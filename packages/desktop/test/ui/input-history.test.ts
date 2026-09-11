/**
 * 方向键翻自己说过的话。
 *
 * 测的是规矩本身，不是某一次渲染长什么样：什么时候接管方向键、什么时候必须让开、翻过头了回到哪儿。
 * 「让开」那几条最要紧——接管得太贪心，代价是多行输入里方向键失灵，而那是每天都要用的东西，历史
 * 只是偶尔用一次。
 */

import assert from "node:assert/strict";
import { createElement as h, useRef, useState } from "react";
import { test } from "node:test";

import type { Message } from "@lyra/core";
import { useInputHistory } from "../../src/features/composer/useInputHistory.ts";
import { click, fire, mount, press } from "../helpers/mount.ts";

function said(text: string, extra: Record<string, unknown> = {}): Message {
	return { role: "user", content: [{ type: "text", text }], timestamp: 1, ...extra } as unknown as Message;
}

function Harness({ messages }: { messages: Message[] }) {
	const [text, setText] = useState("");
	const field = useRef<HTMLTextAreaElement>(null);
	const history = useInputHistory({ messages, value: text, onPick: setText, field, resetKey: "one" });
	return h(
		"div",
		null,
		h("textarea", {
			ref: field,
			value: text,
			onChange: (event: { target: { value: string } }) => setText(event.target.value),
			onKeyDown: history.keyDown,
		}),
		/*
		 * 「发送」：和真的 `submit` 一样直接清空，**不经过 onChange**。
		 *
		 * 这是真窗口里那条路的形状，也是上一版漏掉的那条——把重置挂在 onChange 上，消息发出去了、
		 * 框空了，那行「历史 1/1」还留在框里指着一句已经不在的话。
		 */
		h("button", { type: "button", onClick: () => setText("") }, "发送"),
		h("output", null, history.position ? `${history.position.current}/${history.position.total}` : "—"),
	);
}

/** 像人那样打字：受控输入框里直接赋 value 会被 React 盖掉，得走原生 setter。 */
async function type(field: HTMLTextAreaElement, text: string): Promise<void> {
	const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
	assert.ok(setter);
	setter.call(field, text);
	await fire(field, new Event("input", { bubbles: true }));
}

test("↑ 先给最近说的那句，再按往更早翻", async () => {
	const view = await mount(h(Harness, { messages: [said("第一句"), said("第二句")] }));
	const field = view.find<HTMLTextAreaElement>("textarea");

	await press(field, "ArrowUp");
	assert.equal(field.value, "第二句", "头一次按该是最近说的那句，和 shell 一个规矩");
	assert.match(view.text(), /1\/2/);

	await press(field, "ArrowUp");
	assert.equal(field.value, "第一句");
	assert.match(view.text(), /2\/2/);

	// 到头了就停住，不绕回最近那条——绕回去的话，长按 ↑ 永远走不到尽头。
	await press(field, "ArrowUp");
	assert.equal(field.value, "第一句");
	assert.match(view.text(), /2\/2/);
	await view.unmount();
});

test("翻过头回到草稿，手里那半句话还在", async () => {
	const view = await mount(h(Harness, { messages: [said("说过的")] }));
	const field = view.find<HTMLTextAreaElement>("textarea");

	await type(field, "打了一半");
	await press(field, "ArrowUp");
	assert.equal(field.value, "说过的");

	await press(field, "ArrowDown");
	assert.equal(field.value, "打了一半", "草稿必须回得来，否则没人敢按第二次");
	assert.match(view.text(), /—/, "回到草稿就不该再标着第几条");
	await view.unmount();
});

test("改了一个字，就不再是在翻历史", async () => {
	const view = await mount(h(Harness, { messages: [said("原话")] }));
	const field = view.find<HTMLTextAreaElement>("textarea");

	await press(field, "ArrowUp");
	assert.match(view.text(), /1\/1/);

	await type(field, "原话，再补一句");
	assert.match(view.text(), /—/, "动过手之后，这句就是新写的，不是翻出来的");
	// 这时候再按 ↓ 不该把刚补的字换成草稿：已经脱离历史了。
	await press(field, "ArrowDown");
	assert.equal(field.value, "原话，再补一句");
	await view.unmount();
});

