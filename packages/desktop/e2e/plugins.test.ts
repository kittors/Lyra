/**
 * The plugins page in a real window: what it draws, and what uninstalling actually removes.
 *
 * The unit tests own the rules — where a bundle lands, what its id is, which settings rows it
 * writes. What they cannot see is the half that only exists once there is a window: whether a card
 * appears for something on disk, whether the uninstall in the ⋯ menu reaches the same code the
 * tests call, and whether a page of bundles without their own icons draws marks you can tell apart.
 *
 * That last one is why the icon assertion is here rather than in a unit test. "Every card came back
 * with the same GitHub avatar on it" is not a property of any function — it was a property of the
 * page, produced by a registry that answers with the repository owner's face for anything that
 * shipped no icon, and by a monorepo that makes seven products share one owner. It could only be
 * seen by looking.
 *
 * Uninstalling is driven through the actual menu rather than through `window.lyra`, because the
 * question is whether *the button* works. Everything it touches — the directory, the settings file
 * — is then read off the disk, not off the screen.
 *
 * Installing cannot be reached the same way, and the reason is worth writing down: the 安装 button
 * only exists on a card that came from a registry, a registry index must be https, and standing up
 * an HTTPS server a test process will trust is a great deal of machinery for a button. So that one
 * is driven by calling the same IPC the button calls — which still crosses the process boundary,
 * still clones, still writes settings, and still has to show up on the page afterwards.
 */

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";

import { startApp, type RunningApp } from "./app.ts";

const run = promisify(execFile);

let app: RunningApp;
/** A git repository inside the profile, so the install in the real window has something to clone. */
let source: string;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A profile with two bundles already installed and no registry configured.
 *
 * No registry on purpose: whether this machine can reach the catalogue would otherwise decide what
 * is on the page, and a test that draws a different number of cards depending on the network is a
 * test that reports on the network. Everything asserted below is about bundles on disk, which are
 * the same on every machine.
 */
async function seed(home: string): Promise<void> {
	const mcp = join(home, "mcp", "demo-mcp");
	await mkdir(mcp, { recursive: true });
	await writeFile(
		join(mcp, ".mcp.json"),
		JSON.stringify({ mcpServers: { demo: { command: "npx", args: ["-y", "@demo/server"] } } }),
	);

	const plugin = join(home, "plugins", "demo-plugin", "skills", "greet");
	await mkdir(plugin, { recursive: true });
	await writeFile(join(plugin, "SKILL.md"), "---\nname: greet\ndescription: 在用户请求问候或需要确认连通性时，给出简短、友好的中文问候，用于验证已安装的技能可以被发现并执行。\n---\n\n说你好。\n");

	/*
	 * Something to install, as an actual repository. `git` takes a local path as a remote, so the
	 * install below runs the same code it runs against GitHub — clone, inspect, sort, move — without
	 * this test depending on whether the machine has a network.
	 */
	source = join(home, "source-repo");
	await mkdir(join(source, "skills", "translate"), { recursive: true });
	await writeFile(
		join(source, "skills", "translate", "SKILL.md"),
		"---\nname: translate\ndescription: 用户提供外语文本并要求中文译文时使用，保留原意、术语和段落结构，将输入内容翻译成清晰自然的中文。\n---\n\n翻译它。\n",
	);
	await writeFile(join(source, "plugin.json"), JSON.stringify({ name: "翻译器", skills: "skills" }));
	await run("git", ["init", "-q", "."], { cwd: source });
	await run("git", ["add", "-A"], { cwd: source });
	await run("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: source });

	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			// The row an install would have written, so uninstalling has something to clear.
			mcpServers: [
				{
					id: "demo",
					name: "demo",
					transport: "stdio",
					command: "npx",
					args: ["-y", "@demo/server"],
					enabled: false,
					origin: { bundle: "demo-mcp" },
				},
			],
			projects: [],
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
		}),
	);
}

