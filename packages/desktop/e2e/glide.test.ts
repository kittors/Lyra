/**
 * The highlight on a run of tool work, across the boundary between two turns.
 *
 * The unit tests decide which run `runs` marks; what they cannot show is the thing that was
 * reported — a line still gliding on screen minutes after the work it describes finished, through
 * the whole of a reply that never touched a tool. That is a claim about frames of a live app: the
 * real store, the real memo boundaries, the real CSS class. A finished run that React was never
 * told about looks exactly like a finished run that was, until you watch one.
 *
 * So: one turn of tool work, then a question answered in prose, sampled while it is answered.
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

const MODEL_PORT = 9573;

// ---------------------------------------------------------------------------
// A model that works, answers, and then answers again without working
// ---------------------------------------------------------------------------

/**
 * The three requests this test makes, in order.
 *
 * One turn is two requests — the batch of calls, then the reply once their results come back. The
 * third is the next question, and the whole point of it is that it calls nothing: there is never a
 * new run to take the highlight away, so whatever the previous turn left lit stays lit.
 */
const SCRIPT: ({ tool: string; args: Record<string, unknown> } | { text: string })[][] = [
	[
		{ tool: "ls", args: { path: "." } },
		{ tool: "glob", args: { pattern: "**/*.ts" } },
		{ tool: "read", args: { path: "src/one.ts" } },
	],
	[{ text: "都看完了。" }],
	// Said in pieces, so the sampler sees the reply being written rather than only finished.
	[{ text: "这个交互" }, { text: "可以这么设计：" }, { text: "先把状态说清楚，" }, { text: "再谈动效。" }],
];

const BLOCK_DELAY_MS = 600;

/**
 * How long the last request thinks before saying anything.
 *
 * This is the reported moment, and it is a *gap* rather than an event — the turn is running, the
 * question is on screen, and the reply has produced nothing at all yet. Long enough to be sampled
 * several times.
 */
const PONDER_MS = 1_800;

