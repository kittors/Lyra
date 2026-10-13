/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * Going to 创作 and back, measured on every painted frame.
 *
 * The question is what a person sees while the sidebar folds away: whether the album keeps its rows
 * or lays them out again on every frame of the fold, and how long the frames are while it does. A
 * MutationObserver counts the layouts React committed (painted or not); the rAF log is what was drawn.
 *
 *   node --experimental-strip-types e2e/gallery-switch-probe.ts
 *
 * Seeded from a copy of a real profile — `LYRA_PROBE_SOURCE`, `~/.lyra` by default: the session
 * database as a snapshot taken over a read-only connection, the drawn media, the projects. Nothing in
 * the source is opened for writing. `LYRA_PROBE_RECORD=1` also records the window into ~/Desktop/Lyra创作切换测试.
 */

import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { startApp, type RunningApp } from "./app.ts";
import { driver, encode, frameGrabber, pause, startRecording, type Frame } from "./record.ts";

const PORT = 9461;
const SOURCE = process.env.LYRA_PROBE_SOURCE ?? join(homedir(), ".lyra");
const RECORD = process.env.LYRA_PROBE_RECORD === "1";
const LABEL = process.env.LYRA_PROBE_LABEL ?? "";
const OUT = join(homedir(), "Desktop", "Lyra创作切换测试");
const ROUNDS = Number(process.env.LYRA_PROBE_ROUNDS ?? 3);
/** `LYRA_PROBE_SLOW=10` plays every transition ten times slower, for a recording the eye can follow. */
const SLOW = Number(process.env.LYRA_PROBE_SLOW ?? 1);
/** `LYRA_PROBE_SHOT_AT=1000` takes a screenshot that long after each press. */
const SHOT_AT = Number(process.env.LYRA_PROBE_SHOT_AT ?? -1);
const STAMP = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);

async function seed(home: string): Promise<void> {
	await mkdir(join(home, "sessions"), { recursive: true });
	// A consistent snapshot, the write-ahead log folded in, while the real app may be writing to it.
	const source = new DatabaseSync(join(SOURCE, "sessions", "sessions.db"), { readOnly: true });
	try {
		source.exec(`VACUUM INTO '${join(home, "sessions", "sessions.db").replaceAll("'", "''")}'`);
	} finally {
		source.close();
	}
	await cp(join(SOURCE, "session-media"), join(home, "session-media"), { recursive: true });
	await cp(join(SOURCE, "projects"), join(home, "projects"), { recursive: true }).catch(() => {});
	const settings = JSON.parse(await readFile(join(SOURCE, "settings.json"), "utf8")) as Record<string, unknown>;
	/*
	 * Nothing that reaches outside the window: no sync server on the real port, no MCP processes, no
	 * schedule, no hooks — and no providers, whose keys live in a vault this copy does not have.
	 */
	for (const key of ["sync", "mcpServers", "scheduledTasks", "hooks", "providers", "searchApiKeys"]) delete settings[key];
	await writeFile(join(home, "settings.json"), JSON.stringify(settings));
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1370, height: 900, x: 0, y: 0 }));
}

/**
 * Every painted frame from the click until `__gs.stop`: the frame's length, the album's width, the
 * first tile's box and the sidebar's visible width. Plus every committed change to a tile's size,
 * painted or not, and the long tasks.
 */
const WATCH = `(() => {
	const out = { frames: [], commits: 0, long: [], stop: false, t0: performance.now() };
	window.__gs = out;
	try {
		const po = new PerformanceObserver((list) => { for (const e of list.getEntries()) out.long.push({ at: Math.round(e.startTime - out.t0), ms: Math.round(e.duration) }); });
		po.observe({ type: "longtask" });
		out.po = po;
	} catch {}
	const mo = new MutationObserver((records) => { for (const r of records) if (r.target.matches?.("[data-ly-gallery-tile]")) out.commits++; });
	mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["style"] });
	out.mo = mo;
	let last = performance.now();
	const rail = () => document.querySelector("[data-ly-app-rail]")?.getBoundingClientRect().right ?? 0;
	const tick = (now) => {
		const grid = [...document.querySelectorAll("[data-ly-gallery-grid]")].find((el) => el.checkVisibility());
		const tile = grid?.querySelector("[data-ly-gallery-tile]");
		const panel = document.querySelector("[data-ly-frame-panel]");
		const nav = panel?.firstElementChild;
		const sidebar = nav && !nav.querySelector("[data-ly-gallery]") ? Math.max(0, Math.round(nav.getBoundingClientRect().right - rail())) : 0;
		out.frames.push({
			at: Math.round(now - out.t0),
			dt: Math.round((now - last) * 10) / 10,
			grid: grid ? grid.clientWidth : -1,
			tw: tile ? Math.round(tile.getBoundingClientRect().width * 10) / 10 : -1,
			th: tile ? Math.round(tile.getBoundingClientRect().height * 10) / 10 : -1,
			tx: tile ? Math.round(tile.getBoundingClientRect().left) : -1,
			sidebar,
			// The conversations' box, hidden or not: laid out again on every frame it changes width.
			chat: Math.round(document.querySelector('[data-view="chat"]')?.getBoundingClientRect().width ?? -1),
			skeleton: [...document.querySelectorAll('[data-ly-gallery] [role="status"], [data-view="gallery"] [role="status"]')].some((el) => el.checkVisibility()),
			// Pictures that have faded in, in the visible album.
			loaded: grid ? grid.querySelectorAll("img[data-loaded], video[data-loaded]").length : 0,
			// The page itself mounted: its code has arrived (\`LazyScreen\`).
			page: [...document.querySelectorAll("[data-ly-gallery]")].some((el) => el.checkVisibility()),
		});
		last = now;
		if (!out.stop) requestAnimationFrame(tick);
		else { mo.disconnect(); out.po?.disconnect(); }
	};
	requestAnimationFrame(tick);
	return true;
})()`;

