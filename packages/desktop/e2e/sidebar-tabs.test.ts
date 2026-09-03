/**
 * The sidebar's two lists, pinned for real.
 *
 * Everything here measures boxes and reads computed style. Nothing asserts on a class name, and
 * nothing reads the store — the claim under test is "the strip stays at the top and the list goes
 * under it", and the only honest evidence for that is where things are and how much of them is
 * being drawn.
 *
 * The rows are held by `position: sticky`, so where they sit is the browser's job and not worth
 * asserting. What is worth asserting is everything around it: that the fade starts under them
 * rather than through them, that a row being pushed out cannot surface above the strip, and — the
 * one that cost the most to learn — that a pinned row does not move while the list scrolls under
 * it. An earlier version placed these by hand from `scroll` events and lagged the compositor by a
 * frame, which is a row visibly jumping a wheel tick at a time.
 */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { SIDEBAR_MIN } from "../src/app/layout-widths.ts";
import { startApp, type RunningApp } from "./app.ts";

let app: RunningApp;

const DAY = 86_400_000;
/**
 * Enough projects that the list runs several screens past the viewport.
 *
 * Length is load-bearing here rather than incidental. A list that only just overflows cannot be
 * scrolled far enough for a heading to reach the rail and be held there — every scroll lands in the
 * middle of one heading pushing out the next — and it bottoms out immediately, which takes the
 * lower fade with it. Both of those read as the feature being broken.
 */
const PROJECTS = [
	"alpha-project",
	"beta-project",
	"gamma-project",
	"delta-project",
	"epsilon-project",
	"zeta-project",
	"eta-project",
	"theta-project",
];
const PER_PROJECT = 9;

before(async () => {
	app = await startApp({ port: 9453, seed });
	// Geometry, so the window has to be a known quantity rather than whatever this machine opens at.
	await app.send("Emulation.setDeviceMetricsOverride", {
		width: 1280,
		height: 900,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await new Promise((r) => setTimeout(r, 800));
});

after(async () => {
	await app?.stop();
});

async function seed(home: string): Promise<void> {
	const now = Date.now();
	const ages = [0, 0, 1, 1, 3, 9, 20, 40, 90];
	const metas = [];
	let n = 0;
	for (const name of PROJECTS) {
		for (let i = 0; i < PER_PROJECT; i++) {
			const updatedAt = now - ages[i % ages.length] * DAY - n * 60_000;
			metas.push({
				id: `s${n}`,
				title: `${name} 会话 ${i + 1}`,
				cwd: `/w/${name}`,
				projectId: name,
				projectName: name,
				createdAt: updatedAt - 60_000,
				updatedAt,
				modelId: "m",
				messageCount: 4,
				usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
				seq: 1,
				// A third filed away, so the archive is long enough to scroll and pin too.
				archived: n % 3 === 2,
			});
			n++;
		}
	}

	await mkdir(join(home, "sessions"), { recursive: true });
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify(metas));
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: PROJECTS.map((name, i) => ({ path: `/w/${name}`, name, pinned: false, lastOpenedAt: 100 - i })),
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "medium",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			pluginRegistries: [],
			skillRegistries: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4517, token: null },
			appearance: { theme: "dark" },
		}),
	);
}

const VIEW = `document.querySelector(".ly-sidebar-fill .ly-scroll-view")`;

interface Pinned {
	/** Distance from the top of the scroll viewport, in CSS pixels. */
	y: number;
	height: number;
	text: string;
	/** Whether the browser is currently holding it, as the row itself has been marked. */
	stuck: boolean;
	/**
	 * What it is painting, as `[r, g, b, a]` off a canvas rather than as a string.
	 *
	 * Computed colours come back in whichever notation the declaration used — `rgb()`, `rgba()`,
	 * `color(srgb …)` from a `color-mix()` — and comparing those as text means adding a case every
	 * time a stylesheet changes how it spells one. Painting the colour and reading the pixel gives
	 * one form for all of them, and `a === 0` versus `a === 255` is the question being asked here:
	 * a fill hides the list going under a held row, and a row holding nothing back has nothing to
	 * hide.
	 */
	fill: [number, number, number, number];
}

