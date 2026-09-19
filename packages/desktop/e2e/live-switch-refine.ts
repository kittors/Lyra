/* oxlint-disable no-console -- 一次性调试脚本，留档用，不在 CI 里跑 */
import { evaluateRenderer } from "./app.ts";

const REFINE = `(() => {
	const log = window.__ly_listen || [];
	window.__ly_listen = log;
	const rawPush = log.push.bind(log);
	log.push = function (entry) {
		if (entry && entry.kind === "event" && entry.name !== "pointerdown" && entry.name !== "click") return log.length;
		return rawPush(entry);
	};
	window.__ly_press_at = 0;
	if (window.__ly_refined) return "already-refined";
	window.__ly_refined = true;
	const push = (entry) => {
		entry.at = Math.round(performance.now());
		log.push(entry);
		if (log.length > 300) log.splice(0, log.length - 300);
	};
	const afterPress = () => window.__ly_press_at && performance.now() - window.__ly_press_at < 2500;
	try {
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				if (!afterPress() || entry.duration < 32) continue;
				push({
					kind: "loaf",
					dur: Math.round(entry.duration),
					block: Math.round(entry.blockingDuration || 0),
					scripts: (entry.scripts || []).slice(0, 8).map((script) => ({
						dur: Math.round(script.duration),
						name: script.sourceFunctionName || script.invoker || "",
						src: String(script.sourceURL || "").split("/").pop() || "",
					})),
				});
			}
		}).observe({ type: "long-animation-frame", buffered: false });
	} catch {}
	try {
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				if (!afterPress() || entry.duration < 32) continue;
				push({ kind: "longtask", dur: Math.round(entry.duration) });
			}
		}).observe({ type: "longtask", buffered: false });
	} catch {}
	try {
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				if (!afterPress() || entry.duration < 50) continue;
				if (entry.name !== "pointerdown" && entry.name !== "click") continue;
				push({
					kind: "event",
					name: entry.name,
					dur: Math.round(entry.duration),
					proc: Math.round((entry.processingEnd || 0) - (entry.processingStart || 0)),
				});
			}
		}).observe({ type: "event", durationThreshold: 50, buffered: false });
	} catch {}
	const views = () => [...document.querySelectorAll("[data-view]")].map((node) => {
		const style = getComputedStyle(node);
		return {
			id: (node.getAttribute("data-view") || "").slice(0, 8),
			on: node.getAttribute("data-active"),
			disp: style.display,
			vis: style.visibility,
			kids: node.querySelectorAll("*").length,
			h: Math.round(node.scrollHeight),
		};
	});
	document.addEventListener("pointerdown", (event) => {
		const row = event.target && event.target.closest ? event.target.closest("[data-ly-row]") : null;
		if (!row) return;
		window.__ly_press_at = performance.now();
		let added = 0;
		const obs = new MutationObserver((records) => {
			for (const record of records) added += record.addedNodes.length;
		});
		obs.observe(document.body, { childList: true, subtree: true });
		const t0 = performance.now();
		push({
			kind: "press",
			id: (row.getAttribute("data-ly-row") || "").slice(0, 8),
			title: (row.innerText || "").split("\\n")[0].slice(0, 36),
			trees: document.querySelectorAll("[data-ly-session]").length,
			nodes: document.querySelectorAll("*").length,
			runs: document.querySelectorAll("[data-ly-run], main .prose-dw").length,
			views: views(),
		});
		requestAnimationFrame(() => {
			const first = performance.now() - t0;
			document.body.getBoundingClientRect();
			const layout1 = performance.now() - t0;
			requestAnimationFrame(() => {
				document.body.getBoundingClientRect();
				const layout2 = performance.now() - t0;
				obs.disconnect();
				const after = document.querySelector("[data-active=true] [data-ly-session], [data-ly-session]");
				push({
					kind: "paint2",
					gap: Math.round(performance.now() - t0),
					first: Math.round(first),
					layout1: Math.round(layout1),
					layout2: Math.round(layout2),
					added,
					id: after ? (after.getAttribute("data-ly-session") || "").slice(0, 8) : "",
					trees: document.querySelectorAll("[data-ly-session]").length,
					nodes: document.querySelectorAll("*").length,
					busy: Boolean(document.querySelector("[aria-busy=true]")),
					views: views(),
				});
			});
		});
	}, true);
	return "refined";
})()`;

const list = (await fetch("http://127.0.0.1:9333/json/list").then((r) => r.json())) as {
	type: string;
	webSocketDebuggerUrl?: string;
}[];
for (const page of list.filter((item) => item.type === "page" && item.webSocketDebuggerUrl)) {
	const result = await evaluateRenderer<string>(page.webSocketDebuggerUrl!, REFINE).catch((error) => String(error));
	console.log(result);
}
