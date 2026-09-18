/**
 * 两条规则各自成立，改完即生效。
 *
 * 这一页以前把两类故障折叠进一个下拉里轮流显示，还要按一次「保存」；这里的每一条都在钉死
 * 改掉它的那两件事：屏幕上同时读得到两条规则各自在做什么，以及任何一次修改都会自己落盘。
 */

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { act, createElement as h } from "react";
import { DEFAULT_SETTINGS, type Settings } from "@lyra/core";

import { RetrySettings } from "../../src/features/settings/RetrySettings.tsx";
import { useApp } from "../../src/store/index.ts";
import { click, fire, mount, type Mounted } from "../helpers/mount.ts";

let saved: Settings[] = [];

beforeEach(() => {
	saved = [];
	useApp.setState({
		settings: DEFAULT_SETTINGS,
		saveSettings: async (next: Settings) => {
			saved.push(next);
			useApp.setState({ settings: next });
		},
	} as never);
});

/** Mount against whatever the store currently holds — which is what the settings page does. */
function show() {
	return mount(h(RetrySettings, { settings: useApp.getState().settings! }));
}

/** Re-render with the store's latest settings, as the page does after a save. */
const refresh = (view: Mounted) => view.rerender(h(RetrySettings, { settings: useApp.getState().settings! }));

const summary = (view: Mounted, kind: string) => view.find(`[data-retry-summary="${kind}"]`).textContent;

/** Open one rule's fields. The rows are folded, and only one is open at a time. */
async function open(view: Mounted, title: string) {
	const head = view.all<HTMLButtonElement>("button[aria-expanded]").find((button) => button.textContent?.includes(title));
	assert.ok(head, `no folded row titled ${title}`);
	await click(head);
}

async function type(input: HTMLInputElement, value: string) {
	const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
	assert.ok(setter);
	setter.call(input, value);
	await fire(input, new Event("input", { bubbles: true }));
}

/** Long enough for the number fields' debounce to fire, inside `act` so React sees the update. */
const settle = () => act(async () => { await new Promise((done) => setTimeout(done, 400)); });

const policyOf = (settings: Settings) => settings.retryPolicy!;

test("两条规则同时在屏幕上，各自的默认写在自己那一行", async () => {
	const view = await show();

	// 这是整个改动的要点：不用切换、不用记忆，两者的差别一眼读得到。
	assert.equal(summary(view, "network"), "无限重试 · 每 5 秒");
	assert.equal(summary(view, "upstream"), "重试 10 次 · 每 5 秒");
	assert.match(view.text(), /网络中断.*连接失败、超时、传输中断/);
	assert.match(view.text(), /上游故障.*限流、服务过载、暂时不可用/);

	// 收起时只有这两行摘要，编辑控件不占位置。
	assert.equal(view.all(".ly-reveal[aria-hidden='true']").length, 2);
	await view.unmount();
});

test("展开一条只影响自己，另一条留在原处", async () => {
	const view = await show();
	await open(view, "网络中断");

	const [network, upstream] = view.all("button[aria-expanded]");
	assert.equal(network?.getAttribute("aria-expanded"), "true");
	assert.equal(upstream?.getAttribute("aria-expanded"), "false");
	assert.equal(summary(view, "upstream"), "重试 10 次 · 每 5 秒");
	await view.unmount();
});

test("开关改完立刻落盘，没有保存按钮可按", async () => {
	const view = await show();
	await open(view, "网络中断");

	// 页面上不存在任何提交控件——这是「热更新」在界面上的样子。
	assert.equal(view.all("form").length, 0);
	assert.equal(view.all("button[type='submit']").length, 0);

	await click(view.find('[aria-label="网络中断不限次数"]'));
	assert.equal(saved.length, 1);
	assert.equal(policyOf(saved[0]!).network.retries, 10);
	// 另一条不能被顺手改掉。
	assert.deepEqual(policyOf(saved[0]!).upstream, policyOf(DEFAULT_SETTINGS).upstream);

	await refresh(view);
	assert.equal(summary(view, "network"), "重试 10 次 · 每 5 秒");
	await view.unmount();
});

