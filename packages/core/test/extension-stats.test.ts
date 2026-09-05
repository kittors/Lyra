/**
 * 扩展的可观测（10 §7.3）：每个事件的调用次数、错误、超时与 p95，最近一次错误，熔断状态。
 *
 * 宿主以前只知道「调了」和「坏了三次」。设置页要回答的是另一些问题：这个扩展有没有被够到、
 * 每次多慢、上一次是怎么坏的——这些只有在派发那一刻记下来才有。
 *
 * 真 worker，真时间：sleep 的那个处理器 p95 不该低于它睡的时长；从不回话的那个走的是
 * 超时那条路（超时时长是可配置的，测试不用等两秒）。
 */

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { ExtensionHost, percentile } from "../src/extensions/host.ts";
import { FAILURE_LIMIT } from "../src/extensions/types.ts";

let root: string;

async function extension(name: string, manifest: Record<string, unknown>, source: string): Promise<string> {
	const dir = join(root, name);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "extension.json"), JSON.stringify({ name, main: "index.mjs", ...manifest }), "utf8");
	await writeFile(join(dir, "index.mjs"), source, "utf8");
	return dir;
}

before(async () => {
	root = await mkdtemp(join(tmpdir(), "ly-ext-stats-"));
});
after(async () => {
	await rm(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
});

test("percentile: the value that share of the samples fall at or below", () => {
	assert.equal(percentile([], 0.95), null);
	assert.equal(percentile([7], 0.95), 7);
	assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95), 10);
	assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5), 5);
	assert.equal(percentile([10, 1, 5], 0.95), 10, "unsorted input, still the top");
});

test("每个订阅的事件一行：调用次数、错误、p95，和最近一次错误", async () => {
	const dir = await extension(
		"probe",
		{ version: "0.1.0", description: "看着工具调用", events: ["tool_call", "tool_result", "turn_end"], intercepts: true },
		`export default {
			tool_call: async () => { await new Promise((r) => setTimeout(r, 8)); return {}; },
			tool_result: async () => { throw new Error("boom"); },
		};`,
	);
	const host = new ExtensionHost();
	assert.equal(await host.load(dir), true);

	for (let i = 0; i < 3; i++) await host.dispatch("tool_call", {});
	await host.dispatch("tool_result", {});

	const [stats] = host.stats();
	assert.equal(stats.name, "probe");
	assert.equal(stats.version, "0.1.0");
	assert.equal(stats.intercepts, true);
	assert.equal(stats.state, "running");
	assert.deepEqual(stats.events, ["tool_call", "tool_result", "turn_end"]);

	const byEvent = Object.fromEntries(stats.perEvent.map((row) => [row.event, row]));
	assert.equal(byEvent.tool_call.calls, 3);
	assert.equal(byEvent.tool_call.errors, 0);
	assert.ok((byEvent.tool_call.p95Ms ?? 0) >= 8, `the handler slept 8ms; p95 was ${byEvent.tool_call.p95Ms}`);
	assert.equal(byEvent.tool_result.calls, 1);
	assert.equal(byEvent.tool_result.errors, 1, "a thrown error is an error, not a timeout");
	assert.equal(byEvent.tool_result.timeouts, 0);
	assert.deepEqual(
		{ calls: byEvent.turn_end.calls, p95Ms: byEvent.turn_end.p95Ms },
		{ calls: 0, p95Ms: null },
		"an event it asked for and never got is a row with zeros, not a missing row",
	);
	assert.equal(stats.failures, 1);
	assert.equal(stats.lastError?.event, "tool_result");
	assert.equal(stats.lastError?.message, "boom");
	await host.dispose();
});

test("从不回话的处理器算超时，超过上限后状态是「已熔断」", async () => {
	const dir = await extension("hang", { events: ["tool_call"] }, "export default { tool_call: () => new Promise(() => {}) };");
	const host = new ExtensionHost({ timeoutMs: 40 });
	assert.equal(await host.load(dir), true);

	for (let i = 0; i < FAILURE_LIMIT; i++) await host.dispatch("tool_call", {});

	const [stats] = host.stats();
	const row = stats.perEvent.find((r) => r.event === "tool_call");
	assert.equal(row?.calls, FAILURE_LIMIT);
	assert.equal(row?.timeouts, FAILURE_LIMIT, "each one waited the whole budget and got nothing");
	assert.equal(row?.errors, 0, "a timeout is not an error reply");
	assert.ok((row?.p95Ms ?? 0) >= 40, `p95 is at least the budget: ${row?.p95Ms}`);
	assert.equal(stats.state, "tripped");
	assert.equal(stats.failures, FAILURE_LIMIT);
	assert.equal(stats.lastError?.message, "timeout");

	// Tripped means not called: another dispatch changes nothing.
	await host.dispatch("tool_call", {});
	assert.equal(host.stats()[0].perEvent[0].calls, FAILURE_LIMIT, "the breaker keeps the count where it stopped");
	await host.dispose();
});
