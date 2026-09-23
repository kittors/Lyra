/**
 * 按了停止的那张工具卡，说「已停止」，不画红叉。
 *
 * 取消回来的结果带着 `isError: true`——那是告诉模型「这一步没做完」——卡片就照着画成了失败：
 * 红叉，展开后标题写「错误」、字是红的。什么都没坏，只是人叫停了。两处会产生取消，都在
 * `details.cancelled` 里留了标记：bash 进程被杀时（core 的 `tools/bash.ts`），和 agent 循环放弃
 * 一个没回来的调用时（`agent/tool-run.ts`，文字是 "Tool execution was cancelled."）。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import { ToolCard } from "../../src/features/conversation/ToolCard.tsx";
import { I18nProvider } from "../../src/i18n/index.ts";
import { click, mount } from "../helpers/mount.ts";

function card(result: Record<string, unknown>) {
	return h(I18nProvider, {
		locale: "zh-CN",
		children: h(ToolCard, {
			toolName: "bash",
			summary: "启动开发服务器",
			args: { command: "pnpm dev" },
			status: "error",
			result,
		} as never),
	});
}

/** The result section's heading, once the card is opened. */
async function opened(view: Awaited<ReturnType<typeof mount>>) {
	await click(view.find("button[aria-expanded]"));
	return view.text();
}

test("bash 被停掉：中性的「已停止」，没有红叉", async () => {
	const view = await mount(card({
		content: [{ type: "text", text: "ready on :5173\n\n[cancelled]" }],
		details: { kind: "bash", command: "pnpm dev", cancelled: true },
		isError: true,
	}));
	try {
		assert.ok(!view.host.querySelector(".lucide-circle-x"), "取消不是失败，不该画红叉");
		const stopped = view.host.querySelector('[aria-label="已停止"]');
		assert.ok(stopped, "应有一个说「已停止」的标记");
		assert.ok(!stopped.getAttribute("class")?.includes("danger"));
		const text = await opened(view);
		assert.ok(text.includes("已停止"), text);
		assert.ok(!text.includes("错误"), `展开后的标题仍写着错误：${text}`);
	} finally {
		await view.unmount();
	}
});

test("agent 层放弃的调用也一样，包括只有那句文字、没有标记的旧记录", async () => {
	for (const result of [
		{ content: [{ type: "text", text: "Tool execution was cancelled." }], details: { cancelled: true }, isError: true },
		{ content: [{ type: "text", text: "Tool execution was cancelled." }], isError: true },
	]) {
		const view = await mount(card(result));
		try {
			assert.ok(!view.host.querySelector(".lucide-circle-x"));
			assert.ok(view.host.querySelector('[aria-label="已停止"]'));
		} finally {
			await view.unmount();
		}
	}
});

test("真的失败了仍是红叉和「错误」", async () => {
	const view = await mount(card({
		content: [{ type: "text", text: "command not found: pnpm" }],
		details: { kind: "bash", command: "pnpm dev", exitCode: 127 },
		isError: true,
	}));
	try {
		assert.ok(view.host.querySelector(".lucide-circle-x"));
		assert.ok(!view.host.querySelector('[aria-label="已停止"]'));
		assert.ok((await opened(view)).includes("错误"));
	} finally {
		await view.unmount();
	}
});
