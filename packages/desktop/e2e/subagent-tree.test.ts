/**
 * 派生树与合计成本，在真窗口里、走完整条链。
 *
 * 面板上那棵树的每一环都有自己的测试：`sub-agent-lineage` 证明注册表记下了父子与账单，
 * `subagent-tree` 证明 store 把名单折成树，`ui/subagent-roster` 证明组件按层缩进。它们
 * 都碰不到的是这条链本身——`.lyra/agents/boss.md` 里一行 `spawns: "*"` 能不能真的让
 * 第二层发生、摘要能不能原样穿过 IPC、面板会不会在派发时自己打开。这三样以前各断过一次，
 * 而且断得很安静：树画不出来，看起来跟「没人派过第二层」一模一样。
 *
 * 模型是假的：一个按「谁在问」回不同剧本的 Anthropic 流式服务。三笔账的数字各不相同，
 * 所以「谁的账记到谁头上」是能分辨的，不是「总数对了」就算。
 */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";

const MODEL_PORT = 9873;
const CDP_PORT = 9463;

let app: RunningApp;
let model: Server;
/** 每个请求是谁发的，按顺序。「boss → explore」出现在里面，就是第二层真的发生了。 */
const asked: string[] = [];

function sse(res: ServerResponse, events: [string, unknown][]): void {
	res.writeHead(200, { "content-type": "text/event-stream" });
	for (const [type, data] of events) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
	res.end();
}

/** 一条完整的流式回复：要么一段话，要么一次 `task` 调用；账单放在 Anthropic 放它的两个位置。 */
function reply(res: ServerResponse, r: { text?: string; tool?: Record<string, unknown>; input: number; output: number }): void {
	const id = `t${Math.random().toString(36).slice(2, 8)}`;
	const blocks: [string, unknown][] = r.tool
		? [
				["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "tool_use", id, name: "task", input: {} } }],
				["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(r.tool) } }],
				["content_block_stop", { type: "content_block_stop", index: 0 }],
			]
		: [
				["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
				["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: r.text } }],
				["content_block_stop", { type: "content_block_stop", index: 0 }],
			];
	sse(res, [
		[
			"message_start",
			{
				type: "message_start",
				message: { id: "m", type: "message", role: "assistant", content: [], model: "scripted", stop_reason: null, usage: { input_tokens: r.input, output_tokens: 0 } },
			},
		],
		...blocks,
		["message_delta", { type: "message_delta", delta: { stop_reason: r.tool ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: r.output } }],
		["message_stop", { type: "message_stop" }],
	]);
}

function startModel(): Server {
	const server = createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => (raw += chunk));
		req.on("end", () => {
			const body = JSON.parse(raw) as { system?: string | { text?: string }[]; messages?: { content: unknown }[] };
			const system = typeof body.system === "string" ? body.system : (body.system ?? []).map((b) => b.text ?? "").join("\n");
			const parts = (body.messages ?? []).flatMap((m) => (Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }])) as {
				type: string;
				text?: string;
			}[];
			const texts = parts.map((c) => (c.type === "text" ? (c.text ?? "") : ""));
			const answered = parts.some((c) => c.type === "tool_result");
			// 主会话由用户那句话认，boss 由它自己提示词里的标记认，剩下的就是 explore。
			const who = system.includes("BOSS_MARKER") ? "boss" : texts.some((t) => t.includes("ORCH-PROBE")) ? "main" : "explore";
			asked.push(who);
			if (who === "main" && !answered) reply(res, { tool: { description: "编排一次搜索", prompt: "去编排：派 explore 找登录入口", subagent_type: "boss" }, input: 1200, output: 40 });
			else if (who === "main") reply(res, { text: "编排完成：登录入口在 auth.ts:42。", input: 1600, output: 60 });
			else if (who === "boss" && !answered) reply(res, { tool: { description: "找登录入口", prompt: "找登录入口在哪", subagent_type: "explore" }, input: 900, output: 30 });
			else if (who === "boss") reply(res, { text: "叶子在 auth.ts:42 找到了登录入口。", input: 1500, output: 50 });
			else reply(res, { text: "登录入口在 auth.ts:42。", input: 500, output: 20 });
		});
	});
	server.listen(MODEL_PORT, "127.0.0.1");
	return server;
}

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(join(project, ".lyra", "agents"), { recursive: true });
	await writeFile(join(project, "auth.ts"), "export const login = 1\n");
	// 这一行 `spawns` 是整条测试的开关：没有它，boss 拿不到 task 工具，第二层不会发生。
	await writeFile(join(project, ".lyra", "agents", "boss.md"), '---\nname: boss\ndescription: 编排者，会再派 explore 去找\nspawns: "*"\n---\nBOSS_MARKER 你是编排者，把搜索派给 explore。\n');
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [
				{
					id: "local",
					name: "Local",
					baseUrl: `http://127.0.0.1:${MODEL_PORT}`,
					api: "anthropic-messages",
					apiKey: "not-a-key",
					enabled: true,
					models: [
						{
							id: "local/scripted",
							providerId: "local",
							modelId: "scripted",
							name: "Scripted",
							contextWindow: 200000,
							maxOutputTokens: 8192,
							supportsThinking: false,
							supportsImages: false,
							supportsTools: true,
							// 定价是成本那一列的前提；数字挑得让合计正好过一分钱、叶子不到一分钱。
							pricing: { input: 3, output: 15 },
						},
					],
				},
			],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: "local/scripted",
			permissionMode: "full",
			thinking: "off",
			retryAttempts: 0,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4523, token: null },
			appearance: { theme: "dark" },
		}),
	);
}

