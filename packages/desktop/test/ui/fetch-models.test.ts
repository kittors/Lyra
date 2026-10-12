/**
 * 拉取弹窗在手里怎么用：取消勾选已有的就是移除，接口没列出的名字可以敲进去，全都加过了也不是死胡同。
 *
 * 用户原话是「获取后无法修改删除，无法取消和新增」。截图里四个模型全是灰的「已添加」，底下
 * 「已选择 0 个模型」，导入按钮是灰的——除了取消什么都做不了。这几条从画出来的 DOM 上验，
 * 按钮上的字、行上的标记、最后交出去的改动，都是人看得见的东西。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";

import type { ModelConfig } from "@lyra/core";
import { I18nProvider } from "../../src/i18n/index.ts";
import { FetchModelsModal } from "../../src/features/settings/FetchModelsModal.tsx";
import type { ModelChange } from "../../src/features/settings/model-sync.ts";
import { click, fire, mount } from "../helpers/mount.ts";

const model = (modelId: string): ModelConfig => ({
	id: `relay/${modelId}`,
	providerId: "relay",
	modelId,
	name: modelId,
	contextWindow: 200_000,
	maxOutputTokens: 65_536,
	supportsThinking: true,
	supportsImages: true,
	supportsTools: true,
});

const FLASH = ["gemini-3.8-flash-high", "gemini-3.8-flash-low", "gemini-3.8-flash-medium", "gemini-3.8-flash-tiered"];

async function open(listed: string[], models: ModelConfig[]) {
	const applied: ModelChange[] = [];
	const view = await mount(h(I18nProvider, {
		locale: "zh-CN",
		children: h(FetchModelsModal, { listed, models, onClose: () => {}, onApply: (change) => applied.push(change) }),
	}));
	const apply = () => document.querySelector<HTMLButtonElement>("[data-ly-fetch-apply]")!;
	return {
		view,
		applied,
		apply,
		summary: () => document.querySelector("[data-ly-fetch-summary]")?.textContent ?? "",
		row: (id: string) => document.querySelector<HTMLElement>(`[data-ly-fetch-row="${id}"]`),
		state: (id: string) => document.querySelector(`[data-ly-fetch-row="${id}"]`)?.getAttribute("data-ly-fetch-state"),
		async toggle(id: string) {
			await click(document.querySelector(`[data-ly-fetch-row="${id}"] [role="checkbox"]`)!);
		},
		async type(text: string) {
			const input = document.querySelector<HTMLInputElement>("[data-ly-modal] input")!;
			await act(async () => {
				Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!.call(input, text);
				input.dispatchEvent(new window.Event("input", { bubbles: true }));
			});
			return input;
		},
		/** 确认挂在退场动画的 animationend 上，happy-dom 不播动画，得手动送这一帧。 */
		async confirm() {
			await click(apply());
			await act(async () => {
				document.querySelector(".ly-dialog-out")?.dispatchEvent(new window.Event("animationend", { bubbles: true }));
			});
		},
	};
}

test("截图里那一刻：四个都加过了——默认不改动，但每一行都能取消，取消就是移除", async () => {
	const dialog = await open(FLASH, FLASH.map(model));
	try {
		assert.equal(dialog.apply().disabled, true, "什么都没动时应用按钮应该是灰的");
		assert.match(dialog.summary(), /没有改动/);
		assert.ok(document.querySelector("[data-ly-fetch-empty]"), "没有可添加的时候要告诉人下一步在搜索框");
		for (const id of FLASH) assert.equal(dialog.state(id), "keep");

		await dialog.toggle("gemini-3.8-flash-low");
		assert.equal(dialog.state("gemini-3.8-flash-low"), "remove");
		assert.match(dialog.row("gemini-3.8-flash-low")?.textContent ?? "", /将移除/);
		assert.match(dialog.summary(), /移除 1 个/);
		assert.equal(dialog.apply().disabled, false);
		assert.match(dialog.apply().textContent ?? "", /移除 1 个/);
		assert.ok(dialog.apply().className.includes("danger"), "只删不加的那一按要读得出是删除");

		await dialog.confirm();
		assert.deepEqual(dialog.applied, [{ add: [], remove: ["gemini-3.8-flash-low"] }]);
	} finally {
		await dialog.view.unmount();
	}
});

