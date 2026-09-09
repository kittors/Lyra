import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

let app: RunningApp;
before(async () => {
	app = await startApp({ port: 9613, seed: async (home) => {
		await seedInteractions(home);
		const path = join(home, "settings.json");
		const settings = JSON.parse(await readFile(path, "utf8"));
		// Synthetic catalog and transcript, loaded by the actual Electron application.
		settings.providers = Array.from({ length: 3 }, (_, p) => ({ id: `p${p}`, name: `供应商 ${p}`, enabled: true, api: "openai-responses", apiKey: "test", baseUrl: "http://127.0.0.1:1", models: Array.from({ length: 20 }, (_, i) => ({
			id: `p${p}/m${i}`, providerId: `p${p}`, modelId: i === 0 ? "gpt-5.6-terra" : `gemini-relay-${i}`, name: i === 0 ? "同名模型" : `Gemini ${i} · 需要横向滚动才能读完的完整模型名称`, supportsThinking: true, supportsTools: true, supportsImages: true, contextWindow: 200000, maxOutputTokens: 8192,
			...(i === 1 ? { thinkingOptions: [{ id: "off", label: "关闭", detail: "" }, { id: "adaptive", label: "自适应", detail: "隔离配置明确声明", isDefault: true }] } : {}),
		})) }));
		settings.defaultModelId = "p0/m0"; settings.favoriteModelIds = ["p1/m1", "p2/m0"]; settings.projectMemory = false;
		await writeFile(path, JSON.stringify(settings));
		const metas = JSON.parse(await readFile(join(home, "sessions", "index.json"), "utf8"));
			for (const meta of metas) {
				meta.modelId = "p0/m0";
			const log = join(home, "sessions", meta.projectId, `${meta.id}.jsonl`);
			const entries = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
			for (const entry of entries) {
				if (entry.meta) entry.meta.modelId = "p0/m0";
				if (entry.message?.role === "assistant") entry.message.content[0].text = `**格式化回答**\n\n### 段落标题\n\n- 使用 \`Index\`\n\n${entry.message.content[0].text}`;
			}
				await writeFile(log, entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
			}
			await writeFile(join(home, "sessions", "index.json"), JSON.stringify(metas));
	} });
});
after(async () => { await app?.stop(); });
afterEach(async (t) => {
	if (!t.passed) { await shot("navigation-models-failure"); t.diagnostic(await app.evaluate<string>(`document.body.innerText.slice(-4000)`)); }
});
async function frames(n = 20) { await app.evaluate(`new Promise(r=>{let n=${n};const f=()=>--n?requestAnimationFrame(f):r();requestAnimationFrame(f);})`); }
async function until(expression: string) {
	await app.evaluate(`new Promise((resolve,reject)=>{let n=400;const f=()=>{if(${expression})resolve();else if(--n)requestAnimationFrame(f);else reject(new Error(${JSON.stringify(expression)}));};f();})`);
}
async function point(selector: string) {
	return app.evaluate<{ x: number; y: number }>(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw new Error(${JSON.stringify(selector)});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
}
async function click(selector: string) {
	await app.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
	const at = await point(selector);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await app.send("Input.dispatchMouseEvent", { type, ...at, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
	await frames(3);
}
async function label(text: string, scope = "nav button") {
	await until(`[...document.querySelectorAll(${JSON.stringify(scope)})].some(e=>e.checkVisibility({visibilityProperty:true})&&e.textContent.trim()===${JSON.stringify(text)})`);
	await app.evaluate(`(()=>{document.querySelector('[data-qa-target]')?.removeAttribute('data-qa-target');const e=[...document.querySelectorAll(${JSON.stringify(scope)})].find(e=>e.checkVisibility()&&e.textContent.trim()===${JSON.stringify(text)});if(!e)throw new Error(${JSON.stringify(text)});e.setAttribute('data-qa-target','');})()`);
	await click('[data-qa-target]');
}
async function key(key: string, code: number) {
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key, windowsVirtualKeyCode: code });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key, windowsVirtualKeyCode: code }); await frames(3);
}
async function shot(name: string) {
	const directory = process.env.LYRA_E2E_ARTIFACTS; if (!directory) return;
	await mkdir(directory, { recursive: true });
	const image = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(directory, `${name}.png`), Buffer.from(image.data, "base64"));
}

