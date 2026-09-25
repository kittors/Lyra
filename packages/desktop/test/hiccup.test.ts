import assert from "node:assert/strict";
import { test } from "node:test";

import { describeHiccup, foldRetry, hiccupTip, settleHiccups, type Hiccup } from "../src/lib/hiccup.ts";

const failure = (over: Partial<{ kind: "network" | "upstream" | "fatal"; summary: string; detail: string; fingerprint: string; hint: string }> = {}) => ({
	kind: "upstream" as const,
	summary: "服务暂时不可用",
	fingerprint: "upstream:abc",
	...over,
});

const retry = (attempt: number, over: Record<string, unknown> = {}) => ({
	attempt,
	delayMs: 5000,
	reason: "服务暂时不可用",
	failure: failure(),
	...over,
});

test("一次中断只占一条，次数往上加", () => {
	let hiccups: Hiccup[] = [];
	for (let attempt = 1; attempt <= 12; attempt++) {
		hiccups = foldRetry(hiccups, retry(attempt), 1000);
	}
	// 开着无限重试时，一次一行会把整条转录冲垮。
	assert.equal(hiccups.length, 1);
	assert.equal(hiccups[0].attempts, 12);
});

test("接上了又断，才算新的一条", () => {
	let hiccups = foldRetry([], retry(1), 1000);
	hiccups = settleHiccups(hiccups, { outcome: "recovered", attempts: 1 });
	hiccups = foldRetry(hiccups, retry(1), 9000);
	assert.equal(hiccups.length, 2);
	assert.equal(hiccups[0].outcome, "recovered");
	assert.equal(hiccups[1].outcome, "waiting");
});

test("收场了的记录不会被后来的抖动改写", () => {
	let hiccups = foldRetry([], retry(1), 1000);
	hiccups = settleHiccups(hiccups, { outcome: "gave_up", attempts: 3, failure: failure({ summary: "额度不足" }) });
	const before = hiccups[0];
	hiccups = settleHiccups(hiccups, { outcome: "recovered", attempts: 9 });
	assert.deepEqual(hiccups[0], before, "已经放弃的那条是历史，不该被改写");
});

test("重试成功说的是恢复，不是出错", () => {
	let hiccups = foldRetry([], retry(1), 1000);
	hiccups = foldRetry(hiccups, retry(2), 1000);
	hiccups = foldRetry(hiccups, retry(3), 1000);
	hiccups = settleHiccups(hiccups, { outcome: "recovered", attempts: 3 });
	const line = describeHiccup(hiccups[0], 2000);
	assert.equal(line, "重试 3 次后恢复");
	// 用户要的就是这个：自己好了的，不该有任何像报错的字眼。
	assert.ok(!line.includes("错"), "恢复了就不该出现「错」字");
	assert.ok(!line.includes("失败"), "恢复了就不该出现「失败」");
});

test("只断一下的说法更短", () => {
	let hiccups = foldRetry([], retry(1), 1000);
	hiccups = settleHiccups(hiccups, { outcome: "recovered", attempts: 1 });
	assert.equal(describeHiccup(hiccups[0], 2000), "断了一下，已恢复");
});

test("等待时数着秒，过零之后不再声称时间", () => {
	const hiccups = foldRetry([], retry(2), 1000);
	assert.match(describeHiccup(hiccups[0], 1000), /5 秒后重试/);
	assert.match(describeHiccup(hiccups[0], 4000), /2 秒后重试/);
	// 等待结束、请求已经发出去了，这时候再说「0 秒后」就是假的。
	assert.match(describeHiccup(hiccups[0], 7000), /正在重试/);
});

test("一直是同一个错误时，次数比原因更值得说", () => {
	let hiccups: Hiccup[] = [];
	for (let attempt = 1; attempt <= 5; attempt++) hiccups = foldRetry(hiccups, retry(attempt), 1000);
	const line = describeHiccup(hiccups[0], 1000);
	// 无限重试唯一可能骗人的地方：分类器没认出来的终局错误。
	assert.match(line, /一直是同一个错误/);
	assert.match(line, /已重试 5 次/);
});

test("错误换了花样，就不算「一直是同一个」", () => {
	let hiccups = foldRetry([], retry(1, { failure: failure({ fingerprint: "upstream:aaa" }) }), 1000);
	hiccups = foldRetry(hiccups, retry(2, { failure: failure({ fingerprint: "upstream:bbb" }) }), 1000);
	hiccups = foldRetry(hiccups, retry(3, { failure: failure({ fingerprint: "upstream:ccc" }) }), 1000);
	assert.equal(hiccups[0].repeated, 1);
	assert.ok(!describeHiccup(hiccups[0], 1000).includes("一直是同一个"));
});

