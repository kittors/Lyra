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
	const row = document.querySelector('[data-ly-row="19e88370-9561-4627-a871-c5d02a650b93"]');
	const chain = [];
	let el = row;
	for (let i = 0; i < 10 && el; i++) {
		const b = el.getBoundingClientRect();
		const st = getComputedStyle(el);
		chain.push({
			tag: el.tagName,
			cls: String(el.className || "").slice(0, 90),
			y: Math.round(b.y),
			h: Math.round(b.height),
			overflow: st.overflow,
			pos: st.position,
			trans: st.transform,
		});
		el = el.parentElement;
	}
	const other = document.querySelector('[data-ly-row="0f2ffd48"]') || document.querySelector('[data-ly-row^="0f2ffd48"]');
	const others = [...document.querySelectorAll("[data-ly-row]")].filter((n) => (n.getAttribute("data-ly-row") || "").startsWith("0f2ffd48")).map((n) => {
		const b = n.getBoundingClientRect();
		return { id: n.getAttribute("data-ly-row"), y: Math.round(b.y), h: Math.round(b.height), parent: n.parentElement?.className?.toString().slice(0, 60) };
	});
	return { chain, others };
})()`);
console.log(JSON.stringify(result, null, 2));
