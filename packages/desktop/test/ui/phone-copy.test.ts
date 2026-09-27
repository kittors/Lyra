/**
 * Phone copy that has to fit, as markup: what the phone draws where the desktop's words did not fit.
 *
 * The widths themselves are measured on the real renderer in `e2e/phone-copy-fit.test.ts`, in every
 * language at 320, 390 and 430pt. This pins down the structure that layout rests on — a meter in
 * place of the reasoning level's word, a model's name in two parts, an approval's kind and countdown
 * under its title, a short placeholder — and that the desktop still draws exactly what it drew.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createElement as h, type ReactNode } from "react";
import { DEFAULT_SETTINGS, type ModelConfig, type Settings } from "@lyra/core";

import { LayoutProvider } from "../../src/app/layout.tsx";
import { ApprovalOverlay } from "../../src/features/conversation/ApprovalOverlay.tsx";
import { EmptyState } from "../../src/features/conversation/EmptyState.tsx";
import { effortSteps } from "../../src/features/models/EffortMeter.tsx";
import { EffortTrigger, ModelTrigger } from "../../src/features/models/index.ts";
import { I18nProvider, type ResolvedUiLocale } from "../../src/i18n/index.ts";
import { useApp } from "../../src/store/index.ts";
import { mount } from "../helpers/mount.ts";

/** Enough of the bridge for the composer the empty screen carries to mount. */
const bridge = { commands: { list: async () => ({ commands: [], skills: [], agents: [] }) } };
const phone = { ...bridge, host: "mobile", platform: "darwin" };
const desktop = { ...bridge, host: "desktop", platform: "darwin" };

const claude: ModelConfig = { id: "anthropic/claude-sonnet-5", providerId: "anthropic", modelId: "claude-sonnet-5", name: "Claude Sonnet 5", contextWindow: 1_000_000, maxOutputTokens: 64_000, supportsThinking: true, supportsImages: true, supportsTools: true };
const gpt: ModelConfig = { ...claude, id: "openai/gpt-5.5", providerId: "openai", modelId: "gpt-5.5", name: "GPT-5.5" };
const settings: Settings = {
	...DEFAULT_SETTINGS,
	defaultModelId: claude.id,
	thinking: "medium",
	projects: [{ id: "a", path: "/p/aurora-notes", name: "aurora-notes", pinned: false, lastOpenedAt: 0 }],
	providers: [
		{ id: "anthropic", name: "Anthropic", api: "anthropic-messages", baseUrl: "http://localhost", apiKey: "test", enabled: true, models: [claude] },
		{ id: "openai", name: "OpenAI", api: "openai-responses", baseUrl: "http://localhost", apiKey: "test", enabled: true, models: [gpt] },
	],
};

let previous: ReturnType<typeof useApp.getState>;

beforeEach(() => {
	previous = useApp.getState();
	Object.defineProperty(window, "lyra", { configurable: true, value: phone });
	useApp.setState({ settings, meta: null, workspace: { path: "/p/aurora-notes", name: "aurora-notes", isGitRepo: true, branch: "main" }, view: "chat" });
});

afterEach(() => {
	Reflect.deleteProperty(window, "lyra");
	useApp.setState(previous, true);
});

const inLocale = (locale: ResolvedUiLocale, children: ReactNode) => h(I18nProvider, { locale, children: h(LayoutProvider, null, children) });

test("a phone draws the reasoning level as a meter: no word in the row, the word still in its name", async () => {
	for (const [locale, name] of [["en", "Reasoning effort: Medium"], ["ru", "Глубина рассуждений: Средняя"], ["zh-CN", "推理强度：中"]] as const) {
		const view = await mount(inLocale(locale, h(EffortTrigger, { modelId: claude.id })));
		try {
			const button = view.find("button");
			assert.equal(button.textContent, "", `${locale}：行里没有字，宽度就不随语言变`);
			assert.equal(button.getAttribute("aria-label"), name, `${locale}：读屏照旧念出档位`);
			const bars = view.all(".ly-effort-meter > span");
			assert.equal(bars.length, 3, "这个模型有低、中、高三档，就画三格");
			assert.equal(view.all(".ly-effort-meter > [data-on]").length, 2, "「中」亮两格");
		} finally {
			await view.unmount();
		}
	}

	Object.defineProperty(window, "lyra", { configurable: true, value: desktop });
	const wide = await mount(inLocale("en", h(EffortTrigger, { modelId: claude.id })));
	try {
		assert.equal(wide.find("button").textContent, "Medium", "桌面端照旧写字");
		assert.equal(wide.all(".ly-effort-meter").length, 0);
	} finally {
		await wide.unmount();
	}
});

