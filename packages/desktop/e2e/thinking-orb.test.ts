/**
 * The orb at the head of a running turn: that it draws, and that it draws the right thing.
 *
 * The unit tests prove which mood a tool maps to. They cannot prove any of what actually goes
 * wrong with a canvas component in Electron — that it mounts at all, that it paints something
 * rather than staying a blank 20×20 box, that it is legible on both themes, and that it stops when
 * the turn does. Those need a real window with a real turn running in it, which is this.
 *
 * Pixels rather than class names throughout. A canvas has no DOM to assert on: the only honest
 * evidence that an animation is running is that the bytes change between two frames, and the only
 * honest evidence that it suits a theme is the ink being lighter than the pane on dark and darker
 * on light.
 */

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { cleanupFixture } from "./fixture-cleanup.ts";

let app: RunningApp;
let model: Server;

const MODEL_PORT = 9567;
/** Held open so they can be hung up on at the end; an unclosed socket keeps the server alive. */
const open = new Set<import("node:http").ServerResponse>();

function sse(res: import("node:http").ServerResponse, payload: unknown): void {
	res.write(`event: ${(payload as { type: string }).type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

/**
 * A reply that starts and never finishes, which is what a long turn looks like from here.
 *
 * The orb only exists while a turn is running, so hanging the stream is the only way to hold it on
 * screen long enough to photograph it.
 */
function startModel(): Server {
	const server = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
			});
			open.add(res);
			res.on("close", () => open.delete(res));
			sse(res, {
				type: "message_start",
				message: { id: "msg_1", role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } },
			});
			sse(res, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
			sse(res, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "开始干活" } });
			// Left open on purpose: the turn has to still be running when the picture is taken.
		});
	});
	server.listen(MODEL_PORT, "127.0.0.1");
	return server;
}

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "one.ts"), "export const one = 1\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [
				{
					id: "local",
					name: "Local",
					baseUrl: `http://127.0.0.1:${MODEL_PORT}`,
					api: "anthropic-messages",
					apiKey: "not-a-key",
					enabled: true,
					models: [
						{
							id: "local/scripted",
							providerId: "local",
							modelId: "scripted",
							name: "Scripted",
							contextWindow: 200000,
							maxOutputTokens: 8192,
							supportsThinking: false,
							supportsImages: false,
							supportsTools: true,
						},
					],
				},
			],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: "local/scripted",
			permissionMode: "full",
			thinking: "off",
			retryAttempts: 1,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4521, token: null },
			appearance: { theme: "dark" },
		}),
	);
}

