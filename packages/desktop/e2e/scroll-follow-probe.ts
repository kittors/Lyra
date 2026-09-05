/* oxlint-disable no-console -- a probe that prints what it measured */
/**
 * Whether the reader can scroll up while a reply is streaming, and whether coming back to a
 * conversation lies about having new content.
 *
 * `node --experimental-strip-types e2e/scroll-follow-probe.ts`
 *
 * Both were reported. Neither can be tested without a real window, because both are claims about a
 * race: a wheel notch and a streamed token arrive from different places and the old code let
 * whichever landed second decide. A unit test can only show that the rule is right — see
 * `test/scroll-follow.test.ts` — not that the rule is what runs.
 *
 * The wheel is dispatched through the DevTools protocol rather than as a synthetic event, so it is
 * a real scroll performed by the browser, with real event ordering against React's commits.
 *
 * What it covers, all of it reported or reasoned out against the old implementation:
 *
 *   1. a 40px nudge upwards mid-stream survives the rest of the turn — the reported bug: under the
 *      old 80px slack it did not, so within that distance the wheel simply did not work;
 *   2. a wheel during the ride back down stops the ride;
 *   3. catching up clears the unread mark, and scrolling back over content already read does not
 *      re-raise it;
 *   4. leaving a conversation and returning — by view and by opening another conversation — keeps
 *      the position and does not claim new content that never arrived;
 *   5. switching conversations during the ride back completes the reader's return instead of
 *      restoring an intermediate position and offering the same button again;
 *   6. the panels that share the hook mount and draw.
 *
 * And one measurement of a browser fact the design was written against: does `display: none` keep
 * a scroll position? Two comments in this repository disagree, and it is reported rather than
 * asserted — it measures the platform, not this code.
 */

import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";

const MODEL_PORT = 9576;
const DEBUG_PORT = 9486;

let app: RunningApp;
let model: Server;

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
function check(label: string, passed: boolean, evidence: string): void {
	if (!passed) failures++;
	process.stdout.write(`${passed ? "✓" : "✗"} ${label}\n    ${evidence}\n`);
}

// ---------------------------------------------------------------------------
// A model that writes slowly enough to scroll against
// ---------------------------------------------------------------------------

/**
 * Sixty paragraphs, one every 60ms.
 *
 * Long enough to overflow the window several times over — the transcript has to be scrollable for
 * any of this to mean anything — and slow enough that a gesture lands in the middle of the stream
 * with a few dozen tokens still to come after it. A token every 60ms is denser than a real model,
 * which is the point: it squeezes the race this is looking for.
 */
const PARAGRAPHS = 60;
const TOKEN_MS = 60;