test("the meter lights what the menu would say: the model's own scale, its default for a level it lacks, nothing for off", () => {
	assert.deepEqual(effortSteps("medium", claude), { bars: 3, lit: 2 });
	assert.deepEqual(effortSteps("off", claude), { bars: 3, lit: 0 });
	assert.deepEqual(effortSteps("high", claude), { bars: 3, lit: 3 });
	// Claude has no `xhigh`; the menu shows its default, 中, and so does the meter.
	assert.deepEqual(effortSteps("xhigh", claude), { bars: 3, lit: 2 });
	// GPT-5.5 offers four levels above off.
	assert.deepEqual(effortSteps("xhigh", gpt), { bars: 4, lit: 4 });
	assert.deepEqual(effortSteps("medium", { ...claude, supportsThinking: false }), { bars: 3, lit: 0 }, "不支持推理的模型是一排暗格");
	// A scale longer than seven is drawn as seven, and its lowest level still lights one.
	const long = { ...claude, thinkingOptions: Array.from({ length: 11 }, (_, index) => ({ id: index === 0 ? "off" : `level-${index}`, label: `${index}`, detail: "" })) } as unknown as ModelConfig;
	assert.deepEqual(effortSteps("level-1" as never, long), { bars: 7, lit: 1 });
	assert.deepEqual(effortSteps("level-10" as never, long), { bars: 7, lit: 7 });
});

test("on a phone a name that leads with its house comes in two parts; the desktop keeps it whole", async () => {
	const view = await mount(inLocale("en", h(ModelTrigger, { modelId: claude.id, ariaLabel: "Select model" })));
	try {
		assert.equal(view.find("[data-ly-model-house]").textContent, "Claude");
		assert.equal(view.find(".ly-model-name").textContent, "Claude Sonnet 5", "拆成两段，读出来仍是一整个名字");
	} finally {
		await view.unmount();
	}

	const single = await mount(inLocale("en", h(ModelTrigger, { modelId: gpt.id, ariaLabel: "Select model" })));
	try {
		assert.equal(single.all(".ly-model-name").length, 0, "一个词的名字没有可拆的");
		assert.equal(single.find(".ly-fit-probe").textContent, "GPT-5.5");
	} finally {
		await single.unmount();
	}

	Object.defineProperty(window, "lyra", { configurable: true, value: desktop });
	const wide = await mount(inLocale("en", h(ModelTrigger, { modelId: claude.id, ariaLabel: "Select model" })));
	try {
		assert.equal(wide.all(".ly-model-name").length, 0, "桌面端不拆");
		assert.equal(wide.find(".ly-fit-probe").textContent, "Claude Sonnet 5");
	} finally {
		await wide.unmount();
	}
});

test("an approval on a phone: the title has the row, and the kind and the countdown are its caption", async () => {
	useApp.setState({ activeSessionId: "owner", approvals: [{ id: "push", kind: "bash", title: "Force-push the reworded commit", detail: "git push --force-with-lease origin fix/offline-merge", expiresAt: Date.now() + 298_000 }] });
	const view = await mount(inLocale("en", h(ApprovalOverlay)));
	try {
		const head = view.find("[data-approval-head]");
		const meta = view.find("[data-approval-meta]");
		assert.equal(view.find("[data-approval-title]").textContent, "Force-push the reworded commit");
		assert.match(meta.textContent ?? "", /^Run a command.*Expires in \d:\d\d$/, "种类和倒计时在标题下面那一行");
		const column = meta.parentElement;
		assert.ok(column?.contains(view.find("[data-approval-title]")), "和标题在同一栏里");
		const beside = [...head.children].filter((child) => child !== column && /Run a command|Expires in/.test(child.textContent ?? ""));
		assert.equal(beside.length, 0, "不再和标题抢那一行");
	} finally {
		await view.unmount();
	}

	Object.defineProperty(window, "lyra", { configurable: true, value: desktop });
	const wide = await mount(inLocale("en", h(ApprovalOverlay)));
	try {
		const head = wide.find("[data-approval-head]");
		assert.equal(wide.all("[data-approval-meta]").length, 0, "桌面端没有这一行");
		const beside = [...head.children].map((child) => child.textContent ?? "");
		assert.ok(beside.includes("Run a command"), "桌面端的种类仍在标题旁边");
		assert.ok(beside.some((text) => /^Expires in \d:\d\d$/.test(text)), "倒计时也是");
	} finally {
		await wide.unmount();
	}
});

test("a phone's composer asks in a few words; the desktop keeps the whole hint", async () => {
	const view = await mount(inLocale("en", h(EmptyState)));
	try {
		assert.equal(view.find<HTMLTextAreaElement>("textarea").placeholder, "Message Lyra");
	} finally {
		await view.unmount();
	}

	Object.defineProperty(window, "lyra", { configurable: true, value: desktop });
	const wide = await mount(inLocale("en", h(EmptyState)));
	try {
		assert.equal(wide.find<HTMLTextAreaElement>("textarea").placeholder, "Type a message, / for commands, @ for references");
	} finally {
		await wide.unmount();
	}
});
