import { createServer, type ServerResponse } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { devNull } from "node:os";
import { emptyUsage, type AssistantMessage, type Message } from "@lyra/core";

/** Local deterministic model fixtures go through the real provider, loop, IPC and renderer. */
export function issueModel() {
	let next: "hold" | "question" | "multi" | "text" | "plan" | "discard" = "text";
	const held: ServerResponse[] = [];
	const answers: string[] = [];
	const emit = (res: ServerResponse, type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
	const finish = (res: ServerResponse, reason = "end_turn") => {
		emit(res, "content_block_stop", { index: 0 });
		emit(res, "message_delta", { delta: { stop_reason: reason }, usage: { output_tokens: 20 } });
		emit(res, "message_stop", {}); res.end();
	};
	const server = createServer((req, res) => {
		let raw = ""; req.on("data", chunk => { raw += chunk; });
		req.on("end", () => {
			answers.push(raw);
			const mode = next; next = "text";
			res.writeHead(200, { "content-type": "text/event-stream" });
			emit(res, "message_start", { message: { id: `issue-${Date.now()}`, role: "assistant", content: [], usage: { input_tokens: 100, cache_read_input_tokens: 900, output_tokens: 0 } } });
			if (mode === "plan" || mode === "discard") {
				emit(res, "content_block_start", { index: 0, content_block: { type: "tool_use", id: `control-${Date.now()}`, name: mode === "plan" ? "todo_write" : "control_main", input: {} } });
				emit(res, "content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(mode === "plan" ? { todos: [{ content: "旧目标待取消", status: "in_progress" }, { content: "待用户确认", status: "pending" }] } : { action: "pause", discardPlan: true }) } });
				finish(res, "tool_use");
			} else if (mode === "question" || mode === "multi") {
				emit(res, "content_block_start", { index: 0, content_block: { type: "tool_use", id: `ask-${Date.now()}`, name: "ask_user", input: {} } });
				emit(res, "content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ question: "请选择处理方式。上方的分析正文应能完整阅读。", options: [{ label: "保留现有行为", description: "兼容已有使用方式", recommended: true }, "更新实现", "先完成调查"], selectionMode: mode === "multi" ? "multi" : "single", allowCustomInput: true, allowSkip: true }) } });
				finish(res, "tool_use");
			} else {
				emit(res, "content_block_start", { index: 0, content_block: { type: "text", text: "" } });
				emit(res, "content_block_delta", { index: 0, delta: { type: "text_delta", text: mode === "hold" ? "隔离测试模型正在执行，后续输入可以排队。" : "分析已完成，请确认下一步。正文末尾验证标记。" } });
				if (mode === "hold") held.push(res); else finish(res);
			}
		});
	});
	return { server, answers, set: (value: typeof next) => { next = value; }, finish: () => { for (const res of held.splice(0)) finish(res); } };
}

export async function seedIssues(home: string, port: number) {
	const cwd = join(home, "issue-project"); await mkdir(cwd, { recursive: true });
	const git = (...args: string[]) => promisify(execFile)("git", args, { cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull } });
	await git("init", "-q", "-b", "main"); await git("config", "user.name", "Issue fixture"); await git("config", "user.email", "test@example.invalid");
	await writeFile(join(cwd, "README.md"), "# Isolated issue verification fixture\n");
	await git("add", "."); await git("commit", "-qm", "fixture");
	const remote = join(home, "remote.git"); await git("init", "--bare", remote);
	await git("remote", "add", "origin", remote); await git("push", "-qu", "origin", "main"); await git("commit", "--allow-empty", "-qm", "unpushed fixture");
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	const usage = emptyUsage(); const at = Date.now() - 60_000;
	const assistant = (content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage => ({ role: "assistant", content, stopReason, usage, timestamp: at, api: "anthropic-messages", provider: "issue", model: "fixture" });
	const messages: Message[] = [
		{ role: "user", content: [{ type: "text", text: "隔离测试数据：展开、收起思考和工具过程。" }], timestamp: at },
		assistant([{ type: "thinking", thinking: Array.from({ length: 12 }, (_, i) => `第 ${i + 1} 步：核对真实窗口里的动画尺寸和文本。`).join("\n\n") }, { type: "toolCall", id: "read-fixture", name: "read", arguments: { path: "README.md" }, argumentsText: '{"path":"README.md"}' }], "toolUse"),
		{ role: "toolResult", toolCallId: "read-fixture", toolName: "read", isError: false, content: [{ type: "text", text: "# Isolated issue verification fixture" }], timestamp: at },
		assistant([{ type: "text", text: "分析已完成。所有内容由本地测试夹具产生，未读取真实会话。正文末尾验证标记。" }], "stop"),
	];
	const meta = { id: "issue-demo", title: "Issue 修复验证（隔离数据）", projectId, projectName: "Issue 验证", cwd, createdAt: at, updatedAt: at, modelId: "issue/fixture", messageCount: messages.length, usage, seq: messages.length + 2 };
	const dump = "x".repeat(80_000);
	const huge: Message[] = [
		{ role: "user", content: [{ type: "text", text: "打开这条冷会话，核对骨架屏和首屏卡顿。" }], timestamp: at - 1_000 },
		assistant(
			[
				{ type: "thinking", thinking: "先读一批大结果，再继续。" },
				...Array.from({ length: 36 }, (_, i) => ({ type: "toolCall" as const, id: `dump-${i}`, name: "grep", arguments: { pattern: `dump-${i}` }, argumentsText: `{"pattern":"dump-${i}"}` })),
			],
			"toolUse",
		),
		...Array.from({ length: 36 }, (_, i) => ({ role: "toolResult" as const, toolCallId: `dump-${i}`, toolName: "grep", isError: false, content: [{ type: "text" as const, text: dump }], timestamp: at })),
		assistant([{ type: "text", text: "冷会话大结果已写入夹具。正文末尾验证标记。" }], "stop"),
	];
	const hugeMeta = { id: "issue-cold", title: "冷会话大转录", projectId, projectName: "Issue 验证", cwd, createdAt: at - 2_000, updatedAt: at - 1_000, modelId: "issue/fixture", messageCount: huge.length, usage, seq: huge.length + 2 };
	const dir = join(home, "sessions", projectId); await mkdir(dir, { recursive: true });
	const writeSession = async (id: string, sessionMeta: typeof meta, sessionMessages: Message[]) => {
		await writeFile(join(dir, `${id}.jsonl`), [JSON.stringify({ type: "meta", meta: sessionMeta, seq: 1, ts: at }), ...sessionMessages.map((message, i) => JSON.stringify({ type: "message", message, seq: i + 2, ts: at })), JSON.stringify({ type: "meta", meta: sessionMeta, seq: sessionMeta.seq, ts: at })].join("\n") + "\n");
	};
	await writeSession("issue-demo", meta, messages);
	await writeSession("issue-cold", hugeMeta, huge);
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify([hugeMeta, meta]));
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1500, height: 950 }));
	await writeFile(join(home, "settings.json"), JSON.stringify({ uiLocale: "zh-CN", permissionMode: "full", projectMemory: false, thinking: "off", mcpServers: [], hooks: [], sync: { enabled: false }, appearance: { reduceMotion: "off" }, projects: [{ path: cwd, name: "Issue 验证", pinned: true, lastOpenedAt: at }], defaultModelId: "issue/fixture", providers: [{ id: "issue", name: "本地隔离模型", api: "anthropic-messages", baseUrl: `http://127.0.0.1:${port}`, apiKey: "test", enabled: true, models: [{ id: "issue/fixture", providerId: "issue", modelId: "fixture", name: "隔离测试", contextWindow: 128000, maxOutputTokens: 4096, supportsImages: true, supportsTools: true, supportsThinking: true }] }] }));
}
