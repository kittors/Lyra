/* oxlint-disable no-console -- a probe that prints what it measured */
/**
 * What the right-hand end of a model row actually does, measured rather than assumed.
 *
 * The row was rebuilt around one idea: the column at the edge holds the context window at rest
 * and trades it for the star when you point at the row, and the selected row says so with a fill
 * instead of a tick. Every part of that is a computed style or a rectangle, so every part of it
 * can be read back — which is the point. Five props can all be set correctly and the thing on
 * screen still be wrong; what is asked for here is what the browser resolved, after layout.
 *
 * Not a test — `node e2e/model-row-aside-probe.ts` — and it also writes pictures, because
 * 「is the fill obviously a different colour from the hover grey」 is not a number.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { startApp, type RunningApp } from "./app.ts";

/** Real names, because the question includes how much of a real name is left after the column. */
const NAMES = [
	"claude-opus-4-20250514",
	"claude-sonnet-4-5-20250929",
	"gemini-3.8-flash-high",
	"deepseek-v4-flash-thinking",
	"grok-4.6-fast-reasoning",
	"kimi-k2-turbo-preview",
];
const SECOND = ["gpt-5.2-codex", "gpt-5.2-mini", "o4-reasoning-high", "gpt-4.1-legacy"];

/** Starred and selected at once, the way the reported screenshot had it. */
const PICKED = "relay/gemini-3.8-flash-high";
const ALSO_STARRED = "relay/deepseek-v4-flash-thinking";
/** Neither starred nor selected: the plain case the other two are read against. */
const PLAIN = "house/gpt-5.2-codex";

function models(prefix: string, names: string[], window: (i: number) => number) {
	return names.map((name, i) => ({
		id: `${prefix}/${name}`,
		providerId: prefix,
		modelId: name,
		name,
		contextWindow: window(i),
		maxOutputTokens: 8192,
		supportsThinking: true,
		supportsImages: true,
		supportsTools: true,
	}));
}

/*
 * `LYRA_PROBE_DARK=1` runs the whole thing on the dark theme.
 *
 * Worth a switch rather than an eyeball: the selected row's fill is a percentage of the accent
 * mixed into nothing, and 12% of a blue over a near-black panel is not the same amount of
 * visible as 12% of it over white. Only the rest of `appearance` is left out — settings merge
 * over `DEFAULT_APPEARANCE`, so naming the theme is the whole of saying it.
 */
const DARK = process.env.LYRA_PROBE_DARK === "1";
const tag = DARK ? "暗色" : "亮色";

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			appearance: { theme: DARK ? "dark" : "light" },
			providers: [
				{
					id: "relay",
					name: "Relay",
					baseUrl: "http://127.0.0.1:9",
					api: "anthropic-messages",
					apiKey: "not-a-key",
					enabled: true,
					// A 1M row beside 200K rows: the edge has to stay on one line regardless.
					models: models("relay", NAMES, (i) => (i === 2 ? 1_000_000 : i === 1 ? 500_000 : 200_000)),
				},
				{
					id: "house",
					name: "House",
					baseUrl: "http://127.0.0.1:9",
					api: "openai-chat",
					apiKey: "not-a-key",
					enabled: true,
					models: models("house", SECOND, () => 200_000),
				},
			],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: PICKED,
			favoriteModelIds: [PICKED, ALSO_STARRED],
			permissionMode: "full",
			thinking: "off",
			retryAttempts: 1,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4523, token: null },
		}),
	);
}

const dir = process.argv[2] ?? join(homedir(), "Desktop", "模型菜单改版测试");
await mkdir(dir, { recursive: true });

const app: RunningApp = await startApp({ port: 9471, seed });

/** Park the pointer somewhere harmless, so a previous row is not still lit. */
const PARK = { x: 640, y: 180 };

async function pointAt(x: number, y: number): Promise<void> {
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
	await new Promise((resolve) => setTimeout(resolve, 420));
}

async function shot(name: string): Promise<void> {
	const png = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(dir, name), Buffer.from(png.data, "base64"));
	console.log(`  → ${name}`);
}

