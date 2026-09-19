/* oxlint-disable no-console -- 一次性调试脚本，留档用，不在 CI 里跑 */
import { evaluateRenderer } from "./app.ts";

const EXPR = `(() => {
	const log = window.__ly_listen || [];
	const late = log.filter((e) => e && e.at >= 168000 && e.kind !== "event");
	const events = log.filter((e) => e && e.kind === "event" && e.at >= 168000 && (e.name === "pointerdown" || e.name === "click"));
	return { late, events, len: log.length };
})()`;

const list = (await fetch("http://127.0.0.1:9333/json/list").then((r) => r.json())) as {
	type: string;
	webSocketDebuggerUrl?: string;
}[];
for (const page of list.filter((item) => item.type === "page" && item.webSocketDebuggerUrl)) {
	const result = await evaluateRenderer<{ late: unknown[]; events: unknown[]; len: number }>(
		page.webSocketDebuggerUrl!,
		EXPR,
	).catch(() => null);
	if (result && result.len) console.log(JSON.stringify(result, null, 2));
}
