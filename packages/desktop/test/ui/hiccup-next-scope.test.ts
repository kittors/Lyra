/**
 * 「继续」 under a failed turn speaks to the conversation of the screen it is drawn in.
 *
 * The send named no conversation, which means the live one — in a split, whichever screen has focus.
 * A press focuses its screen first, so the mouse picked the right one; from the keyboard the carry-on
 * went into the conversation beside it (measured in a real window: `e2e/split-scope-rest-probe.ts
 * hiccup`, where the fake model was asked to carry on in the other project). `ResumeRow`, the same
 * entry point wearing another row, already names its screen — see `resume-row-scope.test.ts`.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createElement as h } from "react";
import type { UserContent } from "@lyra/core";
import { SessionScope } from "../../src/app/session-scope.tsx";
import { HiccupRow } from "../../src/features/conversation/HiccupTrace.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import type { Hiccup } from "../../src/lib/hiccup.ts";
import { useApp, type AppState } from "../../src/store/index.ts";
import { click, mount, type Mounted } from "../helpers/mount.ts";

/** A request that failed and was given up on, with nothing to fix in settings: the row offers 「继续」. */
const GAVE_UP: Hiccup = {
	id: "hiccup-1", at: 2, attempts: 1, until: 0, summary: "服务端异常", kind: "upstream", fingerprint: "500", repeated: 1, outcome: "gave_up", resume: false,
};

let previous: AppState;
let view: Mounted | undefined;

beforeEach(() => {
	previous = useApp.getState();
});

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	// The whole state back, stand-in actions included, so nothing leaks into the next test.
	useApp.setState(previous, true);
});

test("「继续」 on a screen without focus is sent to that screen's conversation", async () => {
	const sent: Array<{ text: string; sessionId: string | null | undefined; carryOn: boolean | undefined }> = [];
	useApp.setState({
		activeSessionId: "a",
		send: async (content: UserContent[], options?: { sessionId?: string | null; carryOn?: boolean }) => {
			const first = content[0];
			sent.push({ text: first?.type === "text" ? first.text : "", sessionId: options?.sessionId, carryOn: options?.carryOn });
			return true;
		},
	});
	view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(SessionScope.Provider, { value: "b" }, h(HiccupRow, { hiccup: GAVE_UP })) }));
	await click(view.find("[data-resume-continue]"));
	assert.deepEqual(sent, [{ text: "继续，从中断的地方接着做。", sessionId: "b", carryOn: true }], "the carry-on went to the conversation with focus");
});
