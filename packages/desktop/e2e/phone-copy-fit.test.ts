/**
 * Words on a phone that have to fit: the model's name and the placeholder in the composer, and the
 * title of an approval — in every interface language, at the widths phones come in.
 *
 * Measured on the real phone renderer, because every one of these went wrong in layout rather than
 * in logic, and only in languages nobody was looking at. In English the reasoning level said
 * "Medium" beside the model and left its name at `Claude Sonn…` on a 390pt screen; in Russian it was
 * worse. An approval's kind and countdown never shrank, and at 390pt the title between them was
 * 56pt wide and split "reworded" into "reword" / "ed" — at 320pt it stood one letter to a line. The
 * placeholder wrapped onto a second line in four languages out of seven. Chinese fitted every time,
 * which is why none of it was noticed.
 */

import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { cleanupFixture } from "./fixture-cleanup.ts";
import { seedInteractions } from "./interaction-fixture.ts";
import { startMobile } from "./mobile-app.ts";

const SYNC_PORT = 4613;
const TOKEN = "phone-copy-fit-isolated-test-token";
const LOCALES = ["en", "zh-CN", "zh-TW", "ja", "ko", "fr", "ru"];
const WIDTHS = [320, 390, 430];
const MODEL = "Claude Sonnet 5";
const TITLE = "Force-push the reworded commit";

let desktop: RunningApp;
let phone: Awaited<ReturnType<typeof startMobile>>;

/** Answers with one command to approve, then with a line of text once there is a result. */
const model = createServer((request, response) => {
	let raw = "";
	request.on("data", (chunk) => { raw += chunk; });
	request.on("end", () => {
		const recent = JSON.stringify((JSON.parse(raw) as { messages: unknown[] }).messages.slice(-3));
		response.writeHead(200, { "content-type": "text/event-stream" });
		if (recent.includes("FORCE_PUSH") && !recent.includes('"tool_result"')) {
			reply(response, { tool: { name: "bash", input: { command: "git push --force-with-lease origin fix/offline-merge", description: TITLE } } });
		} else reply(response, { text: "Done." });
	});
});

function reply(response: ServerResponse, content: { text?: string; tool?: { name: string; input: object } }) {
	const emit = (event: { type: string; [key: string]: unknown }) => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
	emit({ type: "message_start", message: { id: "phone-copy-fit", role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } } });
	emit({ type: "content_block_start", index: 0, content_block: content.tool ? { type: "tool_use", id: "push-1", name: content.tool.name, input: {} } : { type: "text", text: "" } });
	emit({ type: "content_block_delta", index: 0, delta: content.tool ? { type: "input_json_delta", partial_json: JSON.stringify(content.tool.input) } : { type: "text_delta", text: content.text } });
	emit({ type: "content_block_stop", index: 0 });
	emit({ type: "message_delta", delta: { stop_reason: content.tool ? "tool_use" : "end_turn" }, usage: { output_tokens: 10 } });
	emit({ type: "message_stop" });
	response.end();
}

type Page = Pick<RunningApp, "evaluate" | "send">;

async function until(page: Page, expression: string, label = expression, timeout = 15_000) {
	const started = performance.now();
	while (performance.now() - started < timeout) {
		if (await page.evaluate<boolean>(expression)) return;
		await new Promise((resolve) => setTimeout(resolve, 80));
	}
	throw new Error(`${label}: ${await page.evaluate("document.body.innerText.slice(-1200)")}`);
}

