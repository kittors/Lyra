/**
 * `[credential:name]` in a message: a chip that copies the value through the main process.
 *
 * This is how "what is my NAS password" gets an answer the model never had: the reply names the
 * credential and the person clicks. The chip asks for the copy with the conversation it sits in, so a
 * credential a card there was given (and not saved) can be copied too — and nowhere else.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import type { CredentialMeta } from "@lyra/core";
import { Markdown } from "../../src/features/conversation/Markdown.tsx";
import { translate } from "../../src/i18n/translate.ts";
import { useApp } from "../../src/store/index.ts";
import { click, mount } from "../helpers/mount.ts";

const NAS: CredentialMeta = { name: "nas-root", kind: "password", title: "NAS 的 root 密码", saved: true, createdAt: 1, approval: "per-conversation" };
const settle = () => act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));

function bridgeWith(list: CredentialMeta[], host?: "mobile") {
	const calls: { method: string; args: unknown[] }[] = [];
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			...(host ? { host } : {}),
			credentials: {
				list: async (...args: unknown[]) => (calls.push({ method: "list", args }), list),
				copy: async (...args: unknown[]) => (calls.push({ method: "copy", args }), { copied: true, clearsAfter: 30_000 }),
			},
		},
	});
	return calls;
}

test("回复里点名的凭据画成一个能点的胶囊：点它，主进程复制，带着这个对话", async () => {
	const previous = useApp.getState();
	const calls = bridgeWith([NAS]);
	useApp.setState({ activeSessionId: "ref-s1" });
	const view = await mount(h(Markdown, { text: "你的 NAS root 密码在保险箱里：[credential:nas-root]，点一下就能复制。" }));
	try {
		await settle();
		const chip = view.find<HTMLButtonElement>("button[data-ly-credential-ref]");
		assert.equal(chip.textContent, "NAS 的 root 密码", "the title, never the value");
		assert.deepEqual(calls.find((call) => call.method === "list")?.args, ["ref-s1"]);
		await click(chip);
		await settle();
		assert.deepEqual(calls.filter((call) => call.method === "copy").map((call) => call.args), [["nas-root", "ref-s1"]]);
		assert.equal(chip.getAttribute("data-ly-tip"), translate("vault.copiedSecret", { s: 30 }));
	} finally {
		await view.unmount();
		useApp.setState(previous, true);
	}
});

test("没有这一项的名字只是个胶囊，点不了；手机上说去电脑上点", async () => {
	const previous = useApp.getState();
	bridgeWith([NAS]);
	useApp.setState({ activeSessionId: "ref-s2" });
	const view = await mount(h(Markdown, { text: "试试 [credential:nope]" }));
	try {
		await settle();
		assert.equal(view.all("button[data-ly-credential-ref]").length, 0);
		assert.equal(view.find("[data-ly-credential-ref]").getAttribute("data-ly-tip"), translate("credential.refUnknown"));
	} finally {
		await view.unmount();
	}
	const calls = bridgeWith([NAS], "mobile");
	useApp.setState({ activeSessionId: "ref-s3" });
	const phone = await mount(h(Markdown, { text: "[credential:nas-root]" }));
	try {
		await settle();
		assert.equal(phone.all("button[data-ly-credential-ref]").length, 0, "a phone cannot copy into this computer's clipboard");
		assert.equal(phone.find("[data-ly-credential-ref]").getAttribute("data-ly-tip"), translate("credential.refPhone"));
		assert.equal(calls.length, 0, "and does not ask for the list it is not offered");
	} finally {
		await phone.unmount();
		useApp.setState(previous, true);
	}
});
