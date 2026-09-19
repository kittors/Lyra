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
	const copies = [...document.querySelectorAll('[data-ly-row="' + id + '"]')].map((el, i) => {
		const b = el.getBoundingClientRect();
		const st = getComputedStyle(el);
		const group = el.closest("[data-ly-project], [data-ly-head], [data-ly-tab]")?.getAttribute("data-ly-project")
			|| el.closest(".relative.mb-2")?.querySelector("[data-ly-project]")?.getAttribute("data-ly-project")
			|| "";
		return {
			i,
			y: Math.round(b.y),
			h: Math.round(b.height),
			w: Math.round(b.width),
			disp: st.display,
			vis: st.visibility,
			op: st.opacity,
			clip: el.closest(".overflow-hidden") != null,
			group,
			parent: el.parentElement?.className?.toString().slice(0, 80),
		};
	});
	const pinHead = document.querySelector("[data-ly-head]");
	const pinBox = pinHead?.getBoundingClientRect();
	const pinName = document.querySelector("[data-ly-head] [data-ly-project], [data-ly-head] .ly-fade-tail")?.textContent;
	return {
		copies,
		pin: pinBox && { y: Math.round(pinBox.y), h: Math.round(pinBox.height), text: (pinName || "").slice(0, 20) },
		pinnedLabel: [...document.querySelectorAll("[data-ly-head]")].slice(0, 4).map((el) => ({
			y: Math.round(el.getBoundingClientRect().y),
			h: Math.round(el.getBoundingClientRect().height),
			t: (el.textContent || "").trim().slice(0, 24),
			stuck: el.hasAttribute("data-ly-stuck") || !!el.closest("[data-ly-stuck]"),
		})),
	};
})()`);
console.log(JSON.stringify(result, null, 2));
