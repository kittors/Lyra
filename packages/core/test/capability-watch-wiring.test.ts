/**
 * 一个真的会话，会不会自己看见磁盘上多出来的技能。
 *
 * 监听器本身的测试在隔壁；这个文件测的是**有没有人接它**。那份 `watched` 名单一直被收集着——
 * 每个 provider 都老实报了自己读过哪些目录——而 `LoadedCapabilities` 从来没带上它，所以谁也
 * 拿不到，谁也建不了监听。
 *
 * 这是这个分支上第十次同一个模式，所以它有一条对照：把接线摘掉，这里必须变红。
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { AgentSession } from "../src/runtime/session.ts";
import { DEFAULT_SETTINGS, type Settings } from "../src/config/settings.ts";
import type { AgentEvent } from "../src/agent/events.ts";
import type { SessionMeta } from "../src/session/store.ts";
import type { SessionStorage } from "../src/session/storage.ts";

let home: string;
let root: string;

const META = { id: "s1", projectId: "p", cwd: "", modelId: "m", title: "", createdAt: 0, updatedAt: 0 } as unknown as SessionMeta;
const STORE = { append: async (meta: SessionMeta) => meta, create: async () => META } as unknown as SessionStorage;

before(async () => {
	home = await mkdtemp(join(tmpdir(), "ly-hot-home-"));
	root = await mkdtemp(join(tmpdir(), "ly-hot-"));
	process.env.LYRA_HOME = home;
});

after(async () => {
	delete process.env.LYRA_HOME;
	await rm(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

async function skill(dir: string, name: string): Promise<void> {
	await mkdir(join(dir, ".lyra", "skills", name), { recursive: true });
	await writeFile(
		join(dir, ".lyra", "skills", name, "SKILL.md"),
		`---\nname: ${name}\ndescription: 一个用来看它有没有被读到的技能\n---\n正文\n`,
		"utf8",
	);
}

test("会话起来之后，新加的技能自己就进来了", async () => {
	const cwd = join(root, "project");
	await skill(cwd, "first");

	const events: AgentEvent[] = [];
	const session = new AgentSession({
		cwd,
		settings: DEFAULT_SETTINGS as Settings,
		store: STORE,
		meta: { ...META, cwd },
		emit: async (event) => void events.push(event),
	});

	try {
		await session.initialize();
		assert.ok(
			session.can.skills.some((s) => s.name === "first"),
			"起步时该有一个",
		);
		assert.ok(session.can.watched.length > 0, "读过的目录要报上来——这份名单以前一直到不了这里");

		/*
		 * 写文件，然后**直接触发一次重载**，而不是等 `fs.watch` 发事件。
		 *
		 * 这条测的是接线：会话建立了监听（上面那行 `watched.length > 0`），而且重载会更新
		 * `can.skills` 并把变化说出来。「`fs.watch` 在这台机器上多久发事件」是 Node 的事，
		 * 而在负载高时它要等十几秒——`capability-watch.test.ts` 为这个把超时调大过三次，
		 * 每次还是偶发红，最后才看清那是在赌 FSEvents 的延迟。
		 *
		 * 真实事件那条路径由 `capability-watch.test.ts` 的替身覆盖：那里测的正是「收到事件
		 * 之后做什么」。
		 */
		await skill(cwd, "second");
		await session.reloadCapabilities();
		assert.ok(
			session.can.skills.some((s) => s.name === "second"),
			"重载之后会话该看见",
		);

		const changed = events.find((e) => e.type === "capabilities_changed");
		assert.ok(changed, "而且要说出来，不能默默换掉");
		assert.equal(changed.type === "capabilities_changed" && changed.skills, 1);
		assert.deepEqual(changed.type === "capabilities_changed" ? changed.added : [], ["second"]);
	} finally {
		await session.dispose();
	}
});

test("会话结束时监听也停", async () => {
	/*
	 * 没人关的 `fs.watch` 会一直拿着描述符，而一天里会开关几十个会话。
	 */
	const cwd = join(root, "disposed");
	await skill(cwd, "only");

	const events: AgentEvent[] = [];
	const session = new AgentSession({
		cwd,
		settings: DEFAULT_SETTINGS as Settings,
		store: STORE,
		meta: { ...META, cwd },
		emit: async (event) => void events.push(event),
	});
	await session.initialize();
	await session.dispose();

	const before = events.length;
	await skill(cwd, "after-dispose");
	await new Promise((resolve) => setTimeout(resolve, 600));
	assert.equal(events.length, before, "已经结束的会话不该再对磁盘有反应");
});
