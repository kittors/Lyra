/** Screenshot / inspect a running dev instance. Scratch — delete after use. */

import { writeFile } from "node:fs/promises";

const port = process.argv[2] ?? "9345";
const out = process.argv[3] ?? "/tmp/attach.png";
const scroll = Number(process.argv[4] ?? 0);

const targets = (await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json())) as {
	type: string;
	webSocketDebuggerUrl?: string;
}[];
const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
if (!page?.webSocketDebuggerUrl) throw new Error("no page");

let id = 0;
function call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(page!.webSocketDebuggerUrl!);
		const mine = ++id;
		socket.addEventListener("open", () => socket.send(JSON.stringify({ id: mine, method, params })));
		socket.addEventListener("message", (event) => {
			const message = JSON.parse(String(event.data));
			if (message.id !== mine) return;
			socket.close();
			if (message.error) reject(new Error(message.error.message));
			else resolve(message.result as T);
		});
		socket.addEventListener("error", reject);
		setTimeout(() => reject(new Error("timeout")), 15_000);
	});
}

if (process.env.DARK === "1") {
	// Through the real settings flow — toggling a class alone would leave every computed
	// --color-* token (set by applyAppearance, not by a CSS selector) at its light values.
	await call("Runtime.evaluate", {
		expression: `(() => {
			document.querySelector("[data-ly-open-settings]")?.click();
			return true;
		})()`,
		returnByValue: true,
	});
	await new Promise((r) => setTimeout(r, 400));
	await call("Runtime.evaluate", {
		expression: `(() => {
			[...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "外观")?.click();
			return true;
		})()`,
		returnByValue: true,
	});
	await new Promise((r) => setTimeout(r, 400));
	await call("Runtime.evaluate", {
		expression: `(() => {
			[...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === "深色")?.click();
			return true;
		})()`,
		returnByValue: true,
	});
	await new Promise((r) => setTimeout(r, 400));
	// Back to the chat, where the sidebar is what we came to look at.
	await call("Runtime.evaluate", {
		expression: `(() => { document.querySelector('[aria-label="返回工作区"]')?.click(); return true; })()`,
		returnByValue: true,
	});
	await new Promise((r) => setTimeout(r, 300));
}

// Scroll first and let the measurement run; reading in the same tick sees stale values.
await call("Runtime.evaluate", {
	expression: `(() => { document.querySelector(".ly-sidebar-fill .ly-scroll-view").scrollTop = ${scroll}; return true; })()`,
	returnByValue: true,
});
await new Promise((r) => setTimeout(r, 400));

const probe = await call<{ result: { value: unknown } }>("Runtime.evaluate", {
	expression: `(() => {
		const view = document.querySelector(".ly-sidebar-fill .ly-scroll-view");
		if (!view) return { error: "no sidebar scroller" };
		const pane = document.querySelector(".ly-sidebar-fill");
		const head = view.querySelector("[data-ly-head]");
		const strip = view.querySelector("[data-ly-rail]");
		const origin = view.getBoundingClientRect().top;
		const cs = getComputedStyle(view);
		return {
			paneBg: getComputedStyle(pane).backgroundColor,
			behind: getComputedStyle(pane).getPropertyValue("--ly-behind").trim(),
			headBg: head ? getComputedStyle(head).backgroundColor : null,
			stripBg: strip ? getComputedStyle(strip).backgroundColor : null,
			scrollTop: Math.round(view.scrollTop),
			stripY: strip ? Math.round(strip.getBoundingClientRect().top - origin) : null,
			headY: head ? Math.round(head.getBoundingClientRect().top - origin) : null,
			inset: cs.getPropertyValue("--ly-fade-inset").trim(),
			inlineStyle: view.getAttribute("style"),
			railRows: view.querySelectorAll("[data-ly-rail]").length,
			stripExact: strip ? (strip.getBoundingClientRect().top - origin) : null,
			stripBottom: strip ? (strip.getBoundingClientRect().bottom - origin) : null,
			debug: window.__stickyDebug,
			panes: document.querySelectorAll(".ly-sidebar-fill").length,
			scrollers: document.querySelectorAll(".ly-sidebar-fill .ly-scroll-view").length,
			allInsets: [...document.querySelectorAll(".ly-sidebar-fill .ly-scroll-view")].map((v) => v.style.getPropertyValue("--ly-fade-inset")),
			replay: (() => {
				const rows = [];
				if (strip) { const r = strip.getBoundingClientRect(); rows.push({ t: r.top - origin, b: r.bottom - origin, rail: 0 }); }
				for (const h of view.querySelectorAll("[data-ly-head]")) {
					const r = h.getBoundingClientRect();
					rows.push({ t: Math.round(r.top - origin), b: Math.round(r.bottom - origin), rail: 44 });
				}
				let depth = 0;
				for (const r of rows) if (r.t <= r.rail + 0.5) depth = Math.max(depth, r.b);
				return { depth, rows };
			})(),
			headRows: view.querySelectorAll("[data-ly-head]").length,
			fadeTop: cs.getPropertyValue("--ly-fade-top").trim(),
		};
	})()`,
	returnByValue: true,
});
process.stdout.write(`${JSON.stringify(probe.result.value)}\n`);

await new Promise((r) => setTimeout(r, 500));
const shot = await call<{ data: string }>("Page.captureScreenshot", { format: "png" });
await writeFile(out, Buffer.from(shot.data, "base64"));
process.stdout.write(`wrote ${out}\n`);