before(async () => {
	app = await startApp({ port: 9450, seed });
	await openPlugins();
});

after(async () => {
	await app?.stop();
});

async function openPlugins(): Promise<void> {
	await app.evaluate(`(() => {
		const nav = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "插件" || b.getAttribute("aria-label") === "插件");
		if (!nav) throw new Error("no plugins entry in the sidebar");
		nav.click();
		return true;
	})()`);
	await waitFor(`document.body.innerText.includes("已安装")`, "the plugins page never listed anything installed");
}

/**
 * Move to one of the page's three tabs.
 *
 * Looked for inside the market's own tab list, because 插件 is both a tab on this page and the entry
 * in the sidebar that opened it — and the sidebar comes first in the DOM. Taking the first match
 * anywhere clicks the navigation, which lands back where we already are and looks exactly like a
 * tab that refused to switch.
 */
async function switchTab(label: string): Promise<void> {
	await app.evaluate(`(() => {
		// The strip shows a count after each label (MCP 3); the label is what is matched.
		const tab = [...document.querySelectorAll("[data-market] [role=tab]")].find((b) => b.checkVisibility({ visibilityProperty: true }) && b.textContent?.replace(/\\d+$/, "").trim() === ${JSON.stringify(label)});
		if (!tab) throw new Error("no tab called " + ${JSON.stringify(label)});
		tab.click();
		return true;
	})()`);
}

/** Poll an expression until it is true, so nothing here is timing against how fast the machine is. */
async function waitFor(expression: string, complaint: string, attempts = 40): Promise<void> {
	for (let attempt = 0; attempt < attempts; attempt++) {
		if (await app.evaluate<boolean>(`Boolean(${expression})`).catch(() => false)) return;
		await wait(250);
	}
	throw new Error(`${complaint}\n${await app.evaluate<string>("document.body.innerText")}`);
}

test("a bundle on disk gets a card, under the tab for what it is", async () => {
	/*
	 * Two directories, two tabs, and neither of them says which it is. The MCP one holds nothing but
	 * a server declaration and the plugin holds skills — they are sorted by what is inside them,
	 * which is the rule the whole catalogue was rebuilt around, and the tab a card lands on is the
	 * only visible evidence that the sorting happened at all.
	 */
	assert.match(await app.evaluate<string>(`document.body.innerText`), /demo-plugin/, "the 插件 tab opens first");

	await switchTab("MCP");
	await waitFor(`document.body.innerText.includes("demo-mcp")`, "the MCP bundle never appeared on its own tab");

	// And it is not on both: a bundle has one kind, so it gets one card.
	const onMcpTab = await app.evaluate<string>(`document.body.innerText`);
	assert.doesNotMatch(onMcpTab, /demo-plugin/, "the plugin does not also show up under MCP");
});

test("marks are drawn for bundles with no icon, and they are not all one picture", async () => {
	/*
	 * The complaint this page was fixed for: every card wearing the same photograph. A bundle with no
	 * icon now gets a mark for its kind, so what has to be true is that nothing on the page is an
	 * `<img>` repeated across entries — a picture two entries share identifies neither, and is
	 * dropped in the main process before the page ever sees it.
	 */
	const images = await app.evaluate<string[]>(`
		[...document.querySelectorAll("img")].map((img) => img.currentSrc || img.src)
	`);
	const repeated = images.filter((src, index) => src && images.indexOf(src) !== index);
	assert.deepEqual(repeated, [], "no picture is used for more than one entry");

	// And what stands in its place is a real mark, not an empty box.
	const marks = await app.evaluate<number>(`document.querySelectorAll('[role="img"] svg').length`);
	assert.ok(marks > 0, "bundles without an icon are drawn with a mark");
});

