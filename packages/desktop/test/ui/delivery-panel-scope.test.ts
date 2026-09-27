/**
 * The delivery panel in a screen shows that screen's review, named by that screen's project.
 *
 * A split window can show a delivery review in each screen. The review was one per window: opening
 * 乙's review took the one 甲's screen had open, and 甲's panel stepped aside for it. And the file
 * names were cut against the live slot's project, so 乙's files, under a screen without focus, were
 * named from 甲's project root.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createElement as h, Fragment, type ReactNode } from "react";
import type { Message, SessionMeta } from "@lyra/core";
import type { WorkspaceInfo } from "../../electron/ipc-types.ts";
import type { TurnDelivery } from "../../electron/turn-delivery.ts";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { DockScope, SessionScope } from "../../src/app/session-scope.tsx";
import { useDeliveryReview } from "../../src/features/conversation/delivery-review.ts";
import { usePaneDock } from "../../src/features/dock/pane-store.ts";
import "../../src/features/dock/panels/builtin.tsx";
import { allPanels } from "../../src/features/dock/panels/registry.ts";
import { has } from "../../src/features/dock/tree.ts";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import type { Cache } from "../../src/store/derive.ts";
import { act } from "react";
import { mount, type Mounted } from "../helpers/mount.ts";

const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const ALPHA: WorkspaceInfo = { path: "/work/alpha", name: "alpha-app", isGitRepo: true, branch: "main" };
const BETA: WorkspaceInfo = { path: "/work/beta", name: "beta-lib", isGitRepo: true, branch: "beta-work" };
const ROOMY = { width: 1200, height: 900 };

function meta(id: string, cwd: string, name: string): SessionMeta {
	return { id, title: id, cwd, projectId: cwd, projectName: name, createdAt: 1, updatedAt: 2, modelId: "", messageCount: 2, seq: 3, usage };
}
const said = (id: string): Message[] => [
	{ role: "user", content: [{ type: "text", text: `${id} 的问题` }], timestamp: 1 },
	{ role: "assistant", content: [{ type: "text", text: `${id} 的回答` }], api: "anthropic-messages", provider: "t", model: "t", usage, stopReason: "stop", timestamp: 2 },
];
function parked(one: SessionMeta): Cache[string] {
	return { meta: one, messages: said(one.id), toolRuns: {}, state: { running: false, approvals: [], todos: [], compactions: [], commandRuns: [], hiccups: [], stopped: null, retrying: null, capabilities: null, pendingUserMessage: null } };
}
const A = meta("a", ALPHA.path, ALPHA.name);
const B = meta("b", BETA.path, BETA.name);

function delivery(path: string): TurnDelivery {
	return { files: [{ path, added: 3, removed: 1, hunks: [], changeIds: ["c1"], canUndo: true }], commands: [], serviceJobIds: [], warnings: [], reportPath: "" };
}
const DELIVERIES: Record<string, TurnDelivery> = { a: delivery("/work/alpha/src/app.ts"), b: delivery("/work/beta/src/lib.ts") };

let previous: { app: AppState; review: ReturnType<typeof useDeliveryReview.getState> };
let view: Mounted | undefined;

beforeEach(() => {
	previous = { app: useApp.getState(), review: useDeliveryReview.getState() };
	Object.defineProperty(window, "lyra", { configurable: true, value: { delivery: { get: async (sessionId: string) => DELIVERIES[sessionId] } } });
	// 甲 holds the live slot in alpha; 乙, beside it, is parked in beta.
	useApp.setState({
		activeSessionId: "a", pendingSessionId: null, meta: A, messages: said("a"), toolRuns: {}, running: false,
		workspace: ALPHA, scratchCwd: null, scratchRoots: ["/scratch"], parkedDraft: null,
		sessions: [A, B], sessionCache: { b: parked(B) }, workspaceByPath: { [BETA.path]: BETA },
		notify: () => {},
	});
	usePaneDock.setState({ trees: {}, sizes: {}, drag: null, maximized: {}, focused: {}, crossRatio: {}, host: null });
	usePaneDock.getState().rememberSize("a", ROOMY);
	usePaneDock.getState().rememberSize("b", ROOMY);
});

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	useApp.setState(previous.app, true);
	useDeliveryReview.setState(previous.review, true);
	Reflect.deleteProperty(window, "lyra");
});

const DeliveryPanel = allPanels().find((panel) => panel.kind === "delivery")!.render;

function screen(id: string, ...body: ReactNode[]): ReactNode {
	return h("div", { "data-screen": id }, h(DockScope.Provider, { value: id }, h(SessionScope.Provider, { value: id }, ...body)));
}

function inWindow(...parts: ReactNode[]): Promise<Mounted> {
	return mount(h(I18nProvider, { locale: "zh-CN", children: h(LayoutProvider, { children: h(Fragment, null, ...parts) }) }));
}

async function settle(): Promise<void> {
	for (let round = 0; round < 6; round++) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5));
		});
	}
}

/** The file names a screen's delivery panel draws, as a person reads them. */
function named(id: string): string[] {
	return [...document.querySelectorAll(`[data-screen="${id}"] [data-delivery-diff]`)].map((section) => section.querySelector(".truncate")?.textContent ?? "");
}

/** What a turn's 「审核」 does: the review of that conversation's turn, in its screen's dock. */
async function review(id: string): Promise<void> {
	await act(async () => {
		useDeliveryReview.getState().open({ sessionId: id, timestamp: 2, path: null }, DELIVERIES[id]);
		usePaneDock.getState().open(id, "delivery");
	});
	await settle();
}

test("the review under a screen without focus names its files from that screen's project", async () => {
	view = await inWindow(screen("b", h(DeliveryPanel)));
	await review("b");
	assert.deepEqual(named("b"), ["src/lib.ts"], "the file was named from the focused conversation's project root");
});

test("opening a review in one screen leaves the review another screen has open", async () => {
	view = await inWindow(screen("a", h(DeliveryPanel)), screen("b", h(DeliveryPanel)));
	await review("a");
	assert.deepEqual(named("a"), ["src/app.ts"]);
	await review("b");
	assert.deepEqual(named("b"), ["src/lib.ts"]);
	assert.ok(has(usePaneDock.getState().tree("a"), "delivery"), "甲's review panel was closed when 乙 opened one");
	assert.deepEqual(named("a"), ["src/app.ts"], "甲's panel no longer showed 甲's review");
});
