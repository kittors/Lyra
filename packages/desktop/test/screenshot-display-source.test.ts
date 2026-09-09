/**
 * 挑对屏幕这件事，在没有屏幕的地方检查。
 *
 * 这些用例是从一份真实的故障里倒推出来的：有人在 Windows 上报「不能跨屏幕截图」，症状是遮罩正确
 * 地盖住了副屏、画面却是主屏的。原因在 Electron 里——Windows 走 GDI 抓屏时 `display_id` 是空串，
 * 而当时的挑选逻辑配不上就退回 `sources[0]`。所以第一条用例就是那台机器：两块屏、两个空串。
 *
 * 挑错屏幕是一类特别难自己发现的故障：画面本身是完好的，比例也对，只是拍的是隔壁那块。手点是点
 * 不出来的——得有两块屏、还得是那种配置。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { pickDisplaySource, type DisplayShape, type ScreenSource } from "../electron/screenshot-displays.ts";

/** 一块 16:10 的笔记本内屏，2× 缩放。 */
const laptop: DisplayShape = { id: 1, bounds: { width: 1470, height: 956 }, scaleFactor: 2 };
/** 一块 16:9 的外接屏，1× 缩放。 */
const external: DisplayShape = { id: 2, bounds: { width: 1920, height: 1080 }, scaleFactor: 1 };

const shot = (id: string, display_id: string, width: number, height: number): ScreenSource => ({
	id,
	display_id,
	size: { width, height },
});

test("display_id 对得上时就用它——macOS 和 Windows-DirectX 的常态", () => {
	const sources = [shot("screen:0:0", "1", 2940, 1912), shot("screen:1:0", "2", 1920, 1080)];
	assert.deepEqual(pickDisplaySource(sources, [laptop, external], 2), { index: 1, how: "display-id" });
	assert.deepEqual(pickDisplaySource(sources, [laptop, external], 1), { index: 0, how: "display-id" });
});

test("Windows 走 GDI 时 display_id 全是空串，仍然挑得对", () => {
	/*
	 * 这就是被报上来的那台机器。两个空串——`""` 配不上任何一个显示器 id，原来的实现在这里退回
	 * `sources[0]`，于是在外接屏上截图拿到的是笔记本屏的画面。
	 */
	const sources = [shot("screen:0:0", "", 2940, 1912), shot("screen:1:0", "", 1920, 1080)];
	const picked = pickDisplaySource(sources, [laptop, external], 2);
	assert.equal(picked?.index, 1, "外接屏要拿到外接屏那张，不是第一张");
	assert.equal(picked?.how, "index");
});

test("空串不算「对上了」：目标 id 是 0 的时候也不能配上空的 display_id", () => {
	/*
	 * `String(0)` 是 `"0"` 而不是 `""`，所以这一条本来就不会误配。留着它是因为反过来的写法很容易
	 * 出现——`display_id || undefined`、`!display_id` 之类——一旦有人图省事那么写，一台 id 为 0
	 * 的机器就会永远配上第一张画面而且看起来是对的。
	 */
	const zero: DisplayShape = { id: 0, bounds: { width: 1920, height: 1080 }, scaleFactor: 1 };
	const sources = [shot("screen:0:0", "", 2940, 1912), shot("screen:1:0", "", 1920, 1080)];
	const picked = pickDisplaySource(sources, [laptop, zero], 0);
	assert.equal(picked?.index, 1);
	assert.notEqual(picked?.how, "display-id");
});

test("屏幕列表和画面列表顺序不一致时，靠形状认出来", () => {
	/*
	 * 位次是个约定而不是保证：Windows 上屏幕列表来自 `EnumDisplayMonitors`，而 GDI 抓屏枚举的是
	 * `EnumDisplayDevices`，两者通常一致、并不担保一致。所以位次那一条要形状点头才算数——点不了
	 * 头就换成「只有它是这个形状」。
	 */
	const sources = [shot("screen:1:0", "", 1920, 1080), shot("screen:0:0", "", 2940, 1912)];
	assert.deepEqual(pickDisplaySource(sources, [laptop, external], 1), { index: 1, how: "shape" });
	assert.deepEqual(pickDisplaySource(sources, [laptop, external], 2), { index: 0, how: "shape" });
});

