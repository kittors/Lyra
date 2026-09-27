/**
 * A sub-agent's structured reply, drawn by its shape and never as JSON (16 §6.1).
 *
 * 二轮改版之后守的是「读起来像一份回报」：结论开头不带键名，记录一条一条、问题独占一行，
 * 严重度按轻重排、写成人话，长文本直接展开，键名换成人话。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import { hasContent, StructuredOutput } from "../../src/features/subagents/StructuredOutput.tsx";
import { mount } from "../helpers/mount.ts";

test("verify 的回报：顶上一枚「没通过」，结论开头，失败项一条一条", async () => {
	const view = await mount(
		h(StructuredOutput, {
			output: {
				passed: false,
				summary: "node --test: 3 passed, 1 failed",
				command: "node --test test/*.test.ts",
				failures: [{ name: "adds", location: "test/math.test.ts:12", message: "expected 4, got 5" }],
			},
		}),
	);
	try {
		assert.ok(!view.text().includes("{"), `no braces: ${view.text()}`);
		const flag = view.find("[data-field=passed]");
		assert.equal(flag.dataset.kind, "flag");
		assert.match(flag.textContent ?? "", /没通过/);
		assert.match(flag.className, /text-danger/, "没过是红的，第一眼就看得到");

		const lead = view.find("[data-field=summary]");
		assert.equal(lead.dataset.kind, "lead");
		assert.equal(lead.textContent, "node --test: 3 passed, 1 failed");
		assert.ok(!view.text().includes("summary"), "给模型看的键名不印出来");

		assert.match(view.find("[data-field=command]").textContent ?? "", /命令\s*node --test/);
		assert.ok(view.find("[data-field=command] code"), "命令用等宽字");

		const failures = view.find("[data-field=failures]");
		assert.equal(failures.dataset.kind, "records");
		assert.match(failures.querySelector("h4")?.textContent ?? "", /失败项\s*· 1/);
		assert.equal(view.all("table").length, 0, "不再是表格");
		const item = failures.querySelector("[data-item]") as HTMLElement;
		assert.equal(item.querySelector("[data-item-where]")?.textContent, "test/math.test.ts:12");
		assert.match(item.textContent ?? "", /adds.*expected 4, got 5/);
	} finally {
		await view.unmount();
	}
});

test("review 的发现：最重的在最上面，严重度写成人话，问题独占一行，触发条件带标签跟在后面", async () => {
	const view = await mount(
		h(StructuredOutput, {
			output: {
				summary: "看了登录流程，两处问题。",
				findings: [
					{ severity: "low", file: "a.ts", line: 3, problem: "命名不一致", failure: "读代码的人会以为是两个东西" },
					{ severity: "high", file: "src/auth/session.ts:42", problem: "会话令牌过期后没有刷新，用户会被静默登出", failure: "令牌 TTL 到期后的第一次请求返回 401" },
					{ severity: "medium", file: "c.ts", problem: "错误被吞掉", failure: "网络断开时 catch 里什么都不做" },
				],
			},
		}),
	);
	try {
		const findings = view.find("[data-field=findings]");
		assert.equal(findings.dataset.kind, "findings");
		assert.match(findings.querySelector("h4")?.textContent ?? "", /发现的问题\s*· 3/);
		const items = view.all<HTMLElement>("[data-field=findings] [data-item]");
		assert.deepEqual(
			items.map((item) => item.dataset.severity),
			["high", "medium", "low"],
			"按轻重排",
		);
		assert.deepEqual(
			items.map((item) => item.querySelector("[data-item-severity]")?.textContent),
			["高", "中", "低"],
		);
		assert.match(items[0].querySelector("[data-item-severity]")?.className ?? "", /text-danger/);

		// 问题本身是这一条的主句，不带键名；触发条件小一号、带着它叫什么。
		const texts = [...items[0].querySelectorAll<HTMLElement>("[data-item-text]")].map((p) => p.textContent);
		assert.deepEqual(texts, ["会话令牌过期后没有刷新，用户会被静默登出", "触发条件 · 令牌 TTL 到期后的第一次请求返回 401"]);
		assert.equal(items[0].querySelector("[data-item-where]")?.textContent, "src/auth/session.ts:42");
		// 单独写着的行号接到文件后面。
		assert.equal(items[2].querySelector("[data-item-where]")?.textContent, "a.ts:3");
		assert.ok(!view.text().includes("severity") && !view.text().includes("problem"), `键名不印出来：${view.text()}`);
	} finally {
		await view.unmount();
	}
});

test("plan 的步骤有序号、文件是一排小签；风险是列表，空的待确认说「无」", async () => {
	const view = await mount(
		h(StructuredOutput, {
			output: {
				steps: [
					{ what: "改导出", files: ["src/a.ts", "src/b.ts"] },
					{ what: "补测试", files: [] },
				],
				risks: ["调用点漏改"],
				unknowns: [],
			},
		}),
	);
	try {
		const steps = view.all<HTMLElement>("[data-field=steps] [data-item]");
		assert.equal(steps.length, 2);
		assert.match(steps[0].textContent ?? "", /^1改导出/);
		assert.deepEqual(
			[...steps[0].querySelectorAll("[data-item-list=files] [data-item-chip]")].map((chip) => chip.textContent),
			["src/a.ts", "src/b.ts"],
		);
		assert.equal(steps[1].querySelectorAll("[data-item-list]").length, 0, "空的文件列表不画一排空签");

		assert.equal(view.find("[data-field=risks]").dataset.kind, "list");
		assert.match(view.find("[data-field=risks]").textContent ?? "", /风险\s*· 1\s*调用点漏改/);
		assert.match(view.find("[data-field=unknowns]").textContent ?? "", /待确认\s*无/, "an empty list says so instead of vanishing");
	} finally {
		await view.unmount();
	}
});

test("长文本直接展开，交给调用方画成 Markdown——那是交付物，不用先点一下", async () => {
	const report = "## 结论\n\n第一行\n".repeat(20);
	const seen: string[] = [];
	const view = await mount(
		h(StructuredOutput, {
			output: { summary: "一句话结论", report },
			prose: (text: string) => {
				seen.push(text);
				return h("div", { "data-prose": "" }, text);
			},
		}),
	);
	try {
		assert.equal(view.find("[data-field=report]").dataset.kind, "long-text");
		assert.match(view.find("[data-field=report] h4").textContent ?? "", /完整报告/);
		assert.equal(view.all("[data-field=report] button").length, 0, "不折叠");
		assert.deepEqual(seen, ["一句话结论", report], "结论和报告都走同一个画法");
	} finally {
		await view.unmount();
	}
});

test("格式不符的地方在最后小字列出来；认不得的键把下划线拆开照写", async () => {
	const view = await mount(
		h(StructuredOutput, {
			output: { breaking_changes: "无", retryCount: 3 },
			warnings: ["findings[0] 少了 failure"],
		}),
	);
	try {
		assert.match(view.find("[data-field=breaking_changes]").textContent ?? "", /^breaking changes/);
		assert.match(view.find("[data-field=retryCount]").textContent ?? "", /^retry Count\s*3/);
		assert.match(view.find("[data-output-warnings]").textContent ?? "", /1 处不符合约定的格式.*findings\[0\] 少了 failure/);
	} finally {
		await view.unmount();
	}
});

test("什么都没写的对象不算有内容——`{ summary: \"\", files: [] }` 也能过校验", () => {
	assert.equal(hasContent({ summary: "", files: [] }), false);
	assert.equal(hasContent({ summary: "  " }), false);
	assert.equal(hasContent({ passed: false }), true, "没通过也是一个回答");
	assert.equal(hasContent({ files: [{ path: "a.ts", why: "" }] }), true);
});
