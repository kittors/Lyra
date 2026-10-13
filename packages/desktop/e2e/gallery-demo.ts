/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * The gallery, end to end in the real window, against a fake image relay.
 *
 * A boat is drawn and edited in a conversation — by day, at night, then back to the day picture for a
 * sunset, which forks its history — and a conversation from yesterday is seeded the way the old
 * results were written, with no `sources`: its history has to be traced back from `#1`. Then the
 * gallery: the album, a picture opened out of its tile, its history, the way back into the
 * conversation, an edit sent from under the picture, and an annotated edit whose history runs
 * through the marks. What is checked is what a person sees, measured.
 *
 *   node --experimental-strip-types e2e/gallery-demo.ts   # records into ~/Desktop/Lyra画廊测试
 *
 * `LYRA_GALLERY_FIXTURE` names a directory with a dumped session (`dog.jsonl`, `pnpm dump:session`)
 * and its pictures under `media/`; without one the seeded conversation is skipped.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { boatPictures, relaySettings, startFakeImageRelay, type Scene } from "./fake-image-relay.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const PORT = 9452;
const OUT = join(homedir(), "Desktop", "Lyra画廊测试");
const FIXTURE = process.env.LYRA_GALLERY_FIXTURE ?? "/tmp/lyra-gallery-fixture";
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const DRAW_MS = Number(process.env.LYRA_PROBE_DRAW_MS ?? 4000);
/** `LYRA_PROBE_THEME=dark` runs the same script in the dark theme; its files say so. */
const THEME = process.env.LYRA_PROBE_THEME === "dark" ? "dark" : "light";
const TAG = THEME === "dark" ? "深色_" : "";
const DAY = 86_400_000;

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "✅" : "❌"} ${name}\n     ${detail}`);
}

const SCENES: Scene[] = [
	{ cue: "纸船", call: "call_boat", args: { prompt: "A red origami paper boat floating on calm blue water at midday, soft sunlight, gentle hills on the horizon, flat illustration", aspect_ratio: "16:9" }, reply: "画好了。" },
	{ cue: "冬天", call: "call_winter", args: { prompt: "Make the night picture colder, like a winter night; keep the boat and the composition", images: ["#1"], aspect_ratio: "16:9" }, reply: "冷一点了。" },
	{ cue: "夜晚", call: "call_night", args: { prompt: "Turn the scene into a starry night with a full moon; keep the boat and the composition the same", images: ["#1"], aspect_ratio: "16:9" }, reply: "改成夜晚了。" },
	{ cue: "黄昏", call: "call_sunset", args: { prompt: "Go back to the daytime picture and turn it into a warm sunset; keep the boat", images: ["#2"], aspect_ratio: "16:9" }, reply: "这是黄昏的版本。" },
	{ cue: "提亮", call: "call_bright", args: { prompt: "Brighten the circled part of the sky into a golden glow; keep everything else", images: ["#1"], aspect_ratio: "16:9" }, reply: "按标注提亮了。" },
];

/** Pictures that look like the edit asked for, and differ byte for byte: derived from the boat with ffmpeg. */
async function variants(art: { day: string; night: string }): Promise<Record<string, string>> {
	const dir = await mkdtemp(join(tmpdir(), "lyra-gallery-art-"));
	const write = async (name: string, data: string) => writeFile(join(dir, name), Buffer.from(data, "base64"));
	await write("day.jpg", art.day);
	await write("night.jpg", art.night);
	const make = (from: string, to: string, filter: string) =>
		execFileSync("ffmpeg", ["-v", "error", "-y", "-i", join(dir, from), "-vf", filter, "-q:v", "3", join(dir, to)]);
	make("day.jpg", "sunset.jpg", "colorchannelmixer=rr=1.0:rg=0.35:rb=0.15:gr=0.3:gg=0.62:gb=0.08:br=0.15:bg=0.2:bb=0.42,eq=saturation=1.35:contrast=1.05");
	make("night.jpg", "winter.jpg", "hue=s=0.35,colorbalance=bs=0.45:bm=0.3:gs=0.1,eq=brightness=0.06:contrast=1.1");
	make("sunset.jpg", "bright.jpg", "eq=brightness=0.1:gamma=1.15:saturation=1.15,vignette=PI/5");
	const read = async (name: string) => (await readFile(join(dir, name))).toString("base64");
	const out = { day: art.day, night: art.night, sunset: await read("sunset.jpg"), winter: await read("winter.jpg"), bright: await read("bright.jpg") };
	await rm(dir, { recursive: true, force: true });
	return out;
}

/** The seeded conversation's pictures, oldest first, the calls that drew them and what was said for each. */
const DOG = ["557ccf6348a1b20cf6113ef8a59ddf4c0f9c42a6.jpg", "5f93c80bb090e0f7f42a93ac4dac4261622e4d42.jpg", "c77e44bb1d80e72f86ad0720c262e23a6672df63.jpg", "58e4057c33d749ae470a58e501581e03c5768f8b.jpg", "b6d9bda1ee4d19e3cfed1b694cd465008b913fa7.jpg"];
const DOG_CALLS = ["call_1791832694849798683_1317", "call_1791833213290104092_1327", "call_1791833663786386069_1328", "call_1791833711408189636_1329", "call_1791833821097379198_1330"];
const DOG_ASKS = ["给我用生图，画一个可爱的小狗。", "在这个小狗的头上加一个帽子吧", "给我画一个可爱亚洲女孩带着这个小狗一起拍照。", "这个女孩的发型换一下吧", "这个图片的分辨率调整下，改成 4k 的 16:9 的分辨率。"];

const mediaName = (base64: string) => `${createHash("sha1").update(Buffer.from(base64, "base64")).digest("hex")}.jpg`;

/** Every epoch-millisecond field moved back by `shift`: yesterday's conversation, seeded today. */
function shifted(value: unknown, shift: number): unknown {
	if (Array.isArray(value)) return value.map((item) => shifted(item, shift));
	if (!value || typeof value !== "object") return value;
	return Object.fromEntries(
		Object.entries(value as Record<string, unknown>).map(([key, item]) => [
			key,
			typeof item === "number" && item > 1e12 && /^(ts|timestamp|startedAt|createdAt|updatedAt)$/.test(key) ? item - shift : shifted(item, shift),
		]),
	);
}

/** The dumped conversation as a log from before the database, filed under this run's project; imported on first launch. */
async function seedConversation(home: string, cwd: string, projectId: string): Promise<{ id: string; title: string } | null> {
	if (!existsSync(join(FIXTURE, "dog.jsonl"))) return null;
	const records = (await readFile(join(FIXTURE, "dog.jsonl"), "utf8"))
		.split("\n")
		.filter(Boolean)
		.map((line) => shifted(JSON.parse(line), DAY) as Record<string, unknown>);
	let meta: Record<string, unknown> | null = null;
	let title = "";
	for (const record of records) {
		if (record.type === "meta") {
			record.meta = { ...(record.meta as object), cwd, projectId, projectName: "画廊演示" };
			meta = record.meta as Record<string, unknown>;
		}
		if (record.type === "title" && typeof record.title === "string") title = record.title;
	}
	if (!meta) return null;
	const last = records.at(-1) as { ts: number; seq: number };
	const index = { ...meta, title: title || meta.title, updatedAt: last.ts, seq: last.seq };
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	await writeFile(join(home, "sessions", projectId, `${String(meta.id)}.jsonl`), `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify([index]));
	await mkdir(join(home, "session-media"), { recursive: true });
	for (const name of await readdir(join(FIXTURE, "media"))) await copyFile(join(FIXTURE, "media", name), join(home, "session-media", name));
	return { id: String(meta.id), title: String(index.title) };
}