test("接口没列出的生图模型：敲名字、回车，就加进来", async () => {
	const dialog = await open(FLASH, FLASH.map(model));
	try {
		const input = await dialog.type("gemini-3.1-flash-image");
		assert.ok(document.querySelector("[data-ly-fetch-add]"), "敲了一个列表里没有的名字，要给出「添加」");
		await fire(input, new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		assert.equal(dialog.state("gemini-3.1-flash-image"), "add");
		assert.match(dialog.row("gemini-3.1-flash-image")?.textContent ?? "", /手动添加/);
		assert.ok(dialog.row("gemini-3.1-flash-image")?.querySelector("[aria-label='生图模型']"), "名字认得出是生图模型，就该标出来");
		assert.equal(document.querySelector("[data-ly-fetch-add]"), null, "已经有这一行了，不该再提供一次添加");
		assert.match(dialog.apply().textContent ?? "", /添加 1 个/);

		await dialog.confirm();
		assert.deepEqual(dialog.applied, [{ add: ["gemini-3.1-flash-image"], remove: [] }]);
	} finally {
		await dialog.view.unmount();
	}
});

test("又加又删：按钮说「应用 N 项更改」，左边分开写", async () => {
	const dialog = await open([...FLASH, "gemini-3.1-flash-image"], FLASH.map(model));
	try {
		assert.equal(dialog.state("gemini-3.1-flash-image"), "add", "列出来的新模型照旧默认勾上");
		await dialog.toggle("gemini-3.8-flash-tiered");
		assert.match(dialog.summary(), /新增 1 个.*移除 1 个/);
		assert.match(dialog.apply().textContent ?? "", /应用 2 项更改/);
		await dialog.confirm();
		assert.deepEqual(dialog.applied, [{ add: ["gemini-3.1-flash-image"], remove: ["gemini-3.8-flash-tiered"] }]);
	} finally {
		await dialog.view.unmount();
	}
});

test("「全不选」只管自己那一组：不要新的，不会顺手把已有的全删了", async () => {
	const dialog = await open(["a", "b", "c", "d"], [model("a"), model("b")]);
	try {
		const available = document.querySelector("[data-ly-fetch-group='available'] [data-ly-fetch-toggle-all]")!;
		assert.match(available.textContent ?? "", /取消全选/);
		await click(available);
		assert.equal(dialog.state("c"), "skip");
		assert.equal(dialog.state("d"), "skip");
		assert.equal(dialog.state("a"), "keep");
		assert.equal(dialog.state("b"), "keep");
		assert.equal(dialog.apply().disabled, true);
	} finally {
		await dialog.view.unmount();
	}
});

test("接口一个都没列：照样打开，已有的能管，提示去搜索框里敲名字", async () => {
	const dialog = await open([], [model("a")]);
	try {
		assert.equal(dialog.state("a"), "keep");
		assert.match(document.querySelector("[data-ly-fetch-empty]")?.textContent ?? "", /没有列出模型/);
		// 已有、但这次没被列出的，要标出来——这是清掉下线模型的唯一线索。
		assert.match(dialog.row("a")?.textContent ?? "", /未列出/);
	} finally {
		await dialog.view.unmount();
	}
});

test("按厂商搜：google 找得到 gemini，找不到的名字可以直接加", async () => {
	const dialog = await open(["gemini-3.8-flash-high", "claude-opus-5"], []);
	try {
		await dialog.type("google");
		assert.ok(dialog.row("gemini-3.8-flash-high"));
		assert.equal(dialog.row("claude-opus-5"), null);
		await dialog.type("gemini-3.8-flash-high");
		assert.equal(document.querySelector("[data-ly-fetch-add]"), null, "名字已经在列表里，就不该再给一个添加");
	} finally {
		await dialog.view.unmount();
	}
});
