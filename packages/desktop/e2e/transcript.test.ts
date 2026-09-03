/**
 * A stretch of tool work, as it is actually drawn while it happens.
 *
 * The grouping rules have unit tests, and they prove the rows are right for a given transcript.
 * What they cannot prove is the thing that was wrong: that the row a call lands in while the
 * reply is still streaming is the row it ends up in. That is a claim about consecutive frames of
 * a live turn, so it needs a live turn — a real model stream, the real IPC path, the real React
 * tree — and a sampler watching the DOM while it runs.
 *
 * The model is a local server speaking Anthropic's wire format, so this costs nothing, needs no
 * key, and can hold a stream open exactly as long as the sampling needs.
 */

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";

let app: RunningApp;
let model: Server;
let project: string;

const MODEL_PORT = 9561;

// ---------------------------------------------------------------------------
// A model that does exactly what this test needs
// ---------------------------------------------------------------------------

/** One block of a scripted reply, in the order the stream should produce it. */
type Block = { tool: string; args: Record<string, unknown> } | { text: string };

/**
 * What the model answers, turn by turn.
 *
 * Two batches of tool calls with nothing said between them — the shape the transcript is meant to
 * draw as a single line — and a sentence to close the turn. The second batch is the one that
 * matters: by the time it starts, the first is finished and on screen, which is exactly when the
 * old code opened a second row for it.
 */
const SCRIPT: Block[][] = [
	[
		{ tool: "ls", args: { path: "." } },
		{ tool: "glob", args: { pattern: "**/*.ts" } },
	],
	[
		{ tool: "read", args: { path: "src/one.ts" } },
		{ tool: "read", args: { path: "src/two.ts" } },
		{ tool: "read", args: { path: "src/three.ts" } },
	],
	[{ text: "都看完了。" }],
];

/** Slow enough that the sampler below sees the reply part-written rather than only finished. */
const BLOCK_DELAY_MS = 700;

function sse(res: import("node:http").ServerResponse, payload: unknown): void {
	res.write(`event: ${(payload as { type: string }).type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function startModel(): Server {
	let turn = 0;
	const server = createServer((req, res) => {
		// Drain the request; the body is not interesting, only which turn this is.
		req.resume();
		req.on("end", async () => {
			const blocks = SCRIPT[Math.min(turn, SCRIPT.length - 1)];
			turn++;
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
			});
			sse(res, {
				type: "message_start",
				message: { id: `msg_${turn}`, role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } },
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
						content_block: { type: "tool_use", id: `call_${turn}_${index}`, name: block.tool, input: {} },
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
	for (const name of ["one", "two", "three"]) {
		await writeFile(join(project, "src", `${name}.ts`), `export const ${name} = 1\n`);
	}
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
			// Nothing here needs a human to nod at it, and an approval sheet would stall the stream.
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
	app = await startApp({ port: 9448, seed });
});

after(async () => {
	await app?.stop();
	await closeListeningServer(model);
});

// ---------------------------------------------------------------------------
// The turn, sampled
// ---------------------------------------------------------------------------

interface Frame {
	/** How many tool-run lines are on screen. */
	rows: number;
	/** What each of them says, in order — the summary line only, not the cards folded under it. */
	says: string[];
	/** How many of the rows on screen are ones an earlier frame already saw. */
	kept: number;
	/** Whether the agent is still working, so the sampler knows when to stop. */
	turning: boolean;
}

/**
 * Send a message, then watch the transcript until the turn ends.
 *
 * Sampling on a timer rather than on an event on purpose: what is being tested is what someone
 * looking at the screen would see, and they are not subscribed to anything either.
 *
 * The end of the turn is read from the running indicator, not from the tool rows. Between two
 * batches every call is finished for a moment — that gap is part of the turn, and a sampler that
 * treats it as the end stops before the interesting half.
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
		/*
		 * Marked on the element itself, so "the same row" means the same DOM node rather than a
		 * row that happens to read the same. A React remount produces an unmarked one.
		 */
		const sample = () => {
			const runs = [...document.querySelectorAll("[data-ly-run]")];
			let kept = 0;
			for (const run of runs) {
				if (run.dataset.lySeen) kept++;
				else run.dataset.lySeen = "1";
			}
			return {
				rows: runs.length,
				says: runs.map((r) => (r.querySelector("button > span")?.innerText ?? "").replace(/\\s+/g, " ").trim()),
				kept,
				// The turn's own indicator: present for the whole turn, gaps between batches included.
				turning: Boolean([...document.querySelectorAll("main svg")].some((s) => s.classList.contains("ly-spin"))),
			};
		};

		// Long enough for three scripted turns at 700ms a block, with room to spare.
		const deadline = Date.now() + 40000;
		let started = false;
		while (Date.now() < deadline) {
			await wait(80);
			const frame = sample();
			frames.push(frame);
			if (frame.turning) started = true;
			/*
			 * 静默多久才算这一轮真的结束。
			 *
			 * 原来是 8 帧（约 640ms）。而模型桩每个 block 之间等 700ms——两批工具之间的间隙
			 * 必然比 640ms 长，于是循环在第二批开始之前就退出了，测试量到的永远只有第一批。
			 * 这条测试从写下那天起就是红的，而它红的原因和被测的代码无关。
			 *
			 * 24 帧约 1.9 秒，比一个 block 的间隔宽裕，又远短于 40 秒的总超时。
			 */
			if (started && frames.slice(-24).every((f) => !f.turning) && frames.length > 24) break;
		}
		return frames;
	})()`);
}