interface Painted {
	at: number;
	dt: number;
	grid: number;
	tw: number;
	th: number;
	tx: number;
	sidebar: number;
	chat: number;
	skeleton: boolean;
	loaded: number;
	page: boolean;
}

function summarize(frames: Painted[], commits: number, long: { at: number; ms: number }[]) {
	const shown = frames.filter((frame) => frame.tw > 0);
	const first = shown[0];
	// A layout is a change in the tile's size between two painted frames; moving along with the panel is not one.
	let layouts = 0;
	for (let i = 1; i < shown.length; i++) if (shown[i].tw !== shown[i - 1].tw || shown[i].th !== shown[i - 1].th) layouts++;
	const sizes = [...new Set(shown.map((frame) => `${frame.tw}×${frame.th}`))];
	const busy = frames.filter((frame) => frame.at < 600);
	const most = Math.max(0, ...frames.map((frame) => frame.loaded));
	return {
		skeletonAt: frames.find((frame) => frame.skeleton)?.at ?? -1,
		pageAt: frames.find((frame) => frame.page)?.at ?? -1,
		allLoadedAt: most > 0 ? (frames.find((frame) => frame.loaded === most)?.at ?? -1) : -1,
		firstTileAt: first ? first.at : -1,
		layouts,
		sizes,
		commits,
		chatWidths: new Set(frames.map((frame) => frame.chat)).size,
		maxFrame: Math.max(0, ...busy.slice(1).map((frame) => frame.dt)),
		slowFrames: busy.slice(1).filter((frame) => frame.dt > 25).length,
		frames: busy.length,
		long: long.filter((task) => task.at < 1500),
		settled: shown.at(-1),
	};
}

type Metrics = Record<string, number>;
const METRICS = new Set(["LayoutCount", "LayoutDuration", "RecalcStyleCount", "RecalcStyleDuration", "ScriptDuration", "TaskDuration"]);

async function metrics(cdp: Grabber): Promise<Metrics> {
	const { metrics: list } = await cdp.send<{ metrics: { name: string; value: number }[] }>("Performance.getMetrics");
	return Object.fromEntries(list.filter((metric) => METRICS.has(metric.name)).map((metric) => [metric.name, metric.value]));
}

/** What the switch cost the renderer's main thread: layouts, style, script, all tasks — durations in ms. */
function cost(before: Metrics, after: Metrics): string {
	const d = (name: string) => after[name] - before[name];
	const ms = (name: string) => `${Math.round(d(name) * 1000)}ms`;
	return `布局 ${d("LayoutCount")} 次 ${ms("LayoutDuration")}，样式 ${d("RecalcStyleCount")} 次 ${ms("RecalcStyleDuration")}，脚本 ${ms("ScriptDuration")}，主线程合计 ${ms("TaskDuration")}`;
}

type Grabber = Awaited<ReturnType<typeof frameGrabber>>;

interface Profile {
	nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; parent?: number; children?: number[] }[];
	samples: number[];
	timeDeltas: number[];
}

