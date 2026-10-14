/**
 * 保险箱: the list never holds a value, the reference is copied here and the value by the main
 * process, and the add form sends what the broker reads — the kind's fields and nothing else.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import type { CredentialMeta } from "@lyra/core";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { VaultView } from "../../src/features/vault/VaultView.tsx";
import { translate } from "../../src/i18n/translate.ts";
import { useApp } from "../../src/store/index.ts";
import { click, fire, mount } from "../helpers/mount.ts";

const NAS: CredentialMeta = { name: "nas", kind: "login", title: "NAS", username: "admin", target: "ssh://admin@nas.local", saved: true, createdAt: 1, approval: "per-conversation" };
const KEY: CredentialMeta = { name: "deploy", kind: "ssh_key", title: "部署密钥", saved: true, createdAt: 2, approval: "every-use" };

function vault(list: CredentialMeta[]) {
	const calls: { method: string; args: unknown[] }[] = [];
	const record =
		(method: string, answer: (...args: unknown[]) => unknown) =>
		async (...args: unknown[]) => {
			calls.push({ method, args });
			return answer(...args);
		};
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			credentials: {
				list: record("list", () => list),
				add: record("add", (input) => ({ ok: true, meta: { ...(input as object), saved: true, createdAt: 3 } })),
				copy: record("copy", () => ({ copied: true, clearsAfter: 30_000 })),
			},
		},
	});
	return calls;
}

async function type(input: HTMLInputElement, value: string) {
	Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
	await fire(input, new Event("input", { bubbles: true }));
}

const settle = () => act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));

test("列表只有名字、类型、用户名和地址；复制引用在这里，复制值交给主进程", async () => {
	const previous = useApp.getState();
	const calls = vault([NAS, KEY]);
	const written: string[] = [];
	Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => void written.push(text) } });
	useApp.setState({ view: "vault" });
	const view = await mount(h(LayoutProvider, { children: h(VaultView) }));
	try {
		await settle();
		const rows = view.all("[data-ly-vault-row]");
		assert.deepEqual(rows.map((row) => row.getAttribute("data-ly-vault-row")), ["nas", "deploy"], "sorted by title");
		assert.match(rows[0]!.textContent ?? "", /admin/);
		assert.match(rows[0]!.textContent ?? "", /ssh:\/\/admin@nas\.local/);

		await click(rows[0]!.querySelector("[data-ly-vault-copy-reference]")!);
		await settle();
		assert.deepEqual(written, ["[credential:nas]"]);

		await click(rows[1]!.querySelector("[data-ly-vault-copy-value]")!);
		await settle();
		assert.deepEqual(calls.filter((call) => call.method === "copy").map((call) => call.args), [["deploy"]]);
		assert.equal(written.length, 1, "a value never passes through this process's clipboard");
		assert.equal(rows[1]!.querySelector("[data-ly-vault-copy-value]")!.getAttribute("aria-label"), translate("vault.copiedPublicKey"), "a key copies its public half, and says so");
	} finally {
		await view.unmount();
		useApp.setState(previous, true);
	}
});

test("空的时候说清楚是什么；添加时引用名跟着名称走，只送这一类的字段", async () => {
	const previous = useApp.getState();
	const calls = vault([]);
	useApp.setState({ view: "vault" });
	const view = await mount(h(LayoutProvider, { children: h(VaultView) }));
	try {
		await settle();
		assert.match(view.find("[data-ly-vault-empty]").textContent ?? "", new RegExp(translate("vault.empty")));
		await click(view.find("[data-ly-vault-add]"));
		const editor = document.querySelector<HTMLFormElement>("[data-ly-vault-editor='add']");
		assert.ok(editor !== null, "the add form opens");

		// A login: switching the kind changes the fields the form has.
		const login = [...document.querySelectorAll<HTMLButtonElement>("[data-segment]")].find((button) => button.getAttribute("data-segment") === "login")!;
		await click(login);
		await type(document.querySelector<HTMLInputElement>("[data-ly-vault-title]")!, "NAS admin");
		assert.equal(document.querySelector<HTMLInputElement>("[data-ly-vault-name]")!.value, "nas-admin");
		const [username, password] = [...document.querySelectorAll<HTMLInputElement>("[data-ly-credential-field] input:not([type=hidden])")];
		await type(username!, "admin");
		await type(password!, "nas-pass-123");
		await click(document.querySelector("[data-ly-vault-save]")!);
		await settle();
		assert.deepEqual(calls.find((call) => call.method === "add")?.args, [
			{ name: "nas-admin", kind: "login", title: "NAS admin", approval: "per-conversation", values: { username: "admin", password: "nas-pass-123" } },
		]);
		assert.equal(calls.filter((call) => call.method === "list").length, 2, "the list is read again after a save");
	} finally {
		await view.unmount();
		document.querySelectorAll("[data-ly-modal]").forEach((node) => node.remove());
		useApp.setState(previous, true);
	}
});

test("地址写错了在表单上说，不发出去", async () => {
	const previous = useApp.getState();
	const calls = vault([]);
	useApp.setState({ view: "vault" });
	const view = await mount(h(LayoutProvider, { children: h(VaultView) }));
	try {
		await settle();
		await click(view.find("[data-ly-vault-add]"));
		await type(document.querySelector<HTMLInputElement>("[data-ly-vault-title]")!, "NAS");
		await type(document.querySelector<HTMLInputElement>("input[data-ly-secret-input]")!, "pw");
		await type(document.querySelector<HTMLInputElement>("[data-ly-vault-target]")!, "nas.local");
		await click(document.querySelector("[data-ly-vault-save]")!);
		await settle();
		assert.equal(document.querySelector("[data-ly-vault-problem]")?.textContent, translate("credential.problemTarget"));
		assert.equal(calls.filter((call) => call.method === "add").length, 0);
	} finally {
		await view.unmount();
		document.querySelectorAll("[data-ly-modal]").forEach((node) => node.remove());
		useApp.setState(previous, true);
	}
});
