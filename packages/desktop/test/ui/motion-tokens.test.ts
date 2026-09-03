/**
 * The durations in TypeScript and the durations in CSS are the same durations.
 *
 * They have to be written twice — a stylesheet cannot import a module and a `setTimeout` cannot
 * read a custom property without a live document — so the only question is whether anything
 * notices when they drift. Nothing did: `ImageViewer` carried its own copy of the `out` curve,
 * identical to `--ly-e-out` and with nothing connecting them.
 *
 * Reading the stylesheet as text rather than resolving it in a browser, because the assertion is
 * about what is written down. A value that resolves correctly today and was typed twice is still
 * two values.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";

import { DURATION, EASING } from "../../src/ui/motion/tokens.ts";

const CSS = new URL("../../src/styles/tokens.css", import.meta.url);

/** The value of a custom property, as written. */
function valueOf(css: string, name: string): string | undefined {
	return new RegExp(`--${name}:\\s*([^;]+);`).exec(css)?.[1]?.trim();
}

test("三档时长与 CSS 里的一致", async () => {
	const css = await readFile(CSS, "utf8");
	for (const [name, ms] of Object.entries(DURATION)) {
		const declared = valueOf(css, `ly-t-${name}`);
		assert.ok(declared, `styles/tokens.css 里没有 --ly-t-${name}`);
		assert.equal(declared, `${ms}ms`, `--ly-t-${name} 是 ${declared}，TS 里写的是 ${ms}ms`);
	}
});

test("三条曲线与 CSS 里的一致", async () => {
	const css = await readFile(CSS, "utf8");
	for (const [name, curve] of Object.entries(EASING)) {
		const declared = valueOf(css, `ly-e-${name}`);
		assert.ok(declared, `styles/tokens.css 里没有 --ly-e-${name}`);
		// 空格无关：`cubic-bezier(0.22,1,...)` 与 `cubic-bezier(0.22, 1, ...)` 是同一条曲线。
		assert.equal(declared.replace(/\s+/g, ""), curve.replace(/\s+/g, ""), `--ly-e-${name} 与 TS 不一致`);
	}
});

test("CSS 里的每一个动效 token 都在 TS 里有对应", async () => {
	const css = await readFile(CSS, "utf8");
	const inCss = [...css.matchAll(/--ly-([te])-([a-z]+):/g)].map(([, kind, name]) => `${kind}:${name}`);
	const inTs = new Set([
		...Object.keys(DURATION).map((n) => `t:${n}`),
		...Object.keys(EASING).map((n) => `e:${n}`),
	]);
	const missing = inCss.filter((token) => !inTs.has(token));
	assert.deepEqual(
		missing,
		[],
		"CSS 里加了新的动效 token 而 TS 没跟上——JS 驱动的动画会继续用旧值，而那正是两份数字分叉的开始",
	);
});