/** A tap where the element is, after checking that it is the element there. */
async function click(page: Page, selector: string) {
	const point = await page.evaluate<{ x: number; y: number }>(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.checkVisibility({visibilityProperty:true}));if(!el)throw new Error(${JSON.stringify(selector)});const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);if(!hit||!el.contains(hit))throw new Error(${JSON.stringify(selector)}+' is covered');return {x,y};})()`);
	await page.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
	await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
}

async function frames() {
	await phone.evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))");
}

async function size(width: number) {
	await phone.send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile: true });
	await phone.send("Emulation.setTouchEmulationEnabled", { enabled: true });
	await frames();
}

async function locale(value: string) {
	await phone.evaluate(`(async()=>{const s=await window.lyra.settings.get();await window.lyra.settings.save({...s,uiLocale:${JSON.stringify(value)}});return true;})()`);
	await until(phone, `document.documentElement.lang===${JSON.stringify(value)}`, `interface in ${value}`);
	await frames();
}

/*
 * The measurements run in the page. Written as functions and sent as their source, so they can be
 * read and changed as code rather than as strings inside strings; nothing from this module reaches
 * them.
 */

/** What the composer's row shows: the model's name as it can be read, and whether anything is cut. */
function composerFit() {
	const field = [...document.querySelectorAll("main textarea")].find((t) => t.checkVisibility()) as HTMLTextAreaElement;
	const shell = field.closest(".ly-composer") as HTMLElement;
	const probe = shell.querySelector(".ly-fit-probe") as HTMLElement;
	const parts = probe.querySelector(".ly-model-name");
	let shown: string;
	let cut: boolean;
	if (parts) {
		// The house's word is shown only while it shares the first line with the rest of the name.
		const house = parts.querySelector("[data-ly-model-house]") as HTMLElement;
		const rest = [...parts.children].find((child) => child !== house) as HTMLElement;
		const together = Math.abs(house.getBoundingClientRect().top - rest.getBoundingClientRect().top) < 1;
		shown = together ? `${house.textContent} ${rest.textContent}` : (rest.textContent ?? "");
		cut = rest.scrollWidth > rest.clientWidth + 1 || parts.getBoundingClientRect().height > rest.getBoundingClientRect().height + 1;
	} else {
		const value = (probe.querySelector(".ly-roll-value") as HTMLElement | null) ?? probe;
		shown = probe.textContent ?? "";
		cut = probe.scrollWidth > probe.clientWidth + 1 || value.scrollWidth > value.clientWidth + 1;
	}
	const effort = probe.closest("button")?.nextElementSibling as HTMLElement;
	const controls = [...shell.querySelectorAll("button")]
		.filter((button) => button.checkVisibility({ visibilityProperty: true }) && getComputedStyle(button).opacity !== "0")
		.map((button) => ({ label: button.getAttribute("aria-label"), w: button.getBoundingClientRect().width, h: button.getBoundingClientRect().height }));
	// The placeholder on one line: its own width, set in the field's font, against the field's room.
	const style = getComputedStyle(field);
	const ruler = document.createElement("span");
	ruler.textContent = field.placeholder;
	ruler.style.cssText = `position:fixed;left:0;top:0;visibility:hidden;white-space:pre;font:${style.font};letter-spacing:${style.letterSpacing}`;
	document.body.append(ruler);
	const placeholder = ruler.getBoundingClientRect().width;
	ruler.remove();
	const room = field.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
	const chip = probe.closest("button") as HTMLElement;
	const chipStyle = getComputedStyle(chip);
	const bar = chip.closest(".ly-composer-bar") as HTMLElement | null;
	const name = (parts ? [...parts.children].find((child) => !child.hasAttribute("data-ly-model-house")) : probe.querySelector(".ly-roll-value") ?? probe) as HTMLElement;
	return {
		shown,
		cut,
		room: { name: [name.scrollWidth, name.clientWidth], chip: [chip.getBoundingClientRect().width, chipStyle.paddingLeft, chipStyle.paddingRight, chipStyle.gap], bar: bar ? [bar.getBoundingClientRect().width, getComputedStyle(bar).gap] : null },
		effort: { text: effort.textContent?.trim() ?? "", w: effort.getBoundingClientRect().width, label: effort.getAttribute("aria-label") },
		controls,
		placeholder: { text: field.placeholder, needs: Math.ceil(placeholder), room: Math.floor(room) },
	};
}

/** The approval card's header: whether any word of the title is split across lines, and the room it has. */
function approvalFit() {
	const card = document.querySelector("[data-approval-card]") as HTMLElement;
	const head = card.querySelector("[data-approval-head]") as HTMLElement;
	const title = head.querySelector("[data-approval-title]") as HTMLElement;
	const text = [...title.childNodes].find((node) => node.nodeType === Node.TEXT_NODE) as Text;
	const broken: string[] = [];
	// Latin and Cyrillic words, hyphen-separated parts counted apart: breaking after a hyphen is a break between words.
	for (const match of (text.textContent ?? "").matchAll(/[A-Za-z0-9À-ɏЀ-ӿ']+/g)) {
		const range = document.createRange();
		range.setStart(text, match.index);
		range.setEnd(text, match.index + match[0].length);
		const lines = new Set([...range.getClientRects()].filter((rect) => rect.width > 0).map((rect) => Math.round(rect.top)));
		if (lines.size > 1) broken.push(match[0]);
	}
	const meta = head.querySelector("[data-approval-meta]");
	const buttons = [...card.querySelectorAll("button")]
		.filter((button) => button.checkVisibility({ visibilityProperty: true }))
		.map((button) => ({ label: button.getAttribute("aria-label") ?? button.textContent?.trim(), w: button.getBoundingClientRect().width, h: button.getBoundingClientRect().height }));
	return {
		title: text.textContent,
		broken,
		share: title.getBoundingClientRect().width / head.getBoundingClientRect().width,
		metaBelow: Boolean(meta && meta.getBoundingClientRect().top >= title.getBoundingClientRect().bottom - 1 && meta.textContent),
		buttons,
	};
}

before(async () => {
	await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
	const address = model.address();
	assert.ok(address && typeof address !== "string");
	desktop = await startApp({
		port: 9745,
		seed: async (home) => {
			await seedInteractions(home, address.port);
			const file = join(home, "settings.json");
			const settings = JSON.parse(await readFile(file, "utf8"));
			// The model the report was about: a Claude mark and a three-word name, with reasoning on.
			Object.assign(settings.providers[0].models[0], { modelId: "claude-sonnet-5", name: MODEL, supportsThinking: true });
			Object.assign(settings, {
				thinking: "medium",
				permissionMode: "ask",
				uiLocale: "en",
				appearance: { theme: "light", reduceMotion: "on" },
				sync: { enabled: true, port: SYNC_PORT, token: TOKEN },
			});
			await writeFile(file, JSON.stringify(settings));
		},
	});
	phone = await startMobile(desktop.home, { host: "127.0.0.1", port: SYNC_PORT, token: TOKEN, platform: "darwin" }, 9749);
	await until(phone, "!!document.querySelector('.ly-shell')", "phone shell", 30_000);
	await until(phone, "!!document.querySelector('main textarea')", "composer", 30_000);
});

after(async () => {
	await cleanupFixture(
		() => phone?.stop(),
		() => desktop?.stop(),
		() => closeListeningServer(model),
	);
});

test("the model's name is whole wherever it fits, and never cut where it does not, in every language", async (t) => {
	for (const value of LOCALES) {
		await locale(value);
		for (const width of WIDTHS) {
			await size(width);
			const fit = await phone.evaluate<ReturnType<typeof composerFit>>(`(${composerFit.toString()})()`);
			const at = `${value} at ${width}pt: ${JSON.stringify(fit)}`;
			if (process.env.LYRA_E2E_ARTIFACTS && (value === "en" || value === "zh-CN")) {
				// The composer as it is drawn, for looking at: the row these numbers are about.
				const clip = await phone.evaluate<{ x: number; y: number; width: number; height: number }>(`(() => { const r = [...document.querySelectorAll("main textarea")].find((t) => t.checkVisibility()).closest(".ly-composer").getBoundingClientRect(); return { x: Math.max(0, r.x - 12), y: Math.max(0, r.y - 12), width: r.width + 24, height: r.height + 24 }; })()`);
				const { data } = await phone.send<{ data: string }>("Page.captureScreenshot", { format: "png", clip: { ...clip, scale: 2 } });
				await mkdir(process.env.LYRA_E2E_ARTIFACTS, { recursive: true });
				await writeFile(join(process.env.LYRA_E2E_ARTIFACTS, `phone-composer-${value}-${width}.png`), Buffer.from(data, "base64"));
			}
			t.diagnostic(at);
			assert.equal(fit.cut, false, `the name is never cut off mid-word — ${at}`);
			if (width >= 390) assert.equal(fit.shown, MODEL, `the whole name wherever a phone has 390pt — ${at}`);
			// Short of room it gives up the house's word, which the mark beside it already says.
			else assert.ok(fit.shown === MODEL || fit.shown === "Sonnet 5", `the whole name or the name without its house — ${at}`);
			assert.equal(fit.effort.text, "", `the reasoning level is drawn, not named, so it is as wide in every language — ${at}`);
			assert.ok(fit.effort.w <= 45, `the reasoning level keeps to one 44pt target — ${at}`);
			assert.ok(fit.effort.label && fit.effort.label.length > 0, `the level is still named for assistive technology — ${at}`);
			for (const control of fit.controls) assert.ok(control.w >= 44 && control.h >= 44, `a thumb's target — ${JSON.stringify(control)} ${at}`);
			assert.ok(fit.placeholder.needs <= fit.placeholder.room, `the placeholder fits on its one line — ${at}`);
		}
	}
});