test("navigation clicks land instantly inside and outside the transcript window, with no rail movement or reopened preview", async (t) => {
	await click('[data-ly-row="qa-long"] > button');
	await until(`document.querySelectorAll('.ly-question-mark').length===15`);
	await click('.ly-question-mark'); await key("Home", 36);
	for (const [outside, settledHover] of [[false, true], [true, true], [false, false]]) {
		if (outside) {
			await key("End", 35);
			const at = await point('.ly-question-rail');
			for (let i = 0; i < 25; i++) await app.send("Input.dispatchMouseEvent", { type: "mouseWheel", ...at, deltaX: 0, deltaY: -30 });
			await frames(3);
		}
		if (!settledHover) { await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 500, y: 200 }); await frames(3); }
		const position = outside ? await app.evaluate<number>(`Number(document.querySelector('.ly-question-mark').dataset.position)`) : !settledHover ? await app.evaluate<number>(`Number(document.querySelector('.ly-question-mark[aria-current="location"]').dataset.position)+1`) : 9;
		assert.equal(await app.evaluate(`Boolean(document.querySelector('[data-question-index="${position * 2}"]'))`), !outside);
		const selector = `.ly-question-mark[data-position="${position}"]`;
		const at = await point(selector);
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at }); await frames(settledHover ? 20 : 3);
		if (settledHover) {
			/*
			 * 预览里是摘要，不是渲染过的 Markdown。
			 *
			 * 这两条从前找 `strong` 和 `h3`，可 `markdownExcerpt` 出来的是纯文本——预览是一行
			 * 提要，本来就不该带标题和粗体。断言的是一套没有实现过的行为。
			 */
			const excerpt = await app.evaluate<string>(`document.querySelector('.ly-question-excerpt')?.textContent ?? ""`);
			assert.match(excerpt, /格式化回答/);
			assert.match(excerpt, /段落标题/);
			await shot("markdown-question-preview");
		}
		const marks = await app.evaluate<number[]>(`[...document.querySelectorAll('.ly-question-mark')].map(e=>Number(e.dataset.position))`);

		await app.evaluate(`document.addEventListener('click',()=>{window.qaBeforeWidths=[...document.querySelectorAll('.ly-question-mark span')].map(e=>e.getBoundingClientRect().width);window.qaSamples=new Promise(resolve=>{const out=[];const f=()=>{const row=document.querySelector('[data-question-index="${position * 2}"]'), viewport=document.querySelector('.ly-transcript').closest('.ly-scroll-view');out.push({y:row?.getBoundingClientRect().top-viewport.getBoundingClientRect().top,marks:[...document.querySelectorAll('.ly-question-mark')].map(e=>Number(e.dataset.position)),widths:[...document.querySelectorAll('.ly-question-mark span')].map(e=>e.getBoundingClientRect().width),preview:getComputedStyle(document.querySelector('.ly-question-preview')).opacity,rows:document.querySelector('.ly-transcript').children.length});if(out.length<24)requestAnimationFrame(f);else resolve(out);};requestAnimationFrame(f);});},{once:true,capture:true});void 0`);
		for (const type of ["mousePressed", "mouseReleased"]) await app.send("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
		const samples = await app.evaluate<{ y: number; marks: number[]; widths: number[]; preview: string; rows: number }[]>(`window.qaSamples`);
		const widths = await app.evaluate<number[]>(`window.qaBeforeWidths`);
		if (!settledHover) assert.ok(widths[marks.indexOf(position)] > 6 && widths[marks.indexOf(position)] < 22, JSON.stringify(widths));
		for (const sample of samples) {
			assert.ok(Math.abs(sample.y - 40) <= 1, JSON.stringify(sample));
			assert.deepEqual(sample.marks, marks); assert.deepEqual(sample.widths, widths);
			assert.equal(sample.preview, "0"); assert.ok(sample.rows <= 62);
		}
		t.diagnostic(JSON.stringify({ outside, settledHover, position, frames: samples.length, first: samples[0], last: samples.at(-1) }));
	}
});

