/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 在真窗口里验证「拉取并导入模型」这一页。
 *
 * 两件事，客户各报了一条：
 *
 *   问题 5 —— 弹窗里每行都写 200K，导进来却是 1M。写死的假字符串 + 导入把 `metadataSource` 谎报成
 *   `"catalog"`，于是 `withCatalogDefaults` 在每次存/读时把窗口改回目录值。**必须跨一次存盘**才验得出
 *   来：只看导入那一瞬间是 200K，是会漏掉这个 bug 的。
 *
 *   问题 6 —— 弹窗遮罩只盖住了右侧内容区，左边导航栏还是亮的、还能点。`fixed inset-0` 被祖先
 *   `Scroller` 的 `mask-image` 关进了包含块里。这里量的是遮罩的实际矩形对不对得上整扇窗，
 *   不是「看起来变暗了」。
 *
 * 用真实供应商的模型清单，因为假清单里的名字不在离线目录里，恰好绕开了 1M 那条路径。
 */

import { copyFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";

const REAL_HOME = join(homedir(), ".lyra");
const WAIT = `(ms) => new Promise((r) => setTimeout(r, ms))`;

async function seed(home: string): Promise<void> {
	await mkdir(home, { recursive: true });
	const cwd = join(home, "project");
	await mkdir(cwd, { recursive: true });
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	await mkdir(join(home, "sessions", projectId), { recursive: true });

	for (const file of ["credentials.json", "vault.key"]) {
		await copyFile(join(REAL_HOME, file), join(home, file)).catch(() => {
			throw new Error(`没找到 ~/.lyra/${file}——拉取模型要真的连上去`);
		});
	}
	const real = JSON.parse(await readFile(join(REAL_HOME, "settings.json"), "utf8"));
	/*
	 * 供应商保留（要真连），模型清单清空——这一页验的就是「从零导入」。
	 * `defaultModelId` 也跟着清掉，否则它指着一个已经不存在的模型。
	 */
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			...real,
			providers: (real.providers ?? []).map((p: Record<string, unknown>) => ({ ...p, models: [] })),
			defaultModelId: null,
			projects: [{ id: projectId, path: cwd, name: "验收工程", pinned: true, lastOpenedAt: Date.now() }],
			pinnedSessionIds: [],
			sync: { enabled: false },
		}),
	);
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1400, height: 900 }));
}

let app: RunningApp;
const results: Array<{ name: string; ok: boolean; detail: string }> = [];
function check(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "✅" : "❌"} ${name}\n     ${detail.replace(/\n/g, "\n     ")}`);
}


/*
 * 真实鼠标，不是合成事件。
 *
 * `element.dispatchEvent(new MouseEvent(...))` 打不开这个应用里的一部分控件——它们依赖真实的
 * 指针序列与命中测试。这几个助手照 `model-defaults.test.ts` 里已经验过的那套来。
 */
async function until(expression: string) {
	await app.evaluate(`new Promise((resolve,reject)=>{const end=Date.now()+20000;const step=()=>{if(${expression})resolve();else if(Date.now()<end)requestAnimationFrame(step);else reject(new Error(${JSON.stringify(expression)}));};step();})`);
}

async function click(selector: string) {
	await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`);
	await app.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
	await app.evaluate(`new Promise((resolve,reject)=>{let previous='',stable=0;const end=Date.now()+5000;const step=()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return reject(new Error('Target disappeared'));const r=e.getBoundingClientRect(),current=[r.x,r.y,r.width,r.height].join(',');stable=current===previous?stable+1:0;previous=current;if(stable>=3)resolve();else if(Date.now()<end)requestAnimationFrame(step);else reject(new Error('Target kept moving'));};requestAnimationFrame(step);})`);
	const point = await app.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
		await app.send("Input.dispatchMouseEvent", { type, ...point, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
	}
}

/** 按可见文字点一个控件：先给它打个记号，再用真实鼠标点那个记号。 */
async function byText(text: string, scope = "button") {
	await until(`[...document.querySelectorAll(${JSON.stringify(scope)})].some(e=>e.checkVisibility()&&e.textContent.trim()===${JSON.stringify(text)})`);
	await app.evaluate(`(()=>{document.querySelector('[data-probe-qa]')?.removeAttribute('data-probe-qa');[...document.querySelectorAll(${JSON.stringify(scope)})].find(e=>e.checkVisibility()&&e.textContent.trim()===${JSON.stringify(text)}).setAttribute('data-probe-qa','');})()`);
	await click("[data-probe-qa]");
}

