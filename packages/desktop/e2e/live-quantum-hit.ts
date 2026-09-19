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
	const id = "19e88370-9561-4627-a871-c5d02a650b93";
	const row = document.querySelector('[data-ly-row="' + id + '"]');
	const box = row.getBoundingClientRect();
	const x = box.left + box.width / 2;
	const y = box.top + box.height / 2;
	const top = document.elementFromPoint(x, y);
	const all = document.elementsFromPoint(x, y).slice(0, 8).map((el) => ({
		tag: el.tagName,
		cls: String(el.className || "").slice(0, 80),
		row: el.closest("[data-ly-row]")?.getAttribute("data-ly-row") || "",
	}));
	const rows = [...document.querySelectorAll("[data-ly-row]")].map((el) => {
		const b = el.getBoundingClientRect();
		const st = getComputedStyle(el);
		return {
			id: (el.getAttribute("data-ly-row") || "").slice(0, 8),
			y: Math.round(b.y),
			h: Math.round(b.height),
			disp: st.display,
			op: st.opacity,
		};
	});
	const overlap = [];
	for (let i = 0; i < rows.length; i++) {
		for (let j = i + 1; j < rows.length; j++) {
			const a = rows[i];
			const b = rows[j];
			if (a.disp === "none" || b.disp === "none" || a.h === 0 || b.h === 0) continue;
			if (a.y < b.y + b.h && b.y < a.y + a.h) overlap.push([a.id, b.id, a.y, b.y]);
		}
	}
	return {
		hit: top && { tag: top.tagName, row: top.closest("[data-ly-row]")?.getAttribute("data-ly-row") },
		all,
		overlap: overlap.slice(0, 20),
		n: rows.length,
	};
})()`);
console.log(JSON.stringify(result, null, 2));