test("画面被缩到了请求的框里，长宽比还在，照样认得出", () => {
	/*
	 * `getSources` 的 `thumbnailSize` 是所有源共用的：为 1920×1080 的外接屏请求，笔记本那块
	 * 2940×1912 会被按比例缩到框里（1661×1080）。尺寸对不上原生分辨率，长宽比没变——形状这一条
	 * 用的正是长宽比而不是尺寸，就是为了这种情况。
	 */
	const sources = [shot("screen:1:0", "", 1920, 1080), shot("screen:0:0", "", 1661, 1080)];
	assert.deepEqual(pickDisplaySource(sources, [laptop, external], 1), { index: 1, how: "shape" });
});

test("两块一模一样的屏幕：形状分不出来，位次说了算", () => {
	const twinA: DisplayShape = { id: 11, bounds: { width: 1920, height: 1080 }, scaleFactor: 1 };
	const twinB: DisplayShape = { id: 12, bounds: { width: 1920, height: 1080 }, scaleFactor: 1 };
	const sources = [shot("screen:0:0", "", 1920, 1080), shot("screen:1:0", "", 1920, 1080)];
	assert.deepEqual(pickDisplaySource(sources, [twinA, twinB], 12), { index: 1, how: "index" });
});

test("只有一块屏幕时，那张就是全部——不必再问是哪一块", () => {
	const sources = [shot("screen:0:0", "", 2940, 1912)];
	assert.deepEqual(pickDisplaySource(sources, [laptop], 1), { index: 0, how: "only-one" });
	// 连显示器都对不上号也一样：只有一张画面，没有第二个答案。
	assert.deepEqual(pickDisplaySource(sources, [laptop], 999), { index: 0, how: "only-one" });
});

test("数量对不上时不硬套位次，形状还能救回来", () => {
	/*
	 * DXGI 只枚举得到同一块适配器上的输出——双显卡机器上，画面可能比屏幕少。少了那张的位次是错的，
	 * 但形状还在。
	 */
	const sources = [shot("screen:0:0", "", 1920, 1080)];
	const three = [laptop, external, { id: 3, bounds: { width: 2560, height: 1080 }, scaleFactor: 1 }];
	assert.deepEqual(pickDisplaySource(sources, three, 2), { index: 0, how: "only-one" });

	const two = [shot("screen:0:0", "", 2940, 1912), shot("screen:1:0", "", 1920, 1080)];
	assert.deepEqual(pickDisplaySource(two, three, 2), { index: 1, how: "shape" });
});

test("什么依据都用不上时退回第一张，并且说得出自己是在兜底", () => {
	// 三块 16:9 的屏、只有两张画面：形状不唯一，位次对不上，只剩兜底。
	const wideA: DisplayShape = { id: 21, bounds: { width: 1920, height: 1080 }, scaleFactor: 1 };
	const wideB: DisplayShape = { id: 22, bounds: { width: 2560, height: 1440 }, scaleFactor: 1 };
	const wideC: DisplayShape = { id: 23, bounds: { width: 3840, height: 2160 }, scaleFactor: 1 };
	const sources = [shot("screen:0:0", "", 1920, 1080), shot("screen:1:0", "", 2560, 1440)];
	const picked = pickDisplaySource(sources, [wideA, wideB, wideC], 23);
	assert.equal(picked?.how, "first", "兜底要自报家门，日志里才看得出这次是猜的");
	assert.equal(picked?.index, 0);
});

test("一张画面都没有时返回 null，而不是随手给一张", () => {
	// 权限没给、或者系统一张也没交出来。这时候该报「拿不到屏幕」，不是拿一张错的接着画。
	assert.equal(pickDisplaySource([], [laptop, external], 1), null);
});

test("16:10 和 21:9 不会被容差混为一谈", () => {
	const ultrawide: DisplayShape = { id: 31, bounds: { width: 3440, height: 1440 }, scaleFactor: 1 };
	const sources = [shot("screen:0:0", "", 2940, 1912), shot("screen:1:0", "", 3440, 1440)];
	assert.deepEqual(pickDisplaySource(sources, [laptop, ultrawide], 31), { index: 1, how: "index" });
	assert.deepEqual(pickDisplaySource([sources[1]!, sources[0]!], [laptop, ultrawide], 31), { index: 0, how: "shape" });
});
