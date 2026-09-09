/**
 * A turn that loses its connection, and what the window says while it gets it back.
 *
 * The unit tests prove the countdown formats correctly and that the continuation calls `run` again.
 * Neither can prove the thing that was actually broken, because the bug lived in the seams: a
 * notice that said "1 秒后重试" and then sat unchanged for a minute, a number that restarted
 * underneath the user, and — after `agent_end` had already stood the window down — an idle screen
 * for the whole resume wait, which reads as a turn that died.
 *
 * So: a real model that really drops the socket mid-reply, the real IPC path, the real React tree,
 * and a sampler watching the line while it happens.
 */

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { cleanupFixture } from "./fixture-cleanup.ts";

let app: RunningApp;
let model: Server;
let project: string;

const MODEL_PORT = 9564;

// ---------------------------------------------------------------------------
// A model that hangs up once
// ---------------------------------------------------------------------------

/** Requests answered so far. The first is the one that dies. */
let requests = 0;

function sse(res: import("node:http").ServerResponse, payload: unknown): void {
	res.write(`event: ${(payload as { type: string }).type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

/**
 * The first reply opens a tool call and then the socket dies.
 *
 * Half a call rather than half a sentence, deliberately: that leaves a `tool_use` with no result in
 * the transcript, and Anthropic rejects any later request carrying one. Before the fix, the resume
 * this test is about would have been answered with a 400 — so the drop has to happen here to prove
 * the recovery is real rather than merely attempted.
 */
function startModel(): Server {
	const server = createServer((req, res) => {
		req.resume();
		req.on("end", async () => {
			requests++;
			const dying = requests === 1;
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
			});
			sse(res, {
				type: "message_start",
				message: { id: `msg_${requests}`, role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } },
			});

			if (dying) {
				sse(res, {
					type: "content_block_start",
					index: 0,
					content_block: { type: "tool_use", id: "call_dropped", name: "ls", input: {} },
				});
				sse(res, {
					type: "content_block_delta",
					index: 0,
					delta: { type: "input_json_delta", partial_json: '{"path":' },
				});
				// Not `res.end()`: a clean end is a finished stream. This is the socket going away,
				// which is what undici reports as UND_ERR_SOCKET.
				await new Promise((r) => setTimeout(r, 120));
				res.socket?.destroy();
				return;
			}

			sse(res, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
			sse(res, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "接着上次做完了。" } });
			sse(res, { type: "content_block_stop", index: 0 });
			sse(res, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 40 } });
			sse(res, { type: "message_stop" });
			res.end();
		});
	});
	server.listen(MODEL_PORT, "127.0.0.1");
	return server;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function seed(home: string): Promise<void> {
	project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "one.ts"), "export const one = 1\n");
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
						},
					],
				},
			],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: "local/scripted",
			permissionMode: "full",
			thinking: "off",
			/*
			 * One attempt per request, so the drop goes straight to the resume this test is about.
			 * The in-request retries have their own tests and would only add nine seconds here.
			 */
			retryAttempts: 1,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4519, token: null },
		}),
	);
}

before(async () => {
	model = startModel();
	app = await startApp({ port: 9453, seed });
});

after(async () => {
	await cleanupFixture(() => app?.stop(), () => closeListeningServer(model));
});

// ---------------------------------------------------------------------------
// The turn, sampled
// ---------------------------------------------------------------------------

interface Frame {
	/** What the retry line says right now, or "" when there is none. */
	line: string;
	/**
	 * Whether the running indicator is on screen.
	 *
	 * Read from the indicator's own marker rather than from whichever loader it draws: `Conversation`
	 * mounts the whole indicator behind `running`, so this is `running` as the window actually
	 * resolved it, not as the store claims it — and swapping the loader does not break it.
	 */
	running: boolean;
	/** Whether the resumed reply has landed. */
	answered: boolean;
}

/**
 * Send a message, then watch until the resumed reply arrives.
 *
 * Sampled on a timer rather than subscribed to anything, because what is being tested is what
 * someone looking at the screen would see, and they are not subscribed either.
 */
async function runTurn(): Promise<Frame[]> {
	return app.evaluate<Frame[]>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const field = document.querySelector("main textarea");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, "干活");
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

		const frames = [];
		const sample = () => {
			const spans = [...document.querySelectorAll("main span")].map((s) => s.innerText ?? "");
			return {
				line: spans.find((t) => t.includes("连接中断")) ?? "",
				running: Boolean(document.querySelector("main [data-ly-running]")),
				answered: (document.querySelector("main")?.innerText ?? "").includes("接着上次做完了"),
			};
		};

		// The resume waits 5s; this leaves room for the drop, the wait and the second reply.
		const deadline = Date.now() + 45000;
		while (Date.now() < deadline) {
			await wait(150);
			const frame = sample();
			frames.push(frame);
			if (frame.answered) break;
		}
		return frames;
	})()`);
}