test("role and subagent menus share a bounded searchable favourite catalog without changing the active session", async (t) => {
	await click('button:has(svg.lucide-settings)'); await label("模型设置"); await frames();
	// 标签是 `{name} 模型`——底下那句 `[aria-label="explore 模型"]` 用的就是这个格式。
	await click('[aria-label="fast 模型"]'); await frames();
	const menuGeometry = () => app.evaluate<{ height: number; right: number; bottom: number; first: string; fade: string }>(`(()=>{const m=document.querySelector('[aria-label="选择模型"]'),r=m.getBoundingClientRect();return {height:r.height,right:r.right,bottom:r.bottom,first:m.querySelector('[data-model]').dataset.model,fade:m.querySelector('.ly-scroll-view').style.getPropertyValue('--ly-fade-bottom')};})()`);
	const roleMenu = await menuGeometry();
	assert.ok(roleMenu.height <= 420); assert.equal(roleMenu.first, "p1/m1"); assert.equal(roleMenu.fade, "48px");
	await shot("model-role-favourites");
	await click('[data-model="p1/m1"] [role="menuitem"]'); await frames();
	await label("子智能体"); await until(`document.querySelector('[aria-label="explore 模型"]')`);
	await click('[aria-label="explore 模型"]'); await frames();
	assert.equal((await menuGeometry()).first, "p1/m1");
	await click('[data-model="p1/m1"] [role="menuitem"]'); await frames();
	await click('[aria-label="explore 思考等级"]'); await frames();
	const levels = await app.evaluate<string[]>(`[...document.querySelectorAll('[role="menuitem"]')].map(e=>e.textContent.trim())`);
	assert.equal(levels.length, 3); assert.ok(levels.some((text) => text.startsWith("自适应"))); assert.ok(!levels.some((text) => text === "高"));
	await key("Escape", 27); await frames();
	for (const width of [1280, 375]) {
		await app.send("Emulation.setDeviceMetricsOverride", { width, height: 850, deviceScaleFactor: 1, mobile: false }); await frames();
		await click('[aria-label="explore 模型"]'); await frames();
		const geometry = await menuGeometry(); assert.ok(geometry.height <= 420 && geometry.right <= width && geometry.bottom <= 850, JSON.stringify(geometry));
		await shot(`subagent-model-menu-${width}`);
		await click('[aria-label="选择模型"] input'); await app.send("Input.insertText", { text: "gemini-relay-19" }); await frames();
		assert.equal(await app.evaluate(`document.querySelectorAll('[data-model]').length`), 3);
		await key("Escape", 27); await frames();
		t.diagnostic(JSON.stringify({ width, geometry }));
	}
	const saved = JSON.parse(await readFile(join(app.home, "settings.json"), "utf8"));
	assert.equal(saved.modelRoles.fast, "p1/m1"); assert.equal(saved.subAgentProfiles.explore.modelId, "p1/m1"); assert.equal(saved.defaultModelId, "p0/m0");
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 850, deviceScaleFactor: 1, mobile: false }); await frames();
	await label("返回工作区"); await frames();
	assert.match(await app.evaluate<string>(`document.querySelector('[data-dock-pane="conversation"]').innerText`), /同名模型/);
	assert.equal(await app.evaluate(`window.lyra.sessions.list().then(rows=>rows.find(s=>s.id==='qa-long').modelId)`), "p0/m0");
});