before(async () => {
	model = startModel();
	app = await startApp({ port: 9455, seed });
	await app.send("Emulation.setDeviceMetricsOverride", {
		width: 1280,
		height: 900,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await new Promise((r) => setTimeout(r, 600));
});

after(async () => {
	await cleanupFixture(
		() => app?.stop(),
		() => { for (const res of open) res.destroy(); },
		() => closeListeningServer(model),
	);
});

/** Type into the composer and send. */
async function ask(text: string): Promise<void> {
	await app.evaluate(`(() => {
		const field = document.querySelector("main textarea");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, ${JSON.stringify(text)});
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		return true;
	})()`);
}

/** Wait until the running indicator is on screen, or give up and say so. */
async function waitForRunning(): Promise<boolean> {
	for (let i = 0; i < 60; i++) {
		const there = await app.evaluate<boolean>(
			`Boolean(document.querySelector("main [data-ly-running] canvas"))`,
		);
		if (there) return true;
		await new Promise((r) => setTimeout(r, 250));
	}
	return false;
}

interface Ink {
	/** How many of the sampled pixels have any paint on them at all. */
	painted: number;
	/** Mean luminance of the painted pixels, 0–255. */
	luminance: number;
	/** The pane the orb is drawn on, for comparison. */
	pane: number;
}

/**
 * What the orb has actually painted, read off its own backing store.
 *
 * `getImageData` on the live canvas rather than a screenshot: it is the element's own pixels, so
 * nothing about window position, scaling or what is on top of it can move the answer.
 */
async function readInk(): Promise<Ink> {
	return app.evaluate<Ink>(`(() => {
		const canvas = document.querySelector("main [data-ly-running] canvas");
		const ctx = canvas.getContext("2d");
		const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
		let painted = 0;
		let sum = 0;
		for (let i = 0; i < data.length; i += 4) {
			const alpha = data[i + 3];
			if (alpha < 8) continue;
			painted++;
			// Rec. 601 luma, which is close enough for "is this ink light or dark".
			sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
		}
		// What the orb is drawn on: the nearest thing behind it that paints; main itself is a bare, transparent column.
		let host = canvas.parentElement;
		while (host && ["rgba(0, 0, 0, 0)", "transparent"].includes(getComputedStyle(host).backgroundColor)) host = host.parentElement;
		const paneCss = host ? getComputedStyle(host).backgroundColor : "white";
		const probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
		probe.fillStyle = paneCss;
		probe.fillRect(0, 0, 1, 1);
		const p = probe.getImageData(0, 0, 1, 1).data;
		return {
			painted,
			luminance: painted ? sum / painted : 0,
			pane: 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2],
			_size: [width, height],
		};
	})()`);
}

async function setTheme(theme: "dark" | "light"): Promise<void> {
	await app.evaluate(`(async () => {
		const s = await window.lyra.settings.get();
		await window.lyra.settings.save({ ...s, appearance: { ...s.appearance, theme: ${JSON.stringify(theme)} } });
		return true;
	})()`);
	// The theme lands through a settings round trip and a repaint; this is past both.
	await new Promise((r) => setTimeout(r, 900));
}

test("a running turn draws an orb, and it is really drawing", async () => {
	await ask("跑一个长活");
	assert.ok(await waitForRunning(), "the running indicator appears with a canvas in it");

	const box = await app.evaluate<{ w: number; h: number; inRunning: boolean }>(`(() => {
		const canvas = document.querySelector("main [data-ly-running] canvas");
		const r = canvas.getBoundingClientRect();
		return { w: Math.round(r.width), h: Math.round(r.height), inRunning: Boolean(canvas.closest("[data-ly-running]")) };
	})()`);
	assert.ok(box.inRunning, "it belongs to the running indicator rather than to something else");
	// The inline preset: 20 CSS px square, sized to sit in a line of text.
	assert.equal(box.w, 20, `20px wide (${box.w})`);
	assert.equal(box.h, 20, `20px tall (${box.h})`);

	const ink = await readInk();
	assert.ok(ink.painted > 20, `it has painted something rather than staying blank (${ink.painted} px)`);
});

async function withReducedMotion(reduced: boolean, run: (evaluate: (expression: string) => Promise<unknown>) => Promise<void>) {
	const targets: { type: string; url: string; webSocketDebuggerUrl?: string }[] = await fetch("http://127.0.0.1:9455/json/list").then((response) => response.json());
	const target = targets.find((entry) => entry.type === "page" && entry.url.endsWith("/index.html"));
	assert.ok(target?.webSocketDebuggerUrl);
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	try {
		await new Promise<void>((resolve, reject) => {
			socket.addEventListener("open", () => resolve(), { once: true });
			socket.addEventListener("error", () => reject(new Error("motion emulation connection failed")), { once: true });
		});
		// The library reads the OS media query; keep its debugger session alive during pixel sampling.
		let id = 0;
		const send = (method: string, params: Record<string, unknown>) => new Promise<unknown>((resolve, reject) => {
			const request = ++id;
			const listener = (event: MessageEvent) => {
				const message: { id?: number; error?: { message: string }; result?: { exceptionDetails?: { text: string; exception?: { description?: string } }; result?: { value?: unknown } } } = JSON.parse(String(event.data));
				if (message.id !== request) return;
				socket.removeEventListener("message", listener);
				if (message.error) reject(new Error(message.error.message));
				else if (message.result?.exceptionDetails) reject(new Error(message.result.exceptionDetails.exception?.description ?? message.result.exceptionDetails.text));
				else resolve(message.result?.result?.value);
			};
			socket.addEventListener("message", listener);
			socket.send(JSON.stringify({ id: request, method, params }));
		});
		await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }] });
		// Attaching another debugger clears Chromium's emulation, so read through this socket too.
		const evaluate = (expression: string) => send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
		assert.equal(await evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`), reduced);
		await run(evaluate);
	} finally {
		socket.close();
	}
}

test("the animation moves normally and paints a static frame with reduced motion", async (t) => {
	/*
	 * Two reads a few frames apart. A canvas that mounted, painted once and then stopped looks
	 * exactly like a working one in a screenshot — this is the difference, and it is the failure
	 * mode a `requestAnimationFrame` loop that never starts actually has.
	 */
	const snapshot = `(() => {
			const canvas = document.querySelector("main [data-ly-running] canvas");
			const ctx = canvas.getContext("2d");
			const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
			let hash = 0;
			for (let i = 0; i < data.length; i += 17) hash = (hash * 31 + data[i]) >>> 0;
			return String(hash);
		})()`;

	/*
	 * On screen first. The scripted reply says a few words and then nothing, and while words are still
	 * arriving the line is folded away (`useAnswering` — the answer has overtaken it); it comes back
	 * once they stop. Folded, the orb is clipped to nothing, and the library rightly stops drawing what
	 * nobody can see, so a still canvas there says nothing about the animation.
	 */
	await app.evaluate(`new Promise((resolve, reject) => { const end = performance.now() + 8000; const step = () => { const fold = document.querySelector("main [data-ly-running] canvas")?.closest(".ly-reveal"); if (fold?.dataset.open === "true" && fold.getBoundingClientRect().height > 20) resolve(true); else if (performance.now() > end) reject(new Error("the running line never unfolded")); else requestAnimationFrame(step); }; step(); })`);
	for (const reduced of [false, true]) await withReducedMotion(reduced, async (evaluate) => {
		await evaluate(`new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
		const before = await evaluate(snapshot);
		await new Promise((r) => setTimeout(r, 500));
		const after = await evaluate(snapshot);
		t.diagnostic(JSON.stringify({ reduced, before, after }));
		if (reduced) assert.equal(after, before, "reduced motion keeps a static representative frame");
		else assert.notEqual(after, before, "the pixels changed between two reads half a second apart");
	});
});

