/* oxlint-disable no-console -- performance probe CLI that prints timing measurements */
/**
 * What a long transcript costs when the window is being rearranged.
 *
 * Not a test — a probe. It seeds a conversation with hundreds of messages, opens it, and then
 * performs the three gestures that rearrange the layout while that transcript is on screen:
 * dragging a pane's boundary, carrying a pane to another place, and dragging the sidebar's edge.
 *
 * The number that matters is how long the main thread is busy in one frame. A drag is judged by
 * whether it tracks the pointer, and it stops tracking the moment a frame takes longer than the
 * display gives it — so long frames, not averages, are what "不跟手" is made of.
 */

import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";

/** How many "show earlier" clicks to make before measuring, each mounting another 60 rows. */
const EXPANSIONS = Number(process.env.PERF_EXPAND ?? 0);
/**
 * A real conversation off this machine, copied into a throwaway profile.
 *
 * Synthesised transcripts do not reproduce this: the sessions that stutter are the ones with
 * thousands of messages carrying real markdown, real diffs and real tool output, and the cost is
 * in what those rows contain rather than in how many there are. Copied rather than opened in
 * place so nothing here can write to the profile the app actually uses.
 */
const REAL_HOME = process.env.PERF_SOURCE_HOME ?? join(homedir(), ".lyra");

interface FrameStats {
	label: string;
	frames: number;
	p50: number;
	p95: number;
	max: number;
	/** Frames that missed a 60Hz budget, which is what a drag stuttering actually is. */
	janky: number;
	longTaskMs: number;
	worstTask: number;
	/** The worst frames, split into what ran and what the browser then did with it. */
	loaf?: {
		duration: number;
		blocking: number;
		styleAndLayout: number;
		scripts: { duration: number; name: string; url: string; line: number }[];
	}[];
}

// ---------------------------------------------------------------------------
// The heaviest conversation on this machine, copied into a throwaway profile
// ---------------------------------------------------------------------------

interface SessionMeta {
	id: string;
	title: string;
	cwd: string;
	projectId: string;
	projectName: string;
	messageCount: number;
	[key: string]: unknown;
}

/** The session to measure: the one named by `PERF_SESSION`, or the longest transcript there is. */
async function pickSession(): Promise<SessionMeta> {
	const index = JSON.parse(await readFile(join(REAL_HOME, "sessions", "index.json"), "utf8")) as SessionMeta[];
	const wanted = process.env.PERF_SESSION;
	const found = wanted
		? index.find((meta) => meta.id === wanted)
		: index.slice().sort((a, b) => (b.messageCount ?? 0) - (a.messageCount ?? 0))[0];
	if (!found) throw new Error(`no session ${wanted ?? "with any messages"} in ${REAL_HOME}`);
	return found;
}

function seedProfile(meta: SessionMeta): (home: string) => Promise<void> {
	return async (home: string) => {
		await writeFile(join(home, "window.json"), JSON.stringify({ width: 1440, height: 900, x: 0, y: 0 }));
		await writeFile(
			join(home, "settings.json"),
			JSON.stringify({
				version: 1,
				providers: [],
				mcpServers: [],
				projects: [{ id: "perf", name: meta.projectName, path: meta.cwd, pinned: true, lastOpenedAt: 1 }],
				defaultModelId: null,
				permissionMode: "auto",
				thinking: "off",
				retryAttempts: 1,
				hooks: [],
				scheduledTasks: [],
				disabledPlugins: [],
				alwaysAllow: [],
				sync: { enabled: false, port: 4521, token: null },
			}),
		);

		// One session in the index, so the sidebar cannot open a different one by accident.
		await mkdir(join(home, "sessions", meta.projectId), { recursive: true });
		await copyFile(
			join(REAL_HOME, "sessions", meta.projectId, `${meta.id}.jsonl`),
			join(home, "sessions", meta.projectId, `${meta.id}.jsonl`),
		);
		await writeFile(join(home, "sessions", "index.json"), JSON.stringify([meta], null, 2));
	};
}

// ---------------------------------------------------------------------------
// The sampler, installed in the page
// ---------------------------------------------------------------------------

/**
 * Frame intervals and long tasks, recorded while a gesture runs.
 *
 * Both are needed. A long task says the main thread was blocked; the frame interval says whether
 * the user saw it. Neither on its own distinguishes "the layout is expensive" from "the machine
 * was busy elsewhere".
 */
