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
	const head = document.querySelector('[data-ly-project="quantum"] button');
	const before = head?.getAttribute("aria-expanded");
	head?.click();
	return new Promise((resolve) => {
		setTimeout(() => {
			const row = document.querySelector('[data-ly-row="19e88370-9561-4627-a871-c5d02a650b93"]');
			const hb = document.querySelector('[data-ly-project="quantum"]')?.getBoundingClientRect();
			const rb = row?.getBoundingClientRect();
			const clip = row?.parentElement?.parentElement?.getBoundingClientRect();
			const x = (rb?.left || 0) + (rb?.width || 0) / 2;
			const samples = [0.2, 0.5, 0.8].map((t) => {
				const y = (rb?.top || 0) + (rb?.height || 0) * t;
				const hit = document.elementFromPoint(x, y);
				return {
					t,
					row: hit?.closest("[data-ly-row]")?.getAttribute("data-ly-row")?.slice(0, 8) || "",
					project: hit?.closest("[data-ly-project]")?.getAttribute("data-ly-project") || "",
				};
			});
			resolve({
				before,
				after: head?.getAttribute("aria-expanded"),
				head: hb && { y: Math.round(hb.y), h: Math.round(hb.height) },
				row: rb && { y: Math.round(rb.y), h: Math.round(rb.height) },
				clip: clip && { y: Math.round(clip.y), h: Math.round(clip.height) },
				samples,
			});
		}, 400);
	});
})()`);
console.log(JSON.stringify(result, null, 2));