test("发出去之后，「历史 x/x」不该还留在框里", async () => {
	const view = await mount(h(Harness, { messages: [said("说过的")] }));
	const field = view.find<HTMLTextAreaElement>("textarea");

	await press(field, "ArrowUp");
	assert.match(view.text(), /1\/1/);

	await click(view.find("button"));
	assert.equal(field.value, "", "发送把框清空了");
	assert.ok(!view.text().includes("1/1"), `发完那行小字还留着：${view.text()}`);

	// 而且是真的回到了草稿态：这时候按 ↓ 不该翻出任何东西。
	await press(field, "ArrowDown");
	assert.equal(field.value, "");
	await view.unmount();
});

test("多行文本里，光标没贴到边就归光标管", async () => {
	const view = await mount(h(Harness, { messages: [said("说过的")] }));
	const field = view.find<HTMLTextAreaElement>("textarea");

	await type(field, "第一行\n第二行");
	// 光标搁在第二行开头：上面还有一行，↑ 的本分是把它挪上去。
	field.setSelectionRange(4, 4);
	await press(field, "ArrowUp");
	assert.equal(field.value, "第一行\n第二行", "多行里抢走 ↑，等于让方向键在输入框里失灵");

	// 挪到最前面，这才轮到历史。
	field.setSelectionRange(0, 0);
	await press(field, "ArrowUp");
	assert.equal(field.value, "说过的");
	await view.unmount();
});

test("手上选着字的时候不接管", async () => {
	const view = await mount(h(Harness, { messages: [said("说过的")] }));
	const field = view.find<HTMLTextAreaElement>("textarea");

	await type(field, "选中我");
	field.setSelectionRange(0, 3);
	await press(field, "ArrowUp");
	assert.equal(field.value, "选中我", "有选区时方向键是用来收放选区的");
	await view.unmount();
});

test("带修饰键的方向键一概不碰", async () => {
	const view = await mount(h(Harness, { messages: [said("说过的")] }));
	const field = view.find<HTMLTextAreaElement>("textarea");

	for (const init of [{ metaKey: true }, { ctrlKey: true }, { altKey: true }, { shiftKey: true }]) {
		await press(field, "ArrowUp", init);
		assert.equal(field.value, "", `${Object.keys(init)[0]} + ↑ 是别的意思，不该翻历史`);
	}
	await view.unmount();
});

test("没说过话的对话里，↑ 什么也不做", async () => {
	const view = await mount(h(Harness, { messages: [] }));
	const field = view.find<HTMLTextAreaElement>("textarea");

	await press(field, "ArrowUp");
	assert.equal(field.value, "");
	assert.match(view.text(), /—/);
	await view.unmount();
});

test("只翻人自己说过的，机器替他说的不算", async () => {
	const view = await mount(
		h(Harness, {
			messages: [
				said("人说的"),
				said("继续推进当前任务", { synthetic: true }),
				said("规则匹配上的", { ruleMatch: { name: "r" } }),
				{ role: "assistant", content: [{ type: "text", text: "模型说的" }], timestamp: 2 } as unknown as Message,
			],
		}),
	);
	const field = view.find<HTMLTextAreaElement>("textarea");

	await press(field, "ArrowUp");
	assert.equal(field.value, "人说的", "翻出一句自己从没说过的话，比翻不出来更糟");
	assert.match(view.text(), /1\/1/);
	await view.unmount();
});

test("附件正文不跟着翻回输入框", async () => {
	const view = await mount(
		h(Harness, {
			messages: [
				said("看看这个", {
					displayText: "看看这个 【报告.pdf】",
					attachments: [{ name: "报告.pdf" }],
				}),
			],
		}),
	);
	const field = view.find<HTMLTextAreaElement>("textarea");

	await press(field, "ArrowUp");
	assert.ok(!field.value.includes("【"), `占位符该被摘掉，得到：${field.value}`);
	assert.match(field.value, /看看这个/);
	await view.unmount();
});