const SAMPLER = `
window.__perf = {
	frames: [],
	tasks: [],
	observer: null,
	running: false,
	loaf: [],
	start() {
		this.frames = [];
		this.tasks = [];
		this.loaf = [];
		this.running = true;
		try {
			this.observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) this.tasks.push(entry.duration);
			});
			this.observer.observe({ entryTypes: ["longtask"] });
		} catch { this.observer = null; }
		/*
		 * Long animation frames, which say *what* the frame spent its time on.
		 *
		 * \`longtask\` reports that the main thread was blocked and nothing else. A LoAF entry
		 * splits the frame into the scripts that ran and the style-and-layout that followed, and
		 * names the function each script entered through — which is the difference between "the
		 * drag is slow" and "this call is slow".
		 */
		try {
			this.loafObserver = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					this.loaf.push({
						duration: entry.duration,
						blocking: entry.blockingDuration,
						styleAndLayout: entry.startTime + entry.duration - entry.styleAndLayoutStart,
						scripts: (entry.scripts ?? []).map((s) => ({
							duration: s.duration,
							name: s.sourceFunctionName || s.invoker || s.name || "(anonymous)",
							url: (s.sourceURL || "").split("/").pop(),
							line: s.sourceCharPosition,
						})),
					});
				}
			});
			this.loafObserver.observe({ type: "long-animation-frame", buffered: false });
		} catch { this.loafObserver = null; }
		let last = performance.now();
		const tick = (now) => {
			if (!this.running) return;
			this.frames.push(now - last);
			last = now;
			requestAnimationFrame(tick);
		};
		requestAnimationFrame((now) => { last = now; requestAnimationFrame(tick); });
	},
	stop(label) {
		this.running = false;
		this.observer?.disconnect();
		this.loafObserver?.disconnect();
		// The first two frames cover installing the sampler rather than the gesture.
		const frames = this.frames.slice(2).sort((a, b) => a - b);
		const at = (q) => frames.length ? frames[Math.min(frames.length - 1, Math.floor(frames.length * q))] : 0;
		const total = this.tasks.reduce((sum, ms) => sum + ms, 0);
		return {
			label,
			frames: frames.length,
			p50: at(0.5),
			p95: at(0.95),
			max: frames.length ? frames[frames.length - 1] : 0,
			janky: frames.filter((ms) => ms > 20).length,
			longTaskMs: total,
			worstTask: this.tasks.length ? Math.max(...this.tasks) : 0,
			loaf: this.loaf.sort((a, b) => b.duration - a.duration).slice(0, 4),
		};
	},
};
true`;

/** Move a pointer along a path, one step per frame, the way a hand actually does. */
const DRAG = `
window.__drag = async (target, from, to, steps, downOnTarget) => {
	const frame = () => new Promise((r) => requestAnimationFrame(r));
	const at = (type, x, y, buttons) => new PointerEvent(type, {
		pointerId: 1, isPrimary: true, bubbles: true, cancelable: true, clientX: x, clientY: y, buttons,
	});
	/*
	 * How long each event takes to *handle*, which is not the same as how long the frame took.
	 *
	 * A drag's handler runs synchronously inside the dispatch, so timing the dispatch attributes
	 * the cost to the gesture step that caused it — the press, the first move that crosses the
	 * threshold, an ordinary move, the release — rather than to "a frame somewhere in there".
	 */
	window.__steps = [];
	const send = (element, event, label) => {
		const t = performance.now();
		element.dispatchEvent(event);
		window.__steps.push([label, performance.now() - t]);
	};

	send(downOnTarget ? target : window, at("pointerdown", from.x, from.y, 1), "down");
	await frame();
	for (let step = 1; step <= steps; step++) {
		const t = step / steps;
		send(window, at("pointermove", from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, 1), "move " + step);
		await frame();
	}
	send(window, at("pointerup", to.x, to.y, 0), "up");
	await frame();
};
/** The sidebar's handle listens for mouse events, not pointer ones — see \`ResizeHandle\`. */
window.__dragMouse = async (target, from, to, steps) => {
	const frame = () => new Promise((r) => requestAnimationFrame(r));
	const at = (type, x, y, buttons) => new MouseEvent(type, {
		bubbles: true, cancelable: true, clientX: x, clientY: y, buttons, button: 0,
	});
	window.__steps = [];
	const send = (element, event, label) => {
		const t = performance.now();
		element.dispatchEvent(event);
		window.__steps.push([label, performance.now() - t]);
	};
	send(target, at("mousedown", from.x, from.y, 1), "down");
	await frame();
	for (let step = 1; step <= steps; step++) {
		const t = step / steps;
		send(window, at("mousemove", from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, 1), "move " + step);
		await frame();
	}
	send(window, at("mouseup", to.x, to.y, 0), "up");
	await frame();
};
true`;

