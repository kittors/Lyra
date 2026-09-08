/* oxlint-disable no-console -- 探针的输出就是它的全部产物 */
/**
 * What one `tool_update` costs the window, in the real renderer.
 *
 * The coalescing fix is in `core` and is unit-tested there: 600 chunks now produce a handful of
 * updates instead of 600. What that is *worth* is a renderer question, and it is the half a unit
 * test cannot answer — jsdom has no layout, so the cost being removed is invisible to it.
 *
 * So this measures the one thing that scales with the update count: replacing the card's output
 * text and letting Chromium lay it out again. Multiply by the update count before and after and
 * the fix stops being a ratio and becomes seconds.
 *
 *   node --experimental-strip-types packages/desktop/e2e/output-flood-probe.ts
 */

import { startApp } from "./app.ts";

const PORT = 9333;
/** `MAX_OUTPUT_CHARS` from `core/tools/bash.ts` — the size every update carries once output grows. */
const PAYLOAD = 60_000;

const MEASURE = `
	(() => {
		const host = document.createElement("div");
		// The output area's own shape: monospace, bounded height, scrolls. Layout cost lives here.
		host.style.cssText = "position:fixed;left:-9999px;top:0;width:640px;max-height:420px;overflow:auto;font-family:ui-monospace,monospace;font-size:12px;white-space:pre-wrap;";
		document.body.appendChild(host);

		const line = "dist/static/js/async/vendors-node_modules_pnpm_antd_6_3_5_react-dom-7270b5.js   84.1 kB   15.3 kB\\n";
		const text = line.repeat(Math.ceil(${PAYLOAD} / line.length)).slice(0, ${PAYLOAD});

		const times = [];
		for (let i = 0; i < 40; i++) {
			const t0 = performance.now();
			// What React does to a text child that changed: replace it, then the browser reflows.
			host.textContent = text.slice(0, ${PAYLOAD} - (i % 7));
			host.scrollTop = host.scrollHeight; // forces layout, as the autoscroll does
			times.push(performance.now() - t0);
		}
		host.remove();
		times.sort((a, b) => a - b);
		return { median: times[Math.floor(times.length / 2)], worst: times[times.length - 1] };
	})()
`;

async function main() {
	const app = await startApp({ port: PORT });
	try {
		const { median } = await app.evaluate<{ median: number; worst: number }>(MEASURE);
		console.log(`渲染一次 ${PAYLOAD.toLocaleString()} 字符的输出：中位 ${median.toFixed(2)}ms\n`);

		/*
		 * The two update counts, both measured rather than assumed: 2000 comes from replaying a
		 * 192 KB line-at-a-time build through the old per-chunk path, 6 from the same stream through
		 * the 100ms ticker over its ~600ms of wall clock.
		 */
		const before = 2000;
		const after = 6;
		const secs = (n: number) => ((n * median) / 1000).toFixed(1);
		console.log(`一次 192 KB 的构建输出（逐行流式）：`);
		console.log(`  修复前 ${before} 次更新 → 窗口花在重绘上 ${secs(before)}s`);
		console.log(`  修复后 ${after} 次更新 → ${secs(after)}s`);
		console.log(`  省下 ${(((before - after) * median) / 1000).toFixed(1)}s 的主线程时间`);
	} finally {
		await app.stop();
	}
}

main().catch((error: unknown) => {
	console.error("探针失败:", error);
	process.exitCode = 1;
});