function sse(res: import("node:http").ServerResponse, payload: unknown): void {
	res.write(`event: ${(payload as { type: string }).type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function startModel(): Server {
	let request = 0;
	const server = createServer((req, res) => {
		req.resume();
		req.on("end", async () => {
			const at = Math.min(request, SCRIPT.length - 1);
			const blocks = SCRIPT[at];
			const pondering = at === 2;
			request++;
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
			});

			// The stream is open and nothing is on it: the turn is running, the reply has not started.
			if (pondering) await new Promise((r) => setTimeout(r, PONDER_MS));

			sse(res, {
				type: "message_start",
				message: { id: `msg_${request}`, role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } },
			});

			for (const [index, block] of blocks.entries()) {
				await new Promise((r) => setTimeout(r, BLOCK_DELAY_MS));
				if ("text" in block) {
					sse(res, { type: "content_block_start", index, content_block: { type: "text", text: "" } });
					sse(res, { type: "content_block_delta", index, delta: { type: "text_delta", text: block.text } });
				} else {
					sse(res, {
						type: "content_block_start",
						index,
						content_block: { type: "tool_use", id: `call_${request}_${index}`, name: block.tool, input: {} },
					});
					sse(res, {
						type: "content_block_delta",
						index,
						delta: { type: "input_json_delta", partial_json: JSON.stringify(block.args) },
					});
				}
				sse(res, { type: "content_block_stop", index });
			}

			const stop = blocks.some((b) => "tool" in b) ? "tool_use" : "end_turn";
			sse(res, { type: "message_delta", delta: { stop_reason: stop }, usage: { output_tokens: 40 } });
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
	await mkdir(join(project, "src"), { recursive: true });
	await writeFile(join(project, "src", "one.ts"), "export const one = 1\n");
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
			sync: { enabled: false, port: 4519, token: null },
		}),
	);
}

before(async () => {
	model = startModel();
	app = await startApp({ port: 9483, seed });
});

after(async () => {
	await cleanupFixture(() => app?.stop(), () => closeListeningServer(model));
});

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

interface Frame {
	/** What each run row says about itself: "running" or "done", top to bottom. */
	marks: string[];
	/**
	 * Each turn's folded process line, "running" or "done". A finished turn folds its work into one
	 * line that draws nothing while closed, so after a turn this — not the rows — is what says the
	 * work is still in the transcript.
	 */
	folds: string[];
	/** How many summary lines carry the glide animation. The claim is: never more than one. */
	glides: number;
	/** Whether the composer is offering to stop, which is the store's `running` on screen. */
	running: boolean;
	/** What the run rows read, so a failure names the work rather than a row number. */
	says: string[];
}

/**
 * One frame of what the transcript shows of its tool work.
 *
 * A constant rather than written inline in `turn`, because the test that opens a finished turn
 * reads the same things once more, and the two readings have to agree on what a row is.
 */
const SAMPLE = `(() => {
	const rows = [...document.querySelectorAll("main [data-ly-run]")];
	return {
		marks: rows.map((row) => row.dataset.lyRun),
		folds: [...document.querySelectorAll("main [data-ly-turn-process]")].map((fold) => fold.dataset.lyTurnProcess),
		glides: document.querySelectorAll("main .ly-glide").length,
		// The stop button is the store's own answer to whether a turn is running.
		running: Boolean(document.querySelector('main [aria-label="停止"]')),
		// The summary by its class: the button's first span is the icon slot, which reads as nothing.
		says: rows.map((row) => (row.querySelector(":scope > button .ly-flow-summary")?.innerText ?? "").trim()),
	};
})()`;

/**
 * Type a message, send it, and sample the transcript until the turn is over.
 *
 * Sampled on a timer rather than driven by events, for the same reason as `transcript.test.ts`:
 * what is being checked is what a person watching the screen sees, and they are not subscribed to
 * anything either.
 */
async function turn(message: string): Promise<Frame[]> {
	return app.evaluate<Frame[]>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const field = document.querySelector("main textarea");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, ${JSON.stringify(message)});
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

		const sample = () => ${SAMPLE};

		const frames = [];
		const deadline = Date.now() + 40000;
		let started = false;
		while (Date.now() < deadline) {
			await wait(70);
			const frame = sample();
			frames.push(frame);
			if (frame.running) started = true;
			if (started && frames.length > 6 && frames.slice(-6).every((f) => !f.running)) break;
		}
		return frames;
	})()`);
}

/** Frames from while the turn was actually running — the only ones the highlight is a claim about. */
function whileRunning(frames: Frame[]): Frame[] {
	return frames.filter((frame) => frame.running);
}

function story(frames: Frame[]): string {
	const out: string[] = [];
	for (const frame of frames) {
		const line = `${frame.running ? "running" : "idle   "} | ${frame.marks.join(",") || "—"} | fold=${frame.folds.join(",") || "—"} | glides=${frame.glides} | ${frame.says.join(" / ")}`;
		if (line !== out[out.length - 1]) out.push(line);
	}
	return out.join("\n  ");
}

let working: Frame[] = [];
let talking: Frame[] = [];

/**
 * Open the finished turn's folded process, the way a person does to look back at the work.
 *
 * Left open on purpose: the tests after this one are about those rows while the next reply is
 * written, and closed they are not drawn at all.
 */
async function openFinishedProcess(): Promise<void> {
	await app.evaluate(`(async () => {
		const line = document.querySelector('main [data-ly-turn-process="done"] > button[aria-expanded="false"]');
		if (!line) throw new Error("no folded process line to open");
		line.click();
		for (let i = 0; i < 300; i++) {
			if (document.querySelector("main [data-ly-turn-process] [data-ly-run]")) return true;
			await new Promise(requestAnimationFrame);
		}
		throw new Error("the folded process opened onto no run");
	})()`);
}

// ---------------------------------------------------------------------------
// The turn that works: the highlight has to be there, or the test below proves nothing
// ---------------------------------------------------------------------------

