/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * The sidebar under a fast fling: does every frame arrive, and does anything get drawn across the
 * pinned rows on the way.
 *
 * `node --experimental-strip-types e2e/sidebar-wheel-probe.ts [out-dir] [variant] [flags]`
 *
 * Reported as "scrolling the sidebar fast drops frames, and content spills up beside 新对话". The
 * spill was real: a row, or a heading being pushed out, carrying a stale fade line and drawn whole
 * across the tab strip — 27 of 364 frames at 5200px/s before `writeBandEdge` in `useStickyFade`.
 *
 * Seeded from the real profile (`seedFromReal`, secrets stripped) because a dozen projects of real
 * titles is what the reported sidebar looked like; three synthetic rows never reach a fling's speed.
 * The window is the reporter's size, 1072×790.
 *
 * Variants inject one stylesheet each, as a control group for the same gesture:
 * - `as-is` — nothing changed
 * - `no-timeline` — the rows' scroll-driven fade (`ly-under-pin`) switched off
 * - `no-mask` — the viewport's mask (`.ly-fade-y`) switched off
 * - `neither` — both
 *
 * Flags:
 * - `--gesture` one continuous synthesized gesture per direction (a trackpad flick) rather than a
 *   train of wheel events, each of which is a gesture of its own and far gentler
 * - `--rounds=N` how many down-and-up flicks, default 3
 * - `--leaks` count, frame by frame, rows and pushed-out headings still drawn above the pinned
 *   rows' underside
 * - `--busy` hold the main thread for 24ms every frame, as a streaming transcript does
 * - `--trace` record a trace and count the compositor's frame states
 * - `--record` save the screencast frames and an mp4, for checking the pixels rather than the DOM
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { WebSocket } from "ws";
import { startApp, type RunningApp } from "./app.ts";
import { seedFromReal } from "./session-switch-perf.ts";
import { encode, frameGrabber, pause, startRecording, type Frame } from "./record.ts";

const PORT = 9733;
const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith("--"));
const OUT = positional[0] ?? "/tmp/lyra-sidebar-wheel";
const VARIANT = positional[1] ?? "as-is";
const flag = (name: string) => args.includes(`--${name}`);
const ROUNDS = Number(args.find((arg) => arg.startsWith("--rounds="))?.slice(9) ?? 3);

const VARIANTS: Record<string, string> = {
	"as-is": "",
	"no-timeline":
		".ly-sidebar-fill :is([data-ly-row],[data-ly-fades]), .ly-sidebar-fill [data-ly-band] > [data-ly-head] { animation: none !important; } .ly-sidebar-fill [data-ly-band] { view-timeline: none !important; }",
	"no-mask": ".ly-sidebar-fill .ly-fade-y { mask-image: none !important; -webkit-mask-image: none !important; }",
};
VARIANTS.neither = VARIANTS["no-timeline"] + VARIANTS["no-mask"];

let app: RunningApp | undefined;

/*
 * Frame gaps, and — with `--leaks` — every row whose top has passed the pinned rows' underside but is
 * still drawn. No backticks in here: this string lives inside another template literal.
 */
const WATCH = `(() => {
	const out = { gaps: [], leaks: [], loaf: [], stop: false };
	window.__sw = out;
	const view = document.querySelector('.ly-sidebar-fill .ly-scroll-view');
	const strip = view.querySelector('[data-ly-rail]');
	const rail = Number.parseFloat(getComputedStyle(view).getPropertyValue('--ly-rail')) || 0;
	const LEAKS = LEAK_MODE;
	let last = performance.now();
	const tick = () => {
		const now = performance.now();
		out.gaps.push(Math.round((now - last) * 10) / 10);
		last = now;
		if (LEAKS) {
			const origin = view.getBoundingClientRect().top;
			const heads = [...view.querySelectorAll('[data-ly-head]')];
			let cover = strip.getBoundingClientRect().bottom;
			for (const head of heads) { const b = head.getBoundingClientRect(); if (Math.abs(b.top - origin - rail) < 1.5) cover = Math.max(cover, b.bottom); }
			for (const row of view.querySelectorAll('[data-ly-row], [data-ly-fades]')) {
				const b = row.getBoundingClientRect();
				if (b.bottom <= origin || b.top >= cover - 0.5) continue;
				const o = parseFloat(getComputedStyle(row).opacity);
				if (o > 0.08) out.leaks.push({ f: out.gaps.length, top: Math.round(b.top - origin), cover: Math.round(cover - origin), o: Math.round(o * 100) / 100, text: (row.textContent || '').slice(0, 12) });
			}
			for (const head of heads) {
				const b = head.getBoundingClientRect();
				if (b.top - origin >= rail - 1.5 || b.bottom <= origin) continue;
				const o = parseFloat(getComputedStyle(head).opacity);
				if (o > 0.08) out.leaks.push({ f: out.gaps.length, head: true, top: Math.round(b.top - origin), o: Math.round(o * 100) / 100, text: (head.textContent || '').slice(0, 12) });
			}
		}
		if (!out.stop) requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	const po = new PerformanceObserver((list) => {
		for (const e of list.getEntries()) {
			const end = e.startTime + e.duration;
			out.loaf.push({ d: Math.round(e.duration), styleLayout: e.styleAndLayoutStart ? Math.round(end - e.styleAndLayoutStart) : 0 });
		}
	});
	po.observe({ type: 'long-animation-frame' });
	window.__swStop = () => { out.stop = true; po.disconnect(); };
	return true;
})()`;

