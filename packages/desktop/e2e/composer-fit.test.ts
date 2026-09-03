/**
 * The row along the bottom of the composer, at every width it has to survive.
 *
 * Two reported faults, one cause. The context meter and the words beside the access mark were
 * dropped at fixed field widths — 480px and 420px — and a width cannot answer "does this fit",
 * because what fits depends on how long the model's name is. So the meter went while the row still
 * had 54px of clear air in it, and dropping it freed width that nothing then claimed.
 *
 * The other half of it is the overlap. Both groups were `shrink`, and everything inside the left
 * one is `shrink-0` — so flex squeezed the left *box* to 73px while its contents stayed 124px wide
 * and hung out over the model chip. Nothing was drawn on top of anything; the box was simply
 * narrower than what was in it, which looks exactly the same.
 *
 * Widths here are imposed on the field directly rather than by resizing the window. Below about
 * 760px the shell folds its sidebar away and the composer gets *wider*, so the narrow cases are
 * not reachable from the window at all — and they are the ones this is about.
 */

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";

import { MIN_NAME_WIDTH } from "../src/components/composer/fit.ts";

let app: RunningApp;
let model: Server;

const MODEL_PORT = 9578;

/**
 * A model that answers once and stops.
 *
 * Here only so the conversation has messages in it: the context meter draws a share of the window
 * that has been used, and an empty conversation has used none of it — so on a blank session the
 * meter renders nothing at all and every assertion about it passes without meaning anything. The
 * reported fault is about a meter that had something to show and was hidden anyway.
 */
function startModel(): Server {
	const server = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
			const sse = (payload: unknown) =>
				res.write(`event: ${(payload as { type: string }).type}\ndata: ${JSON.stringify(payload)}\n\n`);
			sse({ type: "message_start", message: { id: "m1", role: "assistant", content: [], usage: { input_tokens: 24_000, output_tokens: 0 } } });
			sse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
			sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "好的。" } });
			sse({ type: "content_block_stop", index: 0 });
			sse({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 200 } });
			sse({ type: "message_stop" });
			res.end();
		});
	});
	server.listen(MODEL_PORT, "127.0.0.1");
	return server;
}

/** Long enough that it is the name, not the row, that runs out of room first. */
const LONG_MODEL = "anthropic-claude-opus-4-6-20250514-extended-thinking-preview";
/** Short enough to always fit, so a narrow row must still keep everything beside it. */
const SHORT_MODEL = "gpt-5";

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
	const model = (name: string) => ({
		id: `relay/${name}`,
		providerId: "relay",
		modelId: name,
		name,
		contextWindow: 200000,
		maxOutputTokens: 8192,
		supportsThinking: true,
		supportsImages: true,
		supportsTools: true,
	});
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [
				{
					id: "relay",
					name: "Relay",
					baseUrl: `http://127.0.0.1:${MODEL_PORT}`,
					api: "anthropic-messages",
					apiKey: "not-a-key",
					enabled: true,
					models: [model(LONG_MODEL), model(SHORT_MODEL)],
				},
			],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: `relay/${LONG_MODEL}`,
			// The one mode whose label is worth keeping, and the reason it is red.
			permissionMode: "full",
			thinking: "high",
			retryAttempts: 1,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4524, token: null },
		}),
	);
}

before(async () => {
	model = startModel();
	app = await startApp({ port: 9468, seed });
	// One stylesheet, rewritten per case; see the note at the top about why not the window.
	await app.evaluate(`(() => {
		const style = document.createElement("style");
		style.id = "e2e-composer-width";
		document.head.appendChild(style);
		return true;
	})()`);
	await new Promise((resolve) => setTimeout(resolve, 500));
});

after(async () => {
	await app?.stop();
	await closeListeningServer(model);
});

// ---------------------------------------------------------------------------
// Reading the row
// ---------------------------------------------------------------------------

