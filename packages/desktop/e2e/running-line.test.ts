/**
 * Whether the window ever stops saying it is working while it is still working.
 *
 * The running line folds away once the answer itself is streaming in, which is right: prose
 * arriving on screen is a better progress report than a phrase about progress. What it must not do
 * is fold away and *stay* folded while the turn goes on without it — the composer's stop button is
 * still spinning, so the two halves of the window disagree about whether anything is happening, and
 * the half that is easier to see is the one that is wrong.
 *
 * Two ways to reach that, both of them ordinary:
 *
 *   1. A reply that says a sentence and then calls a tool. That is one assistant message holding
 *      `[text, toolCall]`, not two messages — so a test that models it as two never sees it.
 *   2. A reply that says a sentence and then goes quiet: a slow provider, a long think between
 *      paragraphs. Nothing arrives, nothing changes, and nothing says the turn is still alive.
 *
 * The model here does both, and hangs in each state so the window can be read while it is in it.
 */

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
// The app's own threshold, so tuning it moves this wait with it rather than quietly stranding it.
import { STALL_MS } from "../src/features/conversation/answering.ts";

let app: RunningApp;
let model: Server;
let project: string;

const MODEL_PORT = 9575;

/** Said before the tool call, so the transcript's "the answer started" state is reachable. */
const PROSE = "先看看这个文件的内容";

// ---------------------------------------------------------------------------
// A model that stops in the two states this is about
// ---------------------------------------------------------------------------

let requests = 0;
const open = new Set<import("node:http").ServerResponse>();

