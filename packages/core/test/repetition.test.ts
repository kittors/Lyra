/**
 * Noticing a turn that has stopped learning anything.
 *
 * The line between "working" and "stuck" is whether the world changed: the same call with the same
 * arguments returning the same answer teaches nothing, however many times it is made.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { INTENT_WARN, PROBE_STOP, PROBE_WARN, RepetitionWatch, REPEAT_STOP, REPEAT_WARN } from "../src/agent/repetition.ts";
import type { Message } from "../src/types.ts";

const result = (text: string): Message =>
	({ role: "toolResult", toolCallId: "c", content: [{ type: "text", text }], timestamp: 1 }) as Message;

const call = (name: string, args: unknown) => [{ name, arguments: args }];

test("different results past the old 400-character sample are not identical", () => {
	const watch = new RepetitionWatch();
	for (let i = 0; i < REPEAT_STOP + 1; i++) {
		assert.equal(watch.observe(call("read", { path: "log" }), [result("x".repeat(500) + i)]).worst, 1);
	}
	assert.equal(watch.exhausted(), false);
});

test("a successful edit resets stale observations while failed writes do not", () => {
	const watch = new RepetitionWatch();
	for (let i = 0; i < REPEAT_WARN; i++) watch.observe(call("read", { path: "a" }), [result("same")]);
	const failed = result("denied");
	if (failed.role === "toolResult") failed.isError = true;
	watch.observe(call("write", { path: "a" }), [failed]);
	assert.equal(watch.observe(call("read", { path: "a" }), [result("same")]).worst, REPEAT_WARN + 1);
	watch.observe(call("edit", { path: "a" }), [result("edited")]);
	assert.equal(watch.observe(call("read", { path: "a" }), [result("same")]).worst, 1);
});

test("the same call with the same answer is what counts as repetition", () => {
	const watch = new RepetitionWatch();
	for (let i = 1; i < REPEAT_WARN; i++) {
		assert.equal(watch.observe(call("bash", { command: "ls" }), [result("a.txt")]).warn, null, "not yet");
	}
	assert.equal(watch.observe(call("bash", { command: "ls" }), [result("a.txt")]).warn, "bash", "said once");
	assert.equal(watch.observe(call("bash", { command: "ls" }), [result("a.txt")]).warn, null, "and only once");
});

test("a call whose answer changed is progress, not repetition", () => {
	const watch = new RepetitionWatch();
	for (let i = 0; i < REPEAT_STOP + 3; i++) {
		watch.observe(call("bash", { command: "npm test" }), [result(`run ${i}: still failing`)]);
	}
	// 每一次的答案都不一样，所以每一次都是新指纹——纠正不该落到它头上。
	const round = watch.observe(call("bash", { command: "npm test" }), [result("run last: still failing")]);
	assert.deepEqual(round.repeats, [1], "the world kept changing, so it kept learning");
});

test("argument order does not disguise an identical call", () => {
	const watch = new RepetitionWatch();
	watch.observe(call("read", { path: "a", limit: 3 }), [result("x")]);
	watch.observe(call("read", { limit: 3, path: "a" }), [result("x")]);
	assert.equal(watch.observe(call("read", { path: "a", limit: 3 }), [result("x")]).worst, 3);
});

test("alternating between two useless probes is still stuck", () => {
	const watch = new RepetitionWatch();
	for (let i = 0; i < REPEAT_STOP; i++) {
		watch.observe(call("bash", { command: "check a" }), [result("same")]);
		watch.observe(call("bash", { command: "check b" }), [result("same")]);
	}
	/*
	 * 两个都攒够了纠正线——按「连续」计数会在每次交替时清零，什么也发现不了。
	 *
	 * 攒够之后不再停这一轮（那条路 2026-09-16 去掉了），而是让调用方把那份一模一样的结果换成一句
	 * 「这是第 N 次」。见 `agent/loop.ts` 里用 `repeats` 的那一段。
	 */
	const a = watch.observe(call("bash", { command: "check a" }), [result("same")]);
	assert.ok(a.repeats[0] > REPEAT_WARN, `第 ${a.repeats[0]} 次，早该纠正了`);
	const b = watch.observe(call("bash", { command: "check b" }), [result("same")]);
	assert.ok(b.repeats[0] > REPEAT_WARN, "交替的那一个也一样");
});

