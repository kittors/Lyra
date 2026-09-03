/**
 * Reading a model's name in the picker, which is the only thing the picker is for.
 *
 * Two faults, one cause: the row had less width than the name needed and no way to see the rest.
 *
 *   - 「视觉 · 」 sat in front of the context window on every model that takes images — which is most
 *     of them — spending four characters of the row on a near-constant fact and truncating the one
 *     part that tells two models apart.
 *   - The name is drawn in a `ScrollText`, which reads itself out on hover. It never did here: the
 *     animation is keyed off a hovered ancestor carrying `ly-scroll`, and this row did not carry it.
 *     So a long name faded out at the edge and stayed that way, however long you pointed at it.
 *
 * Hover is a real CSS state and cannot be faked from the page — `dispatchEvent(new MouseEvent(...))`
 * does not make `:hover` match. So the pointer is moved through the debugger, which is the same
 * event a hand would produce.
 */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";

let app: RunningApp;

/** Longer than any row can draw, so the marquee is the only way to read the end of it. */
const LONG = "anthropic-claude-opus-4-20250514-preview-extended-thinking-vision";
/** Short enough to fit, so it is the control: this one must never animate. */
const SHORT = "haiku";

/**
 * Filler, so the list is long enough to earn its search field.
 *
 * The field appears from eight models up (`SEARCH_FROM`), and everything about searching is only
 * reachable past that line. Their names carry digits on purpose: a picker full of `claude-opus-4`
 * and `gemini-3.7` is one where typing a number is an ordinary way to start looking for something.
 */
const FILLER = [
	"gemini-3.7-flash",
	"gemini-3.7-pro",
	"deepseek-v4-flash",
	"deepseek-v4-terminus",
	"grok-4.6-fast",
	"qwen-3-max",
	"kimi-k2-turbo",
	"glm-5-air",
];

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [
				{
					id: "local",
					name: "Local",
					baseUrl: "http://127.0.0.1:9",
					api: "anthropic-messages",
					apiKey: "not-a-key",
					enabled: true,
					models: [
						// Both take images, which is what used to put 「视觉 · 」 on both rows.
						{
							id: `local/${LONG}`,
							providerId: "local",
							modelId: LONG,
							name: LONG,
							contextWindow: 200000,
							maxOutputTokens: 8192,
							supportsThinking: false,
							supportsImages: true,
							supportsTools: true,
						},
						{
							id: `local/${SHORT}`,
							providerId: "local",
							modelId: SHORT,
							name: SHORT,
							contextWindow: 200000,
							maxOutputTokens: 8192,
							supportsThinking: false,
							supportsImages: true,
							supportsTools: true,
						},
						...FILLER.map((name) => ({
							id: `local/${name}`,
							providerId: "local",
							modelId: name,
							name,
							contextWindow: 200000,
							maxOutputTokens: 8192,
							supportsThinking: false,
							supportsImages: true,
							supportsTools: true,
						})),
					],
				},
			],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: `local/${SHORT}`,
			permissionMode: "full",
			thinking: "off",
			retryAttempts: 1,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4521, token: null },
		}),
	);
}

before(async () => {
	app = await startApp({ port: 9460, seed });
});

after(async () => {
	await app?.stop();
});

const UI = `
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	const label = (el) => el.innerText.replace(/\\s+/g, " ").trim();
	const click = (el) => el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
	const menu = () => document.querySelector('[aria-label="选择模型"]');
	const openModelMenu = async () => {
		if (menu()) return menu();
		const chip = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find((x) =>
			(x.dataset.lyTip || "").endsWith("上下文"),
		);
		if (!chip) throw new Error("no model chip");
		click(chip);
		await wait(500);
		if (!menu()) throw new Error("model menu did not open");
		return menu();
	};
	const row = (id) => menu().querySelector('[data-model="local/' + id + '"]');
	const field = () => menu().querySelector("input");
	const rows = () => [...menu().querySelectorAll("[data-model]")].map((r) => r.dataset.model);
	/** Type one character the way a keyboard does: the key event first, then the value it produces. */
	const typeInto = (input, char) => {
		const down = new KeyboardEvent("keydown", { key: char, bubbles: true, cancelable: true });
		const delivered = input.dispatchEvent(down);
		// A handler that called preventDefault is a handler that swallowed the character.
		if (!delivered) return false;
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
		setter.call(input, input.value + char);
		input.dispatchEvent(new Event("input", { bubbles: true }));
		return true;
	};
	/** Empty the field, so a test states its own query rather than inheriting the last one's. */
	const clear = async () => {
		const input = field();
		if (!input) return;
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
		setter.call(input, "");
		input.dispatchEvent(new Event("input", { bubbles: true }));
		await wait(200);
	};
	const type = async (text) => {
		for (const char of text) {
			const input = field();
			if (!input) return false;
			input.focus();
			if (!typeInto(input, char)) return false;
			await wait(120);
		}
		return true;
	};
`;