let app: RunningApp;

async function shot(name: string) {
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	const file = join(OUT, `${stamp}_${TAG}${name}.png`);
	await writeFile(file, Buffer.from(data, "base64"));
	console.log(`   📸 ${file}`);
}

/** The stage picture's box on every painted frame, from before the click until it settles. */
const WATCH_FLIGHT = `(() => {
	const out = { frames: [], stop: false };
	window.__flight = out;
	const tick = () => {
		const stage = document.querySelector('[data-ly-gallery-stage]');
		if (stage) {
			const r = stage.getBoundingClientRect();
			out.frames.push({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) });
		}
		if (!out.stop) requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
	return true;
})()`;

async function main() {
	await mkdir(OUT, { recursive: true });
	const art = await variants(await boatPictures());
	const names = Object.fromEntries(Object.entries(art).map(([key, value]) => [key, mediaName(value)])) as Record<keyof typeof art, string>;
	const relay = await startFakeImageRelay({
		scenes: SCENES,
		art: { day: art.day, night: art.night },
		drawMs: DRAW_MS,
		pick: (_path, body) => {
			const prompt = String(body.prompt ?? "");
			if (/starry night/.test(prompt)) return art.night;
			if (/winter/.test(prompt)) return art.winter;
			if (/sunset/.test(prompt)) return art.sunset;
			if (/golden glow/.test(prompt)) return art.bright;
			return art.day;
		},
	});
	let seeded: { id: string; title: string } | null = null;

	app = await startApp({
		port: PORT,
		seed: async (home) => {
			const cwd = join(home, "project");
			await mkdir(cwd, { recursive: true });
			const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
			await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 0, y: 0 }));
			await writeFile(join(home, "settings.json"), relaySettings(relay.port, cwd, { appearance: { theme: THEME }, projects: [{ id: projectId, path: cwd, name: "画廊演示", pinned: true, lastOpenedAt: Date.now() }] }));
			seeded = await seedConversation(home, cwd, projectId);
		},
	});

	const frames: Frame[] = [];
	const stop = await startRecording(PORT, frames);
	const { until, click, hover, type, submit, settled, key, markByText } = driver(app);
	try {
		await app.evaluate("document.fonts.ready");
		await pause(1200);

		console.log("① 在对话里画一只纸船，改成夜晚，再回到白天那张改成黄昏");
		if (seeded) {
			// A new conversation in the project: the seeded one is yesterday's and stays as it was.
			await markByText("/^新对话$/", "data-probe-new");
			await click("[data-probe-new]");
			await pause(800);
		}
		const draw = async (words: string, cards: number) => {
			await type(words);
			await pause(500);
			await submit();
			await until(`document.querySelectorAll('[data-ly-image-card="done"]').length >= ${cards}`, 60000);
			await settled(60000);
			await pause(500);
		};
		await draw("画一只停在平静水面上的红色纸船", 1);
		await draw("把它改成夜晚，满月和星星", 2);
		await draw("回到白天那张，改成黄昏的暖色调", 3);
		await shot("00_对话里画了三张");

		console.log("② 打开画廊");
		await click('[data-ly-rail-item="gallery"]');
		const expected = 3 + (seeded ? 5 : 0);
		// Lazily loaded: a tile below the fold has not been asked for yet, so only the ones in view are waited on.
		await until(`document.querySelectorAll('[data-ly-gallery-tile]').length >= ${expected}`, 30000);
		await until(`[...document.querySelectorAll('[data-ly-gallery-tile]')].filter((tile) => tile.getBoundingClientRect().top < innerHeight).every((tile) => tile.querySelector('img[data-loaded]'))`, 30000);
		await pause(900);
		const fold = await app.evaluate<{ grid: number; rail: number; sidebar: number }>(`(() => { const panel = document.querySelector('[data-ly-frame-panel]'); const nav = panel?.firstElementChild; const rail = document.querySelector('[data-ly-app-rail]').getBoundingClientRect().right; return { grid: Math.round(document.querySelector('[data-ly-gallery-grid]').getBoundingClientRect().left), rail: Math.round(rail), sidebar: Math.round(nav && !nav.contains(document.querySelector('[data-ly-gallery]')) ? Math.max(0, nav.getBoundingClientRect().right - rail) : 0) }; })()`);
		check("画廊里不要会话侧栏：它收起来，相册占满整块面板", fold.sidebar <= 1 && fold.grid - fold.rail < 60, `侧栏露出 ${fold.sidebar}px，网格从 x=${fold.grid} 开始（图标栏右缘 ${fold.rail}）`);
		await shot("01_画廊总览");
		const grid = await app.evaluate<{ days: { label: string; count: number }[]; rows: { used: number; width: number; last: boolean }[]; tiles: { media: string; ratio: number; chip: string }[] }>(`(() => {
			const grid = document.querySelector('[data-ly-gallery-grid]');
			const width = grid.clientWidth;
			const days = [...grid.querySelectorAll('[data-ly-gallery-day]')].map((section) => ({ label: section.querySelector('h2').firstChild.textContent, count: section.querySelectorAll('[data-ly-gallery-tile]').length }));
			const rows = [...grid.querySelectorAll('[data-ly-gallery-day]')].flatMap((section) => {
				const list = [...section.querySelectorAll('[data-ly-gallery-tile]')].reduce((acc, tile) => { const top = Math.round(tile.getBoundingClientRect().top); (acc[top] ??= []).push(tile); return acc; }, {});
				const tops = Object.keys(list).sort((a, b) => a - b);
				return tops.map((top, i) => { const tiles = list[top]; const first = tiles[0].getBoundingClientRect(); const end = tiles[tiles.length - 1].getBoundingClientRect(); return { used: Math.round(end.right - first.left), width, last: i === tops.length - 1 }; });
			});
			const tiles = [...grid.querySelectorAll('[data-ly-gallery-tile]')].map((tile) => { const r = tile.getBoundingClientRect(); return { media: tile.getAttribute('data-ly-gallery-tile'), ratio: r.width / r.height, chip: tile.querySelector('.ly-gallery-chip')?.textContent ?? '' }; });
			return { days, rows, tiles };
		})()`);
		check("按天分组：今天的三张在前，昨天的在后", grid.days[0]?.label === "今天" && grid.days[0].count === 3 && (!seeded || (grid.days[1]?.label === "昨天" && grid.days[1].count === 5)), grid.days.map((day) => `${day.label} ${day.count}`).join("，"));
		const full = grid.rows.filter((row) => !row.last);
		check("每个整行恰好撑满列宽", full.length > 0 ? full.every((row) => Math.abs(row.used - row.width) <= 1) : true, grid.rows.map((row) => `${row.used}/${row.width}${row.last ? "（末行）" : ""}`).join("，"));
		const boat = grid.tiles.find((tile) => tile.media === names.sunset);
		check("宽图按原比例排，不裁成方块", Boolean(boat) && Math.abs((boat?.ratio ?? 0) - 1408 / 792) < 0.01, `黄昏那张 ${boat?.ratio.toFixed(3)}，原图 ${(1408 / 792).toFixed(3)}`);
		check("一条链上的每张图都标着这条链有几步", grid.tiles.filter((tile) => [names.day, names.night, names.sunset].includes(tile.media)).every((tile) => tile.chip === "3"), grid.tiles.map((tile) => tile.chip || "·").join(" "));

		await hover(`[data-ly-gallery-tile="${names.night}"]`);
		await pause(700);
		const caption = await app.evaluate<{ opacity: string; text: string }>(`(() => { const c = document.querySelector('[data-ly-gallery-tile="${names.night}"] .ly-gallery-caption'); return { opacity: getComputedStyle(c).opacity, text: c.innerText }; })()`);
		check("悬停时露出当时说的那句话", caption.opacity === "1" && /把它改成夜晚/.test(caption.text), `${caption.opacity} · ${caption.text.replace(/\s+/g, " ")}`);
		await shot("02_悬停看到说过的话");

		console.log("③ 点开黄昏那张：从卡片飞到舞台");
		const tileBox = await app.evaluate<{ x: number; y: number; w: number; h: number }>(`(() => { const r = document.querySelector('[data-ly-gallery-tile="${names.sunset}"]').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })()`);
		await app.evaluate(WATCH_FLIGHT);
		await click(`[data-ly-gallery-tile="${names.sunset}"]`);
		await until(`document.querySelector('[data-ly-gallery-detail]')`, 10000);
		await pause(900);
		const flight = await app.evaluate<{ x: number; y: number; w: number; h: number }[]>(`(() => { window.__flight.stop = true; return window.__flight.frames; })()`);
		const [first] = flight;
		const last = flight.at(-1);
		const settledBox = await app.evaluate<{ x: number; y: number; w: number; h: number }>(`(() => { const r = document.querySelector('[data-ly-gallery-stage]').getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; })()`);
		const near = (a?: { x: number; y: number; w: number }, b?: { x: number; y: number; w: number }) => Boolean(a && b) && Math.abs((a?.x ?? 0) - (b?.x ?? 0)) <= 3 && Math.abs((a?.y ?? 0) - (b?.y ?? 0)) <= 3 && Math.abs((a?.w ?? 0) - (b?.w ?? 0)) <= 3;
		check(
			"第一帧就在卡片上，然后飞到舞台落定",
			near(first, tileBox) && near(last, settledBox) && flight.length >= 8,
			`卡片 ${tileBox.w}×${tileBox.h}@${tileBox.x},${tileBox.y} → 第一帧 ${first?.w}×${first?.h}@${first?.x},${first?.y} → 落定 ${settledBox.w}×${settledBox.h}@${settledBox.x},${settledBox.y}，共 ${flight.length} 帧`,
		);
		const room = await app.evaluate<{ stage: number; window: number; left: number; rail: number }>(`(() => ({ stage: Math.round(document.querySelector('[data-ly-gallery-stage]').getBoundingClientRect().width), window: innerWidth, left: Math.round(document.querySelector('[data-ly-gallery-detail]').getBoundingClientRect().left), rail: Math.round(document.querySelector('[data-ly-app-rail]')?.getBoundingClientRect().right ?? 0) }))()`);
		check("打开的图盖住侧栏，把地方让给图", room.left <= room.rail + 8 && room.stage >= 680, `详情层从 x=${room.left} 开始（图标栏右缘 ${room.rail}），舞台上的图 ${room.stage}px 宽（窗口 ${room.window}px）`);

		const detail = await app.evaluate<{ media: string; steps: { id: string; words: string; meta: string; current: boolean }[]; prompt: string; facts: string }>(`(() => {
			const root = document.querySelector('[data-ly-gallery-detail]');
			const steps = [...root.querySelectorAll('[data-ly-lineage-step]')].map((step) => ({ id: step.getAttribute('data-ly-lineage-step'), words: step.querySelector('[data-ly-lineage-words]').innerText, meta: step.querySelector('[data-ly-lineage-meta]').innerText, current: step.getAttribute('aria-current') === 'step' }));
			return { media: root.getAttribute('data-ly-gallery-detail'), steps, prompt: root.querySelector('[data-ly-gallery-prompt]')?.innerText ?? '', facts: root.querySelector('dl')?.innerText.replace(/\\s+/g, ' ') ?? '' };
		})()`);
		check(
			"链路按先后排出三步：生成、修改、再从第一张分出黄昏",
			detail.steps.map((step) => step.id).join() === [names.day, names.night, names.sunset].join() && detail.steps[2].current,
			detail.steps.map((step) => `${step.words}（${step.meta}${step.current ? "，当前" : ""}）`).join(" → "),
		);
		check("每一步写的是当时说的那句话", detail.steps.map((step) => step.words).join("|") === "画一只停在平静水面上的红色纸船|把它改成夜晚，满月和星星|回到白天那张，改成黄昏的暖色调", detail.steps.map((step) => step.words).join(" | "));
		const lanes = await app.evaluate<{ lefts: number[]; bracket: boolean; accent: string; quiet: string }>(`(() => {
			const lineage = document.querySelector('[data-ly-lineage]');
			const lefts = [...lineage.querySelectorAll('[data-ly-lineage-step] img')].map((img) => Math.round(img.getBoundingClientRect().left));
			const onPath = lineage.querySelector('path[data-on-path]');
			const quiet = lineage.querySelector('path:not([data-on-path])');
			return { lefts, bracket: / Q /.test(onPath?.getAttribute('d') ?? ''), accent: onPath ? getComputedStyle(onPath).stroke : '', quiet: quiet ? getComputedStyle(quiet).stroke : '' };
		})()`);
		check(
			"缩略图排成一列；黄昏是从第一张分出去的，用括线接，走的是当前这张的来路",
			new Set(lanes.lefts).size === 1 && lanes.bracket && lanes.accent !== lanes.quiet,
			`缩略图左缘 ${[...new Set(lanes.lefts)].join("、")}px · 来路是括线：${lanes.bracket} · 来路 ${lanes.accent} / 其他 ${lanes.quiet}`,
		);
		check("提示词和参数是这一张的", /warm sunset/.test(detail.prompt) && /gemini-3\.1-flash-image/.test(detail.facts) && /1408 × 792/.test(detail.facts) && /16:9/.test(detail.facts), `${detail.prompt.slice(0, 60)}… · ${detail.facts}`);
		await shot("03_详情与生成链路");

		console.log("④ 点链路第一步：舞台换成那一张");
		await click(`[data-ly-lineage-step="${names.day}"]`);
		await until(`document.querySelector('[data-ly-gallery-detail="${names.day}"]')`, 5000);
		await pause(900);
		const switched = await app.evaluate<string>(`document.querySelector('[data-ly-gallery-prompt]').innerText`);
		check("点链路里的一步，舞台和提示词都换成那一张", /midday/.test(switched), switched.slice(0, 70));
		await shot("04_点链路切到第一步");

		if (seeded) {
			console.log("⑤ 方向键切到昨天那个会话：旧结果里没有记来源，链路靠 #1 倒推");
			await key("ArrowRight", 39);
			await until(`document.querySelector('[data-ly-gallery-detail="${DOG[4]}"]')`, 5000);
			await pause(1200);
			const chain = await app.evaluate<{ id: string; words: string; lane: number }[]>(`[...document.querySelectorAll('[data-ly-lineage-step]')].map((step) => ({ id: step.getAttribute('data-ly-lineage-step'), words: step.querySelector('[data-ly-lineage-words]').innerText, lane: Math.round(step.querySelector('img').getBoundingClientRect().left - step.getBoundingClientRect().left) }))`);
			check("倒推出整条五步链，顺序和会话里一致", chain.map((step) => step.id).join() === DOG.join(), chain.map((step) => step.id.slice(0, 6)).join(" → "));
			check("每一步是你当时说的那句话", chain.map((step) => step.words).join("|") === DOG_ASKS.join("|"), chain.map((step) => step.words).join(" | "));
			check("一条直链只有一道，连线一路往下", new Set(chain.map((step) => step.lane)).size === 1, `缩略图左边距：${[...new Set(chain.map((step) => step.lane))].join("、")}px`);
			await shot("05_小狗会话的五步链路");

			console.log("⑥ 在对话中查看：打开那个会话，滚到第三步那张图，闪一下");
			await click(`[data-ly-lineage-step="${DOG[2]}"]`);
			await until(`document.querySelector('[data-ly-gallery-detail="${DOG[2]}"]')`, 5000);
			await pause(700);
			await app.evaluate(`(() => { window.__flash = false; const seen = new MutationObserver(() => { if (document.querySelector('[data-ly-image-card][data-ly-flash]')) window.__flash = document.querySelector('[data-ly-image-card][data-ly-flash]').getAttribute('data-ly-image-call'); }); seen.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-ly-flash'] }); window.__flashWatch = seen; return true; })()`);
			await click("[data-ly-gallery-locate]");
			await until(`window.__flash`, 15000);
			await pause(450);
			const landed = await app.evaluate<{ call: string; inView: boolean; top: number; bottom: number; viewTop: number; viewBottom: number; gallery: boolean }>(`(() => {
				const card = document.querySelector('[data-ly-image-call="${DOG_CALLS[2]}"]');
				const view = card.closest('.ly-scroll-view') ?? document.querySelector('main .ly-scroll-view');
				const a = card.getBoundingClientRect(); const b = view.getBoundingClientRect();
				return { call: window.__flash, inView: a.top >= b.top - 1 && a.bottom <= b.bottom + 1, top: Math.round(a.top), bottom: Math.round(a.bottom), viewTop: Math.round(b.top), viewBottom: Math.round(b.bottom), gallery: Boolean(document.querySelector('[data-ly-gallery-detail]')) };
			})()`);
			check("回到对话，正好停在生成那张图的地方并闪了一下", landed.call === DOG_CALLS[2] && landed.inView && !landed.gallery, `闪的是 ${landed.call}，卡片 ${landed.top}–${landed.bottom}，可视区 ${landed.viewTop}–${landed.viewBottom}`);
			await shot("06_跳回对话里那张图");
			await pause(1600);

			console.log("⑦ 回到画廊，关掉大图：飞回它的卡片");
			await click('[data-ly-rail-item="gallery"]');
			await until(`document.querySelector('[data-ly-gallery-detail="${DOG[2]}"]')`, 5000);
			await pause(900);
		}
		await app.evaluate(`(() => { const out = { frames: [], stop: false }; window.__back = out; const tick = () => { const stage = document.querySelector('[data-ly-gallery-stage]'); if (stage) { const r = stage.getBoundingClientRect(); out.frames.push({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }); } if (!out.stop && document.querySelector('[data-ly-gallery-detail]')) requestAnimationFrame(tick); }; requestAnimationFrame(tick); return true; })()`);
		const closing = await app.evaluate<string>(`document.querySelector('[data-ly-gallery-detail]').getAttribute('data-ly-gallery-detail')`);
		await key("Escape", 27);
		await until(`!document.querySelector('[data-ly-gallery-detail]')`, 5000);
		await pause(400);
		const back = await app.evaluate<{ frames: { x: number; y: number; w: number }[]; tile: { x: number; y: number; w: number }; visible: string }>(`(() => { const tile = document.querySelector('[data-ly-gallery-tile="${closing}"]'); const r = tile.getBoundingClientRect(); return { frames: window.__back.frames, tile: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) }, visible: getComputedStyle(tile).visibility }; })()`);
		const end = back.frames.at(-1);
		check("关掉大图，它飞回自己的卡片，卡片随后露出来", Boolean(end) && Math.abs((end?.w ?? 0) - back.tile.w) <= 4 && Math.abs((end?.x ?? 0) - back.tile.x) <= 4 && back.visible === "visible", `最后一帧 ${end?.w}px@${end?.x},${end?.y} · 卡片 ${back.tile.w}px@${back.tile.x},${back.tile.y} · 卡片 ${back.visible}（${back.frames.length} 帧）`);
		await shot("07_关闭后回到网格");

		console.log("⑧ 搜索");
		// Closing flew the picture back to its tile, scrolling the album to it; the field is at the top.
		await app.evaluate(`document.querySelector('[data-ly-gallery] input').scrollIntoView({ block: "center" })`);
		await pause(500);
		await click('[data-ly-gallery] input');
		await app.send("Input.insertText", { text: "夜晚" });
		await pause(900);
		const found = await app.evaluate<string[]>(`[...document.querySelectorAll('[data-ly-gallery-tile]')].map((tile) => tile.getAttribute('data-ly-gallery-tile'))`);
		check("按说过的话搜得到", found.length === 1 && found[0] === names.night, `${found.length} 张：${found.map((name) => name.slice(0, 6)).join("、")}`);
		await shot("08_搜索说过的话");
		await key("Escape", 27);
		await pause(700);

		console.log("⑨ 在夜晚那张下面写一句，回车：发到它所在的对话里");
		await click(`[data-ly-gallery-tile="${names.night}"]`);
		await until(`document.querySelector('[data-ly-gallery-detail="${names.night}"] [data-ly-gallery-words]')`, 5000);
		await pause(900);
		await click("[data-ly-gallery-words]");
		await app.send("Input.insertText", { text: "整体再冷一点，像冬天" });
		await pause(800);
		await shot("09_在图下面写要怎么改");
		const before = relay.seen.length;
		await key("Enter", 13);
		await until(`!document.querySelector('[data-ly-gallery-detail]') && document.querySelectorAll('[data-ly-image-card]').length >= 4`, 20000);
		await pause(800);
		await shot("10_发到对话里开始画");
		// The visible screen only: a conversation retained out of sight is in the document too.
		const bubble = await app.evaluate<string>(`([...document.querySelectorAll('[data-question-index]')].filter((el) => el.checkVisibility()).at(-1)?.innerText ?? '').replace(/\\s+/g, ' ')`);
		check("对话里那条消息带着图和那句话", /整体再冷一点，像冬天/.test(bubble), bubble);

		console.log("   还在画的时候回到画廊：发送键换成停止键，和输入框里那颗一样");
		await click('[data-ly-rail-item="gallery"]');
		await until(`document.querySelector('[data-ly-gallery-detail] [data-ly-gallery-send] [data-composer-send="stop"]')`, 8000);
		const stopping = await app.evaluate<{ mode: string; radius: string; width: number }>(`(() => { const b = document.querySelector('[data-ly-gallery-detail] [data-ly-gallery-send] button'); return { mode: b.getAttribute('data-composer-send'), radius: getComputedStyle(b).borderRadius, width: Math.round(b.getBoundingClientRect().width) }; })()`);
		check("那个对话还在画时，编辑栏的按钮是输入框同款的停止键", stopping.mode === "stop" && stopping.width === 28 && stopping.radius === "8px", `${stopping.mode} · ${stopping.width}px · 圆角 ${stopping.radius}`);
		await pause(700);
		await shot("11_画廊里看到正在画的停止键");
		await until(`document.querySelector('[data-ly-gallery-detail="${names.winter}"]')`, 60000);
		await until(`document.querySelector('[data-ly-gallery-detail] [data-ly-gallery-send] [data-composer-send="send"]')`, 15000);
		check("画好后画廊停在新图上，按钮变回发送键", true, "停止 → 发送");
		const edit = relay.seen.slice(before).find((seen) => seen.path.endsWith("/images/edits"));
		const sentImages = edit?.body.image;
		const sent = Array.isArray(sentImages) ? String(sentImages[0]) : "";
		check("发出去的是原图本身，字节一点没变", sent === `data:image/jpeg;base64,${art.night}`, `${sent.slice(0, 30)}…（${sent.length} 字符）`);

		console.log("⑩ 画好以后：画廊自动切到刚画好的那张，链路接上了");
		await pause(1200);
		const grown = await app.evaluate<{ id: string; words: string; meta: string }[]>(`[...document.querySelectorAll('[data-ly-lineage-step]')].map((step) => ({ id: step.getAttribute('data-ly-lineage-step'), words: step.querySelector('[data-ly-lineage-words]').innerText, meta: step.querySelector('[data-ly-lineage-meta]').innerText }))`);
		check("新图接在夜晚那张后面，链路多了一步；黄昏那条分支整段列在后面", grown.map((step) => step.id).join() === [names.day, names.night, names.winter, names.sunset].join() && grown[2]?.words === "整体再冷一点，像冬天", grown.map((step) => step.words).join(" → "));
		await shot("12_新图接进链路");

		console.log("⑪ 在黄昏那张上标注，再写一句：标注那一步也在链路里");
		await click(`[data-ly-lineage-step="${names.sunset}"]`);
		await until(`document.querySelector('[data-ly-gallery-detail="${names.sunset}"]')`, 5000);
		await pause(800);
		await click("[data-ly-gallery-annotate]");
		await until(`document.querySelector('[role="dialog"][aria-modal="true"] button[aria-label="完成"]')`, 10000);
		await pause(1400);
		const canvas = await app.evaluate<{ x: number; y: number; w: number; h: number }>(`(() => { const all = [...document.querySelectorAll('[role="dialog"] canvas')]; const c = all[all.length - 1]; const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
		const cx = canvas.x + canvas.w * 0.72;
		const cy = canvas.y + canvas.h * 0.24;
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx + 70, y: cy });
		await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: cx + 70, y: cy, button: "left", buttons: 1, clickCount: 1 });
		for (let step = 1; step <= 36; step++) {
			const angle = (step / 36) * Math.PI * 2;
			await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx + Math.cos(angle) * 70, y: cy + Math.sin(angle) * 46, button: "left", buttons: 1 });
			await pause(16);
		}
		await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: cx + 70, y: cy, button: "left", buttons: 0, clickCount: 1 });
		await pause(900);
		await shot("13_在图上圈出要改的地方");
		await click('[role="dialog"][aria-modal="true"] button[aria-label="完成"]');
		await until(`document.querySelector('[data-ly-gallery-marked] img')`, 10000);
		await pause(1200);
		await click("[data-ly-gallery-words]");
		await app.send("Input.insertText", { text: "把圈出来的那片天空提亮一点" });
		await pause(800);
		await shot("14_标注图留在编辑栏里");
		const beforeMarked = relay.seen.length;
		await key("Enter", 13);
		await until(`document.querySelectorAll('[data-ly-image-card="done"]').length >= 5`, 60000);
		await settled(60000);
		const markedEdit = relay.seen.slice(beforeMarked).find((seen) => seen.path.endsWith("/images/edits"));
		const markedImages = markedEdit?.body.image;
		const markedImage = Array.isArray(markedImages) ? String(markedImages[0]) : "";
		check("标注过的图作为 PNG 发了出去", markedImage.startsWith("data:image/png;base64,") && markedImage.length > 10000, `${markedImage.slice(0, 26)}…（${markedImage.length} 字符）`);
		await click('[data-ly-rail-item="gallery"]');
		await until(`document.querySelector('[data-ly-gallery-detail="${names.bright}"]')`, 15000);
		await pause(1200);
		const throughMarks = await app.evaluate<{ id: string; words: string; meta: string }[]>(`[...document.querySelectorAll('[data-ly-lineage-step]')].map((step) => ({ id: step.getAttribute('data-ly-lineage-step'), words: step.querySelector('[data-ly-lineage-words]').innerText, meta: step.querySelector('[data-ly-lineage-meta]').innerText }))`);
		const markedAt = throughMarks.findIndex((step) => step.words === "在图上做了标注");
		check(
			"标注那一步接在黄昏后面，新图接在标注后面",
			markedAt > 0 && throughMarks[markedAt + 1]?.id === names.bright && throughMarks.some((step) => step.id === names.sunset),
			throughMarks.map((step) => `${step.meta.split(" · ")[0]}：${step.words}`).join(" → "),
		);
		await shot("15_链路穿过标注那一步");
		await key("Escape", 27);
		await pause(1200);
		await shot("16_回到画廊总览");

		console.log("⑫ 窄窗口：没有图标栏，大图在上、链路在下");
		await app.send("Emulation.setDeviceMetricsOverride", { width: 720, height: 860, deviceScaleFactor: 2, mobile: false });
		await pause(1500);
		await app.evaluate(`document.querySelector('[data-ly-gallery] input')?.scrollIntoView({ block: "center" })`);
		await pause(600);
		await shot("17_窄窗口的画廊");
		const narrowGrid = await app.evaluate<{ width: number; rows: number }>(`(() => { const grid = document.querySelector('[data-ly-gallery-grid]'); const tops = new Set([...grid.querySelectorAll('[data-ly-gallery-tile]')].map((tile) => Math.round(tile.getBoundingClientRect().top))); return { width: grid.clientWidth, rows: tops.size }; })()`);
		await click(`[data-ly-gallery-tile="${names.bright}"]`);
		await until(`document.querySelector('[data-ly-gallery-detail]')`, 5000);
		await pause(1200);
		const narrow = await app.evaluate<{ stage: { top: number; bottom: number; width: number }; panel: { top: number; width: number }; innerWidth: number }>(`(() => { const s = document.querySelector('[data-ly-gallery-stage]').getBoundingClientRect(); const p = document.querySelector('[data-ly-gallery-panel]').getBoundingClientRect(); return { stage: { top: Math.round(s.top), bottom: Math.round(s.bottom), width: Math.round(s.width) }, panel: { top: Math.round(p.top), width: Math.round(p.width) }, innerWidth }; })()`);
		check("窄窗口里大图在上、详情在下，都占满宽度", narrow.panel.top >= narrow.stage.bottom && narrow.panel.width >= narrow.innerWidth - 40 && narrowGrid.width > 600, `窗口 ${narrow.innerWidth}px · 图 ${narrow.stage.width}px 宽，底边 ${narrow.stage.bottom} · 详情从 ${narrow.panel.top} 开始、${narrow.panel.width}px 宽 · 网格 ${narrowGrid.width}px、${narrowGrid.rows} 行`);
		await shot("18_窄窗口的大图与链路");
		await key("Escape", 27);
		await pause(900);
		await app.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 2, mobile: false });
		await pause(900);
	} catch (error) {
		console.log(`💥 ${error instanceof Error ? error.message : String(error)}`);
		await shot("失败现场").catch(() => {});
		check("探针跑完了全程", false, error instanceof Error ? error.message : String(error));
	} finally {
		await stop();
		await app.stop();
		relay.close();
		const passed = results.filter((result) => result.ok).length;
		const video = join(OUT, `${stamp}_${TAG}画廊_${passed}of${results.length}.mp4`);
		await encode(frames, video);
		console.log(`\n🎬 ${video}\n${passed}/${results.length} 通过`);
		if (passed !== results.length) process.exitCode = 1;
	}
}

await main();
