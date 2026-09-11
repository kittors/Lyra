/**
 * 实时速度：窗口怎么收采样、怎么算出 tok/s。
 *
 * 这一块全是纯函数，所以每一种情况都能在这里走到——包括那些在真窗口里要等二十分钟才碰得上一次的：
 * 工具跑了很久、模型换了一条消息、时钟没有前进、回合结束。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { pushSample, rateFrom, SETTLE_MS, trustworthy, WINDOW_MS, type RateSample } from "../src/features/conversation/live-rate.ts";

/** 按 (时刻, 字数) 依次喂进去，返回最终的窗口。 */
function feed(pairs: [number, number][]): RateSample[] {
	let samples: RateSample[] = [];
	for (const [at, chars] of pairs) samples = pushSample(samples, at, chars);
	return samples;
}

// ---------------------------------------------------------------------------
// 还没有速度可言的那些时刻
// ---------------------------------------------------------------------------

test("一个采样都没有时，速度是 0 而不是别的什么", () => {
	assert.equal(rateFrom([]), 0);
});

test("只有一个采样时也是 0——两点之间才有速度", () => {
	assert.equal(rateFrom(feed([[1000, 350]])), 0);
});

test("字数没长，速度就是 0", () => {
	// 工具跑了四秒，一个字都没产出。此刻报「0.0 tok/s」是实话，但界面上不显示它——见组件里的门槛。
	assert.equal(rateFrom(feed([[1000, 350], [2000, 350], [3000, 350]])), 0);
});

test("时间没走，不会除出无穷大", () => {
	const samples: RateSample[] = [
		{ at: 1000, chars: 100 },
		{ at: 1000, chars: 900 },
	];
	assert.equal(rateFrom(samples), 0);
});

// ---------------------------------------------------------------------------
// 正常写字
// ---------------------------------------------------------------------------

test("按 3.5 字符一个 token 折算，和 core 的估算同一把尺", () => {
	// 两秒写了 700 字 → 200 token → 100 tok/s
	assert.equal(rateFrom(feed([[1000, 0], [3000, 700]])), 100);
});

test("速度是窗口内的平均，不是从回合开头算起", () => {
	/*
	 * 这是这个功能的全部意义所在：一个回合前面停了很久（工具、思考、等待），此刻才开始快写。
	 * 从头平均会被前面那段稀释成一个贴地的数字，而屏幕上它紧挨着一个正在跳的省略号。
	 */
	const slow: [number, number][] = [[0, 0], [60_000, 0]];
	const fast: [number, number][] = [[61_000, 350], [62_000, 1400]];
	const rate = rateFrom(feed([...slow, ...fast]));
	// 最后一秒写了 1050 字 = 300 token，所以应当是几百的量级，而不是被一分钟稀释掉的个位数。
	assert.ok(rate > 100, `窗口内的速度该是三位数，得到 ${rate}`);
});

// ---------------------------------------------------------------------------
// 窗口滑动
// ---------------------------------------------------------------------------

test("窗口内不够两个采样时，往前借一个来凑", () => {
	const samples = feed([
		[0, 0],
		[1000, 350],
		[2000, 700],
		[10_000, 3500],
	]);
	// 10 秒那一刻窗口左端是 6 秒，窗口内只剩它自己一个——一个点算不出速度，所以往前借上一个。
	assert.equal(samples.length, 2, `窗口该只剩跨界的一对，得到 ${JSON.stringify(samples)}`);
	assert.equal(samples[0].at, 2000, "留下的该是刚过期的那一个");
});

test("窗口不会无限长", () => {
	let samples: RateSample[] = [];
	for (let at = 0; at <= 60_000; at += 250) samples = pushSample(samples, at, at);
	const span = samples[samples.length - 1].at - samples[0].at;
	assert.ok(span <= WINDOW_MS + 250, `窗口时距该在 ${WINDOW_MS}ms 上下，得到 ${span}ms`);
	assert.ok(samples.length < 30, `采样条数该有界，得到 ${samples.length}`);
});

// ---------------------------------------------------------------------------
// 换了一条消息 / 回合结束
// ---------------------------------------------------------------------------

test("字数变少说明换了一条消息，整个窗口作废", () => {
	/*
	 * 上一条写到 4000 字，下一条从 12 字开始。两者量的不是同一段文本，减出来的负数没有任何意义——
	 * 而如果不重置，窗口里会同时留着两条消息的采样，算出一个既不属于前者也不属于后者的数。
	 */
	const samples = feed([[1000, 3500], [2000, 4000], [3000, 12]]);
	assert.equal(samples.length, 1, "该从这一刻重新开始");
	assert.equal(samples[0].chars, 12);
	assert.equal(rateFrom(samples), 0, "新消息刚起头时没有速度可言");
});

test("回合结束（字数归零）同样是重新开始", () => {
	const samples = feed([[1000, 3500], [2000, 7000], [3000, 0]]);
	assert.equal(samples.length, 1);
	assert.equal(rateFrom(samples), 0);
});

