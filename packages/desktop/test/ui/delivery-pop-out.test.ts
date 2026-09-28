/**
 * A popped-out delivery pane shows the turn and the file its conversation's review was on.
 *
 * The pane window is a second renderer with a fresh copy of `useDeliveryReview`, and the pop-out
 * hands it only the conversation. With no target it drew its empty state — 「文件变更」 and nothing
 * else. The target is now also kept per conversation in localStorage, which every window shares;
 * these mount the pane the way `PanelWindow` does — a session scope and no dock scope — over an
 * empty store.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h } from "react";
import type { TurnDelivery } from "../../electron/turn-delivery.ts";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { SessionScope } from "../../src/app/session-scope.tsx";
import { useDeliveryReview } from "../../src/features/conversation/delivery-review.ts";
import "../../src/features/dock/panels/builtin.tsx";
import { allPanels } from "../../src/features/dock/panels/registry.ts";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import { mount, type Mounted } from "../helpers/mount.ts";

const TURN = 1_790_000_000_000;
const OTHER_TURN = TURN + 60_000;

function delivery(...paths: string[]): TurnDelivery {
	return { files: paths.map((path) => ({ path, added: 3, removed: 1, hunks: [], changeIds: ["c1"], canUndo: true })), commands: [], serviceJobIds: [], warnings: [], reportPath: "" };
}
const TURNS: Record<number, TurnDelivery> = {
	[TURN]: delivery("/work/alpha/docs/prd.md", "/work/alpha/src/app.ts"),
	[OTHER_TURN]: delivery("/work/alpha/src/other.ts"),
};

let asked: Array<{ sessionId: string; timestamp: number }>;
let previous: { app: AppState; review: ReturnType<typeof useDeliveryReview.getState> };
let view: Mounted | undefined;

beforeEach(() => {
	asked = [];
	previous = { app: useApp.getState(), review: useDeliveryReview.getState() };
	localStorage.clear();
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			delivery: {
				get: async (sessionId: string, timestamp: number) => {
					asked.push({ sessionId, timestamp });
					return TURNS[timestamp];
				},
			},
		},
	});
	useApp.setState({ notify: () => {} });
});

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	useApp.setState(previous.app, true);
	useDeliveryReview.setState(previous.review, true);
	localStorage.clear();
	Reflect.deleteProperty(window, "lyra");
});

const panel = allPanels().find((one) => one.kind === "delivery")!;

/** What a panel window renders: its conversation's scope, no dock scope, and the pane's own header. */
async function panelWindow(sessionId: string): Promise<Mounted> {
	const Header = panel.header!;
	const Body = panel.render;
	return mount(
		h(I18nProvider, {
			locale: "zh-CN",
			children: h(LayoutProvider, { children: h(SessionScope.Provider, { value: sessionId }, h(Header), h(Body)) }),
		}),
	);
}

/** Another window opening a review: its store, and the shared record it leaves behind. */
function openedElsewhere(target: { sessionId: string; timestamp: number; path: string | null }) {
	useDeliveryReview.getState().open(target);
	useDeliveryReview.setState({ reviews: {} });
}

const shown = () => [...document.querySelectorAll("[data-delivery-diff]")].map((section) => section.getAttribute("data-delivery-diff"));

test("a popped-out pane shows the file its conversation's review was on, not an empty state", async () => {
	openedElsewhere({ sessionId: "a", timestamp: TURN, path: "/work/alpha/docs/prd.md" });
	view = await panelWindow("a");
	await act(async () => {});
	assert.deepEqual(asked, [{ sessionId: "a", timestamp: TURN }]);
	assert.deepEqual(shown(), ["/work/alpha/docs/prd.md"]);
	assert.match(document.body.textContent ?? "", /prd\.md/, "the header names the file, not 「文件变更」");
});

test("a review of the whole turn pops out as the whole turn", async () => {
	openedElsewhere({ sessionId: "a", timestamp: TURN, path: null });
	view = await panelWindow("a");
	await act(async () => {});
	assert.deepEqual(shown(), ["/work/alpha/docs/prd.md", "/work/alpha/src/app.ts"]);
});

test("the popped-out pane follows when the main window opens another file", async () => {
	openedElsewhere({ sessionId: "a", timestamp: TURN, path: "/work/alpha/docs/prd.md" });
	view = await panelWindow("a");
	await act(async () => {});
	// The main window writes the record; the pane's window hears it as a `storage` event.
	const key = "ly:delivery-target:a";
	const value = JSON.stringify({ timestamp: OTHER_TURN, path: "/work/alpha/src/other.ts" });
	localStorage.setItem(key, value);
	await act(async () => {
		// The DOM shim has no StorageEvent constructor; the hook reads only `key`.
		window.dispatchEvent(Object.assign(new Event("storage"), { key, newValue: value }));
	});
	await act(async () => {});
	assert.deepEqual(shown(), ["/work/alpha/src/other.ts"]);
});

test("another conversation's record is not this pane's", async () => {
	openedElsewhere({ sessionId: "b", timestamp: TURN, path: "/work/alpha/docs/prd.md" });
	view = await panelWindow("a");
	await act(async () => {});
	assert.deepEqual(asked, []);
	assert.deepEqual(shown(), []);
});

test("a review closed after its last change is undone leaves no record to pop out", () => {
	useDeliveryReview.getState().open({ sessionId: "a", timestamp: TURN, path: null });
	assert.ok(localStorage.getItem("ly:delivery-target:a"));
	useDeliveryReview.getState().close("a");
	assert.equal(localStorage.getItem("ly:delivery-target:a"), null);
});