/** Everything the line said, in order, with the repeats squeezed out. */
function transcriptOfLine(frames: Frame[]): string[] {
	const out: string[] = [];
	for (const frame of frames) {
		const line = frame.says[frame.says.length - 1] ?? "";
		if (line && line !== out[out.length - 1]) out.push(line);
	}
	return out;
}

let frames: Frame[] = [];
/** Printed with any failure here: without the frames, a red line says nothing about what moved. */
let story = "";

test("the whole turn is one line, from the first call to the last", async () => {
	frames = await runTurn();
	story = transcriptOfLine(frames).join("\n  ");

	const withWork = frames.filter((f) => f.rows > 0);
	assert.ok(withWork.length > 3, `the turn never drew any tool work (${frames.length} samples)`);
	// Both batches have to have happened, or the interesting half was never tested.
	assert.match(story, /读取文件/, `the second batch never arrived — the line only ever said:\n  ${story}`);

	/*
	 * The failure this test was written for.
	 *
	 * A second batch of calls used to get a row of its own — "执行 3 个操作" under the finished
	 * run — until the reply settled and it jumped into the row above. Two rows on screen at any
	 * moment during a turn with nothing said between the batches is exactly that bug.
	 */
	const most = Math.max(...withWork.map((f) => f.rows));
	assert.equal(most, 1, `the transcript held ${most} tool rows at once. The line read:\n  ${story}`);
});

test("that line only ever gains work, never trades it for a different sentence", () => {
	const said = frames.filter((f) => f.rows === 1).map((f) => f.says[0]);
	assert.ok(said.length > 3, "not enough samples of the line to judge");

	/*
	 * Monotone, clause by clause.
	 *
	 * The line is a list — "列出目录、查找文件、读取文件 3 个" — and the only honest way for it to
	 * change mid-turn is to grow. A running group used to replace the whole thing with the live
	 * call's own label, or with a count of operations, and then put it back: three sentences in
	 * one row while you are trying to read it. Counting clauses catches that without pinning the
	 * test to any particular wording.
	 */
	let clauses = 0;
	for (const line of said) {
		const count = line.split("、").filter(Boolean).length;
		assert.ok(count >= clauses, `the line went backwards: "${line}" after ${clauses} clauses:\n  ${story}`);
		clauses = count;
	}

	// And it describes the work rather than counting events, at every point along the way.
	const counted = said.find((line) => /执行 \d+ 个操作/.test(line));
	assert.equal(counted, undefined, `the line fell back to a count of events:\n  ${story}`);

	const last = said[said.length - 1];
	assert.match(last, /读取文件/, `the second batch never joined the line: "${last}"`);
	assert.match(last, /列出目录/, `the first batch left the line: "${last}"`);
});

test("it is the same element the whole way, not a new one per batch", () => {
	/*
	 * A row that is torn down and rebuilt loses whatever state the reader gave it — an open group
	 * closes by itself, and the entrance animation plays again over work that was already there.
	 * `kept` counts rows a previous frame had already marked, so a remount shows up as a row that
	 * is on screen and unmarked.
	 */
	const afterFirst = frames.slice(frames.findIndex((f) => f.rows > 0) + 1).filter((f) => f.rows > 0);
	const fresh = afterFirst.filter((f) => f.kept < f.rows);
	assert.equal(fresh.length, 0, `the run was rebuilt ${fresh.length} times mid-turn:\n  ${story}`);
});

test("opening the group survives the work still arriving", async () => {
	const kept = await app.evaluate<{ opened: boolean; stillOpen: boolean }>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const run = document.querySelector("[data-ly-run]");
		run.querySelector("button").click();
		await wait(400);
		const opened = Boolean(run.querySelector("[aria-expanded=true]"));
		await wait(600);
		return { opened, stillOpen: Boolean(run.querySelector("[aria-expanded=true]")) };
	})()`);

	assert.equal(kept.opened, true, "the group did not open");
	assert.equal(kept.stillOpen, true, "the group closed itself, so it was rebuilt rather than kept");
});
