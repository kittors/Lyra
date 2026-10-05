/**
 * 对话里的派发：收起时行尾那排脸、展开后每张卡片，说的是不是登记簿里的实情。
 *
 * 一次派四个、闸门只放一个——这是这一处改动要说清楚的场景。从前界面上只看得见在跑的那一个，
 * 另外三个像是没派出去；现在它们是眯着眼、褪了色的三张脸，卡片上写着「排队中」，不转圈也不计时。
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, createElement as h } from "react";
import type { AssistantContent, SubAgentSummary } from "@lyra/core";
import { ToolRun } from "../../src/features/conversation/runs.tsx";
import { useApp } from "../../src/store/index.ts";
import { useSubAgents } from "../../src/store/subAgents.ts";
import { click, mount } from "../helpers/mount.ts";

type Call = Extract<AssistantContent, { type: "toolCall" }>;
const task = (id: string, description: string, subagent_type: string): Call => ({ type: "toolCall", id, name: "task", arguments: { description, prompt: description, subagent_type } });

function summary(over: Partial<SubAgentSummary> & { id: string }): SubAgentSummary {
	return {
		agent: "general",
		description: over.id,
		status: "running",
		startedAt: Date.now() - 3000,
		toolCalls: 0,
		depth: 1,
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		...over,
	};
}

const calls = [task("c1", "找登录入口", "general"), task("c2", "审一遍鉴权", "simple"), task("c3", "规划迁移", "reason")];

afterEach(() => {
	useSubAgents.setState({ agents: [], transcripts: {}, focused: null, loading: [] });
	useApp.setState({ toolRuns: {} });
});

async function draw() {
	const started = Date.now() - 4000;
	useApp.setState({
		activeSessionId: "dispatch",
		capabilities: null,
		toolRuns: Object.fromEntries(calls.map((call) => [call.id, { toolCallId: call.id, toolName: "task", summary: String(call.arguments.description), args: call.arguments, status: "running" as const, startedAt: started }])),
	});
	useSubAgents.setState({ agents: [summary({ id: "sub:1", description: "找登录入口", startedAt: started + 100 })], transcripts: {}, focused: null, loading: [] });
	return mount(h(ToolRun, { calls: calls.map((block) => ({ block, stopReason: "toolUse" as const })), live: true }));
}

test("the folded line shows who was sent, and which of them are still waiting their turn", async () => {
	const view = await draw();
	try {
		const faces = view.all<HTMLElement>("[data-avatar-stack] [data-stack-face] .ly-avatar");
		assert.deepEqual(faces.map((face) => [face.dataset.avatar, face.dataset.mood]), [
			["circle-blue", "working"],
			["pill-brown", "waiting"],
			["triangle-orange", "waiting"],
		]);
		const tips = view.all<HTMLElement>("[data-stack-face]").map((face) => face.dataset.lyTip ?? "");
		assert.match(tips[1], /@simple · 审一遍鉴权 — 排队中/);
	} finally { await view.unmount(); }
});

test("each card wears its agent's face; a queued one says so instead of spinning; a running one opens its page in the panel", async () => {
	const view = await draw();
	try {
		await click(view.find("[data-ly-run] > button"));
		// 卡片是带着脸的那几块 div；行尾那排脸是 span，不算。
		const cards = view.all<HTMLElement>("[data-ly-run] div[data-ly-avatar-host]");
		assert.equal(cards.length, 3, "three delegation cards");
		assert.match(cards[0].textContent ?? "", /找登录入口@general/);
		assert.equal(cards[0].querySelector(".ly-avatar")?.getAttribute("data-mood"), "working");
		assert.match(cards[1].textContent ?? "", /审一遍鉴权@simple排队中/);
		// "Running" is the sweep of light across the summary (`ly-glide`). First confirm the running card really has it, or the "has none" below proves nothing.
		assert.ok(cards[0].querySelector(".ly-glide"), "the running one glides");
		assert.ok(!cards[1].querySelector(".ly-glide"), "no glide for a call that has not started");

		const open = cards[0].querySelector<HTMLButtonElement>("button");
		assert.match(open?.getAttribute("aria-label") ?? "", /在面板里看 @general/);
		await click(open as HTMLButtonElement);
		assert.equal(useSubAgents.getState().focused, "sub:1", "the panel turns to this sub-agent's page");
	} finally { await view.unmount(); }
});

test("when the queued one gets its slot, its face wakes up without the line being redrawn from scratch", async () => {
	const view = await draw();
	try {
		const stack = view.find("[data-avatar-stack]");
		await act(async () => {
			useSubAgents.setState({ agents: [summary({ id: "sub:1", description: "找登录入口", status: "done" }), summary({ id: "sub:2", agent: "simple", description: "审一遍鉴权" })] });
		});
		const moods = view.all<HTMLElement>("[data-stack-face] .ly-avatar").map((face) => face.dataset.mood);
		assert.deepEqual(moods, ["done", "working", "waiting"]);
		// 比身份用 `===`：DOM 节点交给 assert.equal，失败时格式化它会把整个文件卡死。
		assert.ok(view.find("[data-avatar-stack]") === stack, "the same element: faces change expression in place");
	} finally { await view.unmount(); }
});