/**
 * Where to put the pointer so a given row is hovered but the star is not.
 *
 * Left of centre on purpose: the star's hit area is the whole right-hand column, and a reading
 * taken with the pointer on the star answers a slightly different question than 「the row is
 * hovered」. Both are worth having, so they are taken separately.
 *
 * Scrolled into view first, and that is not a nicety. `getBoundingClientRect` answers for a row
 * the scroller has clipped as readily as for one you can see, so the first run of this probe
 * pointed at a coordinate outside the menu entirely and reported that hovering did nothing —
 * a made-up fault, in code that was working.
 */
const centre = (id: string) => `(async () => {
	const row = document.querySelector('[data-model="${id}"]');
	row.scrollIntoView({ block: "center", behavior: "instant" });
	await new Promise(requestAnimationFrame);
	const r = row.getBoundingClientRect();
	const hit = document.elementFromPoint(Math.round(r.left + r.width * 0.35), Math.round(r.top + r.height / 2));
	return {
		x: Math.round(r.left + r.width * 0.35),
		y: Math.round(r.top + r.height / 2),
		// What is actually under that point, so a miss is reported as a miss rather than as a fault.
		hits: hit ? (hit.closest('[data-model]')?.dataset.model ?? hit.tagName) : "nothing",
	};
})()`;

interface Aside {
	window: { opacity: string; transform: string; right: number };
	star: { opacity: string; transform: string; right: number; pressed: string | null; fill: string };
	rowBackground: string;
	selected: boolean;
}

/* Read the resolved values off one row. `right` is what says the two take the same place. */
const aside = (id: string) => `(() => {
	const row = document.querySelector('[data-model="${id}"]');
	const win = row.querySelector('.ly-model-window');
	const star = row.querySelector('.ly-model-star');
	const icon = star.querySelector('svg');
	const ws = getComputedStyle(win), ss = getComputedStyle(star);
	return {
		window: { opacity: ws.opacity, transform: ws.transform, right: Math.round(win.getBoundingClientRect().right) },
		star: {
			opacity: ss.opacity,
			transform: ss.transform,
			right: Math.round(icon.getBoundingClientRect().right),
			pressed: star.getAttribute('aria-pressed'),
			fill: getComputedStyle(icon).fill,
		},
		rowBackground: getComputedStyle(row).backgroundColor,
		selected: row.dataset.selected === 'true',
	};
})()`;

