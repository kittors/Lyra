/* oxlint-disable no-console -- 一次性调试脚本，留档用，不在 CI 里跑 */
import { evaluateRenderer } from "./app.ts";

const PATCH = `(() => {
	if (!window.__ly_settle_patched) {
		const native = window.setTimeout.bind(window);
		window.setTimeout = (handler, delay, ...args) => {
			if (delay === 360 && typeof handler === "function") {
				handler();
				return native(() => {}, 0);
			}
			return native(handler, delay, ...args);
		};
		window.__ly_settle_patched = true;
	}
	const log = window.__ly_listen;
	if (Array.isArray(log) && !log.__ly_filtered) {
		const push = log.push.bind(log);
		log.push = (entry) => {
			if (entry && entry.kind === "event" && /^(pointer|mouse)(over|out|enter|leave)$/.test(entry.name || "")) {
				return log.length;
			}
			return push(entry);
		};
		log.__ly_filtered = true;
		log.length = 0;
	}
	return {
		patched: Boolean(window.__ly_settle_patched),
		filtered: Boolean(log && log.__ly_filtered),
		len: log ? log.length : 0,
	};
})()`;

const list = (await fetch("http://127.0.0.1:9333/json/list").then((r) => r.json())) as {
	type: string;
	title?: string;
	webSocketDebuggerUrl?: string;
}[];
for (const page of list.filter((item) => item.webSocketDebuggerUrl)) {
	const result = await evaluateRenderer<Record<string, unknown>>(page.webSocketDebuggerUrl!, PATCH).catch((error) => ({
		error: String(error),
	}));
	console.log(page.title, JSON.stringify(result));
}
