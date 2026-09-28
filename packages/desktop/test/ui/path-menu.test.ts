/**
 * Right-clicking a file in a conversation: a file the turn edited, the header of its diff, a link in
 * a reply. Nothing happened on any of them — the one place a file's name is shown most, the
 * 「已编辑 N 个文件」 card, could not be opened in an editor or shown in the Finder.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h, type ReactNode } from "react";
import type { Message, SessionMeta } from "@lyra/core";
import type { TurnDelivery } from "../../electron/turn-delivery.ts";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { DockScope, SessionScope } from "../../src/app/session-scope.tsx";
import { useDeliveryReview } from "../../src/features/conversation/delivery-review.ts";
import { Markdown } from "../../src/features/conversation/Markdown.tsx";
import { TurnDeliveryCard } from "../../src/features/conversation/TurnDelivery.tsx";
import "../../src/features/dock/panels/builtin.tsx";
import { allPanels } from "../../src/features/dock/panels/registry.ts";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import { click, fire, mount, type Mounted } from "../helpers/mount.ts";

const ROOT = "/work/alpha";
const PRD = `${ROOT}/docs/prd.md`;
const LIB = `${ROOT}/src/lib.ts`;
const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const META: SessionMeta = { id: "a", title: "a", cwd: ROOT, projectId: ROOT, projectName: "alpha", createdAt: 1, updatedAt: 2, modelId: "", messageCount: 2, seq: 3, usage };
const SAID: Message[] = [
	{ role: "user", content: [{ type: "text", text: "写一份需求文档" }], timestamp: 1 },
	{ role: "assistant", content: [{ type: "text", text: "写好了" }], api: "anthropic-messages", provider: "t", model: "t", usage, stopReason: "stop", timestamp: 2 },
];
const DELIVERY: TurnDelivery = {
	files: [PRD, LIB].map((path) => ({ path, added: 3, removed: 1, hunks: [], changeIds: ["c1"], canUndo: true })),
	commands: [], serviceJobIds: [], warnings: [], reportPath: "",
};

let calls: Array<[string, string]>;
let copied: string[];
let notices: string[];
let gone: Set<string>;
let host: string;
let previous: { app: AppState; review: ReturnType<typeof useDeliveryReview.getState> };
let view: Mounted | undefined;

beforeEach(() => {
	calls = [];
	copied = [];
	notices = [];
	gone = new Set();
	host = "desktop";
	previous = { app: useApp.getState(), review: useDeliveryReview.getState() };
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			get host() {
				return host;
			},
			platform: "darwin",
			system: {
				openTargets: async () => [
					{ id: "zed", label: "Zed", aliases: [] },
					{ id: "cursor", label: "Cursor", aliases: [] },
					{ id: "vscode", label: "VS Code", aliases: [] },
					{ id: "reveal", label: "在访达中显示", aliases: [] },
				],
				pathExists: async (path: string) => !gone.has(path),
				openIn: async (target: string, path: string) => {
					calls.push([target, path]);
				},
				openPath: async (path: string) => {
					calls.push(["default", path]);
				},
			},
			delivery: { get: async () => DELIVERY },
			clipboard: { write: async (text: string) => void copied.push(text) },
			commands: { list: async () => ({ commands: [], skills: [], agents: [] }) },
		},
	});
	useApp.setState({
		activeSessionId: "a", pendingSessionId: null, meta: META, messages: SAID, toolRuns: {}, running: false,
		workspace: { path: ROOT, name: "alpha", isGitRepo: true, branch: "main" }, scratchCwd: null, scratchRoots: ["/scratch"],
		sessions: [META], sessionCache: {}, workspaceByPath: {},
		settings: { projects: [{ path: ROOT, name: "alpha" }], editor: { defaultOpenTarget: "zed" } } as unknown as AppState["settings"],
		notify: (message: string) => void notices.push(message),
	});
	window.localStorage.clear();
});

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	useApp.setState(previous.app, true);
	useDeliveryReview.setState(previous.review, true);
	Reflect.deleteProperty(window, "lyra");
});

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 10)));

async function inConversation(body: ReactNode): Promise<Mounted> {
	const mounted = await mount(
		h(I18nProvider, {
			locale: "zh-CN",
			children: h(LayoutProvider, { children: h(DockScope.Provider, { value: "a" }, h(SessionScope.Provider, { value: "a" }, body)) }),
		}),
	);
	await settle();
	return mounted;
}

/** The labels of every open menu's rows, the first menu first. */
function menus(): string[][] {
	return [...document.body.querySelectorAll('[role="menu"], [aria-label="打开方式"]')].map((menu) =>
		[...menu.querySelectorAll("button")].map((button) => (button.textContent ?? "").trim()),
	);
}

