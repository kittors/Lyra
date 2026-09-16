/**
 * 一整轮里，哪一段是过程，哪一句是回答。
 *
 * 「想 → 做 → 说」这条线是在 Run 这一层定下来的，不是在渲染时看邻居。规则性的东西要能单独测——
 * 而这一条尤其容易悄悄错：判错了边界，收起过程时会把答案一起收进去，或者把过程漏在外面，
 * 两种都不报错，只是屏幕上不对。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "@lyra/core";

import { turnBlocks, type Run } from "../src/features/conversation/grouping.ts";

const ask = (text: string, index: number): Run => ({
	kind: "message",
	message: { role: "user", content: [{ type: "text", text }], timestamp: 1 } as Message,
	index,
	upTo: 1,
});

/** 被单独拆出来的开头推理行——`leadingThinking` 干的事。 */
const think = (index: number): Run => ({
	kind: "message",
	message: { role: "assistant", content: [{ type: "thinking", thinking: "想想" }], stopReason: "toolUse" } as Message,
	index,
	upTo: 1,
	lead: true,
});

const say = (text: string, index: number): Run => ({
	kind: "message",
	message: { role: "assistant", content: [{ type: "text", text }], stopReason: "end" } as Message,
	index,
	upTo: 1,
});

const work = (n: number): Run => ({
	kind: "tools",
	calls: Array.from({ length: n }, (_, i) => ({
		block: { type: "toolCall", id: `c${i}`, name: "read", arguments: {} },
		stopReason: "toolUse",
	})) as Run extends { kind: "tools"; calls: infer C } ? C : never,
});

const shape = (list: Run[]) => turnBlocks(list).map((b) => b.kind);

test("一轮里，过程收成一块，最后那句话留在外面", () => {
	const blocks = turnBlocks([ask("帮我看看", 0), think(1), work(2), think(3), work(1), say("看完了。", 5)]);
	assert.deepEqual(blocks.map((b) => b.kind), ["plain", "process", "plain"]);
	assert.equal(blocks[1].runs.length, 4, "两次思考加两段活，全在过程里");
	assert.deepEqual(blocks[1].counts, { tools: 3, thinking: 2 });
	assert.equal(blocks[2].runs[0].kind, "message");
});

test("中间的解说也算过程——它在说自己正在做什么，不是结论", () => {
	// 「我先看一下配置」不是这一轮的答案，最后那句才是。
	const blocks = turnBlocks([ask("改一下", 0), think(1), say("我先看一下配置。", 2), work(1), say("改好了。", 4)]);
	assert.deepEqual(blocks.map((b) => b.kind), ["plain", "process", "plain"]);
	assert.equal(blocks[1].runs.length, 3, "推理、解说、那段活，三条都收进去");
	assert.equal(blocks[2].runs[0].kind, "message");
});

test("还没说出最后那句话时，过程一直延伸到末尾", () => {
	// 正在跑的那一轮本来就该全程看得见；`TurnProcess` 只在收起时才折叠。
	const blocks = turnBlocks([ask("跑一下", 0), think(1), work(2)]);
	assert.deepEqual(blocks.map((b) => b.kind), ["plain", "process"]);
	assert.equal(blocks[1].counts.tools, 2);
});

test("没有过程的一轮不产生空壳", () => {
	// 一问一答，中间什么都没发生——不该凭空多出一行「思考了一会儿」。
	assert.deepEqual(shape([ask("你好", 0), say("你好。", 1)]), ["plain", "plain"]);
});

test("连着两轮各自成块，不会串到一起", () => {
	const blocks = turnBlocks([
		ask("第一件事", 0), think(1), work(1), say("好了。", 3),
		ask("第二件事", 4), think(5), work(2), say("也好了。", 8),
	]);
	assert.deepEqual(blocks.map((b) => b.kind), ["plain", "process", "plain", "plain", "process", "plain"]);
	assert.equal(blocks[1].counts.tools, 1);
	assert.equal(blocks[4].counts.tools, 2);
});

test("只想不做的一轮，过程里只有思考", () => {
	// 这正是那句「思考了一会儿」该出现的地方——没有工具可数。
	const blocks = turnBlocks([ask("想想这个", 0), think(1), say("我的看法是……", 2)]);
	assert.deepEqual(blocks[1].counts, { tools: 0, thinking: 1 });
});

