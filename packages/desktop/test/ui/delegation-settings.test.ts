/**
 * 子智能体调度这一页，说的话跟运行时做的事是不是一回事。
 *
 * 这一页只有一个真正值得测的东西，而它是一个反直觉的组合：**上限不是实际值**。派活的档位会在
 * 上限底下再收一道，所以设成 8 之后实际只跑 2 个——这在没有解释的情况下会被当成设置没生效。
 * 那行解释是这一页存在的一半理由，所以它显示的数字必须跟 core 的闸门算出来的那个一致，而不是
 * 界面自己凑的一个差不多的数。
 *
 * 另外两件必须验的：关掉自动跟随时不能把用户当前那一档改掉（他按这个开关就是为了「别再自己
 * 变」），以及自动模式下不能让人误以为档位可点。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS, type ModelConfig, type Settings } from "@lyra/core";
import { delegationConcurrency } from "@lyra/core/delegation";
import { DelegationSettings } from "../../src/features/settings/DelegationSettings.tsx";
import { useApp } from "../../src/store/index.ts";
import { click, mount } from "../helpers/mount.ts";
import { I18nProvider } from "../../src/i18n/index.ts";

const model: ModelConfig = {
	id: "qa/model",
	modelId: "gpt-5.6-sol",
	providerId: "qa",
	name: "QA",
	contextWindow: 128000,
	maxOutputTokens: 4096,
	supportsThinking: true,
	supportsImages: false,
	supportsTools: true,
};

const base: Settings = {
	...DEFAULT_SETTINGS,
	defaultModelId: model.id,
	providers: [{ id: "qa", name: "QA", api: "openai-responses", baseUrl: "http://localhost", apiKey: "test", enabled: true, models: [model] }],
};

function setup(initial: Partial<Settings>, save: (settings: Settings) => Promise<Settings> = async (next) => next) {
	const settings = { ...base, ...initial };
	useApp.setState({ activeSessionId: "qa", meta: null, settings, capabilities: null });
	Object.defineProperty(window, "lyra", { configurable: true, value: { settings: { save } } });
	return settings;
}

async function open(initial: Partial<Settings>, save?: (settings: Settings) => Promise<Settings>) {
	setup(initial, save);
	const { createElement: h } = await import("react");
	return mount(h(I18nProvider, { locale: "zh-CN", children: h(DelegationSettings) }));
}

/** 选中的那一档，从 DOM 上读回来。 */
const selected = (view: Awaited<ReturnType<typeof open>>) =>
	view.host.querySelector<HTMLElement>("[data-delegation-tier][data-selected]")?.dataset.delegationTier;

test("默认是跟随思考等级，选中的那一档由等级推出来", async () => {
	const view = await open({});
	try {
		// DEFAULT_SETTINGS 的思考等级是 medium，推出来是「挑着派」。
		assert.equal(selected(view), "selective");
		assert.match(view.text(), /跟随思考等级/);
		assert.match(view.text(), /当前/, "自动模式下要标出现在落在哪一档");
		// 自动模式下每一档旁边写着哪些等级会落到它上面——否则「跟随」是一句没法验证的话。
		assert.match(view.text(), /关 · 极简 · 低/);
	} finally {
		await view.unmount();
	}
});

test("自动模式下档位不可点，点了也不会偷偷改设置", async () => {
	let saved: Settings | undefined;
	const view = await open({}, async (next) => {
		saved = next;
		return next;
	});
	try {
		const eager = view.find<HTMLButtonElement>('[data-delegation-tier="eager"]');
		assert.equal(eager.disabled, true, "跟随等级时这些只是说明，不是选项");
		await click(eager);
		assert.ok(!saved, "禁用的按钮不该写盘");
		assert.equal(selected(view), "selective");
	} finally {
		await view.unmount();
	}
});

test("关掉跟随时钉住当前这一档，而不是跳到某个默认值", async () => {
	let saved: Settings | undefined;
	// 高等级的会话，自动推出来是「主动派」。
	const view = await open({ thinking: "high" }, async (next) => {
		saved = next;
		return next;
	});
	try {
		assert.equal(selected(view), "ready");
		await click(view.find('[aria-label="跟随思考等级"]'));
		/*
		 * 按这个开关的人想说的是「就照现在这样，别再自己变」。关掉的瞬间档位跳到别处，正好是他
		 * 要避免的那件事，而且是他亲手按出来的。
		 */
		assert.equal(saved?.subAgentDelegation, "ready");
	} finally {
		await view.unmount();
	}
});

