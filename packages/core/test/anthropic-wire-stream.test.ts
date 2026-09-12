/**
 * Anthropic Messages 链上的 SSE 空闲闸。
 *
 * `readSse` 只接一个 AbortSignal，没有计时器：上游把连接挂住不再发帧时，那个 `await reader.read()` 就
 * 一直等下去，界面上是一个永远转着的圈，用户只能按停。这一组守两件事——正常流一个字节都不受影响，挂死
 * 的流会被抓出来而且**不会被当成「模型没话说」**。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readSseWithIdleTimeout } from "../src/utils/sse.ts";

/** 一段真形状的 Anthropic SSE。事件名和字段都照着真的来，因为解析器认的就是这些。 */
const FRAMES = [
	'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_01XY","usage":{"input_tokens":31,"output_tokens":1}}}\n\n',
	'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
	'event: ping\ndata: {"type":"ping"}\n\n',
	'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"好"}}\n\n',
	'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
	'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":4}}\n\n',
	'event: message_stop\ndata: {"type":"message_stop"}\n\n',
];

/** 一个照着给的片段吐字节的 Response；`stall` 之后那个片段永远不来。 */
function sseResponse(chunks: string[], options: { stallAfter?: number } = {}): Response {
	const encoder = new TextEncoder();
	let at = 0;
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (options.stallAfter !== undefined && at >= options.stallAfter) {
				// 挂住：既不 close 也不 enqueue。真实的挂死连接就是这样。
				await new Promise<never>(() => {});
				return;
			}
			if (at >= chunks.length) {
				controller.close();
				return;
			}
			controller.enqueue(encoder.encode(chunks[at++]));
		},
	});
	return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

test("正常流一帧不少，闸没被误触", async () => {
	const idle = { tripped: false };
	const seen: string[] = [];
	for await (const frame of readSseWithIdleTimeout(sseResponse(FRAMES), undefined, 60_000, idle)) {
		seen.push(String(JSON.parse(frame.data).type));
	}
	assert.deepEqual(seen, ["message_start", "content_block_start", "ping", "content_block_delta", "content_block_stop", "message_delta", "message_stop"]);
	assert.equal(idle.tripped, false);
});

// 带超时：闸要是坏了，这一条会**永远**挂着（`node --test` 默认不给超时），那样坏掉的是整套测试而不是
// 这一条。红验证过：把闸拿掉之后这里报 `test timed out`。
test("挂死的流被闸掉，而且闸掉这件事写下来了", { timeout: 5_000 }, async () => {
	/*
	 * 这条是整个缺口的要点：`readSse` 收到 abort 之后走 `reader.cancel()`，那个生成器**正常结束**而不
	 * 是抛。所以光看「循环结束了」分不出「流完了」和「流挂死了」——一个截断的回答会被当成完整的。
	 */
	const idle = { tripped: false };
	const seen: string[] = [];
	for await (const frame of readSseWithIdleTimeout(sseResponse(FRAMES, { stallAfter: 3 }), undefined, 25, idle)) {
		seen.push(String(JSON.parse(frame.data).type));
	}
	assert.deepEqual(seen, ["message_start", "content_block_start", "ping"]);
	assert.equal(idle.tripped, true, "不写下来的话，上面那层会把它当成「模型没话说」");
});

test("每收到一帧就把计时拨回去——慢但一直在动的流不该被闸掉", { timeout: 5_000 }, async () => {
	const encoder = new TextEncoder();
	let at = 0;
	const body = new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (at >= FRAMES.length) {
				controller.close();
				return;
			}
			// 每一帧之间都等掉大半个阈值。不拨回去的话第二帧就超时了。
			await new Promise((resolve) => setTimeout(resolve, 18));
			controller.enqueue(encoder.encode(FRAMES[at++]));
		},
	});
	const idle = { tripped: false };
	let count = 0;
	for await (const _frame of readSseWithIdleTimeout(new Response(body, { status: 200 }), undefined, 40, idle)) count++;
	assert.equal(count, FRAMES.length);
	assert.equal(idle.tripped, false);
});

test("调用方自己的信号照样能停，而且不会被记成空闲超时", async () => {
	const controller = new AbortController();
	const idle = { tripped: false };
	const seen: string[] = [];
	for await (const frame of readSseWithIdleTimeout(sseResponse(FRAMES, { stallAfter: 2 }), controller.signal, 60_000, idle)) {
		seen.push(String(JSON.parse(frame.data).type));
		if (seen.length === 2) controller.abort();
	}
	assert.deepEqual(seen, ["message_start", "content_block_start"]);
	assert.equal(idle.tripped, false, "用户按停不是「流挂死了」");
});

test("循环提前跳出时计时器被清掉——不然每次失败都漏一个十分钟的计时器", { timeout: 5_000 }, async () => {
	const idle = { tripped: false };
	const frames = readSseWithIdleTimeout(sseResponse(FRAMES, { stallAfter: 4 }), undefined, 20, idle);
	for await (const _frame of frames) break;
	// `for await` 提前跳出会调生成器的 `.return()`，`finally` 里的 clearTimeout 必须跑到。等过阈值再看：
	// 计时器要是还活着，这里就会被置位。
	await new Promise((resolve) => setTimeout(resolve, 60));
	assert.equal(idle.tripped, false);
});
