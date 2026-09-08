import assert from "node:assert/strict";
import { test } from "node:test";

import { classifyFailure, messageFromBody, serverDelayMs, worthRetrying } from "../src/ai/failure.ts";
import { RetryBudget, fetchWithRetry } from "../src/ai/retry.ts";

const transport = (code?: string, message = "fetch failed") =>
	classifyFailure({ from: "transport", error: code ? Object.assign(new Error(message), { cause: { code } }) : new Error(message) });

test("认得出的传输故障算连接问题", () => {
	for (const code of ["ECONNRESET", "UND_ERR_SOCKET", "ETIMEDOUT", "EAI_AGAIN", "ENOTFOUND"]) {
		const failure = transport(code);
		assert.equal(failure.kind, "network", `${code} 应当算连接问题`);
		assert.equal(worthRetrying(failure), true);
	}
});

test("没见过的传输故障也重试，而不是当场放弃", () => {
	// 白名单时代的漏网之鱼：名字没见过就一律不重试。
	const failure = transport("EWEIRD_NEW_CODE");
	assert.equal(failure.kind, "network");
	assert.equal(worthRetrying(failure), true);
});

test("证书问题不重试——再试一百次还是同一张证书", () => {
	for (const code of ["CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID", "DEPTH_ZERO_SELF_SIGNED_CERT"]) {
		assert.equal(transport(code).kind, "fatal", `${code} 应当直接报错`);
	}
	assert.equal(transport("ERR_INVALID_URL").summary, "接口地址无效");
});

test("密钥、模型、额度、请求体——只有这几样不重试", () => {
	assert.equal(classifyFailure({ from: "status", status: 401 }).kind, "fatal");
	assert.equal(classifyFailure({ from: "status", status: 403 }).kind, "fatal");
	assert.equal(classifyFailure({ from: "status", status: 404 }).kind, "fatal");
	assert.equal(classifyFailure({ from: "status", status: 402 }).kind, "fatal");
	assert.equal(classifyFailure({ from: "status", status: 400 }).kind, "fatal");
	assert.equal(classifyFailure({ from: "status", status: 413 }).kind, "fatal");
	assert.equal(classifyFailure({ from: "status", status: 422 }).kind, "fatal");
	// 界面据此给出下一步，所以分类必须带上它。
	assert.equal(classifyFailure({ from: "status", status: 401 }).hint, "check-key");
	assert.equal(classifyFailure({ from: "status", status: 404 }).hint, "check-model");
	assert.equal(classifyFailure({ from: "status", status: 402 }).hint, "check-billing");
});

test("白名单外的状态码现在会重试", () => {
	// 改动前这两个直接报错——真值表里的「漏网」两行。
	for (const status of [520, 521, 530, 598, 466]) {
		const failure = classifyFailure({ from: "status", status });
		assert.equal(failure.kind, "upstream", `${status} 应当重试`);
		assert.equal(worthRetrying(failure), true);
	}
	assert.equal(classifyFailure({ from: "status", status: 429 }).kind, "upstream");
	assert.equal(classifyFailure({ from: "status", status: 503 }).kind, "upstream");
});

test("流内 error 事件重试，哪怕它什么都没说", () => {
	// 截图里那个：中转发一个空的 error 事件，界面显示 Unknown provider error。
	const bare = classifyFailure({ from: "stream" });
	assert.equal(bare.kind, "upstream");
	assert.equal(worthRetrying(bare), true);
	assert.equal(bare.summary, "服务商中断了这次回答");

	const withMessage = classifyFailure({ from: "stream", message: "upstream temporarily unavailable" });
	assert.equal(withMessage.kind, "upstream");
});

test("正文里写着终局理由的，状态码再像临时故障也照拒", () => {
	// 有的中转把欠费答成 503。
	const quota = classifyFailure({ from: "status", status: 503, body: JSON.stringify({ error: { code: "insufficient_quota" } }) });
	assert.equal(quota.kind, "fatal");
	assert.equal(quota.hint, "check-billing");

	const banned = classifyFailure({ from: "stream", message: "account_suspended: contact support" });
	assert.equal(banned.kind, "fatal");

	const filtered = classifyFailure({ from: "stream", message: "content_filter triggered" });
	assert.equal(filtered.kind, "fatal");
	assert.equal(filtered.hint, "blocked");
});

test("空回答算失败，不算「模型没话说」", () => {
	for (const why of ["no-content", "no-frames", "unparsable"] as const) {
		const failure = classifyFailure({ from: "empty", why });
		assert.equal(failure.kind, "upstream", `${why} 应当重试`);
	}
	assert.equal(classifyFailure({ from: "empty", why: "unparsable" }).summary, "返回的内容无法解析");
});

