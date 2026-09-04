/**
 * 谁来跑后台抽取，什么时候跑，跑之前问没问过。
 *
 * 这半边曾经完全不存在。`memory-extract.ts` 写完、测完、导出了，而**没有任何东西调用它**——
 * 它自己的注释写着「同意与调度归调用方」，那个调用方一直没写。读 `MEMORY.md` 的那条线接好了，
 * 写它的那条没有，所以那个文件永远是空的，而且一切看起来都是对的。
 *
 * 所以这个文件里最重要的一条测试是最后一条：跑完之后，磁盘上真的多了一个文件。
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { DEFAULT_SETTINGS, type Settings } from "../src/config/settings.ts";
import { lastPassAt, PASS_INTERVAL_MS, runMemoryPass, shouldRunPass } from "../src/runtime/memory-pass.ts";
import { projectMemoryDir } from "../src/runtime/project-memory.ts";
import { projectIdFor } from "../src/session/store.ts";
import type { SessionStorage } from "../src/session/storage.ts";
import type { AssistantMessage, Message } from "../src/types.ts";

let home: string;
let project: string;

const MODEL = {
	id: "p/m",
	providerId: "p",
	modelId: "m",
	name: "M",
	contextWindow: 100_000,
	maxOutputTokens: 4096,
};
const PROVIDER = { id: "p", name: "P", baseUrl: "x", api: "openai-responses", apiKey: "k", enabled: true, models: [MODEL] };

/** 一份配置好模型、并且已经答应过抽取的设置。 */
function settings(over: Partial<Settings> = {}): Settings {
	return {
		...DEFAULT_SETTINGS,
		providers: [PROVIDER] as never,
		defaultModelId: "p/m",
		memoryExtraction: true,
		...over,
	};
}

function scripted(text: string) {
	const message = {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "p",
		model: "m",
		usage: {},
		stopReason: "stop",
		timestamp: 0,
	} as AssistantMessage;
	return (async function* () {
		yield { type: "text_delta" as const, index: 0, delta: text, partial: message };
		return message;
	}) as never;
}

before(async () => {
	home = await mkdtemp(join(tmpdir(), "ly-pass-home-"));
	project = await mkdtemp(join(tmpdir(), "ly-pass-proj-"));
	process.env.LYRA_HOME = home;
});