/** Where the sampled time went, by function: self time, and total time for the heaviest frames. */
function printProfile(profile: Profile): void {
	const self = new Map<number, number>();
	profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
	const byId = new Map(profile.nodes.map((node) => [node.id, node]));
	const parent = new Map<number, number>();
	for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id);
	const name = (id: number) => {
		const frame = byId.get(id)?.callFrame;
		if (!frame) return "?";
		const file = frame.url.split("/").pop() ?? "";
		return `${frame.functionName || "(anonymous)"} ${file}:${frame.lineNumber + 1}`;
	};
	const selfBy = new Map<string, number>();
	const totalBy = new Map<string, number>();
	for (const [id, us] of self) {
		selfBy.set(name(id), (selfBy.get(name(id)) ?? 0) + us);
		// Each ancestor once per sample, however often it recurs.
		const seen = new Set<string>();
		for (let at: number | undefined = id; at !== undefined; at = parent.get(at)) {
			const key = name(at);
			if (seen.has(key)) continue;
			seen.add(key);
			totalBy.set(key, (totalBy.get(key) ?? 0) + us);
		}
	}
	const top = (map: Map<string, number>, n: number) =>
		[...map.entries()]
			.filter(([key]) => !/^\((idle|program|root)\)/.test(key))
			.sort((a, b) => b[1] - a[1])
			.slice(0, n)
			.map(([key, us]) => `       ${(us / 1000).toFixed(1).padStart(6)}ms  ${key}`)
			.join("\n");
	console.log(`   自身时间最多：\n${top(selfBy, 18)}\n   包含子调用最多：\n${top(totalBy, 30)}`);
}