// ---------------------------------------------------------------------------
// The gestures
// ---------------------------------------------------------------------------

async function measure(app: RunningApp, label: string, gesture: string): Promise<FrameStats> {
	await app.evaluate(`(async () => { window.__perf.start(); await (${gesture}); return true; })()`);
	const stats = await app.evaluate<FrameStats>(`window.__perf.stop(${JSON.stringify(label)})`);

	/*
	 * Which step of the gesture was slow, not merely that one was.
	 *
	 * The handler runs synchronously inside the dispatch, so timing each dispatch attributes the
	 * cost to the press, to the first move that crosses the threshold, to an ordinary move, or to
	 * the release. That distinction is what found this: it was the first move and the release, and
	 * both were the same forced layout — see `dockBox` in `useDockDrag.ts`.
	 */
	const steps = await app.evaluate<[string, number][]>(`window.__steps ?? []`);
	const slow = steps.filter(([, ms]) => ms > 8);
	if (slow.length > 0) {
		console.log(`\n  ${label} — the gesture steps that took longest to handle:`);
		for (const [name, ms] of slow.sort((a, b) => b[1] - a[1]).slice(0, 6)) {
			console.log(`    ${ms.toFixed(1).padStart(6)} ms  ${name}`);
		}
	}

	// Let the layout settle before the next gesture measures a transition it did not cause.
	await app.evaluate(`new Promise((r) => setTimeout(r, 600))`);
	return stats;
}

