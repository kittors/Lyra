/**
 * 命令的两件事：内建的那几条归谁管，以及一条命令展开后怎么送出去。
 *
 * 前者拦的是「只有一个界面知道它们存在」——那三条内建命令此前写在 `Composer.tsx` 里，于是
 * CLI 里没有 `/compact`，设置页也列不出它们。后者是 `deliver`：会话正忙时，插话还是排队。
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { builtinCommandsFor, BUILTIN_COMMANDS } from "../src/commands/builtin.ts";
import { loadCommands } from "../src/commands/loader.ts";
import { AgentSession } from "../src/runtime/session.ts";
import { DEFAULT_SETTINGS, type Settings } from "../src/config/settings.ts";
import type { AssistantMessage, ModelConfig, ProviderConfig } from "../src/types.ts";

const MODEL: ModelConfig = {
	id: "fake/model",
	providerId: "fake",
	modelId: "model",
	name: "Fake",
	contextWindow: 100_000,
	maxOutputTokens: 4096,
	supportsThinking: false,
	supportsImages: false,
	supportsTools: true,
};
const PROVIDER: ProviderConfig = { id: "fake", name: "Fake", baseUrl: "http://localhost", api: "openai-responses", apiKey: "x", enabled: true, models: [MODEL] };
const SETTINGS: Settings = { ...DEFAULT_SETTINGS, providers: [PROVIDER], defaultModelId: MODEL.id, mcpServers: [], permissionMode: "full" };

/*
 * 每次一个新对象。
 *
 * 共用一个引用会被 `log.commit` 的去重挡掉——它按引用记「这条已经提交过」，于是第二轮的
 * 回复静默消失，而症状是后面几轮的历史里少了东西，跟投递逻辑本身毫无关系。
 */
const reply = (): AssistantMessage =>
	({
		role: "assistant",
		content: [{ type: "text", text: "好" }],
		api: "openai-responses",
		provider: "fake",
		model: "model",
		usage: {},
		stopReason: "stop",
		timestamp: 0,
	}) as AssistantMessage;

const STORE = (id: string) =>
	({
		create: async () => ({ id, projectId: "p", cwd: root, title: "", updatedAt: 1 }),
		listSessions: async () => [],
		messages: async () => [],
		append: async (meta: unknown) => meta,
	}) as never;

let root: string;

