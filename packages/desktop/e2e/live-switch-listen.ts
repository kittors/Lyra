/* oxlint-disable no-console -- live listener that prints what the installed window did */
/**
 * 挂到本机正在用的那个 Lyra 上，你切会话，这里把卡在哪一行打出来。
 *
 * 用法：先把包装好的 app 用 --remote-debugging-port=9333 拉起来，再跑这个文件。
 */

import { evaluateRenderer } from "./app.ts";

const PORT = Number(process.argv[2] ?? 9333);

const INSTALL = `(() => {
	if (window.__ly_listen) return "already";
	const log = [];
	window.__ly_listen = log;
	const push = (entry) => {
		entry.at = Math.round(performance.now());
		log.push(entry);
		if (log.length > 400) log.splice(0, log.length - 400);
	};
	try {
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				if (entry.duration < 32) continue;
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
		}).observe({ type: "long-animation-frame", buffered: true });
	} catch (error) {
		push({ kind: "no-loaf", err: String(error) });
	}
	try {
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				if (entry.duration < 32) continue;
				push({ kind: "longtask", dur: Math.round(entry.duration) });
			}
		}).observe({ type: "longtask", buffered: true });
	} catch (error) {
		push({ kind: "no-longtask", err: String(error) });
	}
	try {
		new PerformanceObserver((list) => {
			for (const entry of list.getEntries()) {
				if (entry.duration < 40) continue;
				// Hover enter/leave floods the 300-cap and hides the presses we care about.
				if (/^(pointer|mouse)(over|out|enter|leave)$/.test(entry.name)) continue;
				push({
					kind: "event",
					name: entry.name,
					dur: Math.round(entry.duration),
					proc: Math.round((entry.processingEnd || 0) - (entry.processingStart || 0)),
				});
			}
		}).observe({ type: "event", durationThreshold: 40, buffered: true });
	} catch (error) {
		push({ kind: "no-event", err: String(error) });
	}
	document.addEventListener("pointerdown", (event) => {
		const row = event.target && event.target.closest ? event.target.closest("[data-ly-row]") : null;
		if (!row) return;
		const t0 = performance.now();
		const live = document.querySelector("[data-active=true] [data-ly-session], [data-ly-session]");
		push({
			kind: "press",
			id: (row.getAttribute("data-ly-row") || "").slice(0, 8),
			title: (row.innerText || "").split("\\n")[0].slice(0, 36),
			before: live ? (live.getAttribute("data-ly-session") || "").slice(0, 8) : "",
			trees: document.querySelectorAll("[data-ly-session]").length,
			nodes: document.querySelectorAll("*").length,
			runs: document.querySelectorAll("[data-ly-run], main .prose-dw").length,
		});
		requestAnimationFrame(() => {
			const mid = performance.now();
			requestAnimationFrame(() => {
				const after = document.querySelector("[data-active=true] [data-ly-session], [data-ly-session]");
				push({
					kind: "paint2",
					gap: Math.round(performance.now() - t0),
					first: Math.round(mid - t0),
					id: after ? (after.getAttribute("data-ly-session") || "").slice(0, 8) : "",
					trees: document.querySelectorAll("[data-ly-session]").length,
					nodes: document.querySelectorAll("*").length,
					busy: Boolean(document.querySelector("[aria-busy=true]")),
					views: [...document.querySelectorAll("[data-view]")].map((node) => node.getAttribute("data-view")?.slice(0, 8) + ":" + node.getAttribute("data-active")),
				});
			});
		});
	}, true);
	return "installed";
})()`;

async function pageUrl(): Promise<string> {
	const list = (await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json())) as Array<{
		type: string;
		webSocketDebuggerUrl?: string;
		title?: string;
		url?: string;
	}>;
	const pages = list.filter((item) => item.type === "page" && item.webSocketDebuggerUrl);
	for (const page of pages) {
		const mark = await evaluateRenderer<{ shell: boolean; session: boolean }>(
			page.webSocketDebuggerUrl!,
			`({ shell: Boolean(document.querySelector(".ly-shell")), session: Boolean(document.querySelector("[data-ly-session-window]")) })`,
		).catch(() => null);
		if (mark?.shell && !mark.session) return page.webSocketDebuggerUrl!;
	}
	const fallback = pages[0]?.webSocketDebuggerUrl;
	if (!fallback) throw new Error(`调试口 ${PORT} 上没有页面`);
	return fallback;
}

function line(entry: Record<string, unknown>): string {
	const kind = String(entry.kind);
	if (kind === "press") {
		return `▶ 点「${entry.title}」 ${entry.id}  当时树 ${entry.trees} 节点 ${entry.nodes} 行 ${entry.runs}  屏上 ${entry.before}`;
	}
	if (kind === "paint2") {
		return `  两帧后 ${entry.gap}ms（第一帧 ${entry.first}ms）屏上 ${entry.id} 树 ${entry.trees} 节点 ${entry.nodes} busy=${entry.busy} views=${JSON.stringify(entry.views)}`;
	}
	if (kind === "loaf") {
		const scripts = Array.isArray(entry.scripts)
			? (entry.scripts as { dur: number; name: string; src: string }[])
					.map((script) => `${script.dur}ms ${script.name || "?"}@${script.src || "?"}`)
					.join(" | ")
			: "";
		return `  LOAF ${entry.dur}ms 挡住 ${entry.block}ms  ${scripts}`;
	}
	if (kind === "longtask") return `  LONGTASK ${entry.dur}ms`;
	if (kind === "event") return `  EVENT ${entry.name} ${entry.dur}ms 处理 ${entry.proc}ms`;
	return `  ${JSON.stringify(entry)}`;
}

async function main(): Promise<void> {
	const target = await pageUrl();
	const installed = await evaluateRenderer<string>(target, INSTALL);
	const snap = await evaluateRenderer<{ rows: number; trees: number; session: string; nodes: number }>(
		target,
		`({
			rows: document.querySelectorAll("[data-ly-row]").length,
			trees: document.querySelectorAll("[data-ly-session]").length,
			session: (document.querySelector("[data-active=true] [data-ly-session], [data-ly-session]") || {}).getAttribute
				? document.querySelector("[data-active=true] [data-ly-session], [data-ly-session]").getAttribute("data-ly-session") || ""
				: "",
			nodes: document.querySelectorAll("*").length,
		})`,
	);
	console.log(`挂上了（${installed}）。侧栏 ${snap.rows} 行，转录树 ${snap.trees}，节点 ${snap.nodes}，当前 ${snap.session.slice(0, 8) || "无"}`);
	console.log("你现在去切会话。每次按下和卡顿都会打在下面。Ctrl+C 停。\n");
	let seenAt = 0;
	for (;;) {
		const batch = await evaluateRenderer<Record<string, unknown>[]>(
			target,
			`(() => {
				const log = window.__ly_listen || [];
				const next = log.filter((entry) => entry && entry.at > ${seenAt});
				return next;
			})()`,
		).catch((error) => {
			console.log(`监听断了：${error instanceof Error ? error.message : error}`);
			return null;
		});
		if (batch === null) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			continue;
		}
		if (batch.length) {
			const last = batch[batch.length - 1];
			const at = typeof last.at === "number" ? last.at : seenAt;
			seenAt = at;
			for (const entry of batch) console.log(line(entry));
		}
		await new Promise((resolve) => setTimeout(resolve, 400));
	}
}

main().catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
