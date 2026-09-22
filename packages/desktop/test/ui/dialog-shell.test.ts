/**
 * 每一张对话框都长成同一副样子：底下的按钮写着字，卡片里没有横线。
 *
 * 这两条曾经各自散落在五个组件里，各写各的。`ModelEditor` 底下是一个叉和一个勾，动词挂在
 * tooltip 上；它和 `ProviderImportModal` 在标题下、按钮上各画了一条 `border-line`；
 * `ReleaseModal` 画的是 `border-line-soft`，还给页脚加了一层底色。三处都不一样，而它们是同一
 * 个应用里前后脚打开的三张卡片。
 *
 * 现在都走 `DialogFrame`：边界是留白，动作是 `DialogAction`。这支测试守的就是这两句话——它按
 * 类名找横线，所以它拦得住「手写一个 border-t 回来」，拦不住「用一个 1px 的方块画一条」；后者
 * 由 `e2e/dialog-style-probe.ts` 在真窗口里按算出来的边框宽度量。
 *
 * 这里不测每张弹窗自己的业务，那些各有各的用例。这里只问外壳。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import { I18nProvider } from "../../src/i18n/index.ts";
import { FetchModelsModal } from "../../src/features/settings/FetchModelsModal.tsx";
import { ModelEditor } from "../../src/features/settings/ModelEditor.tsx";
import { ProviderImportModal } from "../../src/features/settings/ProviderImportModal.tsx";
import { RegistrySources } from "../../src/features/plugins/RegistrySources.tsx";
import { ReleaseModal } from "../../src/features/git/ReleaseModal.tsx";
import { mount } from "../helpers/mount.ts";

const provider = { id: "relay", baseUrl: "https://relay.example/v1" };

const model = {
	id: "relay/qa-model", providerId: "relay", modelId: "qa-model", name: "QA Model",
	contextWindow: 200_000, maxOutputTokens: 16_384,
	supportsThinking: true, supportsImages: true, supportsTools: true,
};

/** 一张弹窗的外壳，从它真的画出来的 DOM 上读。 */
function shell() {
	const card = [...document.querySelectorAll("[data-ly-modal]")].at(-1);
	assert.ok(card, "弹窗没挂到 Overlay 上");
	return {
		card,
		/*
		 * 动作按钮就是 `.ly-dialog-action`，不是「动作行里的每一个 button」。
		 *
		 * 那一行里还会站着别的东西：发版弹窗左边那句「目标 v0.9.20」前面有一颗 ⓘ，按下去不做
		 * 任何事，只把一段说明浮出来。它没有名字也读得懂——紧挨着它的那句话就是它的语境，而这
		 * 正是「结论按钮」没有的东西。要统一的是结论，不是行里的每一个像素。
		 */
		actions: [...card.querySelectorAll<HTMLButtonElement>("[data-ly-dialog-actions] .ly-dialog-action")],
		/*
		 * 只认横的那两条。左右的边（`@2xl:border-r` 那种分栏线）不在这条规矩里，四边都描的
		 * 圆角卡片也不是——所以查的是 `border-t`/`border-b` 这两个前缀，不是「有没有 border」。
		 */
		rules: [...card.querySelectorAll("*")].filter((node) => {
			const names = node.className.toString().split(/\s+/);
			return names.some((name) => /^@?\w*:?border-[tb](-|$)/.test(name) && !name.includes("border-b-0"));
		}),
	};
}

function audit(what: string, words: string[]) {
	const { actions, rules } = shell();
	assert.equal(
		rules.length,
		0,
		`${what} 里还有横线：${rules.map((node) => node.className.toString().slice(0, 70)).join(" | ")}`,
	);
	assert.ok(actions.length >= 2, `${what} 底下应该有至少两颗按钮，实际 ${actions.length}`);
	for (const button of actions) {
		assert.ok(
			(button.textContent ?? "").trim().length > 0,
			`${what} 底下有一颗光秃秃的图标按钮：${button.outerHTML.slice(0, 120)}`,
		);
	}
	for (const word of words) {
		assert.ok(
			actions.some((button) => (button.textContent ?? "").includes(word)),
			`${what} 底下找不到写着「${word}」的按钮，只有：${actions.map((b) => b.textContent).join(" / ")}`,
		);
	}
}