interface State {
	scrollTop: number;
	/** Where the unsoftened band starts. Non-zero only while a row is on its way to its rail. */
	holdTop: number;
	/** How deep the mask is erasing the list — what the pinned rows are standing on. */
	inset: number;
	fadeTop: number;
	fadeBottom: number;
	/** Where the strip sits in the list itself, before anything holds it back. */
	railInList: number;
	/** The strip, which is a row in the list that happens to stop at the top. */
	strip: Pinned | null;
	heads: Pinned[];
	/** The offset headings come to rest at, as the stylesheet has it. */
	rail: number;
}

/** Everything the pane is doing right now, read off the elements the user is looking at. */
async function state(): Promise<State> {
	return app.evaluate<State>(`(() => {
		const view = ${VIEW};
		const origin = view.getBoundingClientRect().top;
		const clean = (el) => el.innerText.replace(/\\s+/g, " ").trim();
		// Paint the colour and read the pixel: one form for every notation a computed style uses.
		const paint = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
		const rgba = (css) => {
			paint.clearRect(0, 0, 1, 1);
			paint.fillStyle = css.trim();
			paint.fillRect(0, 0, 1, 1);
			return [...paint.getImageData(0, 0, 1, 1).data];
		};
		const pin = (el) => {
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return {
				y: r.top - origin,
				height: r.height,
				text: clean(el),
				stuck: el.hasAttribute("data-ly-stuck"),
				fill: rgba(getComputedStyle(el).backgroundColor),
			};
		};
		const style = getComputedStyle(view);
		const px = (name) => Number.parseFloat(style.getPropertyValue(name)) || 0;
		return {
			scrollTop: view.scrollTop,
			holdTop: px("--ly-hold-top"),
			inset: px("--ly-fade-inset"),
			fadeTop: px("--ly-fade-top"),
			fadeBottom: px("--ly-fade-bottom"),
			railInList: view.querySelector("[data-ly-rail]").getBoundingClientRect().top - origin,
			strip: pin(view.querySelector("[data-ly-rail]")),
			heads: [...view.querySelectorAll("[data-ly-head]")].map(pin),
			rail: Number.parseFloat(getComputedStyle(view).getPropertyValue("--ly-rail")) || 0,
		};
	})()`);
}

async function scrollTo(y: number): Promise<State> {
	await app.evaluate(`(() => { ${VIEW}.scrollTop = ${y}; return true; })()`);
	// The placement runs on the next frame and the fades ease over `--ly-t-base`; this is past both,
	// so every number read here is the settled one rather than a value mid-transition.
	await new Promise((r) => setTimeout(r, 260));
	return state();
}

/**
 * Scroll until a heading is actually being held back, and report where it ended up.
 *
 * Hunting for it rather than scrolling to a number that ought to work. Between one heading being
 * held and the next taking over there is a stretch where nothing is at rest, and which offsets fall
 * in it depends on how many conversations each project happens to have — so picking a constant
 * means writing the fixture's row heights into the test twice.
 *
 * Held means resting exactly on the rail the stylesheet gives it — read from the page rather than
 * recomputed here, so this checks the browser is holding the row where the design says, not that
 * two copies of the same arithmetic agree.
 */
async function scrollUntilPinned(from = 200, to = 2200, step = 40, notThisOne?: string) {
	for (let y = from; y <= to; y += step) {
		const at = await scrollTo(y);
		const held = at.heads.find((head) => head.text !== notThisOne && Math.abs(head.y - at.rail) < 1);
		if (held) return { at, held };
	}
	return null;
}