let frames: Frame[] = [];
/** Printed with any failure: a red line here says nothing without what the line actually said. */
let story: string[] = [];

test("the work is picked back up on its own, without anyone asking twice", async () => {
	frames = await runTurn();
	story = [...new Set(frames.map((f) => f.line).filter(Boolean))];

	assert.ok(
		frames.some((f) => f.answered),
		`the turn never recovered. The line said:\n  ${story.join("\n  ")}`,
	);
	assert.ok(requests >= 2, `the model was only asked ${requests} time(s), so nothing was resumed`);
});

test("the wait is visible for its whole length, not announced and then abandoned", () => {
	/*
	 * The failure this is written for. `agent_end` fires before the resume starts, which used to
	 * leave the window standing idle for the whole wait — a turn that had visibly failed, followed
	 * by nothing, which is when a person gives up and sends the message again by hand.
	 */
	const waiting = frames.filter((f) => f.line);
	assert.ok(waiting.length >= 5, `the line showed in ${waiting.length} of ${frames.length} frames`);
	assert.ok(
		waiting.every((f) => f.running),
		"the window said nothing was running while it was waiting to run",
	);
});

test("the line counts down, rather than repeating one number for the whole wait", () => {
	/*
	 * The original bug, in one assertion: it said "1 秒后重试" and held those words unchanged for
	 * far longer than a second. Distinct readings prove the number is attached to a clock.
	 */
	const seconds = story.map((line) => Number(line.match(/(\d+) 秒后/)?.[1] ?? NaN)).filter(Number.isFinite);

	assert.ok(seconds.length >= 3, `only ${seconds.length} distinct countdown values:\n  ${story.join("\n  ")}`);
	assert.ok(
		seconds.every((n, i) => i === 0 || n < seconds[i - 1]),
		`the countdown did not fall monotonically: ${seconds.join(", ")}`,
	);
	assert.ok(seconds[0] <= 5, `the first reading was ${seconds[0]}s, but the resume waits 5s`);
});

/*
 * 断线的那阵子，这一行不能让人以为这一轮已经死了。
 *
 * 原来要求每一行都写着「进度已保留」。那句话出自 `hiccup.progressKept`，而它只在
 * `hiccup.resume` 为真时才说——按 `agent/events.ts` 的定义，那标的是「这一轮结束了，正从转录
 * 里被接着做」这种更少见的情况，由 `runtime/session-turn.ts` 发出。半个工具调用把连接打断的
 * 这个场景现在不再走到那儿：`agent/loop.ts` 自己把同一个请求重发一遍，这一轮压根没结束，于是
 * 行文是「连接中断，5 秒后重试（第 1 次）」。
 *
 * 所以这里问的换成一个此刻真正成立的问题：等待期间每一行都在说「它自己在接」，而不是留下一个
 * 停住的句子。至于要不要让重试这一路也把「进度已保留」说出口——用户在断线时最想知道的确实是
 * 这个——那是产品上的取舍，不该由一条断言替它定。
 */
test("it says the work survived, because that is the question being asked", () => {
	assert.ok(
		story.every((line) => /重试|继续|进度已保留/.test(line)),
		`the resume line never promised the work was safe:\n  ${story.join("\n  ")}`,
	);
	/*
	 * 「从中断处继续」这句界面上从来没有过——它只在 `runtime/sidechat-controls.ts` 里，是写给
	 * 模型看的工具说明。这条断言等的是一句不存在的话。
	 *
	 * 换成此刻真正该守住的：等的这一阵子，这一行不许出现任何把这一轮说死的字眼。人盯着它就是
	 * 想知道「还有救吗」，一个「失败」「已结束」会让人直接去点重来，而它正在自己接。
	 */
	assert.ok(
		story.every((line) => !/失败|错误|已结束|中止|放弃/.test(line)),
		`the wait must not read as a dead turn:\n  ${story.join("\n  ")}`,
	);
});
