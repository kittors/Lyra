/**
 * 一条读不出来的记录，不该让人失去整个窗口。
 *
 * 这是第二次修同一句报错。2026-09-11 的 `c168d59` 标题写着「转录里的一个空位不再掀翻整个界面」，
 * 做的却全是堵写入口——core 那边三条路各加了一道校验，**渲染端一行没动**。于是承诺只兑现了一半：
 * 空位少了几条来路，可一旦真的出现，`runs()` 照样当场抛 `Cannot read properties of undefined
 * (reading 'role')`，用户在 Windows 上又撞到了同一句话。
 *
 * 所以这个文件守的是另一半，而且刻意不去关心空位从哪来——那是另一个问题，至今没有证实。这里只钉死
 * 一件事：**喂进去什么样的烂数据，转录都得画得出来**。
 *
 * 反过来的一条也在：没有损坏的时候必须原样交回**同一个引用**。少了它，这道防线会把整个转录的
 * memo 全部打穿——几千条消息每次渲染重算一遍，比它要防的崩溃更容易让人换掉这个应用。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Message } from "@lyra/core";
import { runs } from "../src/features/conversation/grouping.ts";
import { intact } from "../src/lib/transcript.ts";

/** 一条正常消息。 */
function ok(role: "user" | "assistant" | "toolResult", text = "x"): Message {
	return { role, content: [{ type: "text", text }], timestamp: 1 } as Message;
}

/** 控制台在这一段闭嘴——损坏路径会打诊断，那是给人看的，不是给测试输出看的。 */
function quietly<T>(run: () => T): T {
	const error = console.error;
	console.error = () => {};
	try {
		return run();
	} finally {
		console.error = error;
	}
}

/**
 * 十二种烂数据，每一种都在真窗口里能出现的形状。
 *
 * 稀疏空洞排第一，因为它是唯一能产生用户那句报错的形状之一，而且最阴险：`messages.map` 会**跳过**
 * 空洞，于是一道用 `map` 写的闸门对它完全没有作用，看起来却很像修好了。
 */
const BROKEN: [string, unknown[]][] = [
	["稀疏数组（真空洞）", (() => { const a: unknown[] = [ok("user")]; a[2] = ok("assistant"); return a; })()],
	["中间夹一个 undefined", [ok("user"), undefined, ok("assistant")]],
	["中间夹一个 null", [ok("user"), null, ok("assistant")]],
	/*
	 * 真稀疏，不是「填满 undefined」。
	 *
	 * `Array.from({ length: 4 })` 给的是四个实打实的 undefined，`0 in a` 为真；把 `length` 撑开给的
	 * 才是空洞，`0 in a` 为假。两者在 `map` 下的表现完全相反，而这个文件守的正是那个区别。
	 */
	["整个数组都是空洞", (() => { const a: unknown[] = []; a.length = 4; return a; })()],
	["只有一个 undefined", [undefined]],
	["缺 role 字段", [ok("user"), { content: [], timestamp: 1 }, ok("assistant")]],
	["role 是非法值", [ok("user"), { role: "wat", content: [], timestamp: 1 }, ok("assistant")]],
	["role 不是字符串", [{ role: 7, content: [], timestamp: 1 }]],
	["content 是 undefined", [ok("user"), { role: "assistant", timestamp: 1 }, ok("assistant")]],
	["content 是字符串", [ok("user"), { role: "assistant", content: "oops", timestamp: 1 }]],
	["content 是数字", [{ role: "user", content: 42, timestamp: 1 }]],
	["消息本身是字符串", [ok("user"), "oops", ok("assistant")]],
];

for (const [name, messages] of BROKEN) {
	test(`转录画得出来：${name}`, () => {
		const rows = quietly(() => runs(messages as never, [], [], []));
		assert.ok(Array.isArray(rows), "该交回一组行，而不是抛出去");
	});
}

test("坏记录就地替换，位置不变——下标还指得准", () => {
	/*
	 * 过滤掉坏记录是更省事的写法，也是错的：`compactions`、`commandRuns`、`hiccups` 全是指进这个
	 * 数组的下标。抽掉一条，它们整体错位一格——一个「不崩」的版本画出一份对不上的转录，比崩更难发现。
	 */
	const messages = [ok("user"), undefined, ok("user", "第三条")] as unknown as Message[];
	const out = quietly(() => intact(messages));

	assert.equal(out.length, 3, "长度不变");
	assert.equal(out[0], messages[0], "好的那条原样带过去");
	assert.equal(out[2], messages[2], "它后面那条还在原来的位置上");
	assert.equal(typeof out[1]?.role, "string", "坏的那条换成一条画得出来的");
});

test("没有损坏时交回同一个引用——否则整个转录的 memo 全打穿", () => {
	const messages = [ok("user"), ok("assistant"), ok("toolResult")];
	assert.equal(intact(messages), messages, "必须是同一个数组对象，不是一份等值的拷贝");
});

test("空转录也走得通", () => {
	assert.equal(intact([]).length, 0);
	assert.deepEqual(runs([], [], [], []), []);
});

test("坏记录会在控制台留下形状——下次报上来的不再只有一句报错", () => {
	/*
	 * 上一轮查不下去，卡的就是这里：只知道「有个空位」，不知道它在第几条、是空洞还是 undefined、
	 * 前后是什么。这几个字段足以把来源缩小到某一条写入路径上。
	 */
	const messages = [ok("user"), undefined, ok("assistant")] as unknown as Message[];
	const lines: string[] = [];
	const error = console.error;
	console.error = (...args: unknown[]) => lines.push(args.join(" "));
	try {
		intact(messages);
	} finally {
		console.error = error;
	}

	assert.equal(lines.length, 1, "只说一次");
	assert.match(lines[0]!, /#1/, "要说清是第几条");
	assert.match(lines[0]!, /prev=user/, "前一条是什么");
	assert.match(lines[0]!, /next=assistant/, "后一条是什么");
});

test("真空洞和 undefined 在诊断里分得开", () => {
	// 两者在 JS 里读出来都是 undefined，但来路完全不同：空洞来自越界赋值，undefined 来自被推进去。
	const sparse: unknown[] = [ok("user")];
	sparse[2] = ok("assistant");
	const lines: string[] = [];
	const error = console.error;
	console.error = (...args: unknown[]) => lines.push(args.join(" "));
	try {
		intact(sparse as Message[]);
	} finally {
		console.error = error;
	}
	assert.match(lines[0]!, /array hole/, "空洞要认出来——它指向一条完全不同的写入路径");
});
