/**
 * The window's half of per-conversation reasoning: which level is displayed, and where a change
 * is written to.
 *
 * The second one is the whole bug. Every control here used to write the app default, so the
 * assertions worth having are about what was *not* written — a call that lands in the right place
 * and also in the wrong one looks identical on screen and is the thing being fixed.
 */

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import type { SessionMeta, Settings } from "@lyra/core";

interface Call {
	sessionId: string;
	value: unknown;
}

const setThinkingCalls: Call[] = [];
const setModelCalls: Call[] = [];
const saved: Settings[] = [];

/*
 * Enough of a window for the store's own imports.
 *
 * Importing the app store pulls in the dock, which registers a `beforeunload` listener at module
 * scope and localStorage-backed layout. Neither is under test; both have to exist or the import
 * itself throws.
 */
(globalThis as unknown as { window: unknown }).window = {
	addEventListener: () => {},
	removeEventListener: () => {},
	localStorage: {
		getItem: () => null,
		setItem: () => {},
		removeItem: () => {},
	},
	matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} }),
	lyra: {
		agent: {
			setThinking: async (sessionId: string, thinking: unknown) => {
				setThinkingCalls.push({ sessionId, value: thinking });
			},
			setModel: async (sessionId: string, modelId: string) => {
				setModelCalls.push({ sessionId, value: modelId });
			},
		},
		settings: {
			save: async (settings: Settings) => {
				saved.push(settings);
				return settings;
			},
		},
	},
};

const { useApp } = await import("../src/store/index.ts");
const { sessionThinking, THINKING_FALLBACK } = await import("../src/lib/thinking.ts");

const SETTINGS = { thinking: "medium", defaultModelId: "relay/a" } as unknown as Settings;
const META = { id: "s-1", modelId: "relay/a" } as unknown as SessionMeta;

describe("which level is on screen", () => {
	it("the conversation's own, when it has one", () => {
		assert.equal(sessionThinking({ thinking: "high" }, SETTINGS), "high");
	});

	it("the app default, when it does not", () => {
		assert.equal(sessionThinking({}, SETTINGS), "medium");
		assert.equal(sessionThinking(null, SETTINGS), "medium");
	});

	it("「关闭」 is a choice, not an absence", () => {
		// `off` is falsy-adjacent enough that `||` would quietly promote it to the default, which
		// would be the app charging for reasoning somebody switched off.
		assert.equal(sessionThinking({ thinking: "off" }, SETTINGS), "off");
	});

	it("with no settings loaded yet it still names a level", () => {
		assert.equal(sessionThinking(null, null), THINKING_FALLBACK);
	});
});

describe("where a change is written", () => {
	beforeEach(() => {
		setThinkingCalls.length = 0;
		setModelCalls.length = 0;
		saved.length = 0;
		useApp.setState({ settings: SETTINGS, meta: META, activeSessionId: "s-1", messages: [] });
	});

	it("a level chosen inside a conversation goes to that conversation only", async () => {
		await useApp.getState().setThinking("high");
		assert.deepEqual(setThinkingCalls, [{ sessionId: "s-1", value: "high" }]);
		assert.equal(saved.length, 0, "the app default is not touched");
		assert.equal(useApp.getState().meta?.thinking, "high", "and the label updates without a round trip");
	});

	it("with no conversation open it becomes the default for new ones", async () => {
		useApp.setState({ meta: null, activeSessionId: null });
		await useApp.getState().setThinking("low");
		assert.equal(setThinkingCalls.length, 0, "there is no conversation to write to");
		assert.equal(saved.at(-1)?.thinking, "low");
	});

	it("picking a model inside a conversation no longer re-aims every future one", async () => {
		await useApp.getState().setModel("relay/b");
		assert.deepEqual(setModelCalls, [{ sessionId: "s-1", value: "relay/b" }]);
		assert.equal(saved.length, 0, "`defaultModelId` is a separate decision");
		assert.equal(useApp.getState().meta?.modelId, "relay/b");
	});

	it("asking for it explicitly does set the default", async () => {
		await useApp.getState().setModel("relay/b", { asDefault: true });
		assert.equal(saved.at(-1)?.defaultModelId, "relay/b");
	});

	it("on a blank conversation the pick is the default, because there is nowhere else for it", async () => {
		useApp.setState({ meta: null, activeSessionId: null });
		await useApp.getState().setModel("relay/c");
		assert.equal(setModelCalls.length, 0);
		assert.equal(saved.at(-1)?.defaultModelId, "relay/c");
	});
});