test("摘要一行放得下，原文一个字不丢", () => {
	const long = "x".repeat(5000);
	const failure = classifyFailure({ from: "status", status: 500, body: JSON.stringify({ error: { message: long } }) });
	assert.ok(failure.summary.length <= 48, `摘要 ${failure.summary.length} 字，超了一行的位置`);
	assert.ok((failure.detail?.length ?? 0) > 100, "原文应当留着，给悬停和展开用");
	assert.ok(failure.detail!.includes("还有"), "截断时要说明还有多少");
});

test("一页 HTML 不会被顶到摘要上", () => {
	const failure = classifyFailure({ from: "status", status: 502, body: "<html><head><title>502 Bad Gateway</title></head><body>...</body></html>" });
	assert.equal(failure.summary, "网关错误");
	assert.ok(!failure.summary.includes("<"), "摘要里不该有标签");
});

test("错误正文的五种写法都能挑出那句话", () => {
	assert.equal(messageFromBody(JSON.stringify({ error: { message: "上游繁忙" } })), "上游繁忙");
	assert.equal(messageFromBody(JSON.stringify({ message: "上游繁忙" })), "上游繁忙");
	assert.equal(messageFromBody(JSON.stringify({ detail: "上游繁忙" })), "上游繁忙");
	assert.equal(messageFromBody(JSON.stringify({ error: "上游繁忙" })), "上游繁忙");
	assert.equal(messageFromBody(JSON.stringify({ data: { error: { reason: "上游繁忙" } } })), "上游繁忙");
	assert.equal(messageFromBody("上游繁忙"), "上游繁忙");
	assert.equal(messageFromBody("<html>502</html>"), "");
});

test("服务器说的等待时间，头和正文两处都认", () => {
	assert.equal(serverDelayMs("2"), 2000);
	assert.equal(serverDelayMs(null, JSON.stringify({ error: { reset_seconds: 54 } })), 54_000);
	assert.equal(serverDelayMs(null, JSON.stringify({ reset_time: "53s" })), 53_000);
	assert.equal(serverDelayMs(null, JSON.stringify({ retry_after_ms: 1500 })), 1500);
	assert.equal(serverDelayMs(null, JSON.stringify({ model: "gpt-4o-2024" })), undefined, "模型名里的数字不是等待时间");
});

test("同一个错误的指纹一样，不同的不一样", () => {
	const first = classifyFailure({ from: "stream", message: "upstream busy (request 8f2a1b)" });
	const second = classifyFailure({ from: "stream", message: "upstream busy (request c93d4e)" });
	// 每条都带着不同的请求 id，归一化掉才认得出「还是刚才那个错误」。
	assert.equal(first.fingerprint, second.fingerprint);

	const other = classifyFailure({ from: "stream", message: "model overloaded" });
	assert.notEqual(first.fingerprint, other.fingerprint);
});

/**
 * 状态码耗尽的重试，不会被另一类的额度接着养下去。
 *
 * 这是改动过程中真出过的一个死循环，而且是默认配置就会撞上的：`fetchWithRetry` 把判好的
 * `FailureError` 抛在自己的 `try` 里，被自己的 `catch` 接住，那里查的是 network 预算——默认无限。
 * 一个 upstream 额度早已用尽的 503 于是永远重试下去，`retry-policy.test.ts` 整个文件挂住，一条都
 * 跑不出来，看起来像是测试框架坏了。
 */
test("upstream 用尽就停，不会被 network 的无限额度接着重试", async () => {
	let calls = 0;
	const budget = new RetryBudget({
		network: { retries: null, strategy: "fixed", intervalMs: 1000, maxIntervalMs: 1000 },
		upstream: { retries: 2, strategy: "fixed", intervalMs: 1000, maxIntervalMs: 1000 },
	});
	await assert.rejects(
		fetchWithRetry(
			async () => {
				calls++;
				return new Response("busy", { status: 503 });
			},
			"https://example.test",
			{},
			{ budget, sleep: async () => {} },
		),
	);
	// 首次 + 两次重试，然后停下——而不是转到天荒地老。
	assert.equal(calls, 3);
});

test("花过钱的失败标出来，没花的不标", () => {
	// 流已经吐了字，说明请求被受理了——那些 token 服务商已经收过钱。
	assert.equal(classifyFailure({ from: "stream", message: "boom", spent: true }).costIncurred, true);
	assert.equal(classifyFailure({ from: "stream", message: "boom" }).costIncurred, undefined);
	assert.equal(transport("ECONNRESET").costIncurred, undefined);
});