interface Watch {
	gaps: number[];
	leaks: { f: number; top: number; cover?: number; o: number; head?: boolean; text: string }[];
	loaf: { d: number; styleLayout: number }[];
}

function pct(values: number[], p: number): number {
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
}

/**
 * Record a trace across `run` on the browser target, and count what the compositor did with each frame.
 *
 * The rAF gaps only see the main thread. A list whose rows fade by scroll timeline can keep the main
 * thread at 16.7ms and still hand the compositor frames it presents without the main thread's half —
 * `PRESENTED_PARTIAL` — and Chromium's own `ScrollJankV4` verdict is the one that says whether the
 * scroll itself kept up.
 */
async function traceDuring(port: number, run: () => Promise<void>): Promise<Record<string, number>> {
	const version = (await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json())) as { webSocketDebuggerUrl: string };
	const socket = new WebSocket(version.webSocketDebuggerUrl, { maxPayload: 1024 * 1024 * 1024 });
	await new Promise<void>((done, fail) => {
		socket.once("open", () => done());
		socket.once("error", fail);
	});
	let id = 0;
	const waiting = new Map<number, (value: unknown) => void>();
	let complete: ((stream: string) => void) | null = null;
	socket.on("message", (raw: Buffer) => {
		const message = JSON.parse(raw.toString()) as { id?: number; method?: string; params?: { stream?: string }; result?: unknown };
		if (message.method === "Tracing.tracingComplete" && message.params?.stream) complete?.(message.params.stream);
		if (message.id !== undefined) waiting.get(message.id)?.(message.result);
	});
	const call = <T>(method: string, params: Record<string, unknown> = {}) =>
		new Promise<T>((done) => {
			const at = ++id;
			waiting.set(at, done as (value: unknown) => void);
			socket.send(JSON.stringify({ id: at, method, params }));
		});
	await call("Tracing.start", {
		transferMode: "ReturnAsStream",
		traceConfig: {
			includedCategories: ["benchmark", "cc", "viz", "gpu", "devtools.timeline", "disabled-by-default-devtools.timeline.frame", "blink"],
			excludedCategories: ["*"],
		},
	});
	await run();
	const streamHandle = new Promise<string>((done) => {
		complete = done;
	});
	await call("Tracing.end");
	const stream = await streamHandle;
	let text = "";
	for (;;) {
		const chunk = await call<{ data: string; eof: boolean; base64Encoded?: boolean }>("IO.read", { handle: stream, size: 8 * 1024 * 1024 });
		text += chunk.base64Encoded ? Buffer.from(chunk.data, "base64").toString() : chunk.data;
		if (chunk.eof) break;
	}
	await call("IO.close", { handle: stream });
	socket.close();
	await writeFile(join(OUT, `trace-${VARIANT}.json`), text);
	type Report = { state?: string; frame_drop_reason?: string; scroll_state?: string };
	type TraceEvent = { name: string; ph: string; args?: { frame_reporter?: Report; scroll_jank_v4?: { is_janky?: boolean } } };
	const parsed = JSON.parse(text) as { traceEvents?: TraceEvent[] } | TraceEvent[];
	const events = Array.isArray(parsed) ? parsed : (parsed.traceEvents ?? []);
	const states: Record<string, number> = {};
	for (const event of events) {
		if (event.name === "ScrollJankV4" && event.args?.scroll_jank_v4) {
			const key = event.args.scroll_jank_v4.is_janky ? "jank:janky" : "jank:ok";
			states[key] = (states[key] ?? 0) + 1;
			continue;
		}
		if (event.name !== "PipelineReporter" || (event.ph !== "b" && event.ph !== "X")) continue;
		const report = event.args?.frame_reporter;
		if (report?.state === "STATE_NO_UPDATE_DESIRED") continue;
		const scroll = report?.scroll_state && report.scroll_state !== "SCROLL_NONE" ? `@${report.scroll_state.replace("SCROLL_", "")}` : "";
		const key = `${(report?.state ?? "?").replace("STATE_", "")}${report?.frame_drop_reason ? `/${report.frame_drop_reason}` : ""}${scroll}`;
		states[key] = (states[key] ?? 0) + 1;
	}
	return states;
}