function sse(res: ServerResponse, payload: unknown): void {
	res.write(`event: ${(payload as { type: string }).type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function startModel(): Server {
	let request = 0;
	const server = createServer((req, res) => {
		req.resume();
		req.on("end", async () => {
			const id = request++;
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
			});
			sse(res, {
				type: "message_start",
				message: { id: `msg_${id}`, role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } },
			});
			sse(res, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
			for (let n = 0; n < PARAGRAPHS; n++) {
				await settle(TOKEN_MS);
				sse(res, {
					type: "content_block_delta",
					index: 0,
					delta: { type: "text_delta", text: `第 ${n + 1} 段：这一段是为了把记录撑得比窗口高，好让人能往上滚。\n\n` },
				});
			}
			sse(res, { type: "content_block_stop", index: 0 });
			sse(res, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 400 } });
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
			sync: { enabled: false, port: 4519, token: null },
		}),
	);
}

// ---------------------------------------------------------------------------
// Driving
// ---------------------------------------------------------------------------

interface Snapshot {
	scrollTop: number;
	scrollHeight: number;
	clientHeight: number;
	distance: number;
	/** Whether the way back is on screen, and how many messages it claims are unread. */
	button: boolean;
	unread: number;
	/** How many such buttons the window has, so a stray panel's does not get read by mistake. */
	buttons: number;
}

async function look(): Promise<Snapshot> {
	/*
	 * The unread state is read from the attribute, not from the label.
	 *
	 * A hidden button says nothing about what it would have said, so testing the text only works
	 * while it is on screen — and "is it clear once I have caught up?" has to be answerable exactly
	 * when the button is *not* shown. One failing run was spent on that.
	 */
	return app.evaluate<Snapshot>(`(() => {
		const el = document.querySelector("main .ly-scroll-view");
		const back = document.querySelector("main button[data-unread]");
		const shown = back ? back.getAttribute("aria-hidden") !== "true" : false;
		return {
			scrollTop: el ? el.scrollTop : -1,
			scrollHeight: el ? el.scrollHeight : -1,
			clientHeight: el ? el.clientHeight : -1,
			distance: el ? el.scrollHeight - el.scrollTop - el.clientHeight : -1,
			button: shown,
			unread: back ? Number(back.getAttribute("data-unread")) : -1,
			buttons: document.querySelectorAll("main button[data-unread]").length,
		};
	})()`);
}

/** Type into the composer and press Enter, without waiting for anything. */
async function send(message: string): Promise<void> {
	await app.evaluate(`(() => {
		const field = document.querySelector("main textarea");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, ${JSON.stringify(message)});
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
	})()`);
}

/**
 * A real wheel, over the middle of the transcript.
 *
 * Through the protocol, not as a synthetic `WheelEvent`: a dispatched event does not scroll
 * anything, so a synthetic one would test the listener while leaving the actual race — browser
 * scroll versus React commit — unexercised.
 */
async function wheel(deltaY: number): Promise<void> {
	const box = await app.evaluate<{ x: number; y: number }>(`(() => {
		const el = document.querySelector("main .ly-scroll-view");
		const rect = el.getBoundingClientRect();
		return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
	})()`);
	await app.send("Input.dispatchMouseEvent", {
		type: "mouseWheel",
		x: box.x,
		y: box.y,
		deltaX: 0,
		deltaY,
		pointerType: "mouse",
	});
}

async function running(): Promise<boolean> {
	return app.evaluate<boolean>(`Boolean(document.querySelector('main [aria-label="停止"]'))`);
}

async function waitForTurnEnd(limitMs = 30000): Promise<void> {
	const deadline = Date.now() + limitMs;
	while (Date.now() < deadline) {
		await settle(200);
		if (!(await running())) return;
	}
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

async function nudgeSurvivesTheStream(): Promise<void> {
	await send("写一段长的");
	// Let enough arrive that the transcript overflows and is genuinely pinned.
	await settle(2200);

	const pinned = await look();
	if (pinned.scrollHeight <= pinned.clientHeight) {
		check("流式中向上滚 40px 不被拽回", false, `记录还没长过窗口，无从滚起：${JSON.stringify(pinned)}`);
		await waitForTurnEnd();
		return;
	}

	// 40px: inside the old 80px slack, which is what made this gesture impossible.
	await wheel(-40);
	await settle(120);
	const justAfter = await look();

	// Now let a dozen more tokens land on top of it.
	await settle(1200);
	const later = await look();

	check(
		"流式中向上滚 40px 不被拽回",
		justAfter.distance > 20 && later.distance > 20,
		`滚动后 distance=${justAfter.distance}，再等 1.2s 后 distance=${later.distance}（回到底部则为 0）`,
	);
	check(
		"离底后不再被后续 token 推着走",
		Math.abs(later.scrollTop - justAfter.scrollTop) < 4,
		`scrollTop ${justAfter.scrollTop} → ${later.scrollTop}`,
	);

	await waitForTurnEnd();
}

async function wheelInterruptsTheRideBack(): Promise<void> {
	// Somewhere well up the transcript, so the ride is long enough to interrupt.
	await app.evaluate(`(() => { document.querySelector("main .ly-scroll-view").scrollTop = 0; })()`);
	await settle(200);
	const away = await look();
	if (!away.button) {
		check("归位动画可被滚轮打断", false, `按钮没出现，无法触发归位：${JSON.stringify(away)}`);
		return;
	}

	await app.evaluate(`(() => {
		const back = [...document.querySelectorAll("main button")].find((b) => /回到最新|有新内容/.test(b.textContent || ""));
		back.click();
	})()`);
	// Mid-glide: the animation runs 420ms.
	await settle(140);
	await wheel(-120);
	await settle(60);
	const interrupted = await look();
	await settle(600);
	const afterAnimationWouldHaveEnded = await look();

	check(
		"归位动画可被滚轮打断",
		afterAnimationWouldHaveEnded.distance > 20,
		`打断时 distance=${interrupted.distance}，动画本应结束后 distance=${afterAnimationWouldHaveEnded.distance}`,
	);
}

/**
 * The browser fact two comments in this repository disagree about.
 *
 * `App.tsx` says `display: none` throws the scroll position away and uses `visibility` to avoid it;
 * `dock/DockPane.tsx` says a pane hidden with `display: none` keeps its scroll position. Both
 * cannot be right, and which one is decides whether hiding a dock pane needs changing.
 */
async function displayNoneKeepsScrollTop(): Promise<void> {
	const measured = await app.evaluate<{ before: number; after: number; heightWhileHidden: number }>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const el = document.querySelector("main .ly-scroll-view");
		el.scrollTop = 400;
		await wait(50);
		const before = el.scrollTop;
		// The pane is hidden by a class on an ancestor, exactly as the collapsed dock layout does it.
		const pane = el.closest(".ly-dock-pane") ?? el.parentElement;
		const previous = pane.style.display;
		pane.style.display = "none";
		await wait(50);
		const heightWhileHidden = el.clientHeight;
		pane.style.display = previous;
		await wait(50);
		return { before, after: el.scrollTop, heightWhileHidden };
	})()`);

	const kept = Math.abs(measured.after - measured.before) < 2;
	process.stdout.write(
		`${kept ? "✓" : "!"} display:none 后 scrollTop ${kept ? "保住了" : "丢了"}\n` +
			`    隐藏前 ${measured.before} → 恢复后 ${measured.after}；隐藏时 clientHeight=${measured.heightWhileHidden}\n` +
			`    ${
				kept
					? "→ DockPane 的注释是对的，App.tsx 那条针对的是另一种情况（整棵子树换掉）。"
					: "→ DockPane 的注释是错的；面板切换会丢位置，需靠 useFollowBottom 的记忆兜底。"
			}\n`,
	);
	// Reported rather than asserted: this measures the platform, not our code. Either answer is
	// actionable, and the follow memory covers the bad one.
}