function ui<T>(body: string): Promise<T> {
	return app.evaluate<T>(`(async () => { ${UI} ${body} })()`);
}

/** Move the real pointer somewhere, because `:hover` answers to nothing else. */
async function pointAt(x: number, y: number): Promise<void> {
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
}

test("no row spends its width saying 视觉", async () => {
	const rows = await ui<string[]>(`
		await openModelMenu();
		return [...menu().querySelectorAll("[data-model]")].map(label);
	`);

	assert.ok(rows.length >= 2, `the menu drew its models: ${JSON.stringify(rows)}`);
	for (const text of rows) {
		assert.doesNotMatch(text, /视觉/, `a model row still labels itself 视觉: ${text}`);
	}
	// The window is still there — this removed a label, not the column it sat in.
	assert.ok(
		rows.every((text) => /200K/.test(text)),
		`every row still says how much context it has: ${JSON.stringify(rows)}`,
	);
});

test("a name too long for its row reads itself out when pointed at", async () => {
	/*
	 * Asked of the animation rather than of pixels moving.
	 *
	 * A position sampled twice can differ for reasons that have nothing to do with this — a reflow,
	 * a scroll, the menu settling. `animation-name` is the fact itself: either the rule matched and
	 * the marquee is running, or it did not.
	 */
	const box = await ui<{ x: number; y: number; track: boolean }>(`
		await openModelMenu();
		const target = row(${JSON.stringify(LONG)});
		if (!target) throw new Error("the long-named model is not in the menu");
		const rect = target.getBoundingClientRect();
		return {
			x: Math.round(rect.left + rect.width / 2),
			y: Math.round(rect.top + rect.height / 2),
			track: Boolean(target.querySelector(".ly-marquee-track")),
		};
	`);

	/*
	 * The second copy of the text is laid out only when the first one really overflows, so its
	 * presence is `ScrollText` having measured the row and agreed there is something to scroll to.
	 */
	assert.equal(box.track, true, "the name was not measured as overflowing, so there is nothing to read out");

	await pointAt(box.x, box.y);
	// Past the 300ms the animation waits before it starts, so a "not running" reading means it.
	await new Promise((resolve) => setTimeout(resolve, 700));

	const running = await ui<{ long: string; short: string | null }>(`
		const track = row(${JSON.stringify(LONG)}).querySelector(".ly-marquee-track");
		const other = row(${JSON.stringify(SHORT)});
		return {
			long: getComputedStyle(track).animationName,
			short: other?.querySelector(".ly-marquee-track") ? "has-track" : null,
		};
	`);

	assert.equal(running.long, "ly-marquee", `hovering the row did not set its name moving: ${running.long}`);
	/*
	 * The control, and it matters: `ScrollText` animates nothing that fits, so a row which already
	 * shows its whole name must not twitch as the pointer crosses it.
	 */
	assert.equal(running.short, null, "a name that fits was given a scrolling track it does not need");
});

test("the pointer leaving stops it", async () => {
	// Otherwise every row the pointer has ever touched would still be moving behind the menu.
	await pointAt(5, 5);
	await new Promise((resolve) => setTimeout(resolve, 400));

	const idle = await ui<string>(`
		const track = row(${JSON.stringify(LONG)})?.querySelector(".ly-marquee-track");
		return track ? getComputedStyle(track).animationName : "gone";
	`);
	assert.equal(idle, "none", `the name kept scrolling with the pointer elsewhere: ${idle}`);
});