interface Row {
	/** The field's own width, which is what the old breakpoints were reading. */
	shell: number;
	/** How much has been given up: 0 all, 1 no meter, 2 no access label. */
	fit: number;
	/** Drawn and occupying width — not merely "its wrapper was not `display: none`". */
	meterShown: boolean;
	/** How wide the meter actually is, so a case can insist it is really on screen. */
	meterWidth: number;
	labelShown: boolean;
	/** Room left for the model's name. */
	nameWidth: number;
	/**
	 * How far the left group's contents reach past the start of the right group's.
	 *
	 * Negative is a gap, which is what it should always be. Measured on the *contents* rather than
	 * the boxes: the fault was a box narrower than what was inside it, so comparing the boxes is
	 * precisely the measurement that cannot see it.
	 */
	overlap: number;
	/** Set instead of the rest when the row could not be read at all. */
	error?: string;
}

const READ_ROW = `(() => { try {
	/*
	 * Found from the model name outwards, not from the field inwards.
	 *
	 * The composer class is a shadow, not an identity — the 回到最新 button wears it too, and it
	 * appears above the field the moment a conversation has something to scroll back through. Taking
	 * the first one on the page therefore worked right up until the first message was sent, and then
	 * measured a button. The model name is in exactly one row, and it is the row this file is about.
	 *
	 * No backticks in here: this whole expression is a template literal, and one would end it.
	 */
	const probe = document.querySelector("main .ly-fit-probe");
	if (!probe) throw new Error("no model name in the composer");
	const bar = probe.closest("[data-ly-fit]");
	if (!bar) throw new Error("the model name is not inside a measured toolbar row");
	const shell = bar.closest(".ly-composer");
	if (!shell) throw new Error("no composer around the toolbar row");
	const [leftGroup, rightGroup] = [...bar.children];
	const meter = shell.querySelector('[data-ly-fit-drop="1"]');
	const label = shell.querySelector('[data-ly-fit-drop="2"]');
	const shown = (el) => Boolean(el) && getComputedStyle(el).display !== "none";
	// Hidden elements report a zero rect at the origin; including them would put the "leftmost"
	// element of the right group at x=0 and turn every reading into a false overlap.
	const boxes = (el) => [...el.children].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0);
	const lefts = boxes(leftGroup);
	const rights = boxes(rightGroup);
	const lastLeft = lefts.sort((a, b) => a.right - b.right).at(-1);
	const firstRight = rights.sort((a, b) => a.left - b.left)[0];
	return {
		shell: Math.round(shell.getBoundingClientRect().width),
		fit: Number(bar.getAttribute("data-ly-fit")),
		meterShown: shown(meter) && meter.getBoundingClientRect().width > 0,
		meterWidth: meter ? Math.round(meter.getBoundingClientRect().width) : -1,
		labelShown: shown(label),
		nameWidth: probe ? Math.round(probe.clientWidth) : -1,
		overlap: lastLeft && firstRight ? Math.round(lastLeft.right - firstRight.left) : -999,
	};
} catch (error) { return { error: String(error && error.message || error) }; } })()`;

/** Put the field at a width and read the row once everything has settled. */
async function at(width: number): Promise<Row> {
	await app.evaluate(`(() => {
		document.getElementById("e2e-composer-width").textContent =
			"main .ly-composer { max-width: ${width}px !important; }";
		return true;
	})()`);
	await new Promise((resolve) => setTimeout(resolve, 450));
	return app.evaluate<Row>(READ_ROW);
}