async function unreadDoesNotLieAfterASwitch(): Promise<void> {
	/*
	 * Catch up first, and this is the whole setup.
	 *
	 * The reported case is 「很多我都读过了，还是显示有新内容」 — content that *has* been seen, on a
	 * conversation that was merely revisited. Without reading to the end first there genuinely is
	 * unread content (the reply went on for another forty paragraphs after the reader scrolled up),
	 * and a probe that skips this step is asserting that a true statement is a lie. It cost one
	 * failing run to notice.
	 */
	await app.evaluate(`(() => {
		const el = document.querySelector("main .ly-scroll-view");
		el.scrollTop = el.scrollHeight;
	})()`);
	await settle(500);

	// Why, when it fails: the sentinel is what marks content read, so its geometry is the evidence.
	const sentinel = await app.evaluate<unknown>(`(() => {
		const root = document.querySelector("main .ly-scroll-view");
		const transcript = root.querySelector(".ly-transcript");
		const last = transcript.lastElementChild;
		const r = root.getBoundingClientRect();
		const s = last.getBoundingClientRect();
		return {
			lastChildClass: last.className,
			lastChildHeight: s.height,
			rootBottom: Math.round(r.bottom),
			sentinelTop: Math.round(s.top),
			insideRoot: s.top >= r.top && s.bottom <= r.bottom,
			children: transcript.children.length,
		};
	})()`);
	process.stdout.write(`    哨兵：${JSON.stringify(sentinel)}\n`);

	const caughtUp = await look();
	check(
		"回到底部后未读清零",
		caughtUp.unread === 0,
		`distance=${caughtUp.distance}，按钮=${caughtUp.button ? "显示" : "隐藏"}，未读=${caughtUp.unread}，按钮数=${caughtUp.buttons}`,
	);

	// Now scroll up over content already read. Nothing arrives while we are up here.
	await app.evaluate(`(() => { document.querySelector("main .ly-scroll-view").scrollTop = 200; })()`);
	await settle(200);
	const before = await look();
	check(
		"读完后往上滚，不会凭空出现未读",
		before.unread === 0,
		`滚到 200 后按钮=${before.button ? "显示" : "隐藏"}，未读=${before.unread}，按钮数=${before.buttons}`,
	);

	// 「计划任务」 unmounts the transcript entirely, which is the same path as opening a cached
	// conversation: the surface goes away and comes back with content it already had.
	await app.evaluate(`(() => {
		const nav = [...document.querySelectorAll("button, a")].find((b) => (b.textContent || "").includes("已安排"));
		if (nav) nav.click();
	})()`);
	await settle(500);
	await app.evaluate(`(() => {
		const rows = [...document.querySelectorAll("aside button, nav button")];
		const row = rows.find((b) => (b.textContent || "").includes("写一段长的"));
		if (row) row.click();
	})()`);
	await settle(900);
	const after = await look();

	check(
		"离开再回来不谎报「有新内容」",
		after.unread === 0,
		`回来后按钮=${after.button ? "显示" : "隐藏"}，未读=${after.unread}，按钮数=${after.buttons}（离开前 distance=${before.distance}）`,
	);
	check(
		"离开再回来仍停在读到的位置",
		Math.abs(after.scrollTop - before.scrollTop) < 40,
		`离开前 scrollTop=${before.scrollTop}，回来后 scrollTop=${after.scrollTop}`,
	);
}