function row(label: string): HTMLElement {
	const found = [...document.body.querySelectorAll<HTMLElement>('[role="menu"] button, [aria-label="打开方式"] button')].find(
		(button) => (button.textContent ?? "").trim() === label,
	);
	assert.ok(found, `no 「${label}」 row`);
	return found;
}

async function rightClick(target: Element) {
	await fire(target, new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
	await settle();
}

async function card(): Promise<HTMLElement[]> {
	view = await inConversation(h(TurnDeliveryCard, { timestamp: 2 }));
	for (let i = 0; i < 100 && view.all("[data-delivery-file]").length < DELIVERY.files.length; i++) await settle();
	return view.all<HTMLElement>("[data-delivery-file]");
}

test("right-clicking a file the turn edited offers to open it, in Zed or another app, show it in the Finder, and copy its path", async () => {
	const [first] = await card();
	await rightClick(first);
	assert.deepEqual(menus(), [["打开", "在 Zed 中打开", "打开方式", "在访达中显示", "复制路径", "复制相对路径"]]);
});

test("在 Zed 中打开 hands the file to Zed; 在访达中显示 shows it where it lives", async () => {
	const [first] = await card();
	await rightClick(first);
	await click(row("在 Zed 中打开"));
	await settle();
	assert.deepEqual(calls, [["zed", PRD]]);
	assert.deepEqual(menus(), [], "choosing a row closes the menu");

	await rightClick(first);
	await click(row("在访达中显示"));
	await settle();
	assert.deepEqual(calls, [["zed", PRD], ["reveal", PRD]]);
});

test("打开方式 lists the other installed applications and the system's default, and choosing one closes both menus", async () => {
	const [first] = await card();
	await rightClick(first);
	await click(row("打开方式"));
	await settle();
	assert.deepEqual(menus(), [["打开", "在 Zed 中打开", "打开方式", "在访达中显示", "复制路径", "复制相对路径"], ["Cursor", "VS Code", "用默认应用打开"]]);
	await click(row("Cursor"));
	await settle();
	assert.deepEqual(calls, [["cursor", PRD]]);
	assert.deepEqual(menus(), []);

	await rightClick(first);
	await click(row("打开方式"));
	await settle();
	await click(row("用默认应用打开"));
	await settle();
	assert.deepEqual(calls, [["cursor", PRD], ["default", PRD]]);
});

test("a file that has moved since the turn is reported, not revealed", async () => {
	const [first] = await card();
	gone.add(PRD);
	await rightClick(first);
	await click(row("在访达中显示"));
	await settle();
	assert.deepEqual(calls, []);
	assert.deepEqual(notices, ["「prd.md」已经不在原来的位置了"]);
});

test("复制路径 and 复制相对路径 copy the full path and the path under the project", async () => {
	const [, second] = await card();
	await rightClick(second);
	await click(row("复制路径"));
	await rightClick(second);
	await click(row("复制相对路径"));
	await settle();
	assert.deepEqual(copied, [LIB, "src/lib.ts"]);
});

test("while the menu is open, resting on another row does not open a preview over it", async () => {
	const [first, second] = await card();
	await rightClick(first);
	await fire(second, new MouseEvent("mouseover", { bubbles: true }));
	// Past the card's 700ms preview delay.
	await act(async () => new Promise((resolve) => setTimeout(resolve, 850)));
	assert.equal(document.body.querySelector('[aria-label="文件变更预览"]'), null);
	assert.equal(menus().length, 1, "the menu is still open");
});

test("the diff pane's file header offers the same menu, without 打开", async () => {
	useDeliveryReview.getState().open({ sessionId: "a", timestamp: 2, path: PRD });
	const DeliveryPanel = allPanels().find((panel) => panel.kind === "delivery")!.render;
	view = await inConversation(h(DeliveryPanel));
	const header = view.find('[data-delivery-diff] .ly-pin > div');
	await rightClick(header);
	assert.deepEqual(menus(), [["在 Zed 中打开", "打开方式", "在访达中显示", "复制路径", "复制相对路径"]]);
});

test("a file linked in a reply offers it too, with 打开 doing what a click does", async () => {
	view = await inConversation(h(Markdown, { text: "文档在 [prd.md](docs/prd.md)" }));
	await rightClick(view.find("[data-ly-file-link] a"));
	assert.deepEqual(menus()[0]?.slice(0, 2), ["打开", "在 Zed 中打开"]);
	await click(row("在 Zed 中打开"));
	await settle();
	assert.deepEqual(calls, [["zed", PRD]]);
});

test("on the phone, where nothing can be opened, a file link offers no menu", async () => {
	// The card is not drawn on the phone at all; a link in a reply is.
	host = "mobile";
	view = await inConversation(h(Markdown, { text: "文档在 [prd.md](docs/prd.md)" }));
	await rightClick(view.find("[data-ly-file-link] a"));
	assert.deepEqual(menus(), []);
});
