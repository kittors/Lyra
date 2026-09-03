/**
 * What the running line says about a turn that was paused and picked back up.
 *
 * Pressing stop and then 继续 is one piece of work with a gap in it. It was reported as two: the
 * meter was thrown away when the turn ended and lit again from zero when the next message went out,
 * so a task that ran for minutes and was paused once reported the length of its second leg — and
 * the tokens of its second leg, which makes the tokens-per-second a rate for work nobody did.
 *
 * The arithmetic is unit-tested in `turn-meter.test.ts`. What cannot be unit-tested is the wiring:
 * the meter is written in three places that each used to overwrite the others — the composer when it
 * sends, `agent_start` when it arrives two seconds later, and the per-session map that keeps the
 * clocks of conversations you are not watching. The fault lived in the seam between them, so this
 * drives the real buttons through the real event stream and reads the number off the screen.
 */

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";

let app: RunningApp;
let model: Server;

const MODEL_PORT = 9577;

/** Long enough that the running line is on screen and the clock has visibly moved. */
const WORKED_MS = 5_000;
/** The gap: the user reading what happened before deciding to carry on. */
const PAUSED_MS = 4_000;

/** Said by the reply that finishes, which is what puts a token count on the line at all. */
const OPENING = "先读一下文件";
const FIRST = "开始干活，这一段要花点时间";
const SECOND = "接着上次继续做";

/**
 * What the first request spends, declared so the carried count is a number the test can name.
 *
 * `usage.total` is only computed when a stream ends, so a turn made entirely of replies that hang
 * would never report a single token however much it claimed at `message_start`. Hence the opening
 * reply: it completes, spends this, and calls a tool — which keeps the turn going into the reply
 * that does hang and can therefore be paused.
 */
const SPENT = 12_000 + 500;

let requests = 0;
const open = new Set<import("node:http").ServerResponse>();