/**
 * The path actually reported: scroll up in one conversation, open another, come back.
 *
 * Different from the view switch above, and the difference is the whole point. Switching to another
 * view unmounts the transcript, so the surface is rebuilt from nothing. Switching *conversations*
 * keeps it mounted and swaps what it holds — which is where the old code wrote the outgoing
 * conversation's position into the incoming one's memory and then read it back as if it were a
 * memory of the incoming one.
 */
async function switchingBetweenTwoConversations(): Promise<void> {
	// A second conversation, so there is something to switch to.
	await app.evaluate(`(() => {
		const button = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "新对话");
		if (button) button.click();
	})()`);
	await settle(600);
	await send("第二个对话");
	await waitForTurnEnd();
	await settle(400);

	// Read to the end of the second one, then go up.
	await app.evaluate(`(() => {
		const el = document.querySelector("main .ly-scroll-view");
		el.scrollTop = el.scrollHeight;
	})()`);
	await settle(400);
	await app.evaluate(`(() => { document.querySelector("main .ly-scroll-view").scrollTop = 300; })()`);
	await settle(300);
	const parked = await look();

	const rows = await app.evaluate<string[]>(`
		[...document.querySelectorAll("aside button, nav button")].map((b) => (b.textContent || "").trim()).filter(Boolean)
	`);
	const other = rows.find((row) => row.includes("写一段长的"));
	if (!other) {
		check("在两个对话之间切换后不谎报未读", false, `侧边栏里找不到第一个对话，只有：${rows.slice(0, 8).join(" / ")}`);
		return;
	}

	const click = (text: string) =>
		app.evaluate(`(() => {
			const row = [...document.querySelectorAll("aside button, nav button")].find((b) => (b.textContent || "").trim() === ${JSON.stringify(text)});
			if (row) row.click();
		})()`);

	await click(other);
	await settle(900);
	await click("第二个对话");
	await settle(900);
	const back = await look();

	check(
		"在两个对话之间切换后不谎报未读",
		back.unread === 0,
		`回到第二个对话：未读=${back.unread}，按钮=${back.button ? "显示" : "隐藏"}`,
	);
	check(
		"在两个对话之间切换后位置还在",
		Math.abs(back.scrollTop - parked.scrollTop) < 40,
		`离开前 scrollTop=${parked.scrollTop}，回来后 scrollTop=${back.scrollTop}`,
	);

	/*
	 * Start the ride and switch in the same task. That deterministically lands inside the 420ms
	 * window which made the reported symptom seem random by hand: the old snapshot encoded
	 * `returning` as detached and kept whichever intermediate scrollTop the last frame had reached.
	 */
	await app.evaluate(`(() => {
		const back = [...document.querySelectorAll("main button")].find((b) => /回到最新|有新内容/.test(b.textContent || ""));
		const row = [...document.querySelectorAll("aside button, nav button")].find((b) => (b.textContent || "").trim() === ${JSON.stringify(other)});
		if (back && row) {
			back.click();
			row.click();
		}
	})()`);
	await settle(900);
	await click("第二个对话");
	await settle(900);
	const returned = await look();
	check(
		"归位动画期间切走，回来后仍完成归位",
		returned.distance < 4 && !returned.button && returned.unread === 0,
		`回来后 distance=${returned.distance}，按钮=${returned.button ? "显示" : "隐藏"}，未读=${returned.unread}`,
	);
}