test("一次都没重试的失败也留一条，否则屏幕上什么都没有", () => {
	// 密钥不对：分类成 fatal，当场停下，一条 retry 事件都不会有。
	const hiccups = settleHiccups([], { outcome: "gave_up", attempts: 0, failure: failure({ kind: "fatal", summary: "密钥被拒绝", hint: "check-key" }) });
	assert.equal(hiccups.length, 1);
	assert.equal(hiccups[0].outcome, "gave_up");
	assert.equal(hiccups[0].hint, "check-key");
	assert.equal(describeHiccup(hiccups[0], 0), "密钥被拒绝");
});

test("一次都没重试的成功不留记录", () => {
	assert.deepEqual(settleHiccups([], { outcome: "recovered", attempts: 0 }), []);
});

test("再长的错误也只占一行", () => {
	const long = "上游返回了一个非常长的错误信息".repeat(30);
	let hiccups = foldRetry([], retry(1, { failure: failure({ summary: long, detail: long }) }), 1000);
	hiccups = settleHiccups(hiccups, { outcome: "gave_up", attempts: 1, failure: failure({ summary: long, detail: long }) });
	const line = describeHiccup(hiccups[0], 0);
	// 一行放得下，不然它会把整条转录顶宽。
	assert.ok(line.length <= 40, `一行 ${line.length} 字，超了`);
	assert.ok(line.endsWith("…"), "截断了就要说明还有");
});

test("悬停给的是概要，不是整页 JSON", () => {
	const huge = JSON.stringify({ error: { message: "x".repeat(5000) } });
	const hiccups = settleHiccups([], { outcome: "gave_up", attempts: 1, failure: failure({ summary: "服务端异常", detail: huge }) });
	const tip = hiccupTip(hiccups[0]);
	assert.ok(tip);
	// 气泡最宽 360px，塞一页 JSON 进去只会得到一堵挡住半个窗口的墙。
	assert.ok(tip.length < 400, `悬停内容 ${tip.length} 字，会撑破气泡`);
	assert.ok(tip.includes("服务端异常"), "该说的那句还是要在");
});

test("有下一步可给的时候，悬停里说得出来", () => {
	const hiccups = settleHiccups([], { outcome: "gave_up", attempts: 0, failure: failure({ kind: "fatal", summary: "额度不足", hint: "check-billing" }) });
	assert.match(hiccupTip(hiccups[0]) ?? "", /余额|额度/);
});

test("摘要和原文一样时不重复说两遍", () => {
	const hiccups = settleHiccups([], { outcome: "gave_up", attempts: 1, failure: failure({ summary: "服务端异常", detail: "服务端异常" }) });
	const tip = hiccupTip(hiccups[0]) ?? "";
	assert.equal(tip.split("服务端异常").length - 1, 1, "同一句话不该在气泡里出现两遍");
});

test("重试中换了模型，说的是换了人，不是恢复也不是失败", () => {
	/*
	 * 旧模型的上游坏了、一直在重试，人换了模型——这一次请求当场放手，换新模型接着问。它既没有
	 * 「恢复」，也没有「放弃」：说成恢复是报一件没发生的好事，说成失败会画出一张失败卡片、摆出
	 * 一个「继续」按钮，而这一轮根本没停。
	 */
	let hiccups = foldRetry([], retry(1), 1000);
	hiccups = foldRetry(hiccups, retry(2), 1000);
	hiccups = settleHiccups(hiccups, { outcome: "switched", attempts: 2, switchedTo: "Model B" }, 0);
	assert.equal(hiccups.length, 1);
	assert.equal(hiccups[0].outcome, "switched");
	const line = describeHiccup(hiccups[0], 2000);
	assert.equal(line, "重试 2 次后换成 Model B 接着问");
	assert.ok(!line.includes("恢复") && !line.includes("失败"));
});

test("没有正在等的那一条时，换模型不凭空补出一条", () => {
	// 只有「一次都没重试就失败」才需要补一条；换模型的那一刻如果没在重试，就没有什么可收场的。
	const hiccups = settleHiccups([], { outcome: "switched", attempts: 0, switchedTo: "Model B" }, 0);
	assert.deepEqual(hiccups, []);
});
