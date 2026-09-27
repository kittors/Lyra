/**
 * Closing a sub-agent from a screen's panel closes it in that screen's conversation.
 *
 * The close button asked the live slot which conversation it was in — whichever screen had focus. A
 * mouse press focuses its screen first, so clicks happened to land; the keyboard reaches the panel of
 * a screen without focus, and there the main process was asked to close an agent the focused
 * conversation never had. Nothing happened (measured in a real window:
 * `e2e/split-scope-rest-probe.ts subagent`).
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createElement as h } from "react";
import type { SubAgentSummary } from "@lyra/core";
import { SessionScope } from "../../src/app/session-scope.tsx";
import { SubAgentPanel } from "../../src/features/subagents/SubAgentPanel.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import { useSubAgents } from "../../src/store/subAgents.ts";
import { click, mount, type Mounted } from "../helpers/mount.ts";

const USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function finished(id: string, description: string): SubAgentSummary {
	return { id, agent: "explore", description, status: "done", startedAt: 1, endedAt: 2, toolCalls: 0, depth: 1, usage: USAGE };
}

let asked: Array<[string, string]>;
let previous: AppState;
let view: Mounted | undefined;

beforeEach(() => {
	asked = [];
	previous = useApp.getState();
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			subAgents: {
				detail: async () => null,
				dismiss: async (sessionId: string, id: string) => {
					asked.push([sessionId, id]);
					return "removed";
				},
			},
		},
	});
	// 乙 holds the live slot; 甲 is on the other screen with the two agents it dispatched.
	useApp.setState({ activeSessionId: "b", pendingSessionId: null, messages: [], running: false });
	useSubAgents.setState({ agents: [], transcripts: {}, focused: null, loading: [], rosters: { a: [finished("a:sub:1", "找入口"), finished("a:sub:2", "找配置")] } });
});

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	useApp.setState(previous, true);
	useSubAgents.setState({ agents: [], transcripts: {}, focused: null, loading: [], rosters: {} });
	Reflect.deleteProperty(window, "lyra");
});

test("the close button in a screen without focus names that screen's conversation", async () => {
	view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(SessionScope.Provider, { value: "a" }, h(SubAgentPanel)) }));
	// One close button per agent, in the switcher's menu (`SubAgentMenu`).
	await click(view.find("[data-sub-switch]"));
	const close = document.querySelector<HTMLButtonElement>('[data-sub-menu] button[aria-label="关闭 找入口"]');
	assert.ok(close, "the menu drew no close button for 找入口");
	await click(close);
	assert.deepEqual(asked, [["a", "a:sub:1"]], "asked the focused conversation, which never dispatched it");
});