/** Click a control by its accessible name, anywhere in the sidebar. */
async function click(label: string): Promise<void> {
	const hit = await app.evaluate<boolean>(`(() => {
		const el = [...document.querySelectorAll(".ly-sidebar-fill button")]
			.find((b) => (b.getAttribute("aria-label") ?? "").includes(${JSON.stringify(label)}));
		if (!el) return false;
		el.click();
		return true;
	})()`);
	assert.ok(hit, `no control named ${label}`);
	await new Promise((r) => setTimeout(r, 500));
}

async function selectTab(value: "projects" | "chats"): Promise<void> {
	await app.evaluate(`(() => { document.querySelector("[data-ly-tab='${value}']").click(); return true; })()`);
	await new Promise((r) => setTimeout(r, 500));
}

test("at rest the strip travels with the list and nothing is erased", async () => {
	const at = await scrollTo(0);
	assert.ok(at.railInList > 60, `the strip sits below the destinations, not at the top: ${JSON.stringify(at)}`);
	assert.equal(at.inset, 0, "erasing a band of a list nobody has scrolled would delete rows");
	assert.equal(at.fadeTop, 0, "and nothing is hidden above, so nothing softens");
	assert.ok(at.strip, "the strip is drawn");
});

test("scrolled, the strip holds the top and the list goes under it", async () => {
	const at = await scrollTo(400);
	assert.ok(at.scrollTop > 100, "the list has scrolled well past where the strip sits in it");
	assert.ok(Math.abs(at.strip?.y ?? -1) < 0.5, `and the strip stays at the top (${at.strip?.y})`);
	assert.ok(
		at.inset >= (at.strip?.height ?? 0) - 0.5,
		`the list is softened from under the strip rather than through it (${at.inset})`,
	);
	assert.ok(at.fadeTop > 0 && at.fadeBottom > 0, "both edges still soften — the fades outlive the pinning");
});

test("a project name is held under the strip, and the list is erased out from under it", async () => {
	const found = await scrollUntilPinned();
	assert.ok(found, "some scroll position holds a heading at the rail");
	assert.ok(found.held.text.length > 0, "and it is a real heading with a name on it");
	/*
	 * The erased band, not the heading's fill. If the band stopped at the strip, the rows below
	 * would start softening while still under the project name — the first conversation in a
	 * project, half drawn, every time.
	 */
	assert.ok(
		found.at.inset >= found.held.y + found.held.height - 1,
		`the erased band reaches the heading's underside (inset ${found.at.inset}, needs ${found.held.y + found.held.height})`,
	);
});

/*
 * A heading on its way out travels up through where the strip is, and has to be hidden by it.
 *
 * The strip covers that journey with its own fill, which is why its breathing room is padding
 * rather than margin — a margin is outside the fill, and an outgoing project name surfaced in the
 * six transparent pixels above the control and slid across the top of the pane.
 */
test("the strip's fill covers the whole rail, so nothing surfaces above it", async () => {
	// Scrolled first, and not incidentally: the fill only exists while the strip is being held,
	// so asking about it at rest is asking about a row that has nothing to hide. See the test below.
	const at = await scrollTo(400);
	assert.ok(at.strip?.stuck, "the strip is being held");
	assert.equal(at.strip?.fill[3], 255, `it has an opaque fill to hide them behind (${at.strip?.fill})`);
	assert.ok(
		Math.abs((at.strip?.height ?? 0) - at.rail) < 1,
		`and it is as tall as the rail headings stop at (${at.strip?.height} vs ${at.rail}) — any gap is a slot to show through`,
	);
});

/*
 * And it exists only then.
 *
 * The fill is there to hide the list going under a held row. A row travelling with the list has
 * nothing going under it, and an opaque band on it is a band of the wrong colour laid across a pane
 * the desktop is supposed to show through — which is what every project name and the strip itself
 * is paint that covers nothing — and it is what put a visible grey slab on every project name back
 * when this pane was translucent.
 *
 * Both halves are asserted here because either one alone is satisfiable by doing nothing: never
 * filling breaks the test above, always filling breaks this one.
 */
