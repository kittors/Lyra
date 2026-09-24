/** Real Electron verification for locale switching, long labels, and retained workspace state. */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";
import { landsOn } from "./lands-on.ts";

let app: RunningApp;

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1440, height: 900, x: 0, y: 0 }));
	await writeFile(join(home, "settings.json"), JSON.stringify({
		version: 1,
		uiLocale: "en",
		providers: [],
		mcpServers: [],
		projects: [],
		permissionMode: "auto",
		thinking: "medium",
		retryAttempts: 1,
		hooks: [],
		scheduledTasks: [],
		disabledPlugins: [],
		alwaysAllow: [],
		sync: { enabled: false, port: 4517, token: null },
	}));
}

before(async () => {
	app = await startApp({ port: 9608, seed });
});

after(async () => {
	await app?.stop();
});

test("switching every bundled locale updates visible UI without reloading or losing a draft", async () => {
	await app.evaluate(`document.querySelector('.ly-shell').dataset.i18nMount = 'kept'`);
	const textarea = await app.evaluate<{ x: number; y: number }>(`(()=>{const e=document.querySelector('textarea');const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;${landsOn("textarea", "e")}return {x,y};})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...textarea });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...textarea });
	await app.send("Input.insertText", { text: "draft survives language changes" });

	const locales = [
		["zh-CN", "新对话"],
		["zh-TW", "新對話"],
		["en", "New chat"],
		["fr", "Nouvelle discussion"],
		["ru", "Новая беседа"],
		["ko", "새 대화"],
		["ja", "新しい会話"],
	] as const;

	for (const [locale, expected] of locales) {
		const state = await app.evaluate<{ lang: string; body: string; draft: string; mount: string }>(`(async()=>{
			const settings=await window.lyra.settings.get();
			await window.lyra.settings.save({...settings,uiLocale:${JSON.stringify(locale)}});
			await new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
			return {lang:document.documentElement.lang,body:document.body.innerText,draft:document.querySelector('textarea')?.value??'',mount:document.querySelector('.ly-shell')?.dataset.i18nMount??''};
		})()`);
		assert.equal(state.lang, locale);
		assert.ok(state.body.includes(expected), `${locale}: ${state.body.slice(0, 240)}`);
		assert.equal(state.draft, "draft survives language changes");
		assert.equal(state.mount, "kept");
	}
});

test("the language menu exposes eight aligned choices and long locales do not overflow", async () => {
	await app.evaluate(`(async()=>{const settings=await window.lyra.settings.get();await window.lyra.settings.save({...settings,uiLocale:'zh-CN'});await new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));})()`);
	await app.evaluate(`document.querySelector('.ly-sidebar-foot button').click()`);
	await frames(20);
	await app.evaluate(`(()=>{const b=[...document.querySelectorAll('nav button')].find((e)=>e.textContent.trim()==='常规');if(!b)throw new Error('general section missing');b.click();})()`);
	await frames(20);
	const menu = await app.evaluate<{ count: number; marks: string[]; maxHeight: number }>(`(async()=>{
		const trigger=document.querySelector('button[aria-label="界面语言"]');
		if(!trigger)throw new Error('language trigger missing');
		trigger.click();
		await new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
		const popup=document.querySelector('[role="menu"]');
		const rows=[...popup.querySelectorAll('button')];
		return {count:rows.length,marks:rows.map((row)=>row.firstElementChild?.textContent?.trim()??''),maxHeight:popup.getBoundingClientRect().height};
	})()`);
	assert.equal(menu.count, 8);
	assert.deepEqual(menu.marks, ["", "中", "繁", "EN", "FR", "РУ", "한", "日"]);
	assert.ok(menu.maxHeight <= 360, `language menu is ${menu.maxHeight}px high`);

	await app.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
	await app.send("Emulation.setDeviceMetricsOverride", { width: 760, height: 900, deviceScaleFactor: 1, mobile: false });
	const wide = await switchAndMeasure("fr");
	assert.ok(wide.documentWidth <= 760, JSON.stringify(wide));
	assert.equal(wide.clippedButtons, 0, JSON.stringify(wide));

	await app.send("Emulation.setDeviceMetricsOverride", { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
	const narrow = await switchAndMeasure("ru");
	assert.ok(narrow.documentWidth <= 375, JSON.stringify(narrow));
	assert.equal(narrow.clippedButtons, 0, JSON.stringify(narrow));
	await capture("i18n-russian-375");
});

async function switchAndMeasure(locale: string) {
	return app.evaluate<{ documentWidth: number; clippedButtons: number }>(`(async()=>{
		const settings=await window.lyra.settings.get();
		await window.lyra.settings.save({...settings,uiLocale:${JSON.stringify(locale)}});
		await new Promise((resolve)=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
		const buttons=[...document.querySelectorAll('nav button')].filter((element)=>element.checkVisibility({visibilityProperty:true}));
		return {documentWidth:document.documentElement.scrollWidth,clippedButtons:buttons.filter((element)=>element.scrollWidth>element.clientWidth+1).length};
	})()`);
}

async function frames(count: number): Promise<void> {
	await app.evaluate(`new Promise((resolve)=>{let count=${count};const frame=()=>--count?requestAnimationFrame(frame):resolve();requestAnimationFrame(frame);})`);
}

async function capture(name: string): Promise<void> {
	const directory = process.env.LYRA_E2E_ARTIFACTS;
	if (!directory) return;
	await mkdir(directory, { recursive: true });
	const result = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(directory, `${name}.png`), Buffer.from(result.data, "base64"));
}
