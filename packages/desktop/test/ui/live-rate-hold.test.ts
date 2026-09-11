/**
 * 实时速度在一个完整回合里的行为：**留在那里，直到被走过去替换**。
 *
 * 这一层是纯函数测不到的。`live-rate.ts` 里的那些函数只知道一个窗口，而这里要验的是跨越好几段状态的
 * 连续性——首 token 的等待、正在写、工具在跑、第二条消息又开始写。那是 hook 的记忆，不是窗口的。
 *
 * 时间是喂进去的，不是等来的：真窗口里跑一遍这个形状要半分钟，而这里把同一串采样按 250ms 的节奏喂过去，
 * 二十毫秒就走完了。动画关掉（`reduceMotion`），于是每一帧读到的就是读数本身，而不是它走到哪儿了。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { useLiveRate } from "../../src/features/conversation/useLiveRate.ts";
import { mount, type Mounted } from "../helpers/mount.ts";

function Probe({ chars, now, startedAt }: { chars: number; now: number; startedAt: number | null }) {
	return h("output", {}, useLiveRate(chars, now, startedAt).toFixed(1));
}

/** 采样的节奏，和 `RunningIndicator` 里那个 `setInterval` 一样。 */
const TICK = 250;

/** 100 tok/s 和 50 tok/s 换算成字符每毫秒——`estimateTokens` 是 3.5 字符一个 token。 */
const FAST = (100 * 3.5) / 1000;
const SLOW = (50 * 3.5) / 1000;

/** 按 250ms 一拍推进时钟，每一拍的字数由 `charsAt` 说。返回途中读到的所有值。 */
async function advance(
	view: Mounted,
	from: number,
	to: number,
	charsAt: (at: number) => number,
	startedAt: number,
): Promise<number[]> {
	const seen: number[] = [];
	for (let at = from + TICK; at <= to; at += TICK) {
		await view.rerender(h(Probe, { chars: charsAt(at), now: at, startedAt }));
		seen.push(Number(view.text()));
	}
	return seen;
}

test("读数跨过首 token 的等待和工具执行一直挂着，被新的一段走过去替换", async () => {
	document.documentElement.dataset.reduceMotion = "on";
	const view = await mount(h(Probe, { chars: 0, now: 0, startedAt: 1 }));
	try {
		// ① 首 token 3 秒：请求在路上，一个字都没有。此时一个 `0.0 tok/s` 会让人以为卡住了。
		const waiting = await advance(view, 0, 3000, () => 0, 1);
		assert.deepEqual(
			[...new Set(waiting)],
			[0],
			"还没有字产出的时候不该有读数",
		);

		// ② SSE 写 10 秒，100 tok/s。
		const first = await advance(view, 3000, 13_000, (at) => Math.round((at - 3000) * FAST), 1);
		const appeared = first.filter((v) => v > 0);
		assert.ok(appeared.length > 0, "写起来就该有读数");
		assert.ok(
			Math.abs(appeared[0] - 100) < 3,
			`第一个读数就该是真实速度，而不是从 0.3 爬上去——得到 ${appeared[0]}`,
		);
		const writing = first[first.length - 1];
		assert.ok(Math.abs(writing - 100) < 2, `写的时候该报 100 tok/s，得到 ${writing}`);

		// ③ 工具跑 8 秒：这一条消息已经落定，`liveChars` 归零。读数该**留着**，不是消失。
		const duringTool = await advance(view, 13_000, 21_000, () => 0, 1);
		assert.deepEqual(
			[...new Set(duringTool.map((v) => v.toFixed(1)))],
			[writing.toFixed(1)],
			"工具跑着的时候读数该一动不动地挂在那里，一次都不该闪",
		);

		// ④ 第二条消息：首 token 又等 4 秒，然后以 50 tok/s 写 10 秒。
		const secondTtft = await advance(view, 21_000, 25_000, () => 0, 1);
		assert.deepEqual(
			[...new Set(secondTtft.map((v) => v.toFixed(1)))],
			[writing.toFixed(1)],
			"第二次等首 token 期间同样该保持",
		);

		const second = await advance(view, 25_000, 35_000, (at) => Math.round((at - 25_000) * SLOW), 1);
		/*
		 * 这一条是整个修复的核心断言。
		 *
		 * 剪掉窗口开头那段空转之前，重新开口的第一个采样会拿「刚写的几十个字」去除「4 秒的窗口宽度」，
		 * 算出个位数——而且时距够长、增量为正，它跨过可信门槛，把 100 换成了 3.1。屏幕上就是
		 * `100 → 3.1 → 一路爬回 50`，先掉进坑再爬出来。
		 *
		 * 从 100 走到 50 是单调下行的，中间不该出现任何低于 50 的值。
		 */
		const dip = Math.min(...second);
		assert.ok(dip > 45, `从 100 换到 50 的路上不该掉进坑，最低读到 ${dip.toFixed(1)}`);
		const settled = second[second.length - 1];
		assert.ok(Math.abs(settled - 50) < 2, `第二段该报 50 tok/s，得到 ${settled}`);
	} finally {
		await view.unmount();
		delete document.documentElement.dataset.reduceMotion;
	}
});