async function main(): Promise<void> {
	let app: RunningApp | null = null;
	let cdp: Grabber | null = null;
	const frames: Frame[] = [];
	let stopRecording: (() => Promise<void>) | null = null;
	let failed = false;
	try {
		app = await startApp({ port: PORT, seed });
		const { until, click, hover } = driver(app);
		await app.evaluate("document.fonts.ready");
		await until(`document.querySelector('[data-ly-rail-item="gallery"]')`, 20000);
		await pause(1500);
		// A long conversation open behind the gallery, when one is named: its layout is part of the switch's cost.
		let session = process.env.LYRA_PROBE_SESSION;
		if (session === "largest") {
			// The longest of the conversations the sidebar lists, counted in the copy's database.
			const rows = await app.evaluate<string[]>(`[...document.querySelectorAll("[data-ly-row]")].map((row) => row.getAttribute("data-ly-row"))`);
			const db = new DatabaseSync(join(app.home, "sessions", "sessions.db"), { readOnly: true });
			const sizes = new Map(db.prepare("select id, message_count from sessions").all().map((row) => [String(row.id), Number(row.message_count)]));
			db.close();
			session = rows.sort((a, b) => (sizes.get(b) ?? 0) - (sizes.get(a) ?? 0))[0];
			console.log(`侧栏里最长的会话：${session}，${sizes.get(session ?? "")} 条消息`);
		}
		if (session) {
			await until(`document.querySelector('[data-ly-row="${session}"]')`, 20000);
			await app.evaluate(`document.querySelector('[data-ly-row="${session}"]').scrollIntoView({ block: "center" })`);
			await pause(400);
			await click(`[data-ly-row="${session}"]`);
			await until(`document.querySelectorAll('[data-view="chat"] [data-ly-message], [data-view="chat"] .ly-md').length > 3`, 30000).catch(() => {});
			await pause(2500);
			console.log(`打开了会话 ${session}：${await app.evaluate<number>(`document.querySelector('[data-view="chat"]').querySelectorAll('*').length`)} 个元素`);
		}
		if (process.env.LYRA_PROBE_IPC === "1") {
			// The read alone, cold and then warm, without the page: what the first visit waits for.
			const times = await app.evaluate<number[]>(`(async () => { const out = []; for (let i = 0; i < 3; i++) { const t = performance.now(); await window.lyra.gallery.list(); out.push(Math.round(performance.now() - t)); } return out; })()`);
			console.log(`gallery.list 三次：${times.join("ms, ")}ms`);
			return;
		}
		// One connection kept open: `Performance.enable` and the throttle belong to the session that sent them.
		cdp = await frameGrabber(PORT);
		await cdp.send("Performance.enable");
		const throttle = Number(process.env.LYRA_PROBE_CPU ?? 1);
		if (throttle > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: throttle });
		/*
		 * Slowed down for the eye: the fold takes 220ms, too quick to see what the tiles do during it. The
		 * motion tokens are what every transition here reads its length from, so stretching them slows
		 * the fold and nothing else — React, the reads and the layouts keep their own pace — and what is
		 * drawn is the same frames, just more of them. (`Animation.setPlaybackRate` was tried first: the
		 * sidebar's transition ignored it.)
		 */
		if (SLOW > 1) {
			await app.evaluate(`(() => {
				const root = document.documentElement;
				for (const name of ["--ly-t-quick", "--ly-t-base", "--ly-t-slow"]) {
					// Computed back as seconds (".22s"), whatever unit the stylesheet wrote it in.
					const raw = getComputedStyle(root).getPropertyValue(name).trim();
					const ms = raw.endsWith("ms") ? parseFloat(raw) : parseFloat(raw) * 1000;
					root.style.setProperty(name, (ms * ${SLOW}) + "ms");
				}
			})()`);
		}
		if (RECORD) stopRecording = await startRecording(PORT, frames);
		const profiling = process.env.LYRA_PROBE_PROFILE === "1";
		if (profiling) {
			await cdp.send("Profiler.enable");
			await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
		}
		for (let round = 1; round <= ROUNDS; round++) {
			// A person's pointer rests on the button for a moment before the press; 0 measures a click with none.
			const rest = Number(process.env.LYRA_PROBE_HOVER_MS ?? 150);
			const before = await metrics(cdp);
			if (rest > 0) {
				await hover('[data-ly-rail-item="gallery"]');
				await pause(rest);
			}
			// The clock starts at the press, not at the hover.
			await app.evaluate(WATCH);
			// The second visit is the ordinary one: the page is retained, and only coming back is measured.
			if (profiling && round === 2) await cdp.send("Profiler.start");
			await click('[data-ly-rail-item="gallery"]');
			if (SHOT_AT >= 0) {
				// Partway through the fold, for a still of what the album looks like while the panel moves.
				await pause(SHOT_AT);
				const { data } = await cdp.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
				await mkdir(OUT, { recursive: true });
				const file = join(OUT, `${STAMP}_切换创作${LABEL ? `_${LABEL}` : ""}_第${round}次进入_${SHOT_AT}ms.png`);
				await writeFile(file, Buffer.from(data, "base64"));
				console.log(`📸 ${file}`);
			}
			await until(`[...document.querySelectorAll("[data-ly-gallery-tile]")].some((el) => el.checkVisibility())`, 20000);
			await pause(1500 * Math.min(SLOW, 4));
			if (profiling && round === 2) printProfile((await cdp.send<{ profile: Profile }>("Profiler.stop")).profile);
			const after = await metrics(cdp);
			const run = await app.evaluate<{ frames: Painted[]; commits: number; long: { at: number; ms: number }[] }>(
				"(() => { const out = window.__gs; out.stop = true; return { frames: out.frames, commits: out.commits, long: out.long }; })()",
			);
			const result = summarize(run.frames, run.commits, run.long);
			const count = await app.evaluate<string>(`document.querySelector('[data-ly-gallery-count]')?.textContent ?? ''`);
			console.log(
				`第 ${round} 次进创作（${count}）：骨架 ${result.skeletonAt}ms，页面挂上 ${result.pageAt}ms，首块图 ${result.firstTileAt}ms，图全部显示 ${result.allLoadedAt}ms，绘制帧里图块换了 ${result.layouts} 次尺寸（${result.sizes.length} 种：${result.sizes.slice(0, 6).join(" → ")}${result.sizes.length > 6 ? " …" : ""}），提交了 ${result.commits} 次样式改动；会话区宽度 ${result.chatWidths} 种；头 600ms ${result.frames} 帧，最长一帧 ${result.maxFrame}ms，超过 25ms 的 ${result.slowFrames} 帧；长任务 ${result.long.map((task) => `${task.ms}ms@${task.at}`).join(" ") || "无"}\n     进：${cost(before, after)}`,
			);
			if (process.env.LYRA_PROBE_DUMP === "1") console.log(JSON.stringify(run.frames.filter((frame) => frame.at < 500)));
			await app.evaluate(WATCH);
			const leaving = await metrics(cdp);
			await click('[data-ly-rail-item="chat"]');
			await pause(1200 * Math.min(SLOW, 4));
			const back = await metrics(cdp);
			const home = await app.evaluate<{ frames: Painted[] }>("(() => { const out = window.__gs; out.stop = true; return { frames: out.frames }; })()");
			const busy = home.frames.filter((frame) => frame.at < 600).slice(1);
			console.log(`     回：${cost(leaving, back)}；最长一帧 ${Math.max(0, ...busy.map((frame) => frame.dt))}ms，超过 25ms 的 ${busy.filter((frame) => frame.dt > 25).length} 帧`);
		}
	} catch (error) {
		failed = true;
		console.error(error);
	} finally {
		cdp?.close();
		if (stopRecording) await stopRecording();
		if (RECORD && frames.length > 0) {
			await mkdir(OUT, { recursive: true });
			const file = join(OUT, `${STAMP}_切换创作${LABEL ? `_${LABEL}` : ""}${SLOW > 1 ? `_慢放${SLOW}倍` : ""}.mp4`);
			await encode(frames, file);
			console.log(`🎬 ${file}`);
		}
		await app?.stop();
	}
	if (failed) process.exitCode = 1;
}

void main();