test("数字等打完再落盘，一次输入不会先存下半截的值", async () => {
	const view = await show();
	await open(view, "上游故障");

	const field = view.find<HTMLInputElement>('[aria-label="上游故障重试次数"]');
	await type(field, "3");
	await type(field, "30");
	// 「3」是「30」路过的中间状态，不该被当成一次设置写进去。
	assert.equal(saved.length, 0);

	await settle();
	assert.equal(saved.length, 1);
	assert.equal(policyOf(saved[0]!).upstream.retries, 30);
	await view.unmount();
});

test("失焦立即落盘，超过上限进不去，空输入不写", async () => {
	const view = await show();
	await open(view, "上游故障");

	const field = view.find<HTMLInputElement>('[aria-label="上游故障重试间隔秒数"]');
	await type(field, "9999");
	assert.equal(field.value, "5", "超过 3600 的数字进不去");
	assert.equal(saved.length, 0);

	await type(field, "12");
	await fire(field, new Event("focusout", { bubbles: true }));
	assert.equal(saved.length, 1);
	assert.equal(policyOf(saved[0]!).upstream.intervalMs, 12_000);

	await type(field, "");
	await fire(field, new Event("focusout", { bubbles: true }));
	await settle();
	// 清空输入框是打字的一步，不是「间隔为零」。
	assert.equal(saved.length, 1);
	await view.unmount();
});

test("两条规则先后改动，后一次不会把前一次盖回去", async () => {
	const view = await show();

	await open(view, "网络中断");
	await click(view.find('[aria-label="网络中断不限次数"]'));
	await refresh(view);

	await open(view, "上游故障");
	await click(view.find('[aria-label="上游故障不限次数"]'));

	const latest = policyOf(saved.at(-1)!);
	assert.equal(latest.upstream.retries, null);
	assert.equal(latest.network.retries, 10, "第一次修改必须还在");
	await view.unmount();
});

test("递增才有最长间隔，摘要把递增说清楚", async () => {
	useApp.setState({
		settings: {
			...DEFAULT_SETTINGS,
			retryPolicy: {
				...policyOf(DEFAULT_SETTINGS),
				upstream: { retries: 10, strategy: "linear", intervalMs: 5000, maxIntervalMs: 30_000 },
			},
		},
	} as never);
	const view = await show();

	assert.equal(summary(view, "upstream"), "重试 10 次 · 5 秒起递增，最长 30 秒");
	// 固定间隔的那条不该出现一个它不使用的上限。
	assert.equal(summary(view, "network"), "无限重试 · 每 5 秒");

	await open(view, "上游故障");
	assert.ok(view.find('[aria-label="上游故障最长间隔秒数"]'));
	assert.match(view.text(), /5、10、15 秒.*30 秒后保持不变/);

	await open(view, "网络中断");
	assert.equal(view.all('[aria-label="网络中断最长间隔秒数"]').length, 0);
	await view.unmount();
});

test("初始间隔越过上限时，上限跟着抬高而不是留下一个矛盾的组合", async () => {
	useApp.setState({
		settings: {
			...DEFAULT_SETTINGS,
			retryPolicy: {
				...policyOf(DEFAULT_SETTINGS),
				upstream: { retries: 10, strategy: "linear", intervalMs: 5000, maxIntervalMs: 30_000 },
			},
		},
	} as never);
	const view = await show();
	await open(view, "上游故障");

	await type(view.find<HTMLInputElement>('[aria-label="上游故障重试间隔秒数"]'), "45");
	await settle();
	const rule = policyOf(saved.at(-1)!).upstream;
	assert.equal(rule.intervalMs, 45_000);
	assert.equal(rule.maxIntervalMs, 45_000);
	await view.unmount();
});

test("不重试时不再问间隔，因为没有下一次", async () => {
	useApp.setState({
		settings: {
			...DEFAULT_SETTINGS,
			retryPolicy: { ...policyOf(DEFAULT_SETTINGS), upstream: { retries: 0, strategy: "fixed", intervalMs: 5000, maxIntervalMs: 30_000 } },
		},
	} as never);
	const view = await show();

	assert.equal(summary(view, "upstream"), "不重试");
	await open(view, "上游故障");
	assert.equal(view.all('[aria-label="上游故障重试间隔秒数"]').length, 0);
	assert.equal(view.all('[aria-label="上游故障间隔方式"]').length, 0);
	assert.match(view.text(), /失败后立即报错/);
	await view.unmount();
});
