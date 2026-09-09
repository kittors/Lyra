/** Real Electron settings rows, using only an isolated provider fixture and saved preferences. */
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";

let app: RunningApp;

before(async () => {
	app = await startApp({ port: 9549, seed: async (home) => {
		await writeFile(join(home, "window.json"), JSON.stringify({ width: 1440, height: 900, x: 0, y: 0 }));
		await writeFile(join(home, "settings.json"), JSON.stringify({
			version: 1, providers: [{ id: "fixture", name: "Fixture", api: "openai-responses", apiKey: "fixture", baseUrl: "http://127.0.0.1:1", enabled: true,
				models: [{ id: "fixture/summary", providerId: "fixture", modelId: "summary", name: "Summary model", contextWindow: 128000, maxOutputTokens: 4096, supportsThinking: false, supportsImages: false, supportsTools: true }] }],
			defaultModelId: "fixture/summary", appearance: { theme: "light" }, projects: [],
		}));
	} });
	await resize(1440);
	await click('document.querySelector(".ly-sidebar-foot button")');
	await waitFor('Boolean([...document.querySelectorAll("button")].find((button) => button.innerText.trim() === "常规"))');
});
after(async () => { await app?.stop(); });

async function waitFor(condition: string): Promise<void> {
	await app.evaluate(`(async () => {
		const deadline = Date.now() + 8000;
		while (!(${condition})) {
			if (Date.now() > deadline) throw new Error("Settings condition timed out");
			await new Promise((resolve) => setTimeout(resolve, 40));
		}
	})()`);
}
async function click(expression: string): Promise<void> {
	const point = await app.evaluate<{ x: number; y: number }>(`(async () => {
		const element = ${expression};
		if (!element) throw new Error("Click target missing");
		element.scrollIntoView({ block: "nearest", behavior: "instant" });
		const deadline = Date.now() + 8000;
		while (true) {
			// A mounted menu can still be invisible and scaled by its entrance animation.
			let ready = element.isConnected && !element.matches(':disabled');
			for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) {
				const style = getComputedStyle(ancestor);
				ready &&= style.visibility !== 'hidden' && Number(style.opacity) > 0;
				ready &&= !ancestor.getAnimations().some((animation) =>
					Number.isFinite(animation.effect?.getComputedTiming().endTime) &&
					(animation.pending || animation.playState === 'running'));
			}
			const rect = element.getBoundingClientRect();
			const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
			if (ready && rect.width > 0 && rect.height > 0 && element.contains(document.elementFromPoint(point.x, point.y))) return point;
			if (Date.now() > deadline) throw new Error("Click target did not become visible and stable");
			await new Promise(requestAnimationFrame);
		}
	})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
}
async function resize(width: number): Promise<void> {
	await app.send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
	await app.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
}
// 名字直接拼进选择器：原来那个三元只认得两页，多传一个会被悄悄当成「模型设置」，于是导航
// 去了别处、等待超时，报出来却像是控件不见了。
async function section(name: "常规" | "模型设置" | "智能体"): Promise<void> {
	await resize(1440);
	await click(`[...document.querySelectorAll("nav button")].find((button) => button.innerText.trim() === ${JSON.stringify(name)})`);
}
const titleRow = `[...document.querySelectorAll('div')].find((element) => element.innerText === "智能标题总结")?.closest('[class~="@container"]')`;
// 压缩模型挪到了「智能体」页的「会话」那一段，控件标签跟着 `agents.compactModel` 变成了
// 「compact 模型」——`@compact · 上下文压缩 用哪个模型` 是它在「模型设置」里那会儿的名字。
const compactButton = `document.querySelector('[aria-label="compact 模型"]')`;

async function verifyRow(kind: "title" | "compact"): Promise<void> {
	for (const theme of ["light", "dark"]) {
		await app.evaluate(`(async () => {
			const settings = await window.lyra.settings.get();
			await window.lyra.settings.save({ ...settings, appearance: { ...settings.appearance, theme: ${theme === "light" ? '"light"' : '"dark"'} } });
		})()`);
		await waitFor(`document.documentElement.classList.contains(${theme === "light" ? '"light"' : '"dark"'})`);
		for (const width of [1440, 760]) {
			await resize(width);
			const metrics = await app.evaluate<{ rowWidth: number; overflow: number; overlaps: boolean; controlWidth: number; visible: boolean; text: string }>(`(() => {
				// compact 那一行搬到「智能体」页之后，外面不再套 @container 那层；它自己带着标识，直接认。
				const row = ${kind === "title" ? titleRow : `document.querySelector('[data-agent-profile="compact"]')`};
				if (!row) throw new Error("Settings row missing");
				row.scrollIntoView({ block: "center", behavior: "instant" });
				const text = row.firstElementChild.firstElementChild;
				const control = row.querySelector('button');
				const r = row.getBoundingClientRect(), t = text.getBoundingClientRect(), c = control.getBoundingClientRect();
				return { rowWidth: r.width, overflow: row.scrollWidth - row.clientWidth,
					overlaps: Math.min(t.right, c.right) > Math.max(t.left, c.left) && Math.min(t.bottom, c.bottom) > Math.max(t.top, c.top),
					controlWidth: c.width, visible: c.top >= 0 && c.bottom <= innerHeight && c.left >= 0 && c.right <= innerWidth,
					text: row.innerText.replace(/\\s+/g, ' ').trim() };
			})()`);
			assert.ok(metrics.rowWidth > 200, JSON.stringify(metrics));
			assert.ok(metrics.overflow <= 1, JSON.stringify(metrics));
			assert.equal(metrics.overlaps, false, JSON.stringify(metrics));
			assert.equal(metrics.visible, true, JSON.stringify(metrics));
			assert.ok(metrics.controlWidth >= (kind === "title" ? 38 : 100), JSON.stringify(metrics));
			console.log(JSON.stringify({ kind, theme, width, ...metrics }));
			const directory = process.env.LYRA_E2E_ARTIFACTS;
			if (directory) {
				await mkdir(directory, { recursive: true });
				const shot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
				await writeFile(join(directory, `${kind}-${theme}-${width}.png`), Buffer.from(shot.data, "base64"));
			}
		}
	}
}

test("title summary is enabled initially and its switch persists without row overlap in either theme", async () => {
	await section("常规");
	await waitFor(`Boolean(${titleRow})`);
	assert.equal(await app.evaluate(`(${titleRow}).querySelector('[role="switch"]').getAttribute('aria-checked')`), "true");
	await click(`(${titleRow}).querySelector('[role="switch"]')`);
	await waitFor(`(${titleRow}).querySelector('[role="switch"]').getAttribute('aria-checked') === 'false'`);
	assert.equal(JSON.parse(await readFile(join(app.home, "settings.json"), "utf8")).autoSummarizeTitle, false);
	await click(`(${titleRow}).querySelector('[role="switch"]')`);
	await waitFor(`(${titleRow}).querySelector('[role="switch"]').getAttribute('aria-checked') === 'true'`);
	assert.equal(JSON.parse(await readFile(join(app.home, "settings.json"), "utf8")).autoSummarizeTitle, true);
	await verifyRow("title");
});

test("compact model role persists and clearing it returns to the session model", async () => {
	await section("智能体");
	await waitFor(`Boolean(${compactButton})`);
	// 没设过的时候，控件显示的是继承来的那个模型，底下一行标着来源——「同会话模型」是它单行
	// 那会儿的写法。
	assert.match(await app.evaluate<string>(`(${compactButton}).innerText.trim()`), /随主会话/);
	await click(compactButton);
	await waitFor('Boolean(document.querySelector("[role=menuitem]"))');
	await click('[...document.querySelectorAll("[role=menuitem]")].find((item) => item.innerText.includes("Summary model"))');
	await waitFor(`(${compactButton}).innerText.includes("Summary model")`);
	/*
	 * 存的地方也换了。
	 *
	 * 这一页现在走 `withAgentProfile`：写进 `subAgentProfiles[name]`，并把同名的 `modelRoles`
	 * 删掉——`compact` 恰好两边都叫这个名字，所以旧字段读起来永远是空的。见
	 * `core/src/config/model-roles.ts`。
	 */
	const saved = async () => JSON.parse(await readFile(join(app.home, "settings.json"), "utf8")) as { subAgentProfiles?: Record<string, { modelId?: string }> };
	assert.equal((await saved()).subAgentProfiles?.compact?.modelId, "fixture/summary");
	await click(compactButton);
	await waitFor('Boolean(document.querySelector("[role=menuitem]"))');
	await click('[...document.querySelectorAll("[role=menuitem]")].find((item) => item.innerText.includes("跟随主会话"))');
	await waitFor(`(${compactButton}).innerText.includes("随主会话")`);
	assert.equal((await saved()).subAgentProfiles?.compact, undefined);
	await verifyRow("compact");
});