test("a row fills only while it is held, so a pane at rest stays clear", async () => {
	const rest = await scrollTo(0);
	assert.equal(rest.strip?.stuck, false, "at the top of the list nothing is being held back");
	assert.equal(rest.strip?.fill[3], 0, `and the strip paints nothing (${rest.strip?.fill})`);
	for (const head of rest.heads) {
		assert.equal(head.stuck, false, `「${head.text}」 travels with the list`);
		assert.equal(head.fill[3], 0, `「${head.text}」 paints nothing (${head.fill})`);
	}

	const found = await scrollUntilPinned();
	assert.ok(found, "some scroll position holds a heading at the rail");
	assert.ok(found.held.stuck, `「${found.held.text}」 is marked held once it reaches the rail`);
	assert.equal(found.held.fill[3], 255, `and only then does it fill (${found.held.fill})`);
	// The ones still coming up the list are unchanged by their neighbour being held.
	for (const head of found.at.heads.filter((h) => h.y > found.at.rail + 2)) {
		assert.equal(head.fill[3], 0, `「${head.text}」 is still in the list and still clear`);
	}
});

/*
 * The strip on its way to the rail, which is where it used to dissolve.
 *
 * The mask softens the top of the viewport and the strip travels through exactly that, so it faded
 * out as it approached, hung there as a ghost of itself, and snapped back to full strength the
 * instant it landed — a control, dimming and un-dimming, while the list around it did the right
 * thing. The list still fades above it; the band the mask leaves alone now starts at the strip
 * rather than at the top edge.
 *
 * Asserted as containment rather than by reading pixels: a row is untouched by the mask exactly
 * when it lies inside the unsoftened band, and both edges of that band are on the viewport.
 */
test("the strip is not faded on its way to the rail", async () => {
	let approaching: State | null = null;
	// Somewhere in here it is partway up. Which offset depends on how tall the destinations above
	// it are, so it is searched for rather than assumed.
	for (let y = 40; y <= 160 && !approaching; y += 4) {
		const at = await scrollTo(y);
		const top = at.strip?.y ?? -1;
		if (top > 0.5 && top < 34) approaching = at;
	}
	assert.ok(approaching, "some offset catches the strip partway to the rail");

	const strip = approaching.strip;
	assert.ok(strip, "the strip is on the viewport");
	assert.equal(strip.stuck, false, `it has not landed yet (${strip.y})`);
	assert.ok(
		approaching.holdTop <= strip.y + 0.5,
		`the unsoftened band starts at or above it (band ${approaching.holdTop}, strip ${strip.y})`,
	);
	assert.ok(
		approaching.inset >= strip.y + strip.height - 0.5,
		`and reaches past its underside (band ends ${approaching.inset}, strip ends ${strip.y + strip.height})`,
	);
	// The list above it is still being softened — this is not "turn the fade off while scrolling".
	assert.ok(approaching.holdTop > 0.5, `and the list above it still fades (${approaching.holdTop})`);
	assert.ok(approaching.fadeTop > 0, "with the top fade very much on");
});

test("landed, the band goes back to the top edge", async () => {
	const at = await scrollTo(400);
	assert.ok(at.strip?.stuck, "the strip is held");
	assert.equal(at.holdTop, 0, "nothing above it to leave unsoftened, so the band starts at the edge");
});

/*
 * The colour it fills with, which is the pane's own and must stay that way.
 *
 * This is the assertion that would have caught the whole episode: the fill was `--color-sidebar`
 * while the pane was painting something else, and every held row was a visible grey slab. Opaque,
 * because that is what hides the list — and exactly the pane's colour, because that is what makes
 * it invisible.
 */
