/**
 * 那两个「正在忙」的记号，画出来是什么样。
 *
 * 这里测的不是「有个 svg」——旧的八角星芒也满足那个。测的是它们之所以是这两个东西的几条：
 * 半径和一列里的邻居对得上、虚线是整周的等分、亮弧背后垫着轨道，以及关掉动效之后各自换成了
 * 另一副样子而不是停在某一帧。每一条错了，屏幕上都只是「说不上哪里怪」，没人会为此提 issue。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createElement as h } from "react";
import { ActionSpinner, StatusSpinner } from "../../src/ui/motion/loaders.tsx";
import { mount } from "../helpers/mount.ts";

/** lucide 的 `CheckCircle2` / `XCircle` / `Clock` 画圆用的就是这个半径，在 24 的 viewBox 里。 */
const RADIUS = 10;

const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

test("两个记号和状态列里的邻居是同一个圆", async () => {
	/*
	 * 整件事的起点就是这一条。
	 *
	 * 之前这里是八条射线撑满 24 的星芒，站在一列 lucide 的描边圆中间——流水线那一列尤其明显，
	 * 上下都是 ✓ ✗ 时钟，中间一个星。半径对不上，笔触也比空心圆环重，每次都从队列里跳出来。
	 */
	for (const [name, node] of [
		["StatusSpinner", h(StatusSpinner)],
		["ActionSpinner", h(ActionSpinner)],
	] as const) {
		const view = await mount(node);
		try {
			const circles = view.all<SVGCircleElement>("svg circle");
			assert.ok(circles.length > 0, `${name} 该是描边圆画的`);
			for (const circle of circles) {
				assert.equal(circle.getAttribute("r"), String(RADIUS), `${name} 的半径要和 lucide 的圆对齐`);
				assert.equal(circle.getAttribute("cx"), "12", `${name} 该在 24 的 viewBox 里居中`);
				assert.equal(circle.getAttribute("cy"), "12", `${name} 该在 24 的 viewBox 里居中`);
			}
			assert.equal(view.find("svg").getAttribute("viewBox"), "0 0 24 24", `${name} 的 viewBox 要和 lucide 一致`);
		} finally {
			await view.unmount();
		}
	}
});

test("虚线环是整周的等分，所以它没有头", async () => {
	/*
	 * 这一条是它敢转的全部理由。
	 *
	 * 六段等分意味着转过 60° 就回到自身，没有任何一个点可以被眼睛追着走。`dasharray` 一旦除不尽
	 * 周长，十二点方向就会留下一道接不上的缝——那道缝就是头，转起来会把视线一圈一圈地勾走，而
	 * 这正是上一版记号立下「什么都不许转」那条规矩时要躲的东西。
	 */
	const css = await readFile(new URL("../../src/styles/loading.css", import.meta.url), "utf8");
	const declared = /\.ly-dash circle \{[^}]*stroke-dasharray:\s*([\d.]+)\s+([\d.]+)/.exec(css);
	assert.ok(declared, "loading.css 里 .ly-dash 该有 stroke-dasharray");

	const [dash, gap] = [Number(declared[1]), Number(declared[2])];
	assert.equal(dash, gap, "实线和缝要等长，不然六段之间读得出疏密");

	const segments = CIRCUMFERENCE / (dash + gap);
	assert.ok(
		Math.abs(segments - Math.round(segments)) < 0.001,
		`一段 ${dash + gap} 除不尽周长 ${CIRCUMFERENCE.toFixed(3)}，十二点方向会留一道接不上的缝`,
	);
	assert.equal(Math.round(segments), 6, "六段：再多在 11px 上并成一圈灰，再少就开始像装饰");
});

test("亮弧背后垫着一圈轨道", async () => {
	/*
	 * 没有轨道的话，图形的轮廓跟着弧一起走，在按钮那个方寸之间读成「有东西在里面甩」。垫一圈淡
	 * 的，形状恒定是一个整圆，动的只有亮处——和隔壁那些状态图标一样是个圆。
	 */
	const view = await mount(h(ActionSpinner));
	try {
		const track = view.find("svg .ly-arc-track");
		const head = view.find("svg .ly-arc-head");
		assert.ok(track, "亮弧要有轨道垫着");
		assert.ok(head, "亮弧本身要在");
		assert.equal(track.getAttribute("r"), head.getAttribute("r"), "轨道和亮弧要在同一个圆上");
		assert.equal(track.getAttribute("stroke-dasharray"), null, "轨道是整圆，不该有 dasharray");
	} finally {
		await view.unmount();
	}

	const css = await readFile(new URL("../../src/styles/loading.css", import.meta.url), "utf8");
	const arc = /\.ly-arc-head \{[^}]*stroke-dasharray:\s*([\d.]+)\s+([\d.]+)/.exec(css);
	assert.ok(arc, "loading.css 里 .ly-arc-head 该有 stroke-dasharray");

	const degrees = (Number(arc[1]) / CIRCUMFERENCE) * 360;
	assert.ok(degrees > 70, `弧只有 ${degrees.toFixed(0)}°，会读成一个点在轨道上跑`);
	assert.ok(degrees < 200, `弧有 ${degrees.toFixed(0)}°，把轨道盖住了，残留也就没了`);
});