try {
	await new Promise((resolve) => setTimeout(resolve, 1400));
	await app.evaluate(`(() => {
		const chip = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find((x) =>
			(x.dataset.lyTip || "").endsWith("上下文"),
		);
		chip.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
		return true;
	})()`);
	await new Promise((resolve) => setTimeout(resolve, 900));
	await pointAt(PARK.x, PARK.y);

	console.log("\n— 静止：右边那一格只有上下文，星星藏着 —");
	await shot(`02-改后-${tag}-静止.png`);
	for (const id of [PICKED, ALSO_STARRED, PLAIN]) {
		const state = await app.evaluate<Aside>(aside(id));
		console.log(`${id}\n  ${JSON.stringify(state)}`);
	}

	/* Every row's edge on one line, with 1M and 200K both in the list. */
	const edges = await app.evaluate<{ windows: number[]; stars: number[]; gaps: number[] }>(`(() => {
		const rows = [...document.querySelectorAll('[data-model]')];
		const round = (n) => Math.round(n * 10) / 10;
		return {
			windows: rows.map((r) => round(r.querySelector('.ly-model-window').getBoundingClientRect().right)),
			stars: rows.map((r) => round(r.querySelector('.ly-model-star svg').getBoundingClientRect().right)),
			gaps: rows.slice(1).map((r, i) => round(r.getBoundingClientRect().top - rows[i].getBoundingClientRect().bottom)),
		};
	})()`);
	console.log(`右边缘（上下文）: ${[...new Set(edges.windows)].join(", ")}`);
	console.log(`右边缘（星星）  : ${[...new Set(edges.stars)].join(", ")}`);
	console.log(`行间距          : ${[...new Set(edges.gaps)].join(", ")}`);

	console.log("\n— 指上去：选中 + 已收藏的那一行 —");
	const at = await app.evaluate<{ x: number; y: number; hits: string }>(centre(PICKED));
	await pointAt(at.x, at.y);
	console.log(`  指针落在 ${at.hits}`);
	console.log(`  ${JSON.stringify(await app.evaluate<Aside>(aside(PICKED)))}`);
	await shot(`03-改后-${tag}-指着选中行.png`);

	console.log("\n— 指上去：没收藏过的那一行 —");
	const plainAt = await app.evaluate<{ x: number; y: number; hits: string }>(centre(PLAIN));
	await pointAt(plainAt.x, plainAt.y);
	console.log(`  指针落在 ${plainAt.hits}`);
	console.log(`  ${JSON.stringify(await app.evaluate<Aside>(aside(PLAIN)))}`);
	await shot(`04-改后-${tag}-指着未收藏行.png`);

	/*
	 * The swap, frame by frame.
	 *
	 * Sampled on `requestAnimationFrame` rather than on a timer: a timer reports what the clock
	 * says, and the question is what was painted. A run of values strictly between 0 and 1 is a
	 * transition; readings that go 0, 0, 1, 1 are a cut, which is what this is here to tell apart.
	 *
	 * The pointer is moved by the debugger and the sampling is started without waiting for it,
	 * because a `:hover` that has already finished settling has nothing left to sample. Synthetic
	 * mouse events are no use at all here: `:hover` answers to the real pointer and to nothing
	 * else, and an earlier version of this probe dispatched `mouseover` and dutifully reported a
	 * flat line.
	 */
	await pointAt(PARK.x, PARK.y);
	const sampler = `(async () => {
		const row = document.querySelector('[data-model="${PLAIN}"]');
		const win = row.querySelector('.ly-model-window'), star = row.querySelector('.ly-model-star');
		const window_ = [], star_ = [];
		for (let i = 0; i < 16; i++) {
			await new Promise(requestAnimationFrame);
			window_.push(Number(getComputedStyle(win).opacity));
			star_.push(Number(getComputedStyle(star).opacity));
		}
		return { window: window_, star: star_ };
	})()`;
	const sampling = app.evaluate<{ window: number[]; star: number[] }>(sampler);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: plainAt.x, y: plainAt.y, buttons: 0 });
	const real = await sampling;
	console.log("\n— 逐帧：指针移上去的那 16 帧 —");
	console.log(`  上下文 ${real.window.map((n) => n.toFixed(2)).join(" ")}`);
	console.log(`  星星   ${real.star.map((n) => n.toFixed(2)).join(" ")}`);
	const moving = (xs: number[]) => xs.some((n) => n > 0.02 && n < 0.98);
	console.log(`  是渐变而不是硬切：上下文 ${moving(real.window)} / 星星 ${moving(real.star)}`);

	/*
	 * Pressing the star with the real mouse, which is the whole of 「it can be clicked」.
	 *
	 * A dispatched `click` would pass whatever the star's opacity is, so it cannot tell a star you
	 * can reach from one drawn under something else. A real press at the star's own coordinates
	 * goes through hit-testing, and hit-testing is the thing in doubt: the star is absolutely
	 * placed over the window it replaces.
	 */
	const starAt = await app.evaluate<{ x: number; y: number; hits: string }>(`(() => {
		const row = document.querySelector('[data-model="${PLAIN}"]');
		const r = row.querySelector('.ly-model-star svg').getBoundingClientRect();
		const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
		const hit = document.elementFromPoint(x, y);
		return { x, y, hits: hit ? (hit.closest('button')?.className.split(' ').find((c) => c.startsWith('ly-model-')) ?? hit.tagName) : "nothing" };
	})()`);
	await pointAt(starAt.x, starAt.y);
	for (const type of ["mousePressed", "mouseReleased"]) {
		await app.send("Input.dispatchMouseEvent", { type, x: starAt.x, y: starAt.y, button: "left", clickCount: 1, buttons: type === "mousePressed" ? 1 : 0 });
	}
	await new Promise((resolve) => setTimeout(resolve, 700));
	const toggled = await app.evaluate<{ pressed: string | null; stored: string[] }>(`(async () => {
		const settings = await window.lyra.settings.get();
		const star = document.querySelector('[data-model="${PLAIN}"] .ly-model-star');
		return { pressed: star ? star.getAttribute('aria-pressed') : null, stored: settings.favoriteModelIds || [] };
	})()`);
	console.log(`\n— 真实鼠标点那颗星 —\n  点之前那个点上是 ${starAt.hits}\n  ${JSON.stringify(toggled)}`);
	await shot(`05-改后-${tag}-刚收藏完.png`);

	console.log(`\n图在 ${dir}`);
} finally {
	await app.stop();
}