test("a held row fills with the pane's own colour, opaque", async () => {
	const at = await scrollTo(400);
	assert.ok(at.strip?.stuck, "the strip is held");

	const pane = await app.evaluate<[number, number, number, number]>(`(() => {
		const paint = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
		paint.fillStyle = getComputedStyle(document.querySelector(".ly-sidebar-fill")).backgroundColor;
		paint.fillRect(0, 0, 1, 1);
		return [...paint.getImageData(0, 0, 1, 1).data];
	})()`);

	assert.equal(at.strip.fill[3], 255, `opaque (${at.strip.fill})`);
	assert.equal(pane[3], 255, `and so is the pane behind it (${pane})`);
	assert.deepEqual(at.strip.fill, pane, "the same colour, so a held row shows only by what it hides");
	for (const head of at.heads.filter((h) => h.stuck)) {
		assert.deepEqual(head.fill, pane, `「${head.text}」 too`);
	}
});

test("scrolling on past a project hands the rail to the next one", async () => {
	const first = await scrollUntilPinned();
	assert.ok(first, "a heading is held to begin with");

	// Carry on from where that one was found until a *different* project has taken the rail. How
	// far that is depends on how tall the first project's block happens to be, so it is searched
	// for rather than guessed at.
	const later = await scrollUntilPinned(first.at.scrollTop + 40, 2600, 40, first.held.text);
	assert.ok(later, "something is still held further down");
	assert.notEqual(later.held.text, first.held.text, "and it is a different project than the one we started in");
	assert.ok(
		later.at.inset >= later.held.y + later.held.height - 1,
		"with the band still erased to its underside",
	);
});

/*
 * The one that cost the most to learn, and the reason the pinning is CSS.
 *
 * Setting `scrollTop` from a test proves nothing here: that runs on the main thread, so a
 * measurement taken beside it lands in the same frame by construction and the failure cannot
 * appear. A wheel is handled on the compositor — the list moves there — so anything positioned from
 * JavaScript is drawn where the list *was*. The first version of this feature did exactly that and
 * every pinned row wobbled by a wheel tick: measured at 14px.
 *
 * Pinned means "does not move". Once held, its offset is a constant, and this is the whole claim.
 */
test("a pinned row does not move while a real wheel scrolls the list under it", async () => {
	await scrollTo(700);
	await app.evaluate(`(() => {
		const view = ${VIEW};
		window.__wobble = { strip: [], scrolls: [] };
		let frames = 0;
		function step() {
			const origin = view.getBoundingClientRect().top;
			window.__wobble.strip.push(view.querySelector("[data-ly-rail]").getBoundingClientRect().top - origin);
			window.__wobble.scrolls.push(view.scrollTop);
			if (++frames < 200) requestAnimationFrame(step);
		}
		requestAnimationFrame(step);
		return true;
	})()`);

	// Small steps in both directions, the way a trackpad sends them.
	for (let i = 0; i < 60; i++) {
		await app.send("Input.dispatchMouseEvent", {
			type: "mouseWheel",
			x: 150,
			y: 500,
			deltaX: 0,
			deltaY: i < 30 ? 16 : -16,
			pointerType: "mouse",
		});
		await new Promise((r) => setTimeout(r, 16));
	}
	await new Promise((r) => setTimeout(r, 300));

	const trace = await app.evaluate<{ strip: number[]; scrolls: number[] }>("window.__wobble");
	const moving = trace.strip.filter((_, i) => i > 0 && trace.scrolls[i] > 100 && trace.scrolls[i] !== trace.scrolls[i - 1]);
	assert.ok(moving.length > 10, `the wheel actually scrolled the list (${moving.length} moving frames)`);

	const wobble = Math.max(...moving) - Math.min(...moving);
	assert.ok(
		wobble < 1,
		`the strip stayed put while the list moved under it — wobble ${wobble.toFixed(2)}px across ${moving.length} frames`,
	);
});

