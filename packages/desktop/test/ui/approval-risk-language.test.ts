/**
 * Why the approval card is asking, in the window's language.
 *
 * The gate used to write the risk rule's sentence into the top of the card's text, and the rules
 * only had Chinese: an English window asked about `git push --force` under 「强制推送会覆盖远程
 * 历史」. The finding now arrives beside the text as a rule code, and the card words it from the
 * catalogues — the same line in the same place, in whichever language the window is set to.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h, memo } from "react";
import { RISK_REASONS, type ApprovalRisk, type UiLocale } from "@lyra/core";

import { LayoutProvider } from "../../src/app/layout.tsx";
import { ApprovalOverlay } from "../../src/features/conversation/ApprovalOverlay.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { MESSAGE_CATALOGS } from "../../src/i18n/messages/index.ts";
import { useApp } from "../../src/store/index.ts";
import { mount } from "../helpers/mount.ts";

const PUSH = "git push --force origin main";
const FORCE_PUSH: ApprovalRisk = { code: "force-push", text: "强制推送会覆盖远程历史" };

/** What the card prints in its text block for one pending request. */
async function cardText(locale: UiLocale, risk: ApprovalRisk | undefined, detail = PUSH): Promise<string> {
	const previous = useApp.getState();
	Object.defineProperty(window, "lyra", { configurable: true, value: {} });
	useApp.setState({
		activeSessionId: "owner",
		approvals: [{ id: "push", kind: "bash", title: "Run shell command", detail, subject: detail, ...(risk ? { risk } : {}) }],
	});
	const view = await mount(h(LayoutProvider, { children: h(I18nProvider, { locale, children: h(ApprovalOverlay) }) }));
	try {
		return view.find("pre").textContent ?? "";
	} finally {
		await view.unmount();
		useApp.setState(previous, true);
		Reflect.deleteProperty(window, "lyra");
	}
}

test("an English window says why in English, above the command", async () => {
	assert.equal(await cardText("en", FORCE_PUSH), `A force push overwrites the remote history\n\n${PUSH}`);
});

test("a Chinese window says it the way it always did", async () => {
	assert.equal(await cardText("zh-CN", FORCE_PUSH), `强制推送会覆盖远程历史\n\n${PUSH}`);
});

test("the values a rule's sentence needs are filled in, in any language", async () => {
	const post: ApprovalRisk = { code: "method-writes", params: { method: "POST" }, text: "POST 会改动对方的数据" };
	assert.equal(await cardText("en", post, "https://api.example.com/items"), "POST changes data on the other end\n\nhttps://api.example.com/items");
	assert.equal(await cardText("ja", post, "https://api.example.com/items"), "POST は相手側のデータを変更します\n\nhttps://api.example.com/items");
});

test("a policy's own sentence, with no rule behind it, is shown as it came", async () => {
	// A plugin's policy has rules of its own and nothing in the catalogues to look up.
	assert.equal(await cardText("en", { text: "Blocked by the build box's policy" }), `Blocked by the build box's policy\n\n${PUSH}`);
	// And a code this build has no words for falls back to the sentence rather than to nothing.
	assert.equal(await cardText("en", { code: "no-such-rule" as never, text: "旧规则" }), `旧规则\n\n${PUSH}`);
});

test("a request with no finding shows only what it is about", async () => {
	assert.equal(await cardText("en", undefined), PUSH);
});

test("switching language rewords a card that is already open", async () => {
	/*
	 * The card lives under the memoised `Conversation`, which does not re-render because the window's
	 * language changed. The stand-in is memoised the same way, so only a context the card itself
	 * subscribes to can reach it.
	 */
	const Conversation = memo(function Conversation() {
		return h(ApprovalOverlay);
	});
	const previous = useApp.getState();
	Object.defineProperty(window, "lyra", { configurable: true, value: {} });
	useApp.setState({ activeSessionId: "owner", approvals: [{ id: "push", kind: "bash", title: "Run shell command", detail: PUSH, subject: PUSH, risk: FORCE_PUSH }] });
	const tree = (locale: UiLocale) => h(LayoutProvider, { children: h(I18nProvider, { locale, children: h(Conversation) }) });
	const view = await mount(tree("zh-CN"));
	try {
		assert.ok(view.find("pre").textContent?.startsWith("强制推送"));
		await view.rerender(tree("ru"));
		assert.ok(view.find("pre").textContent?.startsWith("Принудительный push"), view.find("pre").textContent ?? "");
	} finally {
		await view.unmount();
		useApp.setState(previous, true);
		Reflect.deleteProperty(window, "lyra");
	}
});

test("every rule has its sentence in every language, with the same values in it", () => {
	for (const [code, source] of Object.entries(RISK_REASONS)) {
		const values = (source.match(/\{\w+\}/g) ?? []).sort();
		for (const [locale, catalog] of Object.entries(MESSAGE_CATALOGS)) {
			const text = (catalog as Record<string, string>)[`risk.${code}`];
			assert.ok(text, `${locale} has no words for ${code}`);
			assert.deepEqual((text.match(/\{\w+\}/g) ?? []).sort(), values, `${locale} ${code}: ${text}`);
		}
	}
});