test("换一轮从头来过——上一轮写得多快是上一轮的事", async () => {
	document.documentElement.dataset.reduceMotion = "on";
	const view = await mount(h(Probe, { chars: 0, now: 0, startedAt: 1 }));
	try {
		await advance(view, 0, 4000, (at) => Math.round(at * FAST), 1);
		assert.ok(Number(view.text()) > 50, "先攒出一个读数");

		// 新回合：`turnStartedAt` 变了。
		await view.rerender(h(Probe, { chars: 0, now: 4250, startedAt: 2 }));
		assert.equal(view.text(), "0.0", "新回合不该挂着上一轮的成绩");

		// 而且新窗口不受上一轮采样影响：以一半的速度写，读到的就该是一半。
		const fresh = await advance(view, 4250, 10_000, (at) => Math.round((at - 4250) * SLOW), 2);
		const settled = fresh[fresh.length - 1];
		assert.ok(Math.abs(settled - 50) < 2, `该是 50 tok/s，得到 ${settled}`);
	} finally {
		await view.unmount();
		delete document.documentElement.dataset.reduceMotion;
	}
});

test("回合从头到尾都在跑工具，一个字没产出——那就一直没有读数", async () => {
	// 「保持」不等于「凭空造一个」。没发生过的事不该有数字。
	document.documentElement.dataset.reduceMotion = "on";
	const view = await mount(h(Probe, { chars: 0, now: 0, startedAt: 1 }));
	try {
		const seen = await advance(view, 0, 30_000, () => 0, 1);
		assert.deepEqual([...new Set(seen)], [0]);
	} finally {
		await view.unmount();
		delete document.documentElement.dataset.reduceMotion;
	}
});

test("心跳和流式增量交错到达时，读数照样出得来——这是真窗口的节奏", async () => {
	/*
	 * 上面那些测试每次 rerender 都把 `chars` 和 `now` 一起往前推，那是写测试时脑子里的形状。真窗口里不是：
	 * `now` 来自 250ms 的心跳，`chars` 来自 store 的流式增量，两者各自触发一次渲染，交错前进。
	 *
	 * 这个区别曾经让整件事彻底失效——所有「成对前进」的测试全绿，而真窗口里 48 次读数一个速度都没出现。
	 * 所以这一条按交错的顺序驱动，一次只动一个。
	 */
	document.documentElement.dataset.reduceMotion = "on";
	const view = await mount(h(Probe, { chars: 0, now: 0, startedAt: 1 }));
	try {
		const events: { at: number; tick: boolean }[] = [];
		for (let at = 0; at <= 6000; at += TICK) events.push({ at, tick: true });
		for (let at = 0; at <= 6000; at += 60) events.push({ at, tick: false });
		events.sort((a, b) => a.at - b.at || (a.tick ? -1 : 1));

		let chars = 0;
		let now = 0;
		const seen: number[] = [];
		for (const event of events) {
			if (event.tick) now = event.at;
			else chars += Math.round(60 * FAST); // 100 tok/s
			await view.rerender(h(Probe, { chars, now, startedAt: 1 }));
			seen.push(Number(view.text()));
		}

		const appeared = seen.filter((v) => v > 0);
		assert.ok(appeared.length > 0, "交错节奏下读数一次都没出现——窗口被心跳剪光了");
		const settled = seen[seen.length - 1];
		assert.ok(settled > 85 && settled < 105, `真实 100 tok/s，显示 ${settled}`);
	} finally {
		await view.unmount();
		delete document.documentElement.dataset.reduceMotion;
	}
});