// ---------------------------------------------------------------------------
// Searching, which is what the field above the list is for
// ---------------------------------------------------------------------------

test("typing a digit searches, rather than picking the model on that row", async () => {
	/*
	 * The reported fault, and it makes the field unusable rather than merely awkward: the number
	 * keys pick from the first four rows, and the guard against that was 「is the query non-empty」
	 * — which is false for the first character you type. So the field opens focused, you type the
	 * 「4」 of `claude-opus-4`, and the menu chooses row four and shuts.
	 *
	 * Digits are not an edge case here. Model names are mostly version numbers.
	 */
	await ui(`await openModelMenu();`);

	const typed = await ui<{ open: boolean; value: string; rows: string[] }>(`
		await clear();
		await type("4");
		return {
			open: Boolean(menu()),
			value: menu() ? field().value : "",
			rows: menu() ? rows() : [],
		};
	`);

	assert.equal(typed.open, true, "the menu closed as soon as a digit was typed");
	assert.equal(typed.value, "4", `the digit did not reach the field: 「${typed.value}」`);
	assert.ok(typed.rows.length > 0, "a search for 「4」 matched nothing at all");
	assert.ok(
		typed.rows.every((id) => id.includes("4")),
		`rows that do not match 「4」 were left in the list: ${JSON.stringify(typed.rows)}`,
	);
});

test("it goes on filtering as the rest of the query arrives", async () => {
	const narrowed = await ui<{ open: boolean; value: string; rows: string[] }>(`
		await openModelMenu();
		await clear();
		await type("4.6");
		return { open: Boolean(menu()), value: field().value, rows: rows() };
	`);

	assert.equal(narrowed.open, true, "the menu closed part-way through the query");
	assert.equal(narrowed.value, "4.6", "each character landed in the field, in order");
	assert.deepEqual(narrowed.rows, ["local/grok-4.6-fast"], `「4.6」 should match one model: ${JSON.stringify(narrowed.rows)}`);
});

test("a query matching nothing says so, and clearing it brings the list back", async () => {
	const empty = await ui<{ note: string; rows: string[] }>(`
		await clear();
		await type("zzz");
		return {
			note: [...menu().querySelectorAll("p")].map(label).join(" "),
			rows: rows(),
		};
	`);
	assert.equal(empty.rows.length, 0, "a query nothing matches still drew rows");
	assert.match(empty.note, /没有匹配的模型/, `and it should say why the list is empty: 「${empty.note}」`);

	const cleared = await ui<{ rows: number; value: string }>(`
		const clearButton = [...menu().querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "清除搜索");
		if (!clearButton) throw new Error("no clear button while a query is in the field");
		click(clearButton);
		await wait(300);
		return { rows: rows().length, value: field().value };
	`);
	assert.equal(cleared.value, "", "clearing emptied the field");
	assert.ok(cleared.rows >= 10, `and the whole list came back: ${cleared.rows} rows`);
});

test("searching by provider name works too, not only by model", async () => {
	const byHouse = await ui<string[]>(`
		await clear();
		await type("Local");
		return rows();
	`);
	assert.ok(byHouse.length >= 10, `every model of a matched provider is listed: ${byHouse.length} rows`);
});

test("choosing a searched-for model still works, and closes the menu", async () => {
	/*
	 * The other half of a search: it exists to get you to a model. Worth its own case because the
	 * number-key handler and the row's own click both end in `choose`, and a fix that stopped the
	 * first could easily have stopped the second.
	 */
	const chosen = await ui<{ open: boolean; chip: string }>(`
		await openModelMenu();
		await clear();
		await type("kimi");
		const target = row("kimi-k2-turbo");
		if (!target) throw new Error("the search did not reach the model");
		click(target.querySelector('button[role="menuitem"]'));
		await wait(600);
		const chip = [...document.querySelectorAll('button[aria-haspopup="menu"]')].find((x) =>
			(x.dataset.lyTip || "").endsWith("上下文"),
		);
		return { open: Boolean(menu()), chip: chip ? label(chip) : "" };
	`);

	assert.equal(chosen.open, false, "picking a model left the menu open");
	assert.match(chosen.chip, /kimi-k2-turbo/, `the composer should now show the chosen model: 「${chosen.chip}」`);
});