test("the ink suits the theme it is drawn on", async () => {
	// Dark: light ink on a dark pane.
	await setTheme("dark");
	assert.ok(await waitForRunning(), "still running after the theme change");
	const dark = await readInk();
	assert.ok(dark.painted > 20, `paints on dark (${dark.painted} px)`);
	assert.ok(
		dark.luminance > dark.pane + 30,
		`ink is lighter than the pane on dark (ink ${dark.luminance.toFixed(0)}, pane ${dark.pane.toFixed(0)})`,
	);

	// Light: dark ink on a light pane. The library resolves this from the `dark`/`light` class the
	// app puts on `<html>`, so this is also the test that our class and its `auto` agree.
	await setTheme("light");
	const light = await readInk();
	assert.ok(light.painted > 20, `paints on light (${light.painted} px)`);
	assert.ok(
		light.luminance < light.pane - 30,
		`ink is darker than the pane on light (ink ${light.luminance.toFixed(0)}, pane ${light.pane.toFixed(0)})`,
	);

	await setTheme("dark");
});

/**
 * The mark moves with the work, which is the whole point of there being nine of them.
 *
 * The first version only looked at tools that were *running*, and a `read` or an `ls` is over in
 * tens of milliseconds — so in practice the line sat on one state for an entire turn and the nine
 * animations were decoration. Text streaming is the common case and it now has its own state.
 */
test("the mark says the reply is being written while it streams", async () => {
	const mood = await app.evaluate<string | null>(
		`document.querySelector("main [data-ly-running]")?.dataset.lyMood ?? null`,
	);
	assert.equal(mood, "composing", "text is arriving, so it is not the thinking mark");

	// And the words agree with it, because they come from the same reading.
	const phrase = await app.evaluate<string>(
		`(document.querySelector("main [data-ly-running]")?.innerText ?? "").trim()`,
	);
	const composing = ["Writing", "Drafting", "Putting it down", "Getting it on paper", "Laying down code"];
	assert.ok(
		composing.some((word) => phrase.startsWith(word)),
		`the phrase is one of the writing words (${phrase})`,
	);
});

test("it goes away when the turn does", async () => {
	const stopped = await app.evaluate<boolean>(`(() => {
		const button = document.querySelector('main button[aria-label="停止"]');
		if (!button) return false;
		button.click();
		return true;
	})()`);
	assert.ok(stopped, "the stop button is there while the turn runs");

	for (let i = 0; i < 40; i++) {
		const gone = await app.evaluate<boolean>(`!document.querySelector("main [data-ly-running]")`);
		if (gone) return;
		await new Promise((r) => setTimeout(r, 250));
	}
	assert.fail("the running indicator is still on screen after the turn was stopped");
});