test("an approval's title keeps its words whole, with the kind and the countdown on the line under it", async (t) => {
	await locale("en");
	await size(390);
	await click(phone, "main textarea");
	await phone.send("Input.insertText", { text: "FORCE_PUSH the reworded commit" });
	await click(phone, 'main button[aria-label="Send"]');
	await until(phone, "!!document.querySelector('[data-approval-card] [data-approval-head]')", "the approval card", 30_000);
	for (const value of LOCALES) {
		await locale(value);
		for (const width of WIDTHS) {
			await size(width);
			const card = await phone.evaluate<ReturnType<typeof approvalFit>>(`(${approvalFit.toString()})()`);
			const at = `${value} at ${width}pt: ${JSON.stringify(card)}`;
			t.diagnostic(at);
			assert.equal(card.title, TITLE);
			assert.deepEqual(card.broken, [], `no word of the title is split across two lines — ${at}`);
			assert.ok(card.share >= 0.55, `the title has the header's row, not what two labels leave of it — ${at}`);
			assert.ok(card.metaBelow, `the kind and the countdown are the title's caption, under it — ${at}`);
			for (const button of card.buttons) assert.ok(button.w >= 44 && button.h >= 44, `a thumb's target — ${JSON.stringify(button)} ${at}`);
		}
	}
});
