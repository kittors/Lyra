/**
 * Pressing stop, and what the conversation offers once you have.
 *
 * The unit tests prove `howItStopped` reads an aborted tail correctly. They cannot prove the thing
 * that was actually broken, because it lived in the seams: the state that decides whether anything
 * is offered was computed when a session was *opened*, so a turn paused in the conversation you
 * were already sitting in left the window with nothing to say. The transcript looked finished, and
 * getting back in meant typing 「继续」 by hand.
 *
 * So: a real model that really streams, the real stop button, the real IPC path, and the real React
 * tree — checked before the pause as well as after it, because a row that offers to resume a turn
 * that is still running would be worse than one that never appears.
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

const MODEL_PORT = 9565;

// ---------------------------------------------------------------------------
// A model that starts talking and does not stop
// ---------------------------------------------------------------------------

let requests = 0;
/** Held open so they can be hung up on at the end; an unclosed socket keeps the server alive. */
const open = new Set<import("node:http").ServerResponse>();

function sse(res: import("node:http").ServerResponse, payload: unknown): void {
	res.write(`event: ${(payload as { type: string }).type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

/** The replies, in the order they are asked for. `null` streams a sentence and then hangs. */
const SCRIPT: (string | null)[] = [
	// 1. The turn that gets paused, then thrown away by 重试.
	null,
	// 2. What 重试 asks for: the same question, answered afresh.
	"这次答完了。",
	// 3. A second conversation's turn, paused the same way and kept by 继续.
	null,
	// 4. What 继续 asks for: the rest of the work, added to what is already there.
	"接着上次做完了。",
];

/** Said by the reply that gets interrupted, so its disappearance is something a test can see. */
const HALF = "开始干活，这一段很长";

/**
 * A reply that hangs is what a long turn looks like from the window's side.
 *
 * It is also the only state in which the stop button exists, so it is the only way to reach any of
 * this. The scripted turns either side of it prove what the two buttons then do — one keeps the
 * half-written reply and adds to it, the other replaces it.
 */
function startModel(): Server {
	const server = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			// Indexed, not `??`: `null` is the instruction to hang, and `??` would read it as absent.
			const line = requests < SCRIPT.length ? SCRIPT[requests] : "好了。";
			requests++;
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
			});
			open.add(res);
			res.on("close", () => open.delete(res));

			sse(res, {
				type: "message_start",
				message: { id: `msg_${requests}`, role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } },
			});
			sse(res, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
			sse(res, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: line ?? HALF } });

			// Left open on purpose: the turn has to still be running when the stop button is pressed.
			if (line === null) return;

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
	app = await startApp({ port: 9454, seed });
});

after(async () => {
	await cleanupFixture(
		() => app?.stop(),
		() => { for (const res of open) res.destroy(); },
		() => closeListeningServer(model),
	);
});

// ---------------------------------------------------------------------------
// The pause
// ---------------------------------------------------------------------------

/** What the resume row says, and where it sits, as the window has it right now. */
interface Row {
	/** Its text, or "" when the row is not on screen at all. */
	text: string;
	/** The labels of the buttons in it, in the order they are drawn. */
	buttons: string[];
	/** Whether it sits below the last reply rather than anywhere else in the transcript. */
	belowTheReply: boolean;
	/** Whether the turn is still going, read from the running indicator's loader. */
	running: boolean;
}

/*
 * A button's name is its aria-label when it has one.
 *
 * The resume row's buttons are icons now, their words moved into the label (and the tooltip): a
 * button that does one thing is an icon. Reading textContent, this row had no 继续 in it at all,
 * so every test below failed to find it — and the first one passed without looking, because an
 * empty reading also satisfies "the row is not there mid-turn".
 */
const NAME = `(b) => (b.getAttribute("aria-label") ?? b.textContent ?? "").trim()`;

const READ_ROW = `(() => {
	const name = ${NAME};
	const rows = [...document.querySelectorAll("main div")].filter((el) => {
		/*
		 * Only what is on screen. A conversation switched away from stays in the DOM, hidden, and a
		 * hidden element's innerText falls back to its textContent — so the other conversation's
		 * row would be read as this one's.
		 */
		if (!el.checkVisibility()) return false;
		const text = el.innerText ?? "";
		if (!/已暂停|上次执行被中断|计划还有/.test(text)) return false;
		return [...el.querySelectorAll("button")].some((b) => name(b) === "继续");
	});
	// The innermost match: the outer ones are its ancestors, which contain the whole transcript.
	const row = rows[rows.length - 1];
	if (!row) return { text: "", buttons: [], belowTheReply: false, running: Boolean(document.querySelector("main [data-ly-running]")) };
	const replies = [...document.querySelectorAll("main .group\\\\/msg")];
	const last = replies[replies.length - 1];
	return {
		text: row.innerText ?? "",
		buttons: [...row.querySelectorAll("button")].map(name),
		belowTheReply: Boolean(last) && row.getBoundingClientRect().top >= last.getBoundingClientRect().bottom - 1,
		running: Boolean(document.querySelector("main [data-ly-running]")),
	};
})()`;

/** Poll the renderer until `READ_ROW` satisfies `done`, or give up. */
async function until(done: (row: Row) => boolean, ms = 20_000): Promise<Row> {
	const deadline = Date.now() + ms;
	let row: Row = { text: "", buttons: [], belowTheReply: false, running: false };
	while (Date.now() < deadline) {
		row = await app.evaluate<Row>(READ_ROW);
		if (done(row)) return row;
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
	return row;
}

/** Type into the composer and send, whatever conversation is on screen. */
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

/** Press the composer's stop button, which only exists while a turn is running. */
async function pressStop(): Promise<boolean> {
	return app.evaluate<boolean>(`(() => {
		const button = document.querySelector('main button[aria-label="停止"]');
		if (!button) return false;
		button.click();
		return true;
	})()`);
}

/** Press one of the resume row's own buttons — the last match, so it is that row's and no other. */
async function press(label: string): Promise<void> {
	await app.evaluate(`(() => {
		const name = ${NAME};
		const buttons = [...document.querySelectorAll("main button")].filter((b) => b.checkVisibility() && name(b) === ${JSON.stringify(label)});
		if (buttons.length === 0) throw new Error("no button named " + ${JSON.stringify(label)} + " on screen");
		buttons[buttons.length - 1].click();
		return true;
	})()`);
}

/**
 * Press a button anywhere on the page, for the confirmation dialog.
 *
 * `press` looks inside `main` because that is where the conversation is; the dialog is a portal
 * and deliberately is not there. Clicked directly rather than through the overlay, so this tests
 * what the button does rather than whether the overlay lets a synthetic event through.
 */
async function pressAnywhere(label: string): Promise<boolean> {
	return app.evaluate<boolean>(`(() => {
		const buttons = [...document.querySelectorAll("button")].filter((b) => b.textContent?.trim() === ${JSON.stringify(label)});
		if (buttons.length === 0) return false;
		buttons[buttons.length - 1].click();
		return true;
	})()`);
}

/** Everything the transcript currently says, for asking what is and is not in it. */
async function transcript(): Promise<string> {
	return app.evaluate<string>(`(document.querySelector("main")?.innerText ?? "")`);
}

async function untilTranscript(has: string, ms = 25_000): Promise<boolean> {
	const deadline = Date.now() + ms;
	while (Date.now() < deadline) {
		if ((await transcript()).includes(has)) return true;
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	return false;
}

let midTurn: Row;
let paused: Row;

test("nothing is offered while the turn is still going", async () => {
	await ask("干活");

	/*
	 * Waited for by its words, not merely by `running`.
	 *
	 * `running` is true from `agent_start`, which is before the model has said anything — so
	 * stopping there produces an empty reply rather than a half-written one, and the tests below
	 * about what survives a pause would be testing nothing.
	 */
	assert.ok(await untilTranscript(HALF), "the reply never started streaming");
	midTurn = await app.evaluate<Row>(READ_ROW);

	assert.equal(midTurn.running, true, "the turn never started, so there was nothing to pause");
	assert.equal(midTurn.text, "", `a resume offer appeared mid-turn: ${midTurn.text}`);
});

test("pressing stop leaves the conversation saying it is paused, not that it broke", async () => {
	assert.ok(await pressStop(), "the stop button was not on screen during a running turn");

	paused = await until((row) => Boolean(row.text));

	assert.match(paused.text, /已暂停/, `the row said "${paused.text}" instead`);
	assert.doesNotMatch(
		paused.text,
		/中断/,
		"a pause the user performed was described back to them as an interruption",
	);
	assert.equal(paused.running, false, "the window still claimed to be running after the stop");
});

test("it offers both readings of a stopped turn: carry on, or ask again", () => {
	assert.deepEqual(paused.buttons, ["继续", "重试"]);
});

test("the offer sits under the reply it is about, at the bottom of the conversation", () => {
	assert.equal(paused.belowTheReply, true, "the row was not below the last reply");
});

test("重试 throws the half-written reply away and has the answer again", async () => {
	/*
	 * The distinction the two buttons exist for. This one is not a second kind of "carry on": the
	 * question is asked again from scratch, so what the paused turn had written must be gone rather
	 * than sitting above the new answer as a false start nobody asked to keep.
	 */
	// There is something to throw away, which is what makes its absence below mean anything.
	assert.ok((await transcript()).includes(HALF), "the pause had already lost the half-written reply");

	/*
	 * Two steps now, and the first one is the point.
	 *
	 * 重试 discards everything the turn did and pays for it again, and it sits one word away from
	 * 继续, which does the opposite — so it asks before doing it. Pressing the button alone must
	 * leave the transcript exactly as it was.
	 */
	await press("重试");
	assert.ok((await transcript()).includes(HALF), "asking is not doing: the half-written reply is still there");
	assert.ok(await pressAnywhere("重新生成"), "the confirmation is on screen");

	assert.ok(await untilTranscript("这次答完了"), `重试 never produced a new answer — asked ${requests} time(s)`);

	const text = await transcript();
	assert.ok(!text.includes(HALF), `the discarded reply is still in the transcript:\n${text}`);
	assert.equal(text.split("干活").length - 1, 1, `the question was left in the transcript twice:\n${text}`);

	const after = await app.evaluate<Row>(READ_ROW);
	assert.equal(after.text, "", `the resume offer stayed up after the answer arrived: ${after.text}`);
});

test("继续 keeps what the paused turn wrote and adds the rest to it", async () => {
	/*
	 * A fresh conversation, because the last test deliberately destroyed the paused state it was
	 * given. Same pause, other button, opposite outcome — which is the whole of the difference.
	 */
	await app.evaluate(`(() => {
		[...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "新对话")?.click();
		return true;
	})()`);
	await new Promise((resolve) => setTimeout(resolve, 800));

	await ask("干活");
	assert.ok(await untilTranscript(HALF), "the second reply never started streaming");
	assert.ok(await pressStop(), "the second turn never reached a state that could be stopped");

	const second = await until((row) => Boolean(row.text));
	assert.match(second.text, /已暂停/, `the second pause said "${second.text}"`);

	const atPause = await transcript();
	assert.ok(atPause.includes(HALF), `the pause itself lost what had already been written:\n${atPause}`);

	await press("继续");

	if (!(await untilTranscript("接着上次做完了"))) {
		const why = await app.evaluate<string>(`JSON.stringify({
			buttons: [...document.querySelectorAll("main button")].map((b) => b.textContent?.trim()).filter(Boolean),
			transcript: (document.querySelector("main")?.innerText ?? "").slice(0, 600),
		}, null, 2)`);
		assert.fail(`继续 never reached the model — asked ${requests} time(s)\n${why}`);
	}
	const text = await transcript();
	assert.ok(text.includes(HALF), `继续 threw away the work it was meant to keep:\n${text}`);

	const after = await app.evaluate<Row>(READ_ROW);
	assert.equal(after.text, "", `the resume offer stayed up after the work resumed: ${after.text}`);
});