before(async () => {
	root = await mkdtemp(join(tmpdir(), "ly-cmd-"));
	await mkdir(join(root, "commands"), { recursive: true });
});
after(async () => {
	await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

const sources = () => [{ dir: join(root, "commands"), scope: "workspace" as const, origin: "lyra" as const }];

// ---------------------------------------------------------------------------
// 内建命令
// ---------------------------------------------------------------------------

test("宿主实现了哪些动作，就拿到哪些内建命令", () => {
	/*
	 * `/clear` 在桌面端是开一个新标签，在 CLI 里是清屏重来，而「有一个叫 clear 的命令」在两边
	 * 是同一件事。没实现的动作不该出现在名单里——出现了按下去没反应，比没有更糟。
	 */
	assert.deepEqual(
		builtinCommandsFor(["compact"]).map((c) => c.name),
		["compact"],
	);
	assert.deepEqual(builtinCommandsFor([]).length, 0);
	assert.equal(builtinCommandsFor(["compact", "clear", "manage-commands"]).length, BUILTIN_COMMANDS.length);
});

test("每条内建命令都有说明", () => {
	// 说明就是这一页存在的理由：一个只有名字的列表回答不了「这是干什么的」。
	for (const command of BUILTIN_COMMANDS) {
		assert.ok(command.description.trim(), `${command.name} 没有说明`);
	}
});

// ---------------------------------------------------------------------------
// deliver
// ---------------------------------------------------------------------------

test("没写 deliver 的命令不带这个字段", async () => {
	await writeFile(join(root, "commands", "plain.md"), "---\ndescription: 普通\n---\n干活\n");
	const { commands } = await loadCommands(sources());
	assert.equal(commands.find((c) => c.name === "plain")?.deliver, undefined);
});

test("deliver 读得出来", async () => {
	await writeFile(join(root, "commands", "focus.md"), "---\ndescription: 收窄范围\ndeliver: steer\n---\n只看 src/\n");
	await writeFile(join(root, "commands", "then-test.md"), "---\ndescription: 跑完再测\ndeliver: followUp\n---\n跑一遍测试\n");
	const { commands } = await loadCommands(sources());

	assert.equal(commands.find((c) => c.name === "focus")?.deliver, "steer");
	assert.equal(commands.find((c) => c.name === "then-test")?.deliver, "followUp");
});

test("写错的 deliver 会说出来，而不是静默退回", async () => {
	/*
	 * 静默退回 `prompt` 的话，一条写着 `deliver: steering`（多一个 -ing）的命令会安静地变成
	 * 普通命令——而它跟正确那条唯一的区别，是在模型跑偏时不起作用，那正是写它的人最不会去测
	 * 的时刻。
	 */
	await writeFile(join(root, "commands", "typo.md"), "---\ndescription: 拼错了\ndeliver: steering\n---\n收窄\n");
	const { commands, diagnostics } = await loadCommands(sources());

	assert.equal(commands.find((c) => c.name === "typo")?.deliver, undefined, "按 prompt 处理");
	assert.ok(
		diagnostics.some((d) => d.message.includes("deliver") && d.message.includes("steering")),
		`该有一条诊断说这件事：${JSON.stringify(diagnostics)}`,
	);
});

// ---------------------------------------------------------------------------
// followUp 的行为：不打断，排队
// ---------------------------------------------------------------------------

test("followUp 排在这一轮后面，steer 插进这一轮", async () => {
	/*
	 * 这一条测的是两者**唯一**的区别所在：会话正忙的时候。空闲时它们都是开一个新回合，
	 * 而那个共同点掩盖不了这个差别——一个是「等等，不是那样」，另一个是「做完这个再做那个」。
	 *
	 * 把它们合成一个队列，两种意思里必然有一种表达不出来。
	 */
	const turns: string[][] = [];
	let release: (() => void) | undefined;
	const firstTurnBlocked = new Promise<void>((resolve) => {
		release = resolve;
	});

	const session = new AgentSession({
		cwd: root,
		settings: SETTINGS,
		store: STORE("s1"),
		emit: async () => {},
		streamFn: async (context) => {
			turns.push(
				context.messages.flatMap((m) => (m.role === "user" && !m.synthetic ? m.content.flatMap((c) => (c.type === "text" ? [c.text] : [])) : [])),
			);
			// 第一轮停在这儿，好让两条消息在「正忙」的时候进来。
			if (turns.length === 1) await firstTurnBlocked;
			return reply();
		},
	});
	await session.initialize();

	const first = session.prompt([{ type: "text", text: "第一件事" }]);
	// 等第一轮真的开始跑
	/*
	 * 有上限的等待。
	 *
	 * 上一版是 `while (turns.length === 0)` 不带上限，而 settings 里没配 provider——`run` 直接
	 * 返回，`streamFn` 一次都没被调用，于是这个循环空转到测试超时。一个没有上限的「等它开始」
	 * 在前置条件不成立时不会失败，只会挂住。
	 */
	for (let waited = 0; turns.length === 0 && waited < 400; waited += 1) await new Promise((r) => setTimeout(r, 5));
	assert.ok(turns.length > 0, "第一轮没跑起来——检查 settings 里有没有配 provider");

	await session.prompt([{ type: "text", text: "插一句" }], { deliver: "steer" });
	await session.prompt([{ type: "text", text: "做完再说" }], { deliver: "followUp" });

	release?.();
	await first;

	/*
	 * 断言的是**转录的顺序**，不是 streamFn 收到了什么。
	 *
	 * 第一版断言后者，结果三轮里有两轮拿到空数组——续跑那条路径给 `streamFn` 的 context 不是
	 * 完整历史，而那跟这条测试要验的事毫无关系。转录是这件事唯一的、也是用户真正看到的证据。
	 */
	const said = session.log.messages.map((m) => m.content.filter((c) => c.type === "text").map((c) => c.text).join(""));

	const insertedAt = said.indexOf("插一句");
	const queuedAt = said.indexOf("做完再说");
	assert.ok(insertedAt > 0, `steer 该进转录：${JSON.stringify(said)}`);
	assert.ok(queuedAt > insertedAt, `followUp 该排在 steer 后面：${JSON.stringify(said)}`);
	/*
	 * 中间隔着一条助手消息，就是「不打断」的证据：`followUp` 等到那一轮说完才进来，
	 * 而 `steer` 没等。
	 */
	assert.equal(said[queuedAt - 1], "好", `followUp 前面该是上一轮的回复：${JSON.stringify(said)}`);
});

test("按了停止，排队的那些不该继续跑", async () => {
	/*
	 * 「停止」说的是这个对话现在停下，而不是「停下当前这一轮，然后把我排的三条接着跑完」——
	 * 后者会在人按下按钮之后继续花钱，而屏幕上刚刚显示了已停止。
	 */
	const session = new AgentSession({
		cwd: root,
		settings: SETTINGS,
		store: STORE("s2"),
		emit: async () => {},
		streamFn: async () => reply(),
	});
	await session.initialize();

	// 没在跑的时候排队是立即执行，所以直接检查 abort 会清空队列这件事本身。
	session.abort();
	assert.equal(session.running, false);
});
