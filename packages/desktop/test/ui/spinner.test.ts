/**
 * 那一个「正在忙」的记号，画出来是什么样。
 *
 * 这里测的不是「有个 svg」——旧的圆弧 spinner 也满足那个。测的是它之所以是这个东西的两条：八条
 * 射线均分一圈，以及亮处沿圈**顺时针**走。第二条只差一个符号就会反过来，而反过来在屏幕上只是
 * 「说不上哪里怪」，没人会为此提 issue。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createElement as h } from "react";
import { Spinner } from "../../src/ui/motion/loaders.tsx";
import { mount } from "../helpers/mount.ts";

const PERIOD = 800;

/** `rotate(45 12 12)` 里的那个角度。 */
function angleOf(ray: Element): number {
	return Number.parseFloat(/rotate\(([-\d.]+)/.exec(ray.getAttribute("transform") ?? "")?.[1] ?? "NaN");
}

/** 这一条已经播了多久——负的 delay 就是「上来就当作播过这么久」。 */
function playedAt(ray: SVGLineElement, elapsed: number): number {
	return (elapsed - Number.parseFloat(ray.style.animationDelay)) % PERIOD;
}

test("八条射线均分一圈", async () => {
	const view = await mount(h(Spinner));
	try {
		const rays = view.all<SVGLineElement>("svg.ly-star line");
		assert.equal(rays.length, 8);
		assert.deepEqual(rays.map(angleOf), [0, 45, 90, 135, 180, 225, 270, 315]);
		// 每条的长度一样，位置全靠 transform——写死坐标就会有一条量错而没人发现。
		assert.deepEqual([...new Set(rays.map((ray) => `${ray.getAttribute("y1")}→${ray.getAttribute("y2")}`))], ["2.4→7.6"]);
	} finally { await view.unmount(); }
});

test("亮处顺时针走，一格一格", async () => {
	const view = await mount(h(Spinner));
	try {
		const rays = view.all<SVGLineElement>("svg.ly-star line");
		// opacity 从 1 单调降到 0.12，所以播得最少的那条最亮。
		const brightest = (elapsed: number) =>
			rays.reduce((best, ray, index) => (playedAt(ray, elapsed) < playedAt(rays[best]!, elapsed) ? index : best), 0);

		// 每过 100ms 换下一条，八格走完一圈回到原处。递增的 index 就是顺时针，因为角度是递增排的。
		for (let step = 0; step < 8; step++) {
			assert.equal(brightest(step * 100), step, `第 ${step} 格该轮到第 ${step} 条最亮`);
		}
		assert.equal(brightest(PERIOD), 0, "一圈之后回到起点");
	} finally { await view.unmount(); }
});

test("颜色跟着周围走，也让得出去", async () => {
	// 默认不带 text-*：它顶替的是二十几个 lucide 图标，那些图标就是继承周围颜色的。
	const plain = await mount(h(Spinner));
	try {
		assert.doesNotMatch(plain.find("svg").getAttribute("class") ?? "", /\btext-/);
	} finally { await plain.unmount(); }

	const accent = await mount(h(Spinner, { className: "text-accent" }));
	try {
		assert.match(accent.find("svg").getAttribute("class") ?? "", /\btext-accent\b/);
	} finally { await accent.unmount(); }
});

test("关掉动效之后它还看得见", async () => {
	/*
	 * `motion.css` 的总开关把时长压到 0.01ms 且只跑一遍，动画照常结束；`fill-mode` 是 `none`，
	 * 八条线于是全部弹回 opacity 1，成了一枚扎眼的实心星。两档都得有自己的静态样子。
	 *
	 * 读样式表原文而不是在浏览器里解析：要断言的是「这条规则写下来了」，能解析出正确的值但依赖
	 * 别处兜底的，仍然是没写。
	 */
	const css = await readFile(new URL("../../src/styles/loading.css", import.meta.url), "utf8");
	assert.match(css, /@media \(prefers-reduced-motion: reduce\)[^}]*\{\s*:root\[data-reduce-motion="system"\] \.ly-star line \{\s*opacity:/);
	assert.match(css, /:root\[data-reduce-motion="on"\] \.ly-star line \{\s*opacity:/);
});