const zh = (node: ReturnType<typeof h>) => h(I18nProvider, { locale: "zh-CN", children: node });

test("编辑模型：取消与保存都写着字，上下没有分隔线", async () => {
	const view = await mount(zh(h(ModelEditor, { provider, model, onSave: () => {}, onCancel: () => {} })));
	try {
		audit("编辑模型", ["取消", "保存"]);
	} finally {
		await view.unmount();
	}
});

test("新建模型：同一副外壳，标题换成「添加模型」", async () => {
	const view = await mount(zh(h(ModelEditor, { provider, model: null, onSave: () => {}, onCancel: () => {} })));
	try {
		audit("新建模型", ["取消", "保存"]);
		assert.match(document.querySelector("[data-dialog-title]")?.textContent ?? "", /添加模型/);
	} finally {
		await view.unmount();
	}
});

test("拉取模型：导入按钮带着数字，仍然写得出自己是谁", async () => {
	const view = await mount(zh(h(FetchModelsModal, {
		open: true,
		models: ["alpha", "beta", "gamma"],
		existingModelIds: new Set(["beta"]),
		onClose: () => {},
		onImport: () => {},
	})));
	try {
		audit("拉取模型", ["取消", "导入所选"]);
		// 已经加过的那一个不算在里面——数字是这一按真的会写进去的条数。
		assert.match(shell().actions.at(-1)?.textContent ?? "", /2/);
	} finally {
		await view.unmount();
	}
});

test("导入供应商：计划写在左边，两颗按钮写在右边", async () => {
	const entry = {
		kind: "new" as const,
		hasKey: true,
		keepsLocalKey: false,
		provider: {
			id: "imported", name: "Imported", baseUrl: "https://imported.example/v1",
			api: "openai-responses" as const, apiKey: "k", enabled: true, models: [],
		},
	};
	const view = await mount(zh(h(ProviderImportModal, { entries: [entry], dropped: 0, onCancel: () => {}, onImport: () => {} })));
	try {
		audit("导入供应商", ["取消", "导入"]);
	} finally {
		await view.unmount();
	}
});

test("插件市场源：一个出口，写着「完成」", async () => {
	const view = await mount(zh(h(RegistrySources, {
		sources: ["https://one.example/registry.json"],
		errors: [],
		onClose: () => {},
	})));
	try {
		const { actions, rules } = shell();
		assert.equal(rules.length, 0, `插件市场源里还有横线：${rules.map((n) => n.className.toString()).join(" | ")}`);
		// 改动即时存盘，所以这里只有一颗按钮——但它同样要写着字。
		assert.equal(actions.length, 1);
		assert.equal(actions[0]?.textContent?.trim(), "完成");
	} finally {
		await view.unmount();
	}
});

/**
 * 发版弹窗要先问主进程拿一份版本信息才画得出来。
 *
 * 桩只给它开场那一次要的东西：`releaseInfo` 决定表单那一整段存不存在，`workflowRunStatus` 在
 * 没有 dry-run id 时根本不会被调到。`notify` 走 store 自己的默认实现。
 */
test("发版：取消与发布都写着字，头尾两条线都没了", async () => {
	Reflect.set(window, "lyra", {
		git: {
			releaseInfo: async () => ({
				ok: true,
				currentVersion: "0.9.19",
				latestTag: "v0.9.19",
				commitsSinceTag: [{ hash: "abc1234", subject: "fix: 一条" }],
				suggestedVersion: { patch: "0.9.20", minor: "0.10.0", major: "1.0.0" },
			}),
		},
	});
	try {
		const view = await mount(zh(h(ReleaseModal, { cwd: "/tmp/qa", onClose: () => {} })));
		try {
			audit("发版", ["取消", "发布"]);
		} finally {
			await view.unmount();
		}
	} finally {
		Reflect.deleteProperty(window, "lyra");
	}
});
