/**
 * That failures are restated in the reader's language, and that the ones the system already
 * explains are left to it.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { explain } from "../src/features/toast/explain.ts";

test("the screen-recording refusal is left to macOS's own dialog", () => {
	const result = explain("Failed to get sources.");
	assert.equal(result.silent, true, "系统已经弹了权限对话框，再来一条英文报错只会误导");
	assert.match(result.hint ?? "", /屏幕录制/);
});

test("a provider's 5xx is a sentence, not a wall of JSON", () => {
	const raw = `HTTP 500: {"error":{"message":"Post \\"https://oauth2.googleapis.com/token\\": EOF","type":"server_error","code":"internal_server_error"}}`;
	const result = explain(raw);
	assert.equal(result.message, "模型服务暂时不可用");
	assert.equal(result.silent, undefined, "这条要说，只是说人话");
});

test("errno codes become what they mean", () => {
	assert.equal(explain("Error: ENOENT: no such file or directory, open '/tmp/x'").message, "找不到这个文件或目录");
	assert.equal(explain("EACCES: permission denied").message, "没有权限访问这个文件");
	assert.match(explain("connect ECONNREFUSED 127.0.0.1:8080").message, /连接被拒绝/);
});

test("credentials and rate limits are told apart", () => {
	assert.match(explain("HTTP 401 Unauthorized").message, /凭证/);
	assert.match(explain("HTTP 429 Too Many Requests").message, /限流/);
});

/*
 * The rule that keeps this honest: a wrong translation is worse than none. Anything unrecognised
 * survives verbatim, because the original at least leads somewhere when searched for.
 */
test("anything unrecognised is passed through untouched", () => {
	const odd = "Something nobody has seen before (code 7)";
	assert.equal(explain(odd).message, odd);
	assert.equal(explain(odd).hint, undefined);
});
