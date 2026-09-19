/* oxlint-disable no-console -- live probe */
import { evaluateRenderer } from "./app.ts";

const list = (await fetch("http://127.0.0.1:9333/json/list").then((r) => r.json())) as Array<{
	type: string;
	webSocketDebuggerUrl?: string;
}>;
let url = "";
for (const page of list.filter((item) => item.type === "page" && item.webSocketDebuggerUrl)) {
	const mark = await evaluateRenderer<boolean>(page.webSocketDebuggerUrl!, `Boolean(document.querySelector(".ly-shell"))`);
	if (mark) url = page.webSocketDebuggerUrl!;
}

const ids = [
	"81fd7943-5d23-445a-91d0-bcfbabe4d2bf",
	"19e88370-9561-4627-a871-c5d02a650b93",
	"709346be-82bb-4c75-a123-8168391a6f75",
	"c300b26e-cef7-4f21-abca-ad0c6036ef6f",
];

const result = await evaluateRenderer(url, `(() => new Promise(async (resolve) => {
	const out = [];
	const snap = () => {
		const live = document.querySelector("[data-active=true] [data-ly-session], [data-ly-session]");
		const lit = [...document.querySelectorAll("[data-ly-row] button[aria-current=page]")].map((b) => b.closest("[data-ly-row]")?.getAttribute("data-ly-row") || "");
		return {
			lit: (lit[0] || "").slice(0, 8),
			live: live ? (live.getAttribute("data-ly-session") || "").slice(0, 8) : "",
			busy: Boolean(document.querySelector("[aria-busy=true]")),
			heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null,
			dataImgs: [...document.querySelectorAll("img")].filter((img) => (img.src || "").startsWith("data:")).length,
			imgBytes: [...document.querySelectorAll("img")].reduce((sum, img) => sum + ((img.src || "").startsWith("data:") ? img.src.length : 0), 0),
		};
	};
	for (const id of ${JSON.stringify(ids)}) {
		const btn = document.querySelector('[data-ly-row="' + id + '"] button');
		if (!btn) { out.push({ id: id.slice(0, 8), missing: true }); continue; }
		const t0 = performance.now();
		btn.dispatchEvent(new PointerEvent("pointerdown", { button: 0, bubbles: true, cancelable: true, pointerType: "mouse", clientX: 40, clientY: 40 }));
		let litMs = null;
		let liveMs = null;
		let last = snap();
		for (let i = 0; i < 90; i++) {
			await new Promise((r) => requestAnimationFrame(r));
			last = snap();
			const ms = Math.round(performance.now() - t0);
			if (litMs == null && last.lit === id.slice(0, 8)) litMs = ms;
			if (liveMs == null && last.live === id.slice(0, 8)) liveMs = ms;
			if (litMs != null && liveMs != null && !last.busy) break;
		}
		out.push({ id: id.slice(0, 8), litMs, liveMs, took: Math.round(performance.now() - t0), after: last });
		await new Promise((r) => setTimeout(r, 300));
	}
	resolve(out);
}))()`);
console.log(JSON.stringify(result, null, 2));