after(async () => {
	delete process.env.LYRA_HOME;
	await rm(home, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	await rm(project, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

// ---------------------------------------------------------------------------
// 该不该跑
// ---------------------------------------------------------------------------

test("从没问过，不是「不跑」，是「去问」", () => {
	/*
	 * 这就是 `undefined` 和 `false` 必须分开的全部理由。合成一个布尔，两条路里必然坏掉一条：
	 * 要么永远不问，要么问过了还问。
	 */
	const verdict = shouldRunPass(settings({ memoryExtraction: undefined }), null);
	assert.deepEqual(verdict, { run: false, reason: "never-asked" });
});

test("问过、拒绝了，就不再问", () => {
	assert.deepEqual(shouldRunPass(settings({ memoryExtraction: false }), null), { run: false, reason: "declined" });
});

test("答应了就跑", () => {
	assert.deepEqual(shouldRunPass(settings(), null), { run: true });
});

test("一天之内不跑第二遍", () => {
	/*
	 * 候选会话本身就要「至少 12 小时没动过」，所以更勤只会把同样那几十段转录重读一遍。
	 */
	const now = Date.now();
	assert.deepEqual(shouldRunPass(settings(), now - 1000, now), { run: false, reason: "too-soon" });
	assert.deepEqual(shouldRunPass(settings(), now - PASS_INTERVAL_MS - 1000, now), { run: true });
});

test("没有可用模型是单独一种原因", () => {
	/*
	 * 一个还没配供应商的窗口，会每隔五分钟安静地失败一次，而屏幕上没有任何东西说这件事。
	 */
	const verdict = shouldRunPass({ ...DEFAULT_SETTINGS, memoryExtraction: true, providers: [] } as Settings, null);
	assert.deepEqual(verdict, { run: false, reason: "no-model" });
});

// ---------------------------------------------------------------------------
// 真的跑一遍
// ---------------------------------------------------------------------------

/** 一个够老、够长、能成为候选的会话，写进 `LYRA_HOME/sessions/<projectId>/`。 */
async function seedSession(cwd: string, id: string, lines: string[], ageMs: number): Promise<void> {
	const dir = join(home, "sessions", projectIdFor(cwd));
	await mkdir(dir, { recursive: true });
	const path = join(dir, `${id}.jsonl`);
	await writeFile(path, "", "utf8");
	const when = new Date(Date.now() - ageMs);
	await utimes(path, when, when);
	seeded.set(`${projectIdFor(cwd)}/${id}`, lines.map((text, i) => ({
		role: i % 2 === 0 ? "user" : "assistant",
		content: [{ type: "text", text }],
		timestamp: 0,
	}) as Message));
}

const seeded = new Map<string, Message[]>();
const STORAGE = {
	messages: async (projectId: string, sessionId: string) => seeded.get(`${projectId}/${sessionId}`) ?? [],
} as unknown as SessionStorage;

test("一遍跑完，磁盘上真的多了一个 MEMORY.md", async () => {
	/*
	 * 这条测试是这个文件存在的原因。写它的那条线断了很久，而每一个单元测试都是绿的——因为
	 * 它们测的都是「如果有人调用它，它会做对」。
	 */
	// 六条起：两条的会话是一问一答，而这里找的教训来自工作，不来自查询。
	await seedSession(
		project,
		"s1",
		["跑测试前要先 pnpm build:contract", "好的，记下了", "再跑一次", "跑完了", "提交吧", "已提交"],
		20 * 60 * 60 * 1000,
	);

	const result = await runMemoryPass({
		cwd: project,
		settings: settings(),
		storage: STORAGE,
		stream: scripted("- 跑 e2e 前必须先执行 pnpm build:contract"),
	});

	assert.equal(result.sessions, 1);
	const written = await readFile(join(projectMemoryDir(project), "MEMORY.md"), "utf8");
	assert.match(written, /pnpm build:contract/);
});

test("跑过就记下时间，下一次自己让开", async () => {
	const at = await lastPassAt(project);
	assert.ok(at !== null && Date.now() - at < 60_000, "刚跑完，时间戳应该是刚才");

	const second = await runMemoryPass({ cwd: project, settings: settings(), storage: STORAGE, stream: scripted("- 别的") });
	assert.equal(second.skipped, "too-soon");
});

test("一次空跑也要记下时间", async () => {
	/*
	 * 没有候选的项目，如果不记时间戳，会在每一次空闲时把全部转录重读一遍——永远。空跑和成功
	 * 那一遍花的是同一批工作，只是没产出。
	 */
	const empty = await mkdtemp(join(tmpdir(), "ly-pass-empty-"));
	try {
		const result = await runMemoryPass({ cwd: empty, settings: settings(), storage: STORAGE, stream: scripted("- 不该被写出来") });
		assert.equal(result.skipped, "没有符合条件的会话");
		assert.notEqual(await lastPassAt(empty), null, "什么都没找到，也算跑过一遍");
	} finally {
		await rm(empty, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	}
});

test("太新的会话不读", async () => {
	/*
	 * 二十分钟前结束的对话，多半是那个人去查点什么、还会回来。现在总结它，等于把没写完的一半
	 * 当成结论。
	 */
	const fresh = await mkdtemp(join(tmpdir(), "ly-pass-fresh-"));
	try {
		await seedSession(fresh, "s2", ["a", "b", "c", "d", "e", "f"], 10 * 60 * 1000);
		const result = await runMemoryPass({ cwd: fresh, settings: settings(), storage: STORAGE, stream: scripted("- 不该被写出来") });
		assert.equal(result.skipped, "没有符合条件的会话");
	} finally {
		await rm(fresh, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
	}
});