/** Swap the conversation's model, which is the other thing the row's fit depends on. */
async function useModel(name: string): Promise<void> {
	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
		const chip = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find((x) =>
			(x.dataset.lyTip || "").endsWith("上下文"),
		);
		click(chip);
		await wait(400);
		const row = document.querySelector('[data-model="relay/${name}"]');
		if (!row) throw new Error("model not in the menu: ${name}");
		click(row.querySelector('button[role="menuitem"]'));
		await wait(500);
		return true;
	})()`);
}

// ---------------------------------------------------------------------------
// The reported fault
// ---------------------------------------------------------------------------

test("the conversation has something for the meter to report", async () => {
	// Everything below is about a meter with a reading in it; this is what puts one there.
	await app.evaluate(`(() => {
		const field = document.querySelector("main textarea");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, "你好");
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		return true;
	})()`);

	const deadline = Date.now() + 25_000;
	let row = await at(640);
	while (Date.now() < deadline && !row.meterShown) {
		await new Promise((resolve) => setTimeout(resolve, 300));
		row = await app.evaluate<Row>(READ_ROW);
	}
	assert.equal(row.meterShown, true, `the meter never drew a reading: ${JSON.stringify(row)}`);
	assert.ok(row.meterWidth > 8, `and it takes real width, which is what makes hiding it a saving: ${row.meterWidth}px`);
});

test("a row with room keeps its meter and its label", async () => {
	/*
	 * 440px is under both of the old breakpoints — the meter went at 480 and the label at 420 — and
	 * at this width the row has both, with the name still comfortably readable. That is the whole
	 * report: things disappearing while there was plainly space for them.
	 */
	const row = await at(440);
	assert.equal(row.meterShown, true, `the context meter went at ${row.shell}px with room to spare`);
	assert.equal(row.labelShown, true, "and so did 完全访问");
	assert.equal(row.fit, 0, "nothing was given up");
	assert.ok(row.nameWidth > MIN_NAME_WIDTH, `the name is still readable: ${row.nameWidth}px`);
});

test("nothing overlaps, at any width", async () => {
	/*
	 * Swept rather than sampled, because the old fault appeared gradually — 21px of overhang at
	 * 564px, 47px at 424px — so a check at one width can miss it entirely and a check at the
	 * narrowest misses the middle.
	 */
	const bad: Row[] = [];
	for (const width of [640, 560, 480, 440, 400, 360, 330, 300, 270, 240]) {
		const row = await at(width);
		if (row.overlap >= 0) bad.push(row);
	}
	assert.deepEqual(bad, [], `the left group's contents ran into the right group's:\n${JSON.stringify(bad, null, 1)}`);
});

test("a row that genuinely runs out gives things up, in order", async () => {
	// It has to still work — the point was never to keep everything at every width.
	const tightRow = await at(300);
	assert.ok(tightRow.fit > 0, `nothing was given up at ${tightRow.shell}px: ${JSON.stringify(tightRow)}`);
	assert.equal(tightRow.meterShown, false, "the meter is the first to go");
});

test("and takes it back when the room comes back", async () => {
	/*
	 * The property the breakpoints could not have had. Hiding the meter frees width that nothing
	 * then claims, so a rule that only ever narrows is a rule whose decisions outlive their reason.
	 * Widening has to reverse it, in the order it went.
	 */
	await at(300);
	const roomy = await at(560);
	assert.equal(roomy.fit, 0, "widening the field brought everything back");
	assert.equal(roomy.meterShown, true);
	assert.equal(roomy.labelShown, true);
});

// ---------------------------------------------------------------------------
// The name is what decides, not the width
// ---------------------------------------------------------------------------

test("a short model name keeps the whole row at a width a long one could not", async () => {
	/*
	 * The heart of it. 330px drops two things when the name is 436px wide and drops nothing when it
	 * is 40px, because the question was never how wide the field is — it is whether what is in it
	 * fits. No breakpoint can tell those two rows apart.
	 */
	await at(330);
	const withLong = await app.evaluate<Row>(READ_ROW);
	assert.ok(withLong.fit > 0, `the long name should have cost something at 330px: ${JSON.stringify(withLong)}`);

	await useModel(SHORT_MODEL);
	const withShort = await at(330);
	assert.equal(withShort.fit, 0, `a short name at the same width keeps everything: ${JSON.stringify(withShort)}`);
	assert.equal(withShort.meterShown, true);
	assert.equal(withShort.labelShown, true);
	assert.equal(withShort.overlap < 0, true, "and still does not overlap");
});

test("switching back to a long name gives things up again, without a resize to prompt it", async () => {
	/*
	 * A row can outgrow itself without changing size: picking a longer model is the ordinary way,
	 * and it moves nothing that a resize observer would notice. Measuring only on resize would leave
	 * the row laid out for the model before this one.
	 */
	await useModel(LONG_MODEL);
	await new Promise((resolve) => setTimeout(resolve, 450));
	const row = await app.evaluate<Row>(READ_ROW);
	assert.ok(row.fit > 0, `the row did not react to the longer name: ${JSON.stringify(row)}`);
	assert.ok(row.overlap < 0, "and nothing overlapped while it did");
});