test("the strip is the size of what is written on it, not of the pane", async () => {
	const measured = await app.evaluate<{ strip: number; tabs: number[]; content: number }>(`(() => {
		const list = document.querySelector(".ly-sidebar-fill [data-ly-rail] [role='tablist']");
		return {
			strip: list.getBoundingClientRect().width,
			tabs: [...list.querySelectorAll("[role='tab']")].map((el) => el.getBoundingClientRect().width),
			content: ${VIEW}.clientWidth,
		};
	})()`);

	const [first, second] = measured.tabs;
	assert.ok(Math.abs(first - second) < 1, `both tabs are the same width, so the knob can be half (${first}, ${second})`);
	// The 6px is the track's own padding. Anything beyond that is the strip having been stretched.
	assert.ok(
		Math.abs(measured.strip - (first + second + 6)) < 1.5,
		`the strip is exactly its two tabs plus its padding (${measured.strip} vs ${first + second + 6})`,
	);
	assert.ok(
		measured.strip < measured.content - 40,
		`and leaves the rest of the row to the buttons (${measured.strip} of ${measured.content})`,
	);
});

/*
 * The selected tab has to look like the one on top.
 *
 * Every surface token in this app steps from the background toward the foreground, which means on a
 * light theme `elevated` is *darker* than the `card` under it — so the obvious pair of tokens drew
 * the selected tab as a hole rather than as a knob, and the strip read as having nothing selected.
 * Stated as a relationship rather than as a colour, because it has to hold on both themes.
 */
test("the selected tab reads as lifted out of the track, not pressed into it", async () => {
	const tones = await app.evaluate<{ knob: string; track: string }>(`(() => {
		const scope = document.querySelector(".ly-sidebar-fill [data-ly-rail]");
		return {
			knob: getComputedStyle(scope.querySelector(".ly-tabs-knob")).backgroundColor,
			track: getComputedStyle(scope.querySelector(".ly-tabs")).backgroundColor,
		};
	})()`);

	const lightness = (colour: string) => {
		const [r, g, b] = colour.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0];
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};
	assert.ok(
		lightness(tones.knob) > lightness(tones.track) + 4,
		`the knob sits above the track it is in (knob ${tones.knob}, track ${tones.track})`,
	);
});

test("「聊天」 is every conversation, banded by when it was last touched", async () => {
	await selectTab("chats");
	const at = await scrollTo(0);
	const labels = at.heads.map((head) => head.text);
	assert.ok(labels.includes("今天"), `banded by date (${labels.join(", ")})`);
	assert.ok(labels.length >= 3, "and into several bands, not one");

	const rows = await app.evaluate<number>(`${VIEW}.querySelectorAll("[data-ly-tip='归档会话']").length`);
	assert.ok(rows > PER_PROJECT, `the list is flat across projects, not one project's worth (${rows})`);
});

test("a band heading pins the same way a project name does", async () => {
	await selectTab("chats");
	const found = await scrollUntilPinned();
	assert.ok(found, "a band is held at the rail");
	assert.ok(
		found.at.inset >= found.held.y + found.held.height - 1,
		"and the list is erased to its underside",
	);
});

test("switching tab starts the new list at its own top", async () => {
	await selectTab("chats");
	await scrollTo(600);
	await selectTab("projects");
	const at = await state();
	assert.equal(at.scrollTop, 0, `a depth into one list means nothing in another: ${JSON.stringify(at)}`);
});

test("the archive is the same two lists over the conversations you filed away", async () => {
	await selectTab("chats");
	const live = await scrollTo(0);
	const liveRows = await app.evaluate<string[]>(
		`[...${VIEW}.querySelectorAll("[data-ly-tip='归档会话']")].map((b) => b.getAttribute("aria-label"))`,
	);

	await click("已归档的聊天");
	const archived = await state();

	const restorable = await app.evaluate<number>(`${VIEW}.querySelectorAll("[data-ly-tip='取消归档']").length`);
	const deletable = await app.evaluate<number>(`${VIEW}.querySelectorAll("[data-ly-tip='删除']").length`);
	assert.ok(restorable > 0, "every row offers to put itself back");
	assert.equal(deletable, restorable, "and to be deleted — both, on every row");
	assert.equal(
		await app.evaluate<number>(`${VIEW}.querySelectorAll("[data-ly-tip='归档会话']").length`),
		0,
		"and none of them offers to be archived again",
	);

	assert.ok(archived.heads.length > 0, "still banded by date, being the 「聊天」 half");
	assert.notDeepEqual(
		await app.evaluate<string[]>(
			`[...${VIEW}.querySelectorAll("[data-ly-tip='取消归档']")].map((b) => b.getAttribute("aria-label"))`,
		),
		liveRows,
		"and showing different conversations than the list it replaced",
	);
	assert.equal(archived.scrollTop, 0, "opened at its own top");
	assert.ok(live.strip, "the strip was there before");
	assert.ok(archived.strip, "and is still there — the archive is a state of the list, not another pane");
});