async function main() {
	app = await startApp({ port: 9413, seed });
	try {
		// 设置页 → 模型设置。走真实的导航，不是直接改 store。
		await click(".ly-sidebar-foot button");
		await byText("模型设置", "nav button");
		// 工作区那层还挂着（只是 visibility 隐藏），所以 `querySelector("h1")` 会命中它——
		// 等一个只属于这一页的、可见的控件，才是「这一页到了」的证据。
		await until(`[...document.querySelectorAll("button")].some((b)=>b.checkVisibility()&&/拉取模型/.test(b.innerText))`);

		// 「拉取模型」——真的打到 /v1/models。
		await byText("拉取模型");
		await until(`document.querySelector('[data-ly-modal]')`);
		await app.evaluate(`(${WAIT})(800)`);
		const pulled = await app.evaluate<{ total: number; labels: string[]; open: boolean }>(`(() => {
			const rows = [...document.querySelectorAll('[data-ly-modal] label')];
			return {
				open: Boolean(document.querySelector('[data-ly-modal]')),
				total: rows.length,
				labels: [...new Set(rows.map((r) => ([...r.children].at(-1)?.textContent ?? "").trim()))],
			};
		})()`);
		check("拉取弹窗打开并列出模型", pulled.open && pulled.total > 0, `${pulled.total} 行，右侧标签取值：${JSON.stringify(pulled.labels)}`);
		check(
			"弹窗上的上下文标签是 200K，且只有这一种取值（问题 5 上半）",
			pulled.labels.length === 1 && pulled.labels[0] === "200K",
			`实际：${JSON.stringify(pulled.labels)}`,
		);

		// ---- 问题 6：量遮罩的实际矩形，不看「像不像变暗了」 --------------------------
		const scrim = await app.evaluate<Record<string, number | boolean>>(`(async () => {
			const overlay = document.querySelector('[data-ly-overlay]');
			const r = overlay.getBoundingClientRect();
			// 导航栏上任意一个点，是不是被遮罩接管了——这是「还能不能点到」的真问题。
			const navItem = [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "外观");
			const n = navItem.getBoundingClientRect();
			const hit = document.elementFromPoint(n.left + n.width / 2, n.top + n.height / 2);
			return {
				left: Math.round(r.left), top: Math.round(r.top),
				width: Math.round(r.width), height: Math.round(r.height),
				vw: window.innerWidth, vh: window.innerHeight,
				navCoveredByOverlay: Boolean(hit && (hit.closest('[data-ly-overlay]') !== null)),
			};
		})()`);
		check(
			"遮罩铺满整扇窗（问题 6）",
			scrim.left === 0 && scrim.top === 0 && scrim.width === scrim.vw && scrim.height === scrim.vh,
			`遮罩 ${scrim.left},${scrim.top} ${scrim.width}×${scrim.height}；窗口 ${scrim.vw}×${scrim.vh}`,
		);
		check(
			"左侧导航栏被遮罩接管，点不动（问题 6 的实际后果）",
			scrim.navCoveredByOverlay === true,
			`「外观」那一点命中的是不是遮罩：${scrim.navCoveredByOverlay}`,
		);

		// ---- 问题 5 下半：导入，然后跨一次存盘再看 ----------------------------------
		await app.evaluate(`(()=>{document.querySelector('[data-import-qa]')?.removeAttribute('data-import-qa');[...document.querySelectorAll('[data-ly-modal] button')].find((b)=>/导入所选/.test(b.innerText)).setAttribute('data-import-qa','');})()`);
		await click("[data-import-qa]");
		await app.evaluate(`(${WAIT})(3000)`);
		const imported = await app.evaluate<{ count: number; windows: number[]; outputs: number[]; sources: string[] }>(`(async () => {
			const s = await window.lyra.settings.get();
			const models = (s.providers ?? []).flatMap((p) => p.models ?? []);
			return {
				count: models.length,
				windows: [...new Set(models.map((m) => m.contextWindow))],
				outputs: [...new Set(models.map((m) => m.maxOutputTokens))],
				sources: [...new Set(models.map((m) => m.metadataSource ?? "none"))],
			};
		})()`);
		check(
			"导入后每个模型都是 200K / 65536（问题 5 下半）",
			imported.count > 0 && imported.windows.length === 1 && imported.windows[0] === 200_000 && imported.outputs.length === 1 && imported.outputs[0] === 65_536,
			`${imported.count} 个模型；上下文 ${JSON.stringify(imported.windows)}；最大输出 ${JSON.stringify(imported.outputs)}；来源 ${JSON.stringify(imported.sources)}`,
		);

		/*
		 * 重启应用再看一遍。
		 *
		 * `withCatalogDefaults` 在每次读设置和每次写设置时都跑，标着 `"catalog"` 的行会被目录值覆盖回
		 * 1M——所以只看导入那一瞬间是验不出这个 bug 的，必须跨一次真正的存盘与重新加载。
		 */
		// `app.stop()` 会把 profile 删掉，所以先留一份副本，再关、再用这份副本开第二次。
		const staged = await mkdtemp(join(tmpdir(), "lyra-restart-"));
		await cp(app.home, staged, { recursive: true });
		await app.stop();
		app = await startApp({
			port: 9413,
			seed: async (home) => {
				await rm(home, { recursive: true, force: true });
				await cp(staged, home, { recursive: true });
			},
		});
		const after = await app.evaluate<{ windows: number[]; outputs: number[] }>(`(async () => {
			const s = await window.lyra.settings.get();
			const models = (s.providers ?? []).flatMap((p) => p.models ?? []);
			return { windows: [...new Set(models.map((m) => m.contextWindow))], outputs: [...new Set(models.map((m) => m.maxOutputTokens))] };
		})()`).catch(() => ({ windows: [-1], outputs: [-1] }));
		await rm(staged, { recursive: true, force: true });
		check(
			"重启之后仍然是 200K / 65536（目录没把它改回 1M）",
			after.windows.length === 1 && after.windows[0] === 200_000 && after.outputs[0] === 65_536,
			`上下文 ${JSON.stringify(after.windows)}；最大输出 ${JSON.stringify(after.outputs)}`,
		);
	} finally {
		const passed = results.filter((r) => r.ok).length;
		console.log(`\n${passed}/${results.length} 通过`);
		const home = app.home;
		await app.stop();
		await rm(home, { recursive: true, force: true });
		if (passed !== results.length) process.exitCode = 1;
	}
}

await main();