test("a turn doing tool work glides on the run it is doing", async () => {
	working = await turn("干活");
	const live = whileRunning(working);
	assert.ok(live.length > 3, `the turn never ran (${working.length} samples)\n  ${story(working)}`);

	const lit = live.filter((frame) => frame.marks.includes("running"));
	assert.ok(lit.length > 0, `nothing ever glided while the turn worked:\n  ${story(working)}`);
	assert.ok(
		lit.some((frame) => frame.glides === 1),
		`the run was marked running but the line never carried the animation:\n  ${story(working)}`,
	);

	// Never two at once, at any point.
	const doubled = working.filter((frame) => frame.glides > 1);
	assert.equal(doubled.length, 0, `two lines glided at once:\n  ${story(working)}`);
});

test("and stops gliding when that turn ends", async () => {
	const settled = working[working.length - 1];
	assert.equal(settled.running, false, "the turn should have finished");
	/*
	 * The work folds into one line once the turn is over, and the rows inside are not drawn while it
	 * is closed — so the fold is what says the work is still here, and it has to say it is done. The
	 * rows may or may not still be in the last frame (the fold animates shut); none may be running.
	 */
	assert.deepEqual(settled.folds, ["done"], `the tool work did not fold into one finished line:\n  ${story(working)}`);
	assert.deepEqual(
		settled.marks.filter((mark) => mark !== "done"),
		[],
		`a run was still marked running after the turn ended:\n  ${story(working)}`,
	);
	assert.equal(settled.glides, 0, `a line was still gliding after the turn ended:\n  ${story(working)}`);

	// Opened, the rows are back — done, and not gliding.
	await openFinishedProcess();
	const opened = await app.evaluate<Frame>(SAMPLE);
	assert.ok(opened.marks.length > 0, `the tool work left no row: ${JSON.stringify(opened)}`);
	assert.deepEqual(opened.marks.filter((mark) => mark !== "done"), [], `a run was still marked running: ${JSON.stringify(opened)}`);
	assert.equal(opened.glides, 0, `a line was still gliding: ${JSON.stringify(opened)}`);
});

// ---------------------------------------------------------------------------
// The reported bug
// ---------------------------------------------------------------------------

test("asking something answered in prose never lights the previous turn's work", async () => {
	/*
	 * The report, reproduced: the last run in the transcript belongs to a turn that is over, and
	 * the turn now running will never produce a run of its own. Under the old rule the finished
	 * line lit up the moment the question was sent and glided until the reply was done — through
	 * the pondering, through every word of it.
	 *
	 * Checked across every frame of the reply rather than at the end, because "it was lit for two
	 * seconds and then went out" is the same bug.
	 */
	talking = await turn("先别改代码，说说这个交互怎么设计");
	const live = whileRunning(talking);
	assert.ok(live.length > 8, `the second turn never ran, or was too quick to sample (${talking.length} samples)\n  ${story(talking)}`);

	// It has to be the same transcript, with the first turn's work still on screen — opened by the
	// test above, because a finished turn's rows are folded away otherwise.
	assert.ok(
		live.every((frame) => frame.marks.length > 0),
		`the first turn's run left the transcript:\n  ${story(talking)}`,
	);

	const lit = live.filter((frame) => frame.marks.includes("running") || frame.glides > 0);
	assert.deepEqual(lit, [], `the finished run glided during a reply that touched no tool:\n  ${story(talking)}`);
});

test("the answer arrives and the work above it is still marked done", () => {
	const settled = talking[talking.length - 1];
	assert.equal(settled.running, false);
	assert.deepEqual(settled.marks.filter((mark) => mark !== "done"), [], `\n  ${story(talking)}`);
	assert.equal(settled.glides, 0, `\n  ${story(talking)}`);
	// And the line still says what it said — the fix must not have emptied it.
	assert.ok(
		settled.says.some((line) => line.includes("读取文件") || line.includes("列出目录") || line.includes("查找文件")),
		`the run's summary is gone: ${JSON.stringify(settled.says)}`,
	);
});