test("the archive pins its headings too, and closing returns to the live list", async () => {
	await selectTab("projects");
	const found = await scrollUntilPinned();
	assert.ok(found, "a project name is held in the archive as well");
	assert.ok(
		found.at.inset >= found.held.y + found.held.height - 1,
		"and the archive's list is erased under it, same as the live one",
	);

	await click("退出归档");
	const back = await state();
	assert.equal(
		await app.evaluate<number>(`${VIEW}.querySelectorAll("[data-ly-tip='取消归档']").length`),
		0,
		"the archive's controls are gone",
	);
	assert.ok(
		(await app.evaluate<number>(`${VIEW}.querySelectorAll("[data-ly-tip='归档会话']").length`)) > 0,
		"and the live list is back, offering to archive again",
	);
	assert.equal(back.scrollTop, 0, "at its own top");
});

/**
 * The narrowest the pane can be dragged, with everything still inside it.
 *
 * Last in the file because it reloads the window to apply a stored width.
 *
 * The floor used to be 208px while the strip row needs 216 plus the list's 10px of padding either
 * side — so dragging all the way in put the archive button 18px past the pane's own edge, where it
 * was simply cut in half. Nothing in that row shrank, so the overflow had nowhere to go but out.
 */
test("at its narrowest, the strip and its buttons are still inside the pane", async () => {
	await app.evaluate(`(() => {
		window.localStorage.setItem("dw:sidebar-width", String(${SIDEBAR_MIN}));
		return true;
	})()`);
	await app.evaluate(`location.reload()`).catch(() => {});
	for (let i = 0; i < 40; i++) {
		const there = await app
			.evaluate<boolean>(`Boolean(document.querySelector(".ly-sidebar-fill [data-ly-rail]"))`)
			.catch(() => false);
		if (there) break;
		await new Promise((r) => setTimeout(r, 400));
	}
	await new Promise((r) => setTimeout(r, 600));

	const fit = await app.evaluate<{
		pane: number;
		rowOverflow: number;
		lastButtonPast: number;
		buttons: number;
	}>(`(() => {
		const pane = document.querySelector(".ly-sidebar-fill").getBoundingClientRect();
		const rail = document.querySelector("[data-ly-rail]");
		const row = rail.firstElementChild;
		const trailing = [...rail.querySelectorAll("button")].filter((b) => !b.closest(".ly-tabs"));
		const last = trailing[trailing.length - 1].getBoundingClientRect();
		return {
			pane: Math.round(pane.width),
			// Positive means the row wants more space than it has.
			rowOverflow: row.scrollWidth - row.clientWidth,
			// Positive means the control is drawn past the pane's edge.
			lastButtonPast: Math.round(last.right - pane.right),
			buttons: trailing.length,
		};
	})()`);

	assert.equal(fit.pane, SIDEBAR_MIN, "the pane is at its floor");
	assert.ok(fit.buttons >= 2, "both controls beside the strip are there to be measured");
	assert.ok(fit.rowOverflow <= 1, `the row fits the width it is given (overflow ${fit.rowOverflow}px)`);
	assert.ok(
		fit.lastButtonPast <= 0,
		`the last control is inside the pane, not past its edge (${fit.lastButtonPast}px)`,
	);
});