test("being told and carrying on anyway is corrected, not cut off", () => {
	/*
	 * 这条原来断言的是「说过一次还照做，就结束这一轮」。2026-09-16 改掉了。
	 *
	 * 停下来解决不了任何问题：它既没告诉模型该怎么办，也没把等结果的人放出来，只是把一次卡住变成一次
	 * 中断。现在攒到第三次起，调用方会把那份一字不差的结果换成一句「这是第 N 次，它不会因为你再问一次
	 * 就改变」——信息更具体，而且同一份内容不用付第二遍钱。
	 */
	const watch = new RepetitionWatch();
	let last = 0;
	for (let i = 0; i < REPEAT_STOP + 6; i++) {
		last = watch.observe(call("browser_act", { action: "eval" }), [result("no cap")]).repeats[0];
	}
	assert.equal(last, REPEAT_STOP + 6, "问多少次就数多少次，不设上限——数到哪都不会结束这一轮");
	assert.ok(last > REPEAT_WARN, "而且早就过了该纠正的那条线");
});

/*
 * The shape the exact fingerprint cannot see.
 *
 * A real session paged one query 37 times without ever tripping the watch, because both halves of
 * the fingerprint moved on every call: the arguments carried a fresh `offset`, and the answer
 * carried a hit count that was itself growing. Every round looked new. None of them were.
 */
test("paging the same question over and over is noticed, though no two calls are identical", () => {
	const watch = new RepetitionWatch();
	let reported: { warn: string | null; kind?: string } | null = null;

	for (let i = 0; i < INTENT_WARN; i++) {
		// Arguments differ every time, and so does the answer — exactly the case that used to slip through.
		const round = watch.observe(call("recall", { query: "彻底", offset: i * 2 }), [result(`${26 + i * 2} matches in this session`)]);
		if (round.warn) reported = round;
	}

	assert.equal(reported?.warn, "recall", "the question was the same one every time");
	assert.equal(reported?.kind, "intent", "and it is reported as paging, not as an identical call");
});

test("noticing a page-walk does not end the turn", () => {
	const watch = new RepetitionWatch();
	for (let i = 0; i < INTENT_WARN * 3; i++) {
		watch.observe(call("recall", { query: "彻底", offset: i }), [result(`answer ${i}`)]);
	}
	/*
	 * A soft signal earns a sentence, not a stop. This watch cannot tell a useless walk from a real
	 * one, and a watchdog that cuts off a legitimate read of a long file is a watchdog that gets
	 * switched off.
	 */
	// 这条线连一句纠正都不换，只说一次——它分不清无用的翻页和真的在翻一个长东西。
	assert.ok(true);
});

test("honest paging through a long file is not mistaken for a loop", () => {
	const watch = new RepetitionWatch();
	for (let i = 0; i < INTENT_WARN - 1; i++) {
		const round = watch.observe(call("read", { path: "big.ts", offset: i * 100, limit: 100 }), [result(`lines ${i * 100}…`)]);
		assert.equal(round.warn, null, `reading page ${i} of a long file is work, not repetition`);
	}
});

test("an exact repeat is still reported as itself, not as a page-walk", () => {
	const watch = new RepetitionWatch();
	let reported: { warn: string | null; kind?: string } | null = null;
	for (let i = 0; i < REPEAT_WARN; i++) {
		const round = watch.observe(call("bash", { command: "ls" }), [result("a.txt")]);
		if (round.warn) reported = round;
	}
	assert.equal(reported?.warn, "bash");
	assert.equal(reported?.kind, "exact", "the stronger, more actionable finding wins the round");
});

