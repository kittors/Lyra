/* oxlint-disable no-console -- 一次性调试脚本，留档用，不在 CI 里跑 */
import { evaluateRenderer } from "./app.ts";

const DUMP = `(() => {
	const log = window.__ly_listen || [];
	const presses = log.filter((e) => e && e.kind === "press");
	const paints = log.filter((e) => e && e.kind === "paint2");
	const loafs = log.filter((e) => e && e.kind === "loaf");
	const tasks = log.filter((e) => e && e.kind === "longtask");
	return {
		shell: Boolean(document.querySelector(".ly-shell")),
		sessionWin: Boolean(document.querySelector("[data-ly-session-window]")),
		refined: Boolean(window.__ly_refined),
		installed: Boolean(window.__ly_listen),
		len: log.length,
		presses,
		paints,
		loafs: loafs.slice(-20),
		tasks: tasks.slice(-20),
		rows: document.querySelectorAll("[data-ly-row]").length,
		trees: document.querySelectorAll("[data-ly-session]").length,
		nodes: document.querySelectorAll("*").length,
		title: document.title,
	};
})()`;

const list = (await fetch("http://127.0.0.1:9333/json/list").then((r) => r.json())) as {
	type: string;
	title?: string;
	url?: string;
	webSocketDebuggerUrl?: string;
}[];
let i = 0;
for (const page of list.filter((item) => item.webSocketDebuggerUrl)) {
	const result = await evaluateRenderer<Record<string, unknown>>(page.webSocketDebuggerUrl!, DUMP).catch((error) => ({
		error: String(error),
	}));
	console.log(`\n==== target ${i++} ${page.type} ${page.title} ====`);
	console.log(JSON.stringify(result, null, 2));
}
