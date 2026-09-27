/**
 * 「回报给主 Agent」那张卡片，挂在整个面板里测。
 *
 * 反馈原话是「阅读体验非常差」。其中最大的一处不是样式，是**同一份东西画了两遍**：上面按对象画一遍
 * （那张被挤成每行四个字的表格），下面又把 `answer`——同一个对象给模型读的写法——整段渲染一遍，
 * 每条发现被读两次。这里守的就是「只画一遍」，以及只画一遍时不能丢掉的那两样：没跑完的原因、
 * 对象是空壳时它最后说的话。
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { createElement as h } from "react";

import type { SubAgentSummary } from "@lyra/core";
import { SubAgentPanel } from "../../src/features/subagents/SubAgentPanel.tsx";
import { useApp } from "../../src/store/index.ts";
import { useSubAgents } from "../../src/store/subAgents.ts";
import { mount } from "../helpers/mount.ts";

const zero = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

function finished(over: Partial<SubAgentSummary>): SubAgentSummary {
	return { id: "s:sub:1", agent: "review", description: "审一遍登录", status: "done", startedAt: 1000, endedAt: 9000, toolCalls: 4, depth: 1, usage: zero, ...over };
}

async function show(agent: SubAgentSummary) {
	useSubAgents.setState({ agents: [agent], transcripts: { [agent.id]: [] }, focused: agent.id, loading: [] });
	return mount(h(SubAgentPanel));
}

beforeEach(() => {
	useApp.setState({ activeSessionId: "s", messages: [], toolRuns: {} });
});

afterEach(() => {
	useSubAgents.setState({ agents: [], transcripts: {}, focused: null, loading: [] });
});

test("声明了格式的回报只画一遍：对象画出来，底下不再重复那段给模型读的文字", async () => {
	const view = await show(
		finished({
			output: {
				summary: "看了登录流程，一处问题。",
				findings: [{ severity: "high", file: "src/auth.ts:42", problem: "令牌过期后没有刷新", failure: "TTL 到期后的第一次请求返回 401" }],
			},
			answer: "看了登录流程，一处问题。\n\n**findings**\n- `src/auth.ts:42` — severity: high，problem: 令牌过期后没有刷新，failure: TTL 到期后的第一次请求返回 401",
		}),
	);
	try {
		const report = view.find("[data-sub-report]");
		const text = report.textContent ?? "";
		assert.equal(text.split("令牌过期后没有刷新").length - 1, 1, `每条发现只读一遍：${text}`);
		assert.equal(text.split("看了登录流程").length - 1, 1, "结论也只一遍");
		assert.ok(!text.includes("severity:"), `给模型读的那一行不再出现：${text}`);
		assert.match(report.querySelector("header")?.textContent ?? "", /回报给主 Agent/);
		assert.ok(report.querySelector("button[aria-label='复制这份回报']"), "能把全文复制走");
		assert.equal(view.all("[data-sub-resume], [data-sub-redispatch]").length, 0, "正常做完的不给出路");
	} finally {
		await view.unmount();
	}
});

test("没跑完的：标题说没跑完，那段「为什么没跑完」的话留着，出路是写着字的按钮", async () => {
	const why = "⚠ 到了检查点（这一段 60 轮），它还没做完。下面是它交的阶段性交接，不是完整结论。它的上下文都还留着，可以接着跑。";
	const view = await show(
		finished({
			incomplete: true,
			resumable: true,
			output: { summary: "登录入口在 a.ts，还没看完 session 那一块。", files: [{ path: "src/a.ts", why: "表单提交在这里" }] },
			answer: `${why}\n\n登录入口在 a.ts，还没看完 session 那一块。\n\n**files**\n- \`src/a.ts\` — why: 表单提交在这里`,
		}),
	);
	try {
		const report = view.find("[data-sub-report]");
		assert.match(report.querySelector("header")?.textContent ?? "", /没跑完/);
		const note = view.find("[data-sub-report-note]").textContent ?? "";
		assert.match(note, /^到了检查点（这一段 60 轮）/, `原因留着，前面那个画不出来的 ⚠ 去掉：${note}`);
		const resume = view.find("[data-sub-resume] button");
		assert.match(resume.textContent ?? "", /让主 Agent 接着跑它/, "出路写着字，不用先悬停才知道是什么");
		assert.equal(resume.getAttribute("data-variant"), "subtle", "不带描边");
	} finally {
		await view.unmount();
	}
});

test("对象是空壳时，画它最后说的那段话", async () => {
	const view = await show(finished({ agent: "explore", output: { summary: "", files: [] }, answer: "入口在 src/login.ts，表单提交在第 12 行。" }));
	try {
		assert.match(view.find("[data-sub-report]").textContent ?? "", /入口在 src\/login\.ts/);
		assert.equal(view.all("[data-structured-output]").length, 0);
	} finally {
		await view.unmount();
	}
});