test("正文已经在流式输出时，过程块仍然属于当前这一轮", () => {
	/*
	 * 录像里抓到的那个：模型一开始吐正文，过程块就不再排在末尾，于是「是不是最后一块」判假，
	 * 折叠行在回合中途冒出来、把正在进行的工作收了起来。要问的是「这一块属于第几轮」。
	 */
	const blocks = turnBlocks([ask("干活", 0), think(1), work(3), say("我的结论是……", 4)]);
	const last = blocks[blocks.length - 1];
	const process = blocks.find((b) => b.kind === "process");
	assert.ok(process);
	assert.notEqual(blocks.indexOf(process), blocks.length - 1, "过程块确实不在末尾——这正是旧判断出错的前提");
	assert.equal(process.turn, last.turn, "但它和那句回答属于同一轮");
});

test("上一轮的过程不会被当成这一轮的", () => {
	const blocks = turnBlocks([
		ask("第一件", 0), think(1), work(1), say("好了。", 3),
		ask("第二件", 4), think(5), work(1), say("也好了。", 8),
	]);
	const processes = blocks.filter((b) => b.kind === "process");
	assert.equal(processes.length, 2);
	assert.notEqual(processes[0].turn, processes[1].turn, "两轮各归各的，否则旧的那段会跟着新的一起摊开");
});

/*
 * 一轮里塞进几百个 Run，它们收成**一个**块——这就是「显示更早」曾经点了没反应的成因。
 *
 * 转录的分页窗口从前按 Run 走（那是当时唯一控得住渲染量的闸门），而画出来的单位是块。真实会话里
 * 用户两次发言之间跑过 400 次工具调用，于是往前翻 60 个 Run 时，那 60 个全落进下面这个已经收起的
 * 块——屏幕上唯一的变化是「调用工具 N 个」那行数字。连点四次，转录一动不动（2026-09-15 的录屏）。
 *
 * 窗口现在按块走（`Conversation.tsx` 的 `allBlocks`），所以翻一次必然多出整块、必然看得见。这条
 * 测试钉的是那个成因本身：只要一轮还能收成一个块，按 Run 分页就一定会退化，谁想改回去都得先过它。
 */
test("hundreds of runs between two questions still collapse into a single block", () => {
	const long: Run[] = [ask("查一下这个问题", 0)];
	for (let i = 0; i < 200; i++) {
		long.push(think(i * 2 + 1), work(2));
	}
	long.push(ask("那彻底修一下", 401));

	const blocks = turnBlocks(long);
	const process = blocks.filter((block) => block.kind === "process");

	assert.equal(process.length, 1, "两次发言之间的一切收成一个过程块——这正是按 Run 翻页会失效的原因");
	assert.ok(process[0].runs.length > 300, `那一个块里装着 ${process[0].runs.length} 个 Run`);

	/*
	 * 而按块分页时，同样这段历史往前翻一步必然多出可见的块。
	 *
	 * 拿 `slice` 直接比，是因为组件里就是这么切的（`allBlocks.slice(range.start, range.end)`）——
	 * 这里比的不是 `slice` 会不会工作，是「切的是块不是 Run」这个决定还在不在。
	 */
	assert.ok(blocks.length >= 3, "开头的问题、中间的过程、末尾的问题，至少三块");
	assert.ok(
		blocks.slice(blocks.length - 3).length > blocks.slice(blocks.length - 1).length,
		"往前翻一步就多出块",
	);
});

/*
 * 窗口切的是块，不是 Run——这个决定写在组件里，没有可以单独调用的函数，所以只能对着源码钉。
 *
 * 换个写法就退回原样了，而且退回去之后没有任何测试会红：`turnBlocks` 照常工作、`slice` 照常工作，
 * 只有屏幕上不对。那正是这个 bug 活到今天的方式。
 */
test("the transcript window pages by block, not by run", async () => {
	const { readFile } = await import("node:fs/promises");
	const source = await readFile(new URL("../src/features/conversation/Conversation.tsx", import.meta.url), "utf8");

	assert.match(source, /useTranscriptWindow\([^)]*allBlocks\.length\)/, "窗口的总数要按块算");
	assert.match(source, /allBlocks\.slice\(range\.start, range\.end\)/, "切的要是块");
	assert.ok(!/allRuns\.slice\(range/.test(source), "切 Run 就是那个「点了没反应」的写法");
	assert.match(source, /turnBlocks\(allRuns\)/, "要先分块再开窗，顺序反过来等于没改");
});