before(async () => {
	model = startModel();
	app = await startApp({ port: CDP_PORT, seed });
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
	await new Promise((r) => setTimeout(r, 600));
});

after(async () => {
	await app?.stop();
	await closeListeningServer(model);
});

async function ask(text: string): Promise<void> {
	await app.evaluate(`(() => {
		const field = document.querySelector("main textarea");
		if (!field) throw new Error("找不到输入框——选择器过时了，这条测试在测别的东西");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, ${JSON.stringify(text)});
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		return true;
	})()`);
}

const transcript = () => app.evaluate<string>(`(document.querySelector("main")?.innerText ?? "")`);

async function until(text: string, tries = 120): Promise<boolean> {
	for (let i = 0; i < tries; i++) {
		if ((await transcript()).includes(text)) return true;
		await new Promise((r) => setTimeout(r, 250));
	}
	return false;
}

test("一行 spawns 让第二层真的发生，面板画出树、算出账、并且自己打开", async () => {
	await ask("ORCH-PROBE 派一次编排");
	assert.ok(await until("编排完成"), `主会话该收到 boss 的回报并收尾，实际：${(await transcript()).slice(0, 200)}`);
	await new Promise((r) => setTimeout(r, 600));

	assert.deepEqual(asked, ["main", "boss", "explore", "boss", "main"], "两层各自问了模型，顺序是派下去再收回来");

	const seen = await app.evaluate<{
		pane: boolean;
		rows: [string | null, string | null, string, string | null][];
		totals: string[];
		header: string | null;
		bar: string | null;
	}>(`(() => ({
		pane: !!document.querySelector('[data-dock-pane="subagents"]'),
		rows: [...document.querySelectorAll("[role=treeitem]")].map((r) => [
			r.querySelector("button")?.textContent ?? null,
			r.getAttribute("aria-level"),
			r.style.paddingLeft,
			r.querySelector("[data-sub-figures]")?.textContent ?? null,
		]),
		totals: [...document.querySelectorAll("[data-sub-total]")].map((t) => t.textContent),
		header: document.querySelector('[data-dock-pane="subagents"] [data-sub-figures]:not([role] *)')?.textContent ?? null,
		bar: document.querySelector("[data-ly-subagent-bar]")?.innerText ?? null,
	}))()`);

	assert.ok(seen.pane, "派发时面板自己打开了——不用先去点状态条");
	assert.equal(seen.rows.length, 2, "两层，两行");
	assert.equal(seen.rows[0][1], "1");
	assert.equal(seen.rows[1][1], "2", "explore 在 boss 下面一层");
	assert.ok(Number.parseFloat(seen.rows[1][2]) > Number.parseFloat(seen.rows[0][2]), `第二层要缩进：${seen.rows[1][2]} vs ${seen.rows[0][2]}`);
	assert.match(seen.rows[0][0] ?? "", /编排一次搜索.*boss/);
	assert.match(seen.rows[1][0] ?? "", /找登录入口.*explore/);
	/*
	 * 账：boss 自己 900+30 与 1500+50 两笔，叶子 500+20 一笔。根节点显示整个分支，
	 * 叶子显示自己——不足一分钱写成 <$0.01，而不是看起来像免费的 $0.00。
	 */
	assert.equal(seen.rows[0][3], "3.0k · $0.01", "根节点是整个分支：2480 + 520");
	assert.equal(seen.rows[1][3], "520 · <$0.01");
	assert.ok(seen.totals.includes("本次编排 · 2 个子 Agent · 3.0k · $0.01"), `合计行：${JSON.stringify(seen.totals)}`);
	assert.match(seen.bar ?? "", /2 个子 Agent 已结束[\s\S]*3\.0k · \$0\.01/, "状态条上也有合计——那是跑的时候大家都看着的一行");
});