test("实心底上轨道要浓一档", async () => {
	// `bg-ink` / `bg-accent` 上 currentColor 是底色的反色，默认那档浓度基本看不见。
	const plain = await mount(h(ActionSpinner));
	try {
		assert.doesNotMatch(plain.find("svg").getAttribute("class") ?? "", /ly-arc--on-fill/);
	} finally {
		await plain.unmount();
	}

	const filled = await mount(h(ActionSpinner, { onFill: true }));
	try {
		const svg = filled.find("svg");
		assert.match(svg.getAttribute("class") ?? "", /\bly-arc--on-fill\b/);
		// 只该改浓度，不该改几何——两边都要能和状态列里的邻居对齐。
		assert.equal(filled.find("svg circle").getAttribute("r"), String(RADIUS));
	} finally {
		await filled.unmount();
	}

	const css = await readFile(new URL("../../src/styles/loading.css", import.meta.url), "utf8");
	const base = /\.ly-arc \{[^}]*--ly-track:\s*([\d.]+)/.exec(css);
	const filledTrack = /\.ly-arc--on-fill \{[^}]*--ly-track:\s*([\d.]+)/.exec(css);
	assert.ok(base && filledTrack, "两档浓度都该写在 loading.css 里");
	assert.ok(Number(filledTrack[1]) > Number(base[1]), "实心底那一档要更浓，否则传不传都一样");
});

test("颜色跟着周围走，也让得出去", async () => {
	// 默认不带 text-*：它们顶替的是几十个 lucide 图标，那些图标就是继承周围颜色的。
	for (const node of [h(StatusSpinner), h(ActionSpinner)]) {
		const view = await mount(node);
		try {
			assert.doesNotMatch(view.find("svg").getAttribute("class") ?? "", /\btext-/);
		} finally {
			await view.unmount();
		}
	}

	const accent = await mount(h(StatusSpinner, { className: "text-accent" }));
	try {
		assert.match(accent.find("svg").getAttribute("class") ?? "", /\btext-accent\b/);
	} finally {
		await accent.unmount();
	}
});

test("关掉动效之后它们换一副样子，而不是停在某一帧", async () => {
	/*
	 * `motion.css` 的总开关把时长压到 0.01ms 且只跑一遍，动画照常结束；`fill-mode` 是 `none`，
	 * 两个记号都弹回 `rotate(0)`。各自要躲的东西不一样：
	 *
	 * 虚线环停下来会和任务清单里「还没开始」那一圈虚线撞——跑着的时候一个亮蓝在转一个淡灰不动，
	 * 分得开；静止之后就只剩颜色深浅了。所以这一档要把虚线也收掉。
	 *
	 * 亮弧停下来是一段停在十二点方向的弧配一圈轨道，长得和「下到三成」的进度环一模一样，而它压根
	 * 不知道进度。所以这一档要把弧收掉。
	 *
	 * 读样式表原文而不是在浏览器里解析：要断言的是「这条规则写下来了」，能解析出正确的值但依赖
	 * 别处兜底的，仍然是没写。
	 */
	const css = await readFile(new URL("../../src/styles/loading.css", import.meta.url), "utf8");

	for (const scope of [
		String.raw`@media \(prefers-reduced-motion: reduce\)[\s\S]*?:root\[data-reduce-motion="system"\]`,
		String.raw`:root\[data-reduce-motion="on"\]`,
	]) {
		assert.match(
			css,
			new RegExp(`${scope} \\.ly-dash circle \\{[^}]*stroke-dasharray:\\s*none`),
			"这一档没把虚线收掉，会和任务清单里「还没开始」那一圈撞",
		);
		assert.match(
			css,
			new RegExp(`${scope} \\.ly-arc-head \\{[^}]*display:\\s*none`),
			"这一档没把弧收掉，它会假装自己是一个卡住的进度环",
		);
	}
});