async function main(): Promise<void> {
	await mkdir(OUT, { recursive: true });
	app = await startApp({
		port: PORT,
		seed: async (home) => {
			await seedFromReal(home);
			await writeFile(join(home, "window.json"), JSON.stringify({ width: 1072, height: 790, x: 0, y: 0 }));
		},
	});
	const grab = await frameGrabber(PORT);
	const evaluate = grab.evaluate;

	await evaluate(
		`new Promise((resolve) => { const t0 = performance.now(); const tick = () => { const v = document.querySelector('.ly-sidebar-fill .ly-scroll-view'); if ((v && v.querySelectorAll('[data-ly-row]').length > 10) || performance.now() - t0 > 20000) resolve(true); else requestAnimationFrame(tick); }; tick(); })`,
	);
	await pause(1500);

	const css = VARIANTS[VARIANT];
	if (css === undefined) throw new Error(`unknown variant ${VARIANT}`);
	if (css) await evaluate(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(css)}; document.head.appendChild(s); return true; })()`);

	const geometry = await evaluate<{ x: number; y: number; scrollHeight: number; clientHeight: number; rows: number }>(`(() => {
		const v = document.querySelector('.ly-sidebar-fill .ly-scroll-view');
		const r = v.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), scrollHeight: v.scrollHeight, clientHeight: v.clientHeight, rows: v.querySelectorAll('[data-ly-row]').length };
	})()`);
	console.log(`变体 ${VARIANT}：列表 ${geometry.scrollHeight}px / 视口 ${geometry.clientHeight}px，${geometry.rows} 行`);

	if (flag("busy")) {
		await evaluate(
			`(() => { const spin = () => { const end = performance.now() + 24; while (performance.now() < end) {} if (!window.__busyStop) requestAnimationFrame(spin); }; requestAnimationFrame(spin); return true; })()`,
		);
	}

	const frames: Frame[] = [];
	const stopRecording = flag("record") ? await startRecording(PORT, frames) : null;
	if (stopRecording) await pause(600);

	await evaluate(WATCH.replace("LEAK_MODE", flag("leaks") ? "true" : "false"));
	const fling = async () => {
		for (let round = 0; round < ROUNDS; round++) {
			for (const direction of [1, -1]) {
				if (flag("gesture")) {
					await grab.send("Input.synthesizeScrollGesture", { x: geometry.x, y: geometry.y, yDistance: -direction * 1400, speed: 5200, gestureSourceType: "mouse" });
					await pause(120);
					continue;
				}
				// A wheel tick every 8ms, 90px each — a separate gesture per tick, so gentler than a flick.
				for (let i = 0; i < 60; i++) {
					await grab.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: geometry.x, y: geometry.y, deltaX: 0, deltaY: direction * 90 });
					await pause(8);
				}
				await pause(250);
			}
		}
		await pause(400);
	};
	if (flag("trace")) console.log(`合成器帧：${JSON.stringify(await traceDuring(PORT, fling))}`);
	else await fling();
	const watch = await evaluate<Watch>(`(() => { window.__swStop(); window.__busyStop = true; const o = window.__sw; return { gaps: o.gaps, leaks: o.leaks, loaf: o.loaf }; })()`);

	if (flag("leaks")) {
		console.log(`透出：${watch.leaks.length} 次，落在 ${new Set(watch.leaks.map((l) => l.f)).size} 帧上（共 ${watch.gaps.length} 帧）`);
		for (const leak of watch.leaks.slice(0, 12)) console.log(`  ${JSON.stringify(leak)}`);
	}
	if (stopRecording) {
		await stopRecording();
		await encode(frames, join(OUT, `sidebar-wheel-${VARIANT}.mp4`));
		const raw = join(OUT, `frames-${VARIANT}`);
		await rm(raw, { recursive: true, force: true });
		await mkdir(raw, { recursive: true });
		for (const [i, frame] of frames.entries()) await writeFile(join(raw, `${String(i).padStart(4, "0")}.jpg`), frame.data);
		console.log(`录了 ${frames.length} 帧 → ${raw}`);
	}

	const gaps = watch.gaps.slice(2);
	const over = (ms: number) => gaps.filter((g) => g > ms).length;
	console.log(`帧 ${gaps.length}：p50 ${pct(gaps, 0.5)}ms p95 ${pct(gaps, 0.95)}ms p99 ${pct(gaps, 0.99)}ms 最长 ${Math.max(...gaps)}ms；>20ms ${over(20)}，>33ms ${over(33.4)}，>50ms ${over(50)}`);
	const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
	console.log(`长动画帧 ${watch.loaf.length} 个，合计 ${sum(watch.loaf.map((l) => l.d))}ms，其中样式+布局 ${sum(watch.loaf.map((l) => l.styleLayout))}ms`);
	await writeFile(join(OUT, `watch-${VARIANT}.json`), JSON.stringify({ geometry, watch }, null, 1));
	grab.close();
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(async () => {
		await app?.stop();
	});