test("重置之后能重新长起来，不受上一条消息影响", () => {
	let samples = feed([[1000, 10_000], [2000, 20_000]]);
	samples = pushSample(samples, 3000, 0); // 回合结束
	samples = pushSample(samples, 4000, 350); // 新回合开始写
	samples = pushSample(samples, 5000, 1050);
	// 只该看重置之后那两秒的 1050 字（= 300 token），不该沾上前面那两万字。
	assert.equal(Math.round(rateFrom(samples)), 150);
});

// ---------------------------------------------------------------------------
// 时钟的怪脾气
// ---------------------------------------------------------------------------

test("同一毫秒来两次时覆盖而不是追加", () => {
	const samples = feed([[1000, 350], [1000, 700]]);
	assert.equal(samples.length, 1, "零时距的采样会让除法出事，不能留");
	assert.equal(samples[0].chars, 700, "留的该是后到的那个值");
});

test("时钟往回走时也不会留下倒序的采样", () => {
	// 系统时间被调整过，或者两次渲染拿到的 `Date.now()` 顺序反了。
	const samples = feed([[5000, 350], [4000, 700]]);
	assert.equal(samples.length, 1);
	assert.ok(rateFrom(samples) >= 0, "无论如何不能是负数");
});

test("任何输入下速度都不为负", () => {
	const cases: [number, number][][] = [
		[[1000, 700], [2000, 350]],
		[[2000, 350], [1000, 700]],
		[[0, 0], [0, 0]],
		[[1000, -5], [2000, 350]],
	];
	for (const pairs of cases) {
		const rate = rateFrom(feed(pairs));
		assert.ok(rate >= 0 && Number.isFinite(rate), `${JSON.stringify(pairs)} 算出了 ${rate}`);
	}
});

// ---------------------------------------------------------------------------
// 极端但真实的形状
// ---------------------------------------------------------------------------

test("一次性落地一大段（批量返回的宿主）不会算出荒谬的数", () => {
	/*
	 * 有些宿主把整条回复一口气给完，于是两次采样之间凭空多出几千字。窗口至少 250ms，所以它是一个
	 * 很大但有限的数——这里只要求它有限且为正，不假装它有意义。
	 */
	const rate = rateFrom(feed([[1000, 0], [1250, 7000]]));
	assert.ok(Number.isFinite(rate) && rate > 0);
});

test("很慢的写入也能得到一个非零的读数", () => {
	// 四秒写 35 个字 = 10 token → 2.5 tok/s，界面的门槛是 0.05，显示得出来。
	const rate = rateFrom(feed([[0, 0], [4000, 35]]));
	assert.ok(rate > 0.05, `慢速也该显示，得到 ${rate}`);
	assert.equal(Math.round(rate * 10) / 10, 2.5);
});

test("低于显示门槛的极慢写入", () => {
	// 四秒只写了一个字：0.07 token/s，低于 0.05 的另一侧，但仍是正数、仍然有限。
	const rate = rateFrom(feed([[0, 0], [4000, 1]]));
	assert.ok(rate > 0 && rate < 0.1, `得到 ${rate}`);
});

// ---------------------------------------------------------------------------
// 「攒稳了没有」——够不够资格去替换上一个读数
// ---------------------------------------------------------------------------

test("窗口才刚开始攒，说的话还不可信", () => {
	// 250ms 里来了 88 个字，算出来是 100 tok/s，数值本身没错——但这个分母太短，下一帧就可能翻倍。
	const samples = feed([[0, 0], [250, 88]]);
	assert.ok(rateFrom(samples) > 0, "有读数");
	assert.equal(trustworthy(samples), false, "但还不该拿它去替换");
});

test("窗口跨过门槛之后就可信了", () => {
	const samples = feed([[0, 0], [250, 88], [1250, 438]]);
	assert.ok(samples[samples.length - 1].at - samples[0].at >= SETTLE_MS);
	assert.equal(trustworthy(samples), true);
});

test("一个字都没多的窗口永远不可信——零不该去替换任何东西", () => {
	// 工具跑了十秒，字数一动不动。此刻「速度是 0」是实话，但把上一段真实的读数换成 0 是在撒谎。
	let samples: RateSample[] = [];
	for (let at = 0; at <= 10_000; at += 250) samples = pushSample(samples, at, 4000);
	assert.equal(rateFrom(samples), 0);
	assert.equal(trustworthy(samples), false);
});

// ---------------------------------------------------------------------------
// 空转过后重新开口：这里曾经算出一个「可信的」荒谬数字
// ---------------------------------------------------------------------------