test("钉死之后档位可点，写下去的就是点的那个", async () => {
	let saved: Settings | undefined;
	const view = await open({ subAgentDelegation: "selective" }, async (next) => {
		saved = next;
		useApp.setState({ settings: next });
		return next;
	});
	try {
		assert.equal(selected(view), "selective");
		assert.equal(view.find<HTMLButtonElement>('[data-delegation-tier="off"]').disabled, false);

		await click(view.find('[data-delegation-tier="off"]'));
		assert.equal(saved?.subAgentDelegation, "off");
		assert.equal(selected(view), "off");
		// 关掉之后，等级映射的说明就该消失——那条因果已经断了。
		assert.doesNotMatch(view.text(), /关 · 极简 · 低/);
	} finally {
		await view.unmount();
	}
});

test("并发上限只显示用户自己填的那个数，不摆第二个数出来", async () => {
	const view = await open({ maxConcurrentSubAgents: 8, thinking: "medium" });
	try {
		/*
		 * core 在中档确实会把 8 收成 4，而这一页有意不显示那个 4。
		 *
		 * 试过：把推算值摆在用户填的那个数旁边，等于把一个设置显示成两个数，而看到两个数的人第一
		 * 反应是自己填错了。机制留一句静态说明，数字只留一个。
		 */
		assert.equal(delegationConcurrency(8, "medium", "auto"), 4, "前提：core 在中档确实收一半");
		assert.equal(view.find<HTMLInputElement>('[aria-label="最多同时运行的子智能体数量"]').value, "8");
		assert.doesNotMatch(view.text(), /这一轮实际/);
		assert.doesNotMatch(view.text(), /实际是 4/);
		// 机制本身还是要交代——否则「设了 8 只跑 4」就成了没人说过的事。
		assert.match(view.text(), /会在这个上限底下再收一道/);
	} finally {
		await view.unmount();
	}
});

test("换档不会改并发那一行的说明——它不该跟着别处变", async () => {
	const view = await open({ subAgentDelegation: "selective", maxConcurrentSubAgents: 8 }, async (next) => {
		useApp.setState({ settings: next });
		return next;
	});
	try {
		const before = view.find('[data-settings-row]:has([aria-label="最多同时运行的子智能体数量"])').textContent;
		await click(view.find('[data-delegation-tier="off"]'));
		assert.equal(
			view.find('[data-settings-row]:has([aria-label="最多同时运行的子智能体数量"])').textContent,
			before,
			"一段会随档位改写的说明，就是那个被撤掉的第二个数字换了件衣服",
		);
	} finally {
		await view.unmount();
	}
});

test("会话自己的等级优先于全局默认——这一页说的是当前这场对话", async () => {
	setup({ thinking: "medium" });
	// 会话中途把等级调到了 ultra，全局设置还是 medium。
	useApp.setState({ meta: { id: "qa", thinking: "ultra" } as never });
	const { createElement: h } = await import("react");
	const view = await mount(h(I18nProvider, { locale: "zh-CN", children: h(DelegationSettings) }));
	try {
		assert.equal(selected(view), "eager", "读的该是会话当前的等级");
		assert.match(view.text(), /极致/);
	} finally {
		await view.unmount();
		useApp.setState({ meta: null });
	}
});

test("并发数写下去要落在 1–16 之间，输入框自己拦住越界的值", async () => {
	let saved: Settings | undefined;
	const view = await open({ maxConcurrentSubAgents: 4 }, async (next) => {
		saved = next;
		return next;
	});
	try {
		const field = view.find<HTMLInputElement>('[aria-label="最多同时运行的子智能体数量"]');
		assert.equal(field.min, "1");
		assert.equal(field.max, "16");
		// 0 个子代理不是一个能表达的意思——「一个都不要」是「从不派」那一档，不是这个数字。
		assert.equal(field.value, "4");
		assert.ok(!saved, "光渲染不该写盘");
	} finally {
		await view.unmount();
	}
});

test("保存失败要说出来，界面上的值也不该假装已经改了", async () => {
	const view = await open({ subAgentDelegation: "selective" }, async () => {
		throw new Error("disk full");
	});
	try {
		await click(view.find('[data-delegation-tier="eager"]'));
		assert.match(view.find('[role="alert"]').textContent ?? "", /disk full/);
		assert.equal(selected(view), "selective", "没存下去就不该显示成存下去了");
	} finally {
		await view.unmount();
	}
});