test("installing puts the bundle on disk and a card on the page, under its own name", async () => {
	/*
	 * The whole path, in the window: renderer asks, main process clones and sorts, the page re-reads
	 * the directories and draws what it finds. Every one of those is covered by a unit test on its
	 * own; what is only true here is that they are wired to each other.
	 *
	 * The bundle deliberately calls itself 翻译器 while installing as `translator`. The directory is
	 * the identity — it is what uninstalling removes and what the settings rows are stamped with —
	 * and the manifest is the label, so the card has to show the label while the directory takes the
	 * id. Getting that backwards is invisible until something tries to remove it.
	 */
	await switchTab("插件");
	const result = await app.evaluate<{ ok: boolean; kind?: string; message?: string }>(
		`window.lyra.plugins.installFromRegistry({
			id: "translator",
			name: "翻译器",
			kind: "plugin",
			repository: ${JSON.stringify(source)},
		})`,
	);
	assert.equal(result.ok, true, `the install failed: ${result.message}`);
	assert.equal(result.kind, "plugin", "a directory of skills is a plugin, whatever the entry claimed");

	assert.deepEqual(await readdir(join(app.home, "plugins", "translator", "skills")), ["translate"]);

	/*
	 * And the page shows it once asked to re-read.
	 *
	 * Clicked rather than waited for: nothing on disk announces itself, and the button in the header
	 * is the thing a person would press. Installing through a card calls the same `refresh` on its
	 * own, which is the path the IPC call above deliberately skips.
	 */
	await app.evaluate(`(() => {
		const button = [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "重新读取");
		if (!button) throw new Error("no re-read button in the header");
		button.click();
		return true;
	})()`);
	await waitFor(`document.body.innerText.includes("翻译器")`, "the installed bundle never appeared on the page");
});

test("uninstalling from the ⋯ menu removes the directory and the settings row together", async () => {
	await switchTab("MCP");
	await waitFor(`document.body.innerText.includes("demo-mcp")`, "the MCP tab never came back");

	/*
	 * Open the bundle's own page, then its ⋯ menu. A card offers one action — install, update, or
	 * what state it is in — and everything else about an installed bundle lives on its page.
	 */
	await app.evaluate(`(() => {
		const card = [...document.querySelectorAll("[data-card]")].find((c) => c.textContent?.includes("demo-mcp"));
		if (!card) throw new Error("no card for demo-mcp");
		card.querySelector("button").click();
		return true;
	})()`);
	await waitFor(`Boolean(document.querySelector("[data-plugin-detail]"))`, "the card did not open its page");
	await app.evaluate(`(() => {
		const more = document.querySelector('[data-plugin-detail] button[aria-label="更多操作"]');
		if (!more) throw new Error("no ⋯ menu on the bundle's page");
		more.click();
		return true;
	})()`);
	await waitFor(`document.body.innerText.includes("卸载")`, "the menu never opened");

	await app.evaluate(`(() => {
		const item = [...document.querySelectorAll('[role="menuitem"], button')].find(
			(b) => b.textContent?.trim() === "卸载",
		);
		item.click();
		return true;
	})()`);
	// The menu gives way to a question rather than acting on the click; answering it is the action.
	await waitFor(`document.body.innerText.includes("卸载 demo-mcp？")`, "no confirmation was asked");

	await app.evaluate(`(() => {
		const confirm = [...document.querySelectorAll("button")]
			.filter((b) => b.textContent?.trim() === "卸载")
			.pop();
		confirm.click();
		return true;
	})()`);

	/*
	 * Read off the disk, not off the screen. A card disappearing is the page's opinion; the directory
	 * being gone and the settings row with it is what actually happened — and those are two separate
	 * writes, which is exactly why they are asserted separately.
	 */
	await waitFor(
		`!document.body.innerText.includes("demo-mcp")`,
		"the card was still there after the uninstall was confirmed",
	);

	const left = await readdir(join(app.home, "mcp")).catch(() => []);
	assert.deepEqual(left, [], "the bundle's directory is gone");

	const settings = JSON.parse(await readFile(join(app.home, "settings.json"), "utf8"));
	assert.deepEqual(settings.mcpServers, [], "and the row it wrote into settings went with it");
});
