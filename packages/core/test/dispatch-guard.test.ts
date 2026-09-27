/**
 * The three limits on delegation.
 *
 * Each of these failures is expensive and quiet: twelve parallel dispatches, a cycle, or a tree
 * that keeps going down all look like the system working hard right up until the bill.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
	childDispatch,
	concurrencyNote,
	DispatchCancelled,
	DispatchGate,
	refuseDispatch,
	rootDispatch,
	DEFAULT_MAX_DEPTH,
} from "../src/runtime/dispatch-guard.ts";

test("the main conversation may dispatch", () => {
	assert.equal(refuseDispatch(rootDispatch(), "explore"), undefined);
});

test("a sub-agent may dispatch once, and not past the depth limit", () => {
	const first = childDispatch(rootDispatch(), "explore");
	assert.equal(refuseDispatch(first, "review"), undefined, "depth 1 is still inside the default limit of 2");

	const second = childDispatch(first, "review");
	const refusal = refuseDispatch(second, "general");
	assert.ok(refusal, "depth 2 is the limit");
	assert.match(refusal, /上限是 2/, "the message names the limit rather than only saying no");
	assert.match(refusal, /自己做完/, "and says what to do instead");
});

test("the depth limit is configurable", () => {
	const one = childDispatch(rootDispatch(), "explore");
	assert.ok(refuseDispatch(one, "review", { maxDepth: 1 }));
	assert.equal(refuseDispatch(one, "review", { maxDepth: 3 }), undefined);
});

test("an agent cannot appear twice in one chain", () => {
	/*
	 * `explore → reviewer → explore` is a prompt written wrong rather than a plan, and it spends
	 * money at a rate that makes failing loudly the kind option.
	 */
	const chain = childDispatch(childDispatch(rootDispatch(), "explore"), "reviewer");
	const refusal = refuseDispatch(chain, "explore", { maxDepth: 5 });
	assert.ok(refusal);
	assert.match(refusal, /explore → reviewer → explore/, "the message shows the cycle it found");
});

test("a sibling of the same name at a different point in the tree is fine", () => {
	/*
	 * Two branches each dispatching `explore` is ordinary fan-out. Only a repeat *within one chain*
	 * is a cycle, and a check that looked at the whole tree would forbid the common case.
	 */
	const left = childDispatch(rootDispatch(), "explore");
	const right = childDispatch(rootDispatch(), "review");
	assert.equal(refuseDispatch(right, "explore"), undefined);
	assert.equal(left.chain.length, 1);
});

test("the gate runs up to the limit at once and queues the rest", async () => {
	const gate = new DispatchGate(2);
	const order: string[] = [];
	const release: (() => void)[] = [];

	const start = (name: string) =>
		gate.run(async () => {
			order.push(`start:${name}`);
			await new Promise<void>((resolve) => release.push(resolve));
			order.push(`end:${name}`);
		});

	const a = start("a");
	const b = start("b");
	const c = start("c");
	await new Promise((r) => setTimeout(r, 0));

	assert.deepEqual(order, ["start:a", "start:b"], "the third waited");
	assert.equal(gate.running, 2);
	assert.equal(gate.queued, 1);

	release.shift()!();
	await a;
	await new Promise((r) => setTimeout(r, 0));
	assert.ok(order.includes("start:c"), "finishing one lets the queued one in");

	release.forEach((fn) => fn());
	await Promise.all([b, c]);
	assert.equal(gate.running, 0);
});

test("a throw releases the slot", async () => {
	const gate = new DispatchGate(1);
	await assert.rejects(() =>
		gate.run(async () => {
			throw new Error("boom");
		}),
	);
	assert.equal(gate.running, 0, "a failed dispatch must not permanently consume a slot");
	await gate.run(async () => {});
});

test("the prompt note states the number, because a queue is invisible from inside", () => {
	const note = concurrencyNote(4, DEFAULT_MAX_DEPTH);
	assert.match(note, /最多 4 个子代理同时跑/);
	assert.match(note, /自动排队/, "it says the queue is the gate's job, not the model's");
});

test("并发说明叫模型一起派，而不是一轮只派一个——闸门开到 1 的时候尤其", () => {
	/*
	 * 从前这句是「一次派超过 N 个只会让结果更晚到」。闸门开到 1 时，模型读到的是「一次只派一个」：
	 * 四个审查子代理被排成一串，每两个之间隔一整轮主模型的请求（2026-09-26 的真实会话）。
	 */
	const note = concurrencyNote(1, DEFAULT_MAX_DEPTH);
	assert.match(note, /同一条回复里一起派/);
	assert.match(note, /别为了等前一个的结果而一轮只派一个/);
	assert.ok(!/更晚到|不会更快/.test(note), `不再劝它少派：${note}`);
});

test("排着的时候被叫停，当场离队——之后前面的跑完，它也不会被放进来", async () => {
	/*
	 * 从前闸门听不到停止：整轮被停的时候，排在后面的那几个会在前面的跑完之后照样被放进来，对着
	 * 一个已经停下的会话开跑。
	 */
	const gate = new DispatchGate(1);
	const holding = await gate.acquire();
	const stop = new AbortController();
	const waiting = gate.acquire(stop.signal);
	assert.equal(gate.queued, 1);
	stop.abort("stopped");
	await assert.rejects(waiting, (error: unknown) => error instanceof DispatchCancelled && error.reason === "stopped");
	assert.equal(gate.queued, 0, "离队了");

	holding();
	assert.equal(gate.running, 0, "前面的跑完，名额空着，没有人被放进来");
});

test("已经停下的信号根本排不进去", async () => {
	const gate = new DispatchGate(1);
	await gate.acquire();
	const stop = new AbortController();
	stop.abort();
	await assert.rejects(gate.acquire(stop.signal), DispatchCancelled);
	assert.equal(gate.queued, 0);
});

test("名额还两次也只算一次", async () => {
	const gate = new DispatchGate(2);
	const release = await gate.acquire();
	await gate.acquire();
	release();
	release();
	assert.equal(gate.running, 1, "多还的那一次不该凭空多出一个空位");
});

test("派生里的派生：先让出自己的名额，孩子排不上时照样能被叫停", async () => {
	const gate = new DispatchGate(1);
	const parent = await gate.acquire();
	const child = await gate.acquireNested();
	assert.equal(gate.running, 1, "父亲让出来的那个位置给了孩子");
	child();
	assert.equal(gate.running, 1, "孩子还回去，父亲把自己的位置拿回来");
	parent();
	assert.equal(gate.running, 0);

	// 宽度中途收窄，让出自己的那一个之后仍然超额——孩子得排队；排着被停，父亲的位置照样拿回来。
	const wide = new DispatchGate(2);
	const a = await wide.acquire();
	const b = await wide.acquire();
	wide.setLimit(1);
	const stop = new AbortController();
	const queued = wide.acquireNested(stop.signal);
	assert.equal(wide.queued, 1, "孩子在排队");
	stop.abort();
	await assert.rejects(queued, DispatchCancelled);
	assert.equal(wide.running, 2, "父亲那一个没有丢");
	a();
	b();
	assert.equal(wide.running, 0);
});
