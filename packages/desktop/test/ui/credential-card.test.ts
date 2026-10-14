/**
 * The card a conversation raises for a credential, and the permission card of a command that will be
 * handed one.
 *
 * What is typed goes out on `credentials.submit` — never through `respondToApproval`, which is the
 * channel a phone and the transcript also see. A saved credential is offered before anything is
 * typed; a refusal is said in the card's own words, not as a problem code.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import { LayoutProvider } from "../../src/app/layout.tsx";
import { ApprovalOverlay } from "../../src/features/conversation/ApprovalOverlay.tsx";
import { translate } from "../../src/i18n/translate.ts";
import { useApp } from "../../src/store/index.ts";
import { click, fire, mount } from "../helpers/mount.ts";

const PASSWORD_CARD = {
	id: "req",
	kind: "credential",
	title: "kzhy 的 root 密码",
	detail: "改 Tailscale 配置",
	credential: { key: "k1", name: "kzhy-root", kind: "password" as const, target: "ssh://root@100.64.0.5", fields: [{ key: "password" as const, secret: true }] },
};

function bridgeWith(submit: (...args: unknown[]) => Promise<unknown>) {
	Object.defineProperty(window, "lyra", { configurable: true, value: { credentials: { submit } } });
}

async function type(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
	const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
	Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, value);
	await fire(input, new Event("input", { bubbles: true }));
}

test("填好的值走 credentials.submit，勾上「存进保险箱」就带上 remember", async () => {
	const previous = useApp.getState();
	const sent: unknown[][] = [];
	bridgeWith(async (...args) => {
		sent.push(args);
		return { ok: true };
	});
	const answered: unknown[] = [];
	useApp.setState({ activeSessionId: "owner", approvals: [PASSWORD_CARD], respondToApproval: async (...args: unknown[]) => void answered.push(args) });
	const view = await mount(h(LayoutProvider, { children: h(ApprovalOverlay) }));
	try {
		// The model's sentence and the enforced facts are both on the card, apart.
		assert.equal(view.find("[data-ly-credential-purpose]").textContent, "改 Tailscale 配置");
		assert.match(view.find("[data-ly-credential-fact]").textContent ?? "", /ssh:\/\/root@100\.64\.0\.5/);
		await type(view.find<HTMLInputElement>("input[data-ly-secret-input]"), "Tr0ub4dor&3");
		await click(view.find("[data-ly-credential-remember]"));
		await click(view.find("[data-ly-credential-submit]"));
		assert.deepEqual(sent, [["owner", "req", { values: { password: "Tr0ub4dor&3" }, remember: true }]]);
		assert.deepEqual(answered, [], "a filled card is not answered on the approval channel");
	} finally {
		await view.unmount();
		useApp.setState(previous, true);
	}
});

test("broker 不收时，卡片用自己的话说为什么，按钮还能再按", async () => {
	const previous = useApp.getState();
	bridgeWith(async () => ({ ok: false, problem: "needs-passphrase" }));
	const keyCard = {
		...PASSWORD_CARD,
		credential: { key: "k2", name: "deploy", kind: "ssh_key" as const, fields: [{ key: "private_key" as const, secret: true, multiline: true }, { key: "passphrase" as const, secret: true, optional: true }] },
	};
	useApp.setState({ activeSessionId: "owner", approvals: [keyCard] });
	const view = await mount(h(LayoutProvider, { children: h(ApprovalOverlay) }));
	try {
		await type(view.find<HTMLTextAreaElement>("textarea"), "-----BEGIN OPENSSH PRIVATE KEY-----");
		await click(view.find("[data-ly-credential-submit]"));
		assert.equal(view.find('[role="alert"]').textContent, translate("credential.problemNeedsPassphrase"));
		assert.equal(view.find<HTMLButtonElement>("[data-ly-credential-submit]").disabled, false);
		assert.match(view.text(), new RegExp(translate("credential.anywhere")), "no target is said as no limit, not left out");
	} finally {
		await view.unmount();
		useApp.setState(previous, true);
	}
});

test("存过的先拿出来问：一键用它，或者重新输入", async () => {
	const previous = useApp.getState();
	const sent: unknown[][] = [];
	bridgeWith(async (...args) => {
		sent.push(args);
		return { ok: true };
	});
	useApp.setState({ activeSessionId: "owner", approvals: [{ ...PASSWORD_CARD, credential: { ...PASSWORD_CARD.credential, saved: { createdAt: Date.UTC(2026, 9, 3) } } }] });
	const view = await mount(h(LayoutProvider, { children: h(ApprovalOverlay) }));
	try {
		assert.equal(view.all("input[data-ly-secret-input]").length, 0, "nothing to type until asked for");
		assert.equal(view.find("[data-ly-credential-submit]").textContent, translate("credential.useSaved"));
		await click(view.find("[data-ly-credential-submit]"));
		assert.deepEqual(sent, [["owner", "req", { useSaved: true }]]);
		const again = view.all<HTMLButtonElement>("button").find((button) => button.textContent === translate("credential.typeAnew"))!;
		await click(again);
		assert.equal(view.all("input[data-ly-secret-input]").length, 1);
	} finally {
		await view.unmount();
		useApp.setState(previous, true);
	}
});

test("拒绝走审批通道；手机上只能拒绝", async () => {
	const previous = useApp.getState();
	bridgeWith(async () => ({ ok: true }));
	const answered: unknown[][] = [];
	useApp.setState({ activeSessionId: "owner", approvals: [PASSWORD_CARD], respondToApproval: async (...args: unknown[]) => void answered.push(args) });
	const view = await mount(h(LayoutProvider, { children: h(ApprovalOverlay) }));
	try {
		const reject = view.all<HTMLButtonElement>("button").find((button) => button.textContent === translate("permission.reject"))!;
		await click(reject);
		assert.deepEqual(answered, [["req", "reject", "owner"]]);
	} finally {
		await view.unmount();
	}
	// On a phone there is nothing to type into and nothing to submit: the value is not to cross a relay.
	Object.defineProperty(window, "lyra", { configurable: true, value: { host: "mobile", credentials: { submit: async () => ({ ok: true }) } } });
	const phone = await mount(h(LayoutProvider, { children: h(ApprovalOverlay) }));
	try {
		assert.equal(phone.all("input, textarea").length, 0);
		assert.equal(phone.all("[data-ly-credential-submit]").length, 0);
		assert.equal(phone.find("[data-ly-credential-phone]").textContent, translate("credential.phoneOnly"));
		assert.ok(phone.all<HTMLButtonElement>("button").some((button) => button.textContent === translate("permission.reject")));
	} finally {
		await phone.unmount();
		useApp.setState(previous, true);
	}
});

test("命令要用凭据时，许可卡点名是哪几个；必须每次问的不给「不再询问」", async () => {
	const previous = useApp.getState();
	Object.defineProperty(window, "lyra", { configurable: true, value: {} });
	useApp.setState({ activeSessionId: "owner", approvals: [{ id: "cmd", kind: "bash", title: "登录 kzhy", detail: "ssh root@100.64.0.5 uptime", credentials: ["kzhy-root"] }] });
	const view = await mount(h(LayoutProvider, { children: h(ApprovalOverlay) }));
	const labels = () => view.all("[data-ly-permission-choices] button").map((button) => button.textContent);
	try {
		assert.match(view.find("[data-approval-credentials]").textContent ?? "", /kzhy-root/);
		assert.deepEqual(labels(), [translate("permission.reject"), translate("permission.never"), translate("permission.once")]);
		await act(async () => {
			useApp.setState({ approvals: [{ id: "write", kind: "write", title: "Write kzhy-root into file", detail: "config.yml", credentials: ["kzhy-root"], mustAsk: true }] });
		});
		assert.deepEqual(labels(), [translate("permission.reject"), translate("permission.once")]);
	} finally {
		await view.unmount();
		useApp.setState(previous, true);
	}
});