function sse(res: import("node:http").ServerResponse, payload: unknown): void {
	res.write(`event: ${(payload as { type: string }).type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

/**
 * Both replies say a sentence first and then hang; they differ in what they hang *in*.
 *
 * The first hangs having started a tool call, which is the common shape — a model narrating what it
 * is about to do. The second hangs mid-sentence with nothing else open, which is what a stalled
 * stream looks like from here. Neither ever ends, because the question is what the window shows
 * while a turn is unfinished.
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

			sse(res, {
				type: "message_start",
				message: { id: `msg_${turn}`, role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } },
			});
			sse(res, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
			sse(res, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: PROSE } });

			/*
			 * The third reply keeps writing, which is the case the fold exists for.
			 *
			 * Slowly on purpose — 700ms between chunks is slower than any real model and still well
			 * inside the stall threshold, so if the line came back here it would be coming back
			 * during an ordinary answer.
			 */
			if (turn > 1) {
				let sent = 0;
				const writing = setInterval(() => {
					if (sent++ >= 10 || res.writableEnded) {
						clearInterval(writing);
						return;
					}
					sse(res, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: `，第 ${sent} 段` } });
				}, 700);
				res.on("close", () => clearInterval(writing));
				return;
			}

			// The stalled reply stops here: prose on screen, stream open, nothing more coming.
			if (turn > 0) return;

			/*
			 * Prose, then a call — in one message, which is the whole point.
			 *
			 * The arguments arrive as `input_json_delta` and are deliberately left unfinished: a long
			 * `edit` streams its patch for tens of seconds, and that stretch is exactly when the
			 * window used to look idle. Never closing the block keeps the window in it.
			 */
			sse(res, { type: "content_block_stop", index: 0 });
			sse(res, {
				type: "content_block_start",
				index: 1,
				content_block: { type: "tool_use", id: "toolu_1", name: "read", input: {} },
			});
			sse(res, {
				type: "content_block_delta",
				index: 1,
				delta: { type: "input_json_delta", partial_json: '{"path":"one' },
			});
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
			retryAttempts: 1,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4520, token: null },
		}),
	);
}

before(async () => {
	model = startModel();
	app = await startApp({ port: 9456, seed });
});

after(async () => {
	await app?.stop();
	for (const res of open) res.destroy();
	await closeListeningServer(model);
});

// ---------------------------------------------------------------------------
// Reading the two halves of the window
// ---------------------------------------------------------------------------

/** What the window claims about the turn, from both places that claim anything. */
interface Claim {
	/** The transcript's running line is on screen and not folded to nothing. */
	line: boolean;
	/** The composer offers to stop, which is the other half's way of saying "running". */
	stopButton: boolean;
	/** Whether the transcript has the prose yet, so a wait can be aimed at the right moment. */
	prose: boolean;
	/** Whether a tool card for the streaming call is on screen. */
	toolCard: boolean;
	/** In the tree at all, as against folded to nothing — the two are worth telling apart in a failure. */
	mounted: boolean;
	/** The fold's measured height, so a failure says how shut it was rather than only that it was. */
	foldHeight: number;
}

/**
 * Folded counts as gone.
 *
 * The line is collapsed by its wrapper's grid row going to `0fr`, not by being unmounted — so
 * `querySelector` answers "yes" about a row nobody can see, and so does the row's own
 * `getBoundingClientRect`, which reports the height it *would* have and knows nothing about an
 * ancestor clipping it to nothing. The wrapper is the one that shrinks, so the wrapper is what has
 * to be measured.
 */
const READ_CLAIM = `(() => {
	const line = document.querySelector("main [data-ly-running]");
	const fold = line?.closest(".ly-reveal");
	const shown = Boolean(line) && (!fold || fold.getBoundingClientRect().height > 1);
	const text = document.querySelector("main")?.innerText ?? "";
	return {
		line: shown,
		stopButton: Boolean(document.querySelector('main button[aria-label="停止"]')),
		prose: text.includes(${JSON.stringify(PROSE)}),
		toolCard: Boolean(document.querySelector("main [data-ly-run]")),
		mounted: Boolean(line),
		foldHeight: fold ? Math.round(fold.getBoundingClientRect().height) : -1,
	};
})()`;

async function claim(): Promise<Claim> {
	return app.evaluate<Claim>(READ_CLAIM);
}

async function until(done: (c: Claim) => boolean, ms = 20_000): Promise<Claim> {
	const deadline = Date.now() + ms;
	let last: Claim = { line: false, stopButton: false, prose: false, toolCard: false, mounted: false, foldHeight: -1 };
	while (Date.now() < deadline) {
		last = await claim();
		if (done(last)) return last;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
	return last;
}

/**
 * The fold takes time to shut, and reading it mid-close reports a row that is on its way out as
 * one that is there.
 *
 * This is not a detail: polling for "the state has arrived" and asserting on the same reading is
 * what made the first version of these tests pass against the fault they were written for. The
 * collapse is a CSS transition on `grid-template-rows`, so a height of 12px means "closing", and a
 * test that catches that frame proves nothing about what anybody sees a second later. Every
 * assertion here is made on a reading taken after everything has stopped moving.
 */
async function settled(ms = 1_200): Promise<Claim> {
	await new Promise((resolve) => setTimeout(resolve, ms));
	return claim();
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

// ---------------------------------------------------------------------------
// 1. Prose, then a tool call, in one message
// ---------------------------------------------------------------------------

test("a reply that talks and then calls a tool keeps saying it is working", async () => {
	await ask("看看 one.ts");

	// Aimed at the state itself rather than at a delay: the call is open once its card is drawn.
	const arrived = await until((c) => c.prose && c.toolCard);
	assert.equal(arrived.prose, true, "the reply never started streaming");
	assert.equal(arrived.toolCard, true, "the tool call never reached the transcript");

	// Read once the fold has finished moving; see `settled`.
	const working = await settled();

	/*
	 * Both halves, read at the same instant, because the bug is that they disagree.
	 *
	 * The stop button is the control: if it is gone the turn really did end and there is nothing to
	 * assert. While it is there, the transcript claiming otherwise is the fault.
	 */
	assert.equal(working.stopButton, true, "the turn ended before the window could be read");
	assert.equal(
		working.line,
		true,
		`the transcript went quiet while a tool call was still streaming — the composer was still showing 停止 (${JSON.stringify(working)})`,
	);
});

// ---------------------------------------------------------------------------
// 2. Prose that simply stops arriving
// ---------------------------------------------------------------------------

test("a reply that goes quiet mid-answer says so rather than looking finished", async () => {
	await app.evaluate(`(() => {
		[...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "新对话")?.click();
		return true;
	})()`);
	await new Promise((resolve) => setTimeout(resolve, 800));

	await ask("再看一次");
	const streaming = await until((c) => c.prose);
	assert.equal(streaming.prose, true, "the second reply never started streaming");

	/*
	 * Folded while the words are arriving is correct and is not what this checks. What it checks is
	 * that the fold does not outlive the arriving: nothing more is coming, and after a few seconds
	 * of silence the only thing left saying the turn is alive is the composer's stop button.
	 *
	 * Waited out rather than polled for, and waited out past the threshold the app itself uses —
	 * polling would catch the fold on its way shut and call that "the line is there", which is
	 * exactly the false pass this file was rewritten to stop.
	 */
	const stalled = await settled(STALL_MS + 2_500);
	assert.equal(stalled.stopButton, true, "the turn ended on its own, so there was no stall to see");
	assert.equal(
		stalled.line,
		true,
		`prose stopped arriving and the window looked finished while the turn was still running (${JSON.stringify(stalled)})`,
	);
});

// ---------------------------------------------------------------------------
// 3. The case the fold exists for, which must still work
// ---------------------------------------------------------------------------

test("while the answer really is streaming, the line stays out of the way", async () => {
	/*
	 * The other half of the fix, and the one a fix for the first two could easily break.
	 *
	 * Putting the line back whenever prose is not the newest thing is only right if it stays away
	 * while prose *is*. A line that flickers back between paragraphs would be worse than one that
	 * left too early: it is motion under the text someone is reading.
	 */
	await app.evaluate(`(() => {
		[...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "新对话")?.click();
		return true;
	})()`);
	await new Promise((resolve) => setTimeout(resolve, 800));

	await ask("写点长的");
	const started = await until((c) => c.prose);
	assert.equal(started.prose, true, "the third reply never started streaming");

	/*
	 * Sampled across the whole of the answer rather than at the end of it. A single reading cannot
	 * tell "never came back" from "came back and went away again", and a flicker is exactly the
	 * shape of fault that would hide between two readings.
	 */
	const readings: Claim[] = [];
	for (let i = 0; i < 12; i++) {
		await new Promise((resolve) => setTimeout(resolve, 500));
		readings.push(await claim());
	}

	const streamed = readings.filter((c) => c.stopButton);
	assert.ok(streamed.length >= 8, `the turn ended too early to prove anything: ${streamed.length} readings`);
	const shown = streamed.filter((c) => c.line);
	assert.equal(
		shown.length,
		0,
		`the running line came back while the answer was still being written: ${JSON.stringify(shown)}`,
	);
});