test("a page-walk is counted even on rounds that reported an exact repeat", () => {
	const watch = new RepetitionWatch();
	/*
	 * The exact line fires first and takes the notice for that round. If the intent line stopped
	 * counting on those rounds, a model alternating between an identical probe and a page-walk
	 * would reset the slower counter forever.
	 */
	for (let i = 0; i < REPEAT_WARN; i++) watch.observe(call("recall", { query: "x", offset: 0 }), [result("same")]);
	let sawIntent = false;
	for (let i = 0; i < INTENT_WARN; i++) {
		const round = watch.observe(call("recall", { query: "x", offset: i + 1 }), [result(`page ${i}`)]);
		if (round.kind === "intent") sawIntent = true;
	}
	assert.equal(sawIntent, true, "the earlier rounds counted toward the same question");
});

test("pixel-measure bash is one family even when the script keeps changing", () => {
	const watch = new RepetitionWatch();
	let reported: { warn: string | null; kind?: string } | null = null;
	for (let i = 0; i < PROBE_WARN; i++) {
		const round = watch.observe(
			call("bash", { command: `python3 -c "import numpy; Image.open('band_${String(i).padStart(2, "0")}.png')"` }),
			[result(`wrote band_${i}.png`)],
		);
		if (round.warn) reported = round;
	}
	assert.equal(reported?.warn, "bash");
	assert.equal(reported?.kind, "probe");
});

test("writing a new measure script does not reset the probe family", () => {
	const watch = new RepetitionWatch();
	const script = "import numpy\nfrom PIL import Image\nImage.open('shot.png')\n";
	for (let i = 0; i < 3; i++) {
		watch.observe(call("write", { path: `/tmp/measure_${i}.py`, content: script }), [result("wrote")]);
	}
	let reported: { kind?: string } | null = null;
	for (let i = 0; i < PROBE_WARN; i++) {
		const round = watch.observe(call("read", { path: `/tmp/band_${String(i).padStart(2, "0")}.png` }), [result("pixels")]);
		if (round.kind === "probe") reported = round;
	}
	assert.equal(reported?.kind, "probe", "the writes were more of the same loop, not progress");
});

test("a real workspace edit still resets probe counts", () => {
	const watch = new RepetitionWatch();
	for (let i = 0; i < PROBE_WARN - 1; i++) {
		watch.observe(call("read", { path: `/tmp/band_${String(i).padStart(2, "0")}.png` }), [result("pixels")]);
	}
	watch.observe(call("edit", { path: "packages/desktop/src/styles/base.css" }), [result("edited")]);
	const next = watch.observe(call("read", { path: "/tmp/band_00.png" }), [result("pixels")]);
	assert.equal(next.warn, null);
	assert.equal(next.kind, undefined);
	assert.equal(watch.exhausted(), false);
});

test("ignored probe corrections end the turn", () => {
	const watch = new RepetitionWatch();
	for (let i = 0; i < PROBE_STOP; i++) {
		watch.observe(call("read", { path: `/tmp/band_${String(i).padStart(2, "0")}.png` }), [result("pixels")]);
	}
	assert.equal(watch.exhausted(), true);
});

test("ordinary image work without measuring is not a probe loop", () => {
	const watch = new RepetitionWatch();
	for (let i = 0; i < PROBE_STOP + 1; i++) {
		watch.observe(call("bash", { command: `ffmpeg -i src.mov frame-${i}.png` }), [result("ok")]);
	}
	assert.equal(watch.exhausted(), false);
});

test("one watch spans a whole continuation chain", async () => {
	// 续跑是拿同一份 config 再调一次 `runAgent`；表建在 config 上，计数才不会在续跑的瞬间归零。
	const { readFile } = await import("node:fs/promises");
	const source = await readFile(new URL("../src/runtime/turn-config.ts", import.meta.url), "utf8");

	assert.match(source, /repetition: new RepetitionWatch\(\)/, "整条续跑链共用一只表");
});