test("空转一段再开口，第一个读数不会被那段空转稀释", () => {
	/*
	 * 这是一个真实回合里每几十秒就发生一次的形状，也是这个功能最容易破功的地方。
	 *
	 * 工具跑着的时候字数不动，窗口被同一个数值填满；工具跑完、模型重新开口，第一个新采样落进来。剪掉
	 * 开头那段空转之前，首尾相减是「刚写的那几十个字」，而分母是整整 4 秒的窗口宽度——算出个位数，而且
	 * 时距足够长、增量为正，它会**跨过可信门槛**，理直气壮地把上一段真实的读数替换掉。
	 */
	let samples: RateSample[] = [];
	for (let at = 0; at <= 8000; at += 250) samples = pushSample(samples, at, 0); // 工具期间：八秒没有字
	samples = pushSample(samples, 8250, 88); // 重新开口：250ms 写了 88 个字

	const span = samples[samples.length - 1].at - samples[0].at;
	assert.ok(span <= 300, `窗口该只剩恢复增长那一刻起的一小段，得到 ${span}ms`);
	assert.equal(trustworthy(samples), false, "只有 250ms，还不该拿去替换");
	assert.ok(Math.abs(rateFrom(samples) - 100) < 1, `量级该对得上真实速度，得到 ${rateFrom(samples)}`);
});

test("空转后攒够一秒二，读数是真实速度而不是被稀释的", () => {
	let samples: RateSample[] = [];
	for (let at = 0; at <= 30_000; at += 250) samples = pushSample(samples, at, 0);
	// 恢复输出，350 字/秒 = 100 tok/s。
	for (let at = 30_250; at <= 31_500; at += 250) samples = pushSample(samples, at, Math.round((at - 30_000) * 0.35));

	assert.equal(trustworthy(samples), true);
	const rate = rateFrom(samples);
	assert.ok(Math.abs(rate - 100) < 2, `该是 100 上下，得到 ${rate}——被那三十秒稀释了`);
});

test("输出中途的停顿只剪开头，不剪中间", () => {
	/*
	 * 中间那一拍没长字是流式的常态（SSE 的块不按 250ms 到），它是这段输出真实节奏的一部分，该算进去。
	 * 只有窗口**开头**那段空转是别的事件（工具、首 token）留下的残影，才该剪掉。
	 */
	const samples = feed([[0, 100], [250, 100], [500, 200], [750, 200], [1000, 300], [1250, 400]]);
	assert.equal(samples[0].at, 250, "开头那对同值的，留后面那一个");
	assert.equal(samples.length, 5, "中间的停顿还在窗口里");
});

// ---------------------------------------------------------------------------
// 真窗口的采样节奏：心跳和增量是**交错**到的，不是成对到的
// ---------------------------------------------------------------------------

/**
 * 按组件里实际发生的顺序重放：时钟每 250ms 自己推一拍，流式增量每 60ms 到一次，各自触发一次采样。
 *
 * 上面所有的测试都是「时刻和字数一起前进」——那是写测试时脑子里的形状，不是组件的形状。组件里 `chars` 来自
 * store，`now` 来自 `setInterval`，两者独立变化：心跳那一拍带的是上一次增量留下的**同一个字数**。
 *
 * 这个区别不是细节。第一版的剪裁逻辑在「成对前进」下每一条测试都是绿的，在真窗口里却让读数一次都没出现过
 * ——窗口被每一拍心跳剪成一个采样，时距永远是 0。所以这个形状必须有测试盯着。
 */
function replayInterleaved(ms: number): { window: RateSample[]; rate: number } {
	const events: { at: number; tick: boolean }[] = [];
	for (let at = 0; at <= ms; at += 250) events.push({ at, tick: true });
	for (let at = 0; at <= ms; at += 60) events.push({ at, tick: false });
	events.sort((a, b) => a.at - b.at || (a.tick ? -1 : 1));

	let samples: RateSample[] = [];
	let chars = 0;
	let now = 0;
	for (const event of events) {
		if (event.tick) now = event.at;
		else chars += 21; // 350 字/秒 = 100 tok/s
		samples = pushSample(samples, now, chars);
	}
	return { window: samples, rate: rateFrom(samples) };
}

test("心跳带来的同值采样不会把窗口剪掉——剪到只剩一个就再也长不起来了", () => {
	const { window } = replayInterleaved(6000);
	const span = window[window.length - 1].at - window[0].at;
	assert.ok(window.length >= 2, `窗口至少要留住一个相减的基准，得到 ${window.length} 个`);
	assert.ok(span >= 3000, `六秒的连续输出该攒出接近满窗的时距，得到 ${span}ms`);
});

test("交错节奏下量出来的速度和真实速度同一个量级", () => {
	// 真实是 100 tok/s。已知有约 6% 的系统性低估（见文件头），所以给的区间是 85~105 而不是 99~101。
	const { rate } = replayInterleaved(6000);
	assert.ok(rate > 85 && rate < 105, `真实 100 tok/s，量出 ${rate.toFixed(1)}`);
});

test("交错节奏下能跨过可信门槛", () => {
	// 不只是「算得出一个数」，还得够资格去替换上一个读数——否则屏幕上依然什么都不显示。
	const { window } = replayInterleaved(6000);
	assert.equal(trustworthy(window), true);
});

test("全程没有字产出时，交错节奏也不会造出一个读数", () => {
	let samples: RateSample[] = [];
	let now = 0;
	for (let at = 0; at <= 6000; at += 250) {
		now = at;
		samples = pushSample(samples, now, 0);
	}
	assert.ok(samples.length >= 2, "基准仍在");
	assert.equal(rateFrom(samples), 0);
	assert.equal(trustworthy(samples), false);
});