function sse(res: import("node:http").ServerResponse, payload: unknown): void {
	res.write(`event: ${(payload as { type: string }).type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

/**
 * One reply that finishes and calls a tool, then replies that hang.
 *
 * The first one exists to spend something: usage is only totalled when a stream ends, so a turn made
 * only of replies that hang would report zero tokens however much they declared on the way in. Its
 * tool call is what keeps the same turn going into the second reply — which hangs, and is therefore
 * the one that can be paused and later read.
 */
function startModel(): Server {
	const server = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			const turn = requests++;
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
			});
			open.add(res);
			res.on("close", () => open.delete(res));

			if (turn === 0) {
				sse(res, {
					type: "message_start",
					message: { id: "msg_0", role: "assistant", content: [], usage: { input_tokens: 12_000, output_tokens: 0 } },
				});
				sse(res, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
				sse(res, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: OPENING } });
				sse(res, { type: "content_block_stop", index: 0 });
				sse(res, {
					type: "content_block_start",
					index: 1,
					content_block: { type: "tool_use", id: "toolu_1", name: "read", input: {} },
				});
				sse(res, {
					type: "content_block_delta",
					index: 1,
					delta: { type: "input_json_delta", partial_json: JSON.stringify({ path: "one.ts" }) },
				});
				sse(res, { type: "content_block_stop", index: 1 });
				sse(res, { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 500 } });
				sse(res, { type: "message_stop" });
				res.end();
				return;
			}

			sse(res, {
				type: "message_start",
				message: { id: `msg_${turn}`, role: "assistant", content: [], usage: { input_tokens: 3_000, output_tokens: 0 } },
			});
			sse(res, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
			sse(res, {
				type: "content_block_delta",
				index: 0,
				delta: { type: "text_delta", text: turn === 1 ? FIRST : SECOND },
			});
			// Left open: the turn must still be running to be stopped, and to be read after it resumes.
		});
	});
	server.listen(MODEL_PORT, "127.0.0.1");
	return server;
}

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
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
			retryAttempts: 1,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4522, token: null },
		}),
	);
}

before(async () => {
	model = startModel();
	app = await startApp({ port: 9461, seed });
});

after(async () => {
	await app?.stop();
	for (const res of open) res.destroy();
	await closeListeningServer(model);
});

// ---------------------------------------------------------------------------
// Reading the meter off the screen
// ---------------------------------------------------------------------------

/** The running line, parsed: seconds elapsed and tokens spent, as drawn. */
const READ_METER = `(() => {
	const line = document.querySelector("main [data-ly-running]");
	const text = line ? (line.innerText ?? "").replace(/\\s+/g, " ") : "";
	// 「12s」 or 「1m 04s」, and 「31.4k tokens」 or 「812 tokens」.
	const clock = /(?:(\\d+)m )?(\\d+)s/.exec(text);
	const spend = /([\\d.]+)([kMB])? tokens/.exec(text);
	const scale = { k: 1e3, M: 1e6, B: 1e9 };
	return {
		text,
		seconds: clock ? Number(clock[1] ?? 0) * 60 + Number(clock[2]) : -1,
		tokens: spend ? Number(spend[1]) * (scale[spend[2]] ?? 1) : -1,
		stopButton: Boolean(document.querySelector('main button[aria-label="停止"]')),
	};
})()`;

interface Meter {
	text: string;
	seconds: number;
	tokens: number;
	stopButton: boolean;
}

const meter = () => app.evaluate<Meter>(READ_METER);

async function untilTranscript(has: string, ms = 25_000): Promise<boolean> {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		const text = await app.evaluate<string>(`(document.querySelector("main")?.innerText ?? "")`);
		if (text.includes(has)) return true;
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	return false;
}

async function ask(text: string): Promise<void> {
	await app.evaluate(`(() => {
		const field = document.querySelector("main textarea");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, ${JSON.stringify(text)});
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		return true;
	})()`);
}

async function pressStop(): Promise<boolean> {
	return app.evaluate<boolean>(`(() => {
		const button = document.querySelector('main button[aria-label="停止"]');
		if (!button) return false;
		button.click();
		return true;
	})()`);
}

async function press(label: string): Promise<boolean> {
	return app.evaluate<boolean>(`(() => {
		const buttons = [...document.querySelectorAll("main button")].filter((b) => b.textContent?.trim() === ${JSON.stringify(label)});
		if (buttons.length === 0) return false;
		buttons[buttons.length - 1].click();
		return true;
	})()`);
}

let atPause: Meter;

test("the clock and the token count are running before the pause", async () => {
	await ask("干活");
	assert.ok(await untilTranscript(FIRST), "the reply never started streaming");

	await new Promise((resolve) => setTimeout(resolve, WORKED_MS));
	atPause = await meter();

	assert.equal(atPause.stopButton, true, "the turn ended before it could be paused");
	assert.ok(
		atPause.seconds >= 4,
		`the clock should have counted the ${WORKED_MS / 1000}s of work: ${atPause.text}`,
	);
	assert.ok(
		atPause.tokens >= SPENT * 0.9,
		`the line should be reporting the ${SPENT} tokens the turn has spent: ${atPause.text}`,
	);
});

test("继续 picks the turn up where it stopped instead of starting the clock again", async () => {
	assert.ok(await pressStop(), "the stop button was not on screen during a running turn");
	assert.ok(await untilTranscript("已暂停"), "the pause was never acknowledged");

	// The gap: time the user spent reading, which the turn must not be charged for.
	await new Promise((resolve) => setTimeout(resolve, PAUSED_MS));

	assert.ok(await press("继续"), "the resume offer was not on screen");
	assert.ok(await untilTranscript(SECOND), `继续 never reached the model — asked ${requests} time(s)`);

	const resumed = await meter();

	/*
	 * Three things, and the middle one is the fault this file exists for.
	 *
	 * Carried at all — a resumed turn that reads 「1s」 is the bug. Not carrying the pause, because
	 * elapsed is the work's, not the wall's. And never going backwards, since a clock that jumps down
	 * is the same lie in the other direction.
	 */
	assert.ok(
		resumed.seconds >= atPause.seconds,
		`the clock restarted: ${atPause.seconds}s before the pause, ${resumed.seconds}s after (${resumed.text})`,
	);
	const paused = PAUSED_MS / 1000;
	assert.ok(
		resumed.seconds < atPause.seconds + paused,
		`the ${paused}s pause was charged to the turn: ${atPause.seconds}s → ${resumed.seconds}s (${resumed.text})`,
	);
	assert.ok(
		resumed.tokens >= atPause.tokens,
		`the token count went back down: ${atPause.tokens} → ${resumed.tokens} (${resumed.text})`,
	);
});

test("and it keeps counting from there rather than sitting still", async () => {
	const before = await meter();
	await new Promise((resolve) => setTimeout(resolve, 3_000));
	const after = await meter();

	assert.equal(after.stopButton, true, "the resumed turn ended before this could be read");
	assert.ok(
		after.seconds >= before.seconds + 2,
		`the resumed clock stopped moving: ${before.seconds}s → ${after.seconds}s (${after.text})`,
	);
});

test("a new question starts a fresh meter, so the carried one does not leak into it", async () => {
	/*
	 * The other half of carrying: it has to stop. A frozen meter that outlived the work it measured
	 * would be added to whatever ran next, and the next turn would open claiming minutes it had not
	 * spent — which is a worse number than the one this fix replaced, because it looks plausible.
	 */
	assert.ok(await pressStop(), "the resumed turn could not be stopped");
	assert.ok(await untilTranscript("已暂停"), "the second pause was never acknowledged");
	await new Promise((resolve) => setTimeout(resolve, 1_500));

	await ask("换个问题");
	assert.ok(await untilTranscript(SECOND), "the new question never reached the model");
	await new Promise((resolve) => setTimeout(resolve, 1_000));

	const fresh = await meter();
	assert.ok(
		fresh.seconds >= 0 && fresh.seconds < 5,
		`a new question inherited the paused turn's clock: ${fresh.text}`,
	);
});
