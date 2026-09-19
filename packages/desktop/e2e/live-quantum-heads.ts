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

const result = await evaluateRenderer(url, `(() => {
	const rail = getComputedStyle(document.querySelector("[data-ly-split-root]") || document.documentElement).getPropertyValue("--ly-rail");
	const heads = [...document.querySelectorAll("[data-ly-head], [data-ly-project]")].map((el) => {
		const b = el.getBoundingClientRect();
		const st = getComputedStyle(el);
		return {
			name: el.getAttribute("data-ly-project") || el.getAttribute("data-ly-head") || el.tagName,
			y: Math.round(b.y),
			h: Math.round(b.height),
			z: st.zIndex,
			stuck: el.hasAttribute("data-ly-stuck") || el.closest("[data-ly-stuck]") != null,
			cls: String(el.className || "").slice(0, 70),
		};
	});
	const first = document.querySelector('[data-ly-row="19e88370-9561-4627-a871-c5d02a650b93"]');
	const fb = first?.getBoundingClientRect();
	const x = (fb?.left || 0) + (fb?.width || 0) / 2;
	const samples = [0, 0.15, 0.5, 0.85, 1].map((t) => {
		const y = (fb?.top || 0) + (fb?.height || 0) * t;
		const hit = document.elementFromPoint(x, y);
		return {
			t,
			y: Math.round(y),
			row: hit?.closest("[data-ly-row]")?.getAttribute("data-ly-row")?.slice(0, 8) || "",
			project: hit?.closest("[data-ly-project]")?.getAttribute("data-ly-project") || "",
			tag: hit?.tagName,
		};
	});
	return { rail, heads: heads.filter((h) => h.h > 0).slice(0, 16), first: fb && { y: Math.round(fb.y), h: Math.round(fb.height) }, samples };
})()`);
console.log(JSON.stringify(result, null, 2));