/**
 * The two panels that share the hook, mounted and scrolling without complaint.
 *
 * They have no probe of their own and they are where the old copies of this logic lived, so at
 * minimum: they mount, they build a scroller, and nothing throws on the way.
 */
async function panelsMount(): Promise<void> {
	const before = await app.evaluate<number>(`(window.__lyProbeErrors ?? []).length`);

	/*
	 * By keyboard, not by clicking a menu.
	 *
	 * ⌥⌘S and ⌥⌘A are what the panel definitions register (`panels/builtin.tsx`), and driving the
	 * shortcut is both shorter and less brittle than walking an overflow menu whose markup is not
	 * this probe's business.
	 */
	for (const code of ["KeyS", "KeyA"]) {
		await app.send("Input.dispatchKeyEvent", {
			type: "keyDown",
			modifiers: 1 | 4, // Alt(1) + Meta(4) — Shift is 8, which is not what ⌥⌘ means
			code,
			key: code === "KeyS" ? "s" : "a",
			windowsVirtualKeyCode: code === "KeyS" ? 83 : 65,
		});
		await app.send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: 1 | 4, code, key: code === "KeyS" ? "s" : "a" });
		await settle(600);
	}

	const after = await app.evaluate<{ errors: number; panes: number; scrollers: number; buttons: number }>(`(() => ({
		errors: (window.__lyProbeErrors ?? []).length,
		panes: document.querySelectorAll(".ly-dock-pane").length,
		scrollers: document.querySelectorAll(".ly-scroll-view").length,
		buttons: document.querySelectorAll("button[data-unread]").length,
	}))()`);

	check(
		"打开侧边聊天面板：能挂载且不报错",
		after.errors === before && after.panes >= 2,
		`面板数=${after.panes}，滚动区=${after.scrollers}，回到最新按钮=${after.buttons}，新增报错=${after.errors - before}`,
	);
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	model = startModel();
	app = await startApp({ port: DEBUG_PORT, seed });
	try {
		await settle(800);
		// Renderer errors are collected from here on, so a panel that throws while mounting is not
		// simply invisible to a probe that only looks at geometry.
		await app.evaluate(`(() => {
			window.__lyProbeErrors = [];
			window.addEventListener("error", (e) => window.__lyProbeErrors.push(String(e.message)));
			window.addEventListener("unhandledrejection", (e) => window.__lyProbeErrors.push(String(e.reason)));
		})()`);
		await nudgeSurvivesTheStream();
		await wheelInterruptsTheRideBack();
		await displayNoneKeepsScrollTop();
		await unreadDoesNotLieAfterASwitch();
		await switchingBetweenTwoConversations();
		await panelsMount();
	} finally {
		await app.stop();
		await closeListeningServer(model);
	}
	process.stdout.write(failures === 0 ? "\n全部通过\n" : `\n${failures} 项未通过\n`);
	process.exit(failures === 0 ? 0 : 1);
}

void main();
