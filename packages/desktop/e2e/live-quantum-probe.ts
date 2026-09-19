/* oxlint-disable no-console -- live probe against the installed window */
import { call, evaluateRenderer } from "./app.ts";

const PORT = 9333;
const TARGETS = [
	{ id: "81fd7943-5d23-445a-91d0-bcfbabe4d2bf", label: "small-error" },
	{ id: "19e88370-9561-4627-a871-c5d02a650b93", label: "images-20mb" },
	{ id: "709346be-82bb-4c75-a123-8168391a6f75", label: "small-map" },
	{ id: "c300b26e-cef7-4f21-abca-ad0c6036ef6f", label: "image-4mb" },
];

async function pageUrl(): Promise<string> {
	const list = (await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json())) as Array<{
		type: string;
		webSocketDebuggerUrl?: string;
	}>;
	for (const page of list.filter((item) => item.type === "page" && item.webSocketDebuggerUrl)) {
		const mark = await evaluateRenderer<{ shell: boolean }>(
			page.webSocketDebuggerUrl!,
			`({ shell: Boolean(document.querySelector(".ly-shell")) })`,
		).catch(() => null);
		if (mark?.shell) return page.webSocketDebuggerUrl!;
	}
	throw new Error("no shell");
}

type Snap = { lit: string; live: string; busy: boolean; heap: number | null; imgs: number; dataImgs: number };

function snapExpr(): string {
	return `(() => {
		const live = document.querySelector("[data-active=true] [data-ly-session], [data-ly-session]");
		const lit = [...document.querySelectorAll("[data-ly-row] button[aria-current=page]")].map((b) => b.closest("[data-ly-row]")?.getAttribute("data-ly-row") || "");
		return {
			lit: (lit[0] || "").slice(0, 8),
			live: live ? (live.getAttribute("data-ly-session") || "").slice(0, 8) : "",
			busy: Boolean(document.querySelector("[aria-busy=true]")),
			heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
			imgs: document.querySelectorAll("img").length,
			dataImgs: [...document.querySelectorAll("img")].filter((img) => (img.src || "").startsWith("data:")).length,
		};
	})()`;
}

async function clickRow(target: string, id: string): Promise<boolean> {
	const at = await evaluateRenderer<{ x: number; y: number } | null>(
		target,
		`(() => {
			const e = document.querySelector(${JSON.stringify(`[data-ly-row="${id}"]`)});
			if (!e) return null;
			e.scrollIntoView({ block: "center" });
			const r = e.getBoundingClientRect();
			if (r.width === 0 || r.height === 0) return null;
			return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
		})()`,
	);
	if (!at) return false;
	for (const type of ["mousePressed", "mouseReleased"] as const) {
		await call(target, "Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
	}
	return true;
}

const target = await pageUrl();
for (const row of TARGETS) {
	const before = await evaluateRenderer<Snap>(target, snapExpr());
	const t0 = Date.now();
	const ok = await clickRow(target, row.id);
	if (!ok) {
		console.log(row.label, "MISSING");
		continue;
	}
	let litMs: number | null = null;
	let liveMs: number | null = null;
	let last = before;
	for (let i = 0; i < 80; i++) {
		last = await evaluateRenderer<Snap>(target, snapExpr());
		const ms = Date.now() - t0;
		if (litMs == null && last.lit === row.id.slice(0, 8)) litMs = ms;
		if (liveMs == null && last.live === row.id.slice(0, 8)) liveMs = ms;
		if (litMs != null && liveMs != null && !last.busy) break;
	}
	const done = Date.now() - t0;
	console.log(JSON.stringify({
		row: row.label,
		id: row.id.slice(0, 8),
		ok,
		litMs,
		liveMs,
		doneMs: done,
		before: { lit: before.lit, live: before.live, heap: before.heap, dataImgs: before.dataImgs },
		after: last,
	}));
	await new Promise((resolve) => setTimeout(resolve, 400));
}