async function openPanel(app: RunningApp, label: string): Promise<void> {
	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		document.querySelector('button[aria-label="面板"]').click();
		await wait(220);
		const row = [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent.trim().startsWith(${JSON.stringify(label)}));
		if (!row) throw new Error("no menu row for ${label}");
		row.click();
		await wait(600);
		return true;
	})()`);
}

async function main() {
	const meta = await pickSession();
	console.log(`session ${meta.id} — ${meta.messageCount} messages, project ${meta.projectName}`);

	const app = await startApp({ port: 9471, seed: seedProfile(meta) });
	try {
		await app.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
		await app.evaluate(SAMPLER);
		await app.evaluate(DRAG);

		// Open the conversation the way a person does, then wait for the rows to exist.
		const opened = await app.evaluate<{ rows: number; ms: number }>(`(async () => {
			const wait = (ms) => new Promise((r) => setTimeout(r, ms));
			const rows = () => document.querySelectorAll(".group\\\\/msg").length;
			let started = 0;
			for (let guard = 0; guard < 60; guard++) {
				const row = document.querySelector('[data-ly-row=${JSON.stringify(meta.id)}] button');
				if (row) { started = performance.now(); row.click(); break; }
				await wait(250);
			}
			for (let guard = 0; guard < 240; guard++) {
				if (rows() > 0) break;
				await wait(250);
			}
			const ms = performance.now() - started;
			await wait(1200);
			return { rows: rows(), ms };
		})()`);
		console.log(`opened in ${opened.ms.toFixed(0)} ms; ${opened.rows} assistant rows mounted`);

		for (let round = 0; round < EXPANSIONS; round++) {
			await app.evaluate(`(async () => {
				const more = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") || "").startsWith("显示更早") || (b.getAttribute("data-ly-tip") || "").startsWith("显示更早"));
				more?.click();
				await new Promise((r) => setTimeout(r, 900));
				return true;
			})()`);
		}
		if (EXPANSIONS > 0) {
			const mounted = await app.evaluate<number>(`document.querySelectorAll(".group\\\\/msg").length`);
			console.log(`after ${EXPANSIONS} expansion(s): ${mounted} assistant rows mounted`);
		}

		/*
		 * The Git panel, not the terminal.
		 *
		 * Which panel is open changes what a drag costs, because the pane's contents re-measure
		 * themselves when it is resized — a terminal re-fits its buffer, which is expensive and is
		 * the terminal's own business. Git is the panel this was reported against.
		 */
		const panel = process.env.PERF_PANEL ?? "Git";
		await openPanel(app, panel);
		console.log(`panel open: ${panel}`);

		/*
		 * What one flag on <html> costs, and what a class costs instead.
		 *
		 * A drag used to raise `data-resizing` and `data-dock-dragging` on the root, with the rules
		 * keyed on them written `:root[data-resizing] *`. A descendant-of-attribute selector has to
		 * be resolved against the subtree beneath the attribute, so flipping it invalidated the
		 * style of the whole document — and this document is a transcript. Both are gone now; what
		 * is left is `data-dock-settling`, which an adoption raises and a drag never does.
		 *
		 * Kept as a regression check with teeth: if a flag on the root ever comes back for
		 * something a drag does, this line stops reading zero.
		 */
		const flip = await app.evaluate<{ nodes: number; settling: number; unstyled: number; freeze: number }>(`(() => {
			const root = document.documentElement;
			const cost = (apply, undo) => {
				const t = performance.now();
				apply();
				// getComputedStyle on a leaf forces the pending recalculation to happen now.
				getComputedStyle(document.body).getPropertyValue("opacity");
				const ms = performance.now() - t;
				undo();
				getComputedStyle(document.body).getPropertyValue("opacity");
				return ms;
			};
			const targets = [...document.querySelectorAll(".ly-dock-pane, .ly-freeze")];
			return {
				nodes: document.querySelectorAll("*").length,
				settling: cost(() => { root.dataset.dockSettling = ""; }, () => { delete root.dataset.dockSettling; }),
				unstyled: cost(() => { root.dataset.lyraUnused = "1"; }, () => { delete root.dataset.lyraUnused; }),
				freeze: cost(
					() => { for (const el of targets) el.setAttribute("data-ly-frozen", ""); },
					() => { for (const el of targets) el.removeAttribute("data-ly-frozen"); },
				),
			};
		})()`);
		console.log(
			`\ndocument: ${flip.nodes.toLocaleString()} elements` +
				`\n  raise data-dock-settling on the root   ${flip.settling.toFixed(1)} ms  (adoption only)` +
				`\n  freeze by attribute, as a drag does        ${flip.freeze.toFixed(1)} ms` +
				`\n  set an attribute nothing styles        ${flip.unstyled.toFixed(1)} ms  (the control)`,
		);


		/* Where the elements are, and how many of them a layout can skip. */
		const where = await app.evaluate<{
			panes: [string, number][];
			rows: number;
			skipped: number;
			tallest: number;
			scroller: number;
		}>(`(() => {
			const panes = [...document.querySelectorAll("[data-dock-pane]")].map((p) => [p.dataset.dockPane, p.querySelectorAll("*").length]);
			const rows = [...document.querySelectorAll(".group\\\\/msg")];
			// checkVisibility tells us which ones content-visibility is actually skipping.
			const skipped = rows.filter((r) => !r.checkVisibility({ contentVisibilityAuto: true })).length;
			const tallest = Math.max(0, ...rows.map((r) => r.getBoundingClientRect().height));
			const scroller = document.querySelector("[data-dock-pane='conversation'] .ly-scroll-view, [data-dock-pane='conversation'] [class*=overflow-y]")?.scrollHeight ?? 0;
			return { panes: panes.sort((a, b) => b[1] - a[1]), rows: rows.length, skipped, tallest, scroller };
		})()`);
		console.log(
			`\nelements per pane: ${where.panes.map(([k, n]) => `${k} ${n.toLocaleString()}`).join(", ")}` +
				`\n  ${where.rows} assistant rows, ${where.skipped} skipped by content-visibility, tallest ${where.tallest.toFixed(0)}px`,
		);

		const results: FrameStats[] = [];

		results.push(
			await measure(
				app,
				"splitter drag (pane boundary)",
				`(async () => {
					const seam = document.querySelector('.ly-splitter');
					if (!seam) throw new Error("no splitter on screen");
					const box = seam.getBoundingClientRect();
					const from = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
					await window.__drag(seam, from, { x: from.x - 260, y: from.y }, 45, true);
				})()`,
			),
		);

		results.push(
			await measure(
				app,
				"pane carried across the dock",
				`(async () => {
					const grip = document.querySelector('[data-dock-pane]:not([data-dock-pane="conversation"]) [data-dock-grip]');
					if (!grip) throw new Error("no grip for the panel pane");
					const box = grip.getBoundingClientRect();
					const from = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
					await window.__drag(grip, from, { x: 380, y: 620 }, 45, true);
					await new Promise((r) => setTimeout(r, 500));
				})()`,
			),
		);

		results.push(
			await measure(
				app,
				"sidebar edge drag",
				`(async () => {
					const handle = document.querySelector('[aria-label="调整侧边栏宽度"]');
					if (!handle) throw new Error("no sidebar handle");
					const box = handle.getBoundingClientRect();
					const from = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
					await window.__dragMouse(handle, from, { x: from.x + 150, y: from.y }, 45);
				})()`,
			),
		);

		/*
		 * Scrolling, which is the other thing that makes the transcript redraw.
		 *
		 * Dragging a boundary changes its width; scrolling changes which rows are on screen. Both
		 * reach the same rows, and `content-visibility` is what decides whether the ones off screen
		 * are paid for — so a regression there shows up here first.
		 */
		results.push(
			await measure(
				app,
				"scrolling the transcript",
				`(async () => {
					const frame = () => new Promise((r) => requestAnimationFrame(r));
					const view = document.querySelector("[data-dock-pane='conversation'] .ly-scroll-view");
					if (!view) throw new Error("no transcript scroller");
					// Up through the mounted tail a third of a screen at a time, then back down —
					// which is the pass that makes every row render for the first time.
					for (let i = 0; i < 30; i++) { view.scrollTop -= view.clientHeight / 3; await frame(); }
					for (let i = 0; i < 30; i++) { view.scrollTop += view.clientHeight / 3; await frame(); }
				})()`,
			),
		);

		/*
		 * The same drag with the transcript taken out of the rendering entirely.
		 *
		 * `content-visibility: hidden` leaves the box exactly where it was and stops the browser
		 * styling, laying out or painting anything inside it, so this is the floor: what the
		 * gesture would cost if the conversation on screen were empty. A regression shows up as
		 * the real drag drifting away from this line, which is a sharper signal than an absolute
		 * millisecond count that varies with the machine.
		 */
		await app.evaluate(`(() => {
			const style = document.createElement("style");
			style.id = "perf-hide-transcript";
			style.textContent = "[data-dock-pane='conversation'] .ly-scroll-host { content-visibility: hidden; }";
			document.head.append(style);
			return true;
		})()`);
		await app.evaluate(`new Promise((r) => setTimeout(r, 500))`);

		results.push(
			await measure(
				app,
				"↳ the same, transcript not rendered",
				`(async () => {
					const seam = document.querySelector('.ly-splitter');
					const box = seam.getBoundingClientRect();
					const from = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
					await window.__drag(seam, from, { x: from.x - 260, y: from.y }, 45, true);
				})()`,
			),
		);
		await app.evaluate(`(document.getElementById("perf-hide-transcript")?.remove(), true)`);

		/*
		 * Resizing the window, which is the one gesture the page cannot perform on itself.
		 *
		 * It has to be driven over the protocol, so it cannot be sampled per frame the way the
		 * others are — each step is a round trip. What it can still answer is whether a resize
		 * blocks the main thread, which is the question: it takes the same path as the sidebar drag
		 * (`LayoutProvider` re-renders on every event) plus a real viewport change on top.
		 */
		await app.evaluate(`window.__perf.start()`);
		for (const width of [1440, 1340, 1240, 1140, 1040, 1140, 1240, 1340, 1440]) {
			await app.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
		}
		results.push(await app.evaluate<FrameStats>(`window.__perf.stop("resizing the window")`));

		console.log("");
		console.log("gesture                             frames   p50     p95     max    janky  longtask  worst");
		for (const r of results) {
			console.log(
				`${r.label.padEnd(34)}  ${String(r.frames).padStart(5)}  ${r.p50.toFixed(1).padStart(5)}  ${r.p95
					.toFixed(1)
					.padStart(5)}  ${r.max.toFixed(1).padStart(6)}  ${String(r.janky).padStart(5)}  ${r.longTaskMs
					.toFixed(0)
					.padStart(7)}  ${r.worstTask.toFixed(0).padStart(5)}`,
			);
		}
		for (const r of results) {
			const worst = (r.loaf ?? []).filter((f) => f.duration > 30);
			if (worst.length === 0) continue;
			console.log(`\n  worst frames during ${r.label}:`);
			for (const frame of worst) {
				console.log(
					`    ${frame.duration.toFixed(0)} ms frame — ${frame.styleAndLayout.toFixed(0)} ms style+layout, scripts:`,
				);
				for (const s of frame.scripts.filter((s) => s.duration > 2).slice(0, 5)) {
					console.log(`        ${s.duration.toFixed(0).padStart(4)} ms  ${s.name}  ${s.url ?? ""}`);
				}
			}
		}

	} finally {
		await app.stop();
	}
}

await main();
