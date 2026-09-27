/**
 * 换说话对象时，草稿不能串到别人名下——哪怕只是一瞬。
 *
 * 用户自己派的审查子智能体报出来的（2026-09-26）：从 A 切到 B 的那一次提交里，state 里还是 A 的字，
 * 键却已经是 B 了，按键存就把 A 的草稿写到了 B 名下。下一帧会写回 B 自己的——可要是这两帧之间
 * 面板被关掉，B 的草稿就永远是 A 的那半句话了。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import { useDraft } from "../../src/features/composer/useDraft.ts";
import { useApp } from "../../src/store/index.ts";
import { mount } from "../helpers/mount.ts";

function Probe({ at, seen }: { at: string; seen: string[] }) {
	const { text } = useDraft(at);
	seen.push(text);
	return h("span", { "data-text": text }, text);
}

test("从 A 换到 B：B 名下从来没有出现过 A 的字，画出来的也不闪 A 的字", async () => {
	useApp.setState({ drafts: { "subagent:s:a": { text: "写给 A 的半句话", attachments: [] }, "subagent:s:b": { text: "写给 B 的", attachments: [] } } });
	const writtenToB: string[] = [];
	const stop = useApp.subscribe((state) => {
		const b = state.drafts["subagent:s:b"];
		if (b) writtenToB.push(b.text);
	});
	const seen: string[] = [];
	const view = await mount(h(Probe, { at: "subagent:s:a", seen }));
	try {
		assert.equal(view.find("[data-text]").textContent, "写给 A 的半句话");
		seen.length = 0;
		await view.rerender(h(Probe, { at: "subagent:s:b", seen }));
		assert.equal(view.find("[data-text]").textContent, "写给 B 的");
		assert.ok(!writtenToB.includes("写给 A 的半句话"), `B 名下出现过 A 的字：${JSON.stringify(writtenToB)}`);
		assert.ok(!seen.includes("写给 A 的半句话"), `换过去的那一帧画了 A 的字：${JSON.stringify(seen)}`);
		assert.equal(useApp.getState().drafts["subagent:s:a"]?.text, "写给 A 的半句话", "A 的那份还在 A 名下");
	} finally {
		stop();
		await view.unmount();
		useApp.setState({ drafts: {} });
	}
});
