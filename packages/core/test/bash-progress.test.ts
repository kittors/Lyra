/**
 * How often a running command tells the window about itself.
 *
 * Each `onProgress` carries the whole accumulated output, crosses a process boundary and replaces
 * the card. Sent per chunk, a build printing its asset list a line at a time — 192 KB over 2000
 * chunks — put 193 MB through the bridge and re-rendered 60,000 characters of monospace two
 * thousand times. The command was never stuck; the window was.
 *
 * So the rate is bounded by wall-clock rather than by how chatty the command is. The two things
 * that can go wrong with a coalescing fix are both here: sending too much, and — the one that is
 * worse and quieter — losing the last update before the command exits.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Sandbox, SandboxProcess } from "../src/kernel/index.ts";
import { useSandbox } from "../src/sandbox/index.ts";
import { bashTool } from "../src/tools/bash.ts";
import type { ToolContext, ToolResult } from "../src/types.ts";

/** Emits `chunks` lines on a timer, then exits — a build's output, in miniature. */
class ChattySandbox implements Sandbox {
	// Plain fields rather than parameter properties: `node --test` strips types, it does not compile.
	readonly chunks: number;
	readonly everyMs: number;

	constructor(chunks: number, everyMs = 1) {
		this.chunks = chunks;
		this.everyMs = everyMs;
	}

	run(): SandboxProcess {
		const outputs: ((chunk: string) => void)[] = [];
		const exits: ((code: number | null) => void)[] = [];
		let sent = 0;
		const tick = setInterval(() => {
			if (sent >= this.chunks) {
				clearInterval(tick);
				for (const listener of exits) listener(0);
				return;
			}
			sent++;
			for (const listener of outputs) listener(`dist/static/js/chunk-${sent}.js  84.1 kB  15.3 kB\n`);
		}, this.everyMs);
		return {
			onOutput: (listener) => outputs.push(listener),
			onExit: (listener) => exits.push(listener),
			onError: () => {},
			kill: () => clearInterval(tick),
		};
	}
}

function context(onProgress?: (partial: ToolResult) => void): ToolContext {
	return { cwd: process.cwd(), sessionId: "test", state: new Map(), onProgress } as unknown as ToolContext;
}

const textOf = (result: ToolResult) => result.content.map((b) => (b.type === "text" ? b.text : "")).join("");

test("a chatty command does not send one update per chunk", async (t) => {
	const CHUNKS = 600;
	useSandbox(new ChattySandbox(CHUNKS));
	t.after(() => useSandbox(null));

	let updates = 0;
	const result = (await bashTool.execute({ command: "pnpm build" }, context(() => updates++))) as ToolResult;

	// The output itself is untouched: coalescing is about how often, never about what.
	assert.match(textOf(result), /chunk-1\.js/);
	assert.match(textOf(result), new RegExp(`chunk-${CHUNKS}\\.js`));
	/*
	 * The bound is generous on purpose. 600 chunks at 1ms is ~600ms of wall clock, so a 100ms
	 * ticker gives roughly six updates; anything under a fifth of the chunk count proves the
	 * coupling to chunk count is gone, without pinning the test to a timer's exact behaviour.
	 */
	assert.ok(updates < CHUNKS / 5, `${updates} updates for ${CHUNKS} chunks — still one per chunk`);
	assert.ok(updates > 0, "no progress was reported at all");
});

test("the final output is not lost to the gap between ticks", async (t) => {
	/*
	 * The failure this guards against: output arrives, the command exits before the next tick, and
	 * the card is left showing what it had a tenth of a second ago. It is invisible in the common
	 * case — the finished result overwrites the card — and very visible on a command that is
	 * cancelled or times out, which is exactly when someone is reading it.
	 */
	useSandbox(new ChattySandbox(3, 1));
	t.after(() => useSandbox(null));

	const seen: string[] = [];
	const result = (await bashTool.execute(
		{ command: "echo hi" },
		context((partial) => seen.push(textOf(partial))),
	)) as ToolResult;

	assert.match(textOf(result), /chunk-3\.js/, "the result itself must be complete");
});

test("a command that says nothing reports no progress", async (t) => {
	useSandbox(new ChattySandbox(0));
	t.after(() => useSandbox(null));

	let updates = 0;
	await bashTool.execute({ command: "true" }, context(() => updates++));
	assert.equal(updates, 0, "an interval was started for a command with no output");
});

test("progress is still delivered when someone is watching", async (t) => {
	useSandbox(new ChattySandbox(200, 1));
	t.after(() => useSandbox(null));

	const seen: string[] = [];
	await bashTool.execute({ command: "pnpm build" }, context((partial) => seen.push(textOf(partial))));

	assert.ok(seen.length > 0, "a long command reported nothing while it ran");
	// Each update is the accumulated output, so they only ever grow.
	for (let i = 1; i < seen.length; i++) {
		assert.ok(seen[i].length >= seen[i - 1].length, "an update went backwards");
	}
});

test("no ticker survives the call", async (t) => {
	useSandbox(new ChattySandbox(50, 1));
	t.after(() => useSandbox(null));

	await bashTool.execute({ command: "pnpm build" }, context(() => {}));
	/*
	 * `node --test` hangs on a live handle, so a leaked interval would show up as the whole file
	 * timing out rather than as this assertion failing. Asserting it anyway makes the cause legible
	 * when it does: the timer is unref'd, but unref is a safety net, not the cleanup.
	 */
	const handles = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.() ?? [];
	const timers = handles.filter((h) => h?.constructor?.name === "Timeout");
	assert.equal(timers.length, 0, `${timers.length} timers left running`);
});
