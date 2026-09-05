/**
 * The try-panel on the rules page: type a pattern, see where it would fire (16 §5.2).
 *
 * Mounted because the acceptance is about what is shown: a refusal in the loader's words with
 * the input marked, a hit list with the source named, and a rule's conditions arriving one box
 * each.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import type { AssistantMessage, Message } from "@lyra/core";
import { RuleTryPanel } from "../../src/features/settings/RuleTryPanel.tsx";
import { fire, mount } from "../helpers/mount.ts";

function said(text: string, extra: AssistantMessage["content"] = []): Message {
	return { role: "assistant", content: [{ type: "text", text }, ...extra], timestamp: 0 } as AssistantMessage;
}

const MESSAGES: Message[] = [
	said("先看一眼。", [{ type: "toolCall", id: "c1", name: "bash", arguments: { command: "git push --force" }, argumentsText: '{"command":"git push --force"}' }]),
	said("我不会直接 push --force，先问你。"),
];

async function type(view: Awaited<ReturnType<typeof mount>>, index: number, value: string): Promise<void> {
	const input = view.all<HTMLInputElement>("input")[index];
	const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
	setter?.call(input, value);
	await fire(input, new Event("input", { bubbles: true }));
}

test("a pattern typed in shows every place it would have fired, source named", async () => {
	let patterns = [""];
	const view = await mount(h(RuleTryPanel, { patterns, onChange: (next) => void (patterns = next), messages: MESSAGES }));
	assert.equal(view.all("[data-rule-try-status]").length, 0, "nothing typed, nothing judged");

	await type(view, 0, "push --force");
	assert.deepEqual(patterns, ["push --force"]);
	await view.rerender(h(RuleTryPanel, { patterns, onChange: () => {}, messages: MESSAGES }));

	assert.equal(view.find("[data-rule-try-status]").dataset.ruleTryStatus, "hit");
	assert.match(view.find("[data-rule-try-status]").textContent ?? "", /会命中 2 处/);
	const hits = view.all("[data-rule-try-hit]").map((li) => li.textContent ?? "");
	assert.equal(hits.length, 2);
	assert.match(hits[0], /倒数第 1 条 · 正文/);
	assert.match(hits[1], /倒数第 2 条 · 工具 bash 的参数/);
	await view.unmount();
});

test("a pattern the loader would refuse is refused here, in the same words, with the input marked", async () => {
	const view = await mount(h(RuleTryPanel, { patterns: ["(a+)+$"], onChange: () => {}, messages: MESSAGES }));
	const status = view.find("[data-rule-try-status]");
	assert.equal(status.dataset.ruleTryStatus, "refused");
	assert.match(status.textContent ?? "", /嵌套量词/);
	assert.match(view.find("input").className, /border-danger/);
	assert.equal(view.all("[data-rule-try-hit]").length, 0);
	await view.unmount();
});

test("a rule's conditions arrive one box each, and a miss says how much was looked at", async () => {
	const view = await mount(h(RuleTryPanel, { patterns: ["rm -rf", "(?i)drop table"], onChange: () => {}, messages: MESSAGES }));
	assert.equal(view.all("input").length, 2);
	const statuses = view.all("[data-rule-try-status]").map((p) => p.textContent ?? "");
	assert.match(statuses[0], /最近 2 条里一处都不命中/);
	assert.match(statuses[1], /最近 2 条里一处都不命中/);
	await view.unmount();
});

test("with no conversation open, syntax is still checked and the page says what is missing", async () => {
	const view = await mount(h(RuleTryPanel, { patterns: ["(?i)todo"], onChange: () => {}, messages: [] }));
	assert.match(view.text(), /现在没有可试的消息/);
	assert.match(view.find("[data-rule-try-status]").textContent ?? "", /正则没问题/);
	await view.unmount();
});
