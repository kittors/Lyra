/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * 对话框统一之后，在真窗口里把每一张都拍下来，并量三件事。
 *
 * 三件事，一条一条对着看：底下那排按钮上有没有写字（不是 `aria-label`，是画出来的
 * `innerText`）；卡片里还有没有横着的分隔线；内容和标题的左缘对不对得齐。前两件是这次改动本
 * 身，第三件是它的代价——每张弹窗的内边距都从 `px-5` 换成了 `DialogFrame` 的 `px-6`，只要有
 * 一处内容忘了跟着走，标题和它下面的字就会差出几个像素。
 *
 * 分隔线是量出来的，不是搜类名搜出来的：一条线可以是 `border-t`、可以是一个 1px 高的方块、
 * 也可以是某个 `::before`。这里问的是每个元素自己算出来的 `borderTopWidth`/`borderBottomWidth`
 * ——只要它横贯卡片（宽度过八成），就算一条。
 *
 * 跑：node --experimental-strip-types e2e/dialog-style-probe.ts
 */

import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { DEFAULT_SETTINGS, type ModelConfig, type Settings } from "@lyra/core";
import { startApp } from "./app.ts";

const PORT = 9487;
const OUT = join(homedir(), "Desktop", "弹窗风格统一测试");

/**
 * 一个只会回答 `/v1/models` 的端点。
 *
 * 「拉取模型」那张弹窗只有在真拉到一串名字之后才存在，而例子里那个 gateway 域名是拉不到的
 * ——上一版探针跑到这一步就跳过了，于是三张弹窗里有一张从没在真窗口里出现过。
 */
const catalogue = createServer((request, response) => {
	response.writeHead(200, { "content-type": "application/json" });
	/*
	 * 一个空市场，好让插件页画出那块空状态。
	 *
	 * 一个源都不配也是空的，但那时公开那一栏停在骨架屏上不往下走；配一个答得上话、里面什么都
	 * 没有的源，读取才有结束的那一刻，空状态和它中间那颗按钮才画得出来。
	 */
	if ((request.url ?? "").includes("registry")) {
		response.end(JSON.stringify({ name: "Probe", plugins: [] }));
		return;
	}
	response.end(JSON.stringify({
		data: [
			"gemini-3.8-flash-high", "gemini-3.8-pro", "deepseek-v4-flash", "deepseek-v4-reasoner",
			"claude-opus-5", "claude-sonnet-5", "gpt-5.2-high", "qwen3-max", "kimi-k3", "glm-5",
		].map((id) => ({ id, object: "model", owned_by: "probe" })),
	}));
	void request;
});
await new Promise<void>((resolve) => catalogue.listen(0, "127.0.0.1", resolve));
const address = catalogue.address();
const CATALOGUE = typeof address === "object" && address ? `http://127.0.0.1:${address.port}/v1` : "";

const model = (modelId: string, name: string): ModelConfig => ({
	id: `relay/${modelId}`, providerId: "relay", modelId, name,
	contextWindow: 1_000_000, maxOutputTokens: 65536,
	supportsThinking: true, supportsImages: true, supportsTools: true,
});

const app = await startApp({
	port: PORT,
	seed: async (home) => {
		await mkdir(join(home, "project"), { recursive: true });
		await writeFile(join(home, "window.json"), JSON.stringify({ width: 1440, height: 1000, x: 0, y: 0 }));
		const settings: Settings = {
			...DEFAULT_SETTINGS,
			uiLocale: "zh-CN",
			disabledPlugins: ["*"],
			appearance: { ...DEFAULT_SETTINGS.appearance, theme: "light", reduceMotion: "on" },
			providers: [
				{
					id: "relay", name: "Relay", baseUrl: "https://gateway.example.com/v1",
					api: "openai-responses", apiKey: "", enabled: true,
					models: [model("gemini-3.8-flash-high", "gemini-3.8-flash-high"), model("deepseek-v4-flash", "deepseek-v4-flash")],
				},
				{
					id: "local", name: "Local", baseUrl: CATALOGUE,
					api: "openai-chat-completions", apiKey: "probe", enabled: true,
					models: [{ ...model("gemini-3.8-flash-high", "gemini-3.8-flash-high"), id: "local/gemini-3.8-flash-high", providerId: "local" }],
				},
			],
			defaultModelId: "relay/gemini-3.8-flash-high",
			// 一个答得上话、里面什么都没有的市场——插件页那块空状态要的正是这个。
			pluginRegistries: [CATALOGUE.replace("/v1", "/registry.json")],
			projects: [{ id: "project", name: "弹窗验证", path: join(home, "project"), pinned: true, lastOpenedAt: 1 }],
		};
		await writeFile(join(home, "settings.json"), JSON.stringify(settings));
	},
});

const failures: string[] = [];
const check = (ok: boolean, what: string) => {
	console.log(`   ${ok ? "✔" : "✖"} ${what}`);
	if (!ok) failures.push(what);
};
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(expression: string, note = expression) {
	await app.evaluate(
		`new Promise((resolve,reject)=>{const end=Date.now()+15000;const step=()=>{try{if(${expression})return resolve();}catch(error){}if(Date.now()<end)requestAnimationFrame(step);else reject(new Error(${JSON.stringify(note)}));};step();})`,
	);
}

/**
 * 真鼠标，不是 `.click()`——后者在这个应用里打不开好几处东西。
 *
 * `scroll: false` 是给浮层里的东西用的。`scrollIntoView` 会滚它最近的那个滚动容器，而一个
 * portal 出去的菜单最近的容器是整扇窗；窗一滚，`Popover` 就把自己收了，接下来那一下鼠标落在
 * 空处——菜单消失、什么都没发生，看起来和「点了没反应」一模一样。
 */
async function click(selector: string, { scroll = true } = {}) {
	await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`, `找不到 ${selector}`);
	if (scroll) await app.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
	await app.evaluate(
		`new Promise((resolve,reject)=>{let previous='',stable=0;const end=Date.now()+5000;const step=()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return reject(new Error('目标消失了'));const r=e.getBoundingClientRect(),now=[r.x,r.y,r.width,r.height].join(',');stable=now===previous?stable+1:0;previous=now;if(stable>=3)resolve();else if(Date.now()<end)requestAnimationFrame(step);else reject(new Error('目标一直在动'));};requestAnimationFrame(step);})`,
	);
	const point = await app.evaluate<{ x: number; y: number }>(
		`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
	);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
		await app.send("Input.dispatchMouseEvent", { type, ...point, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
	}
}

/** 按可见文字挑一个元素出来，打上标记再点它。 */
async function mark(scope: string, text: string, attribute: string, options?: { scroll?: boolean }) {
	const finder = `[...document.querySelectorAll(${JSON.stringify(scope)})].find(e=>e.checkVisibility()&&(e.innerText||'').trim().includes(${JSON.stringify(text)}))`;
	await until(`Boolean(${finder})`, `找不到写着「${text}」的 ${scope}`);
	await app.evaluate(
		`(()=>{document.querySelector('[${attribute}]')?.removeAttribute(${JSON.stringify(attribute)});${finder}.setAttribute(${JSON.stringify(attribute)},'');})()`,
	);
	await click(`[${attribute}]`, options);
}

async function shot(name: string) {
	await mkdir(OUT, { recursive: true });
	const capture = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(OUT, `${name}.png`), Buffer.from(capture.data, "base64"));
	console.log(`   📸 ${name}.png`);
}

/**
 * 一张弹窗的体检报告。
 *
 * `rules` 量的是画出来的边框宽度，不是类名；`actions` 里的 `words` 读 `innerText`，一个只存在
 * 于 tooltip 里的动词在这里就是空字符串。
 */
const AUDIT = `(()=>{
	const card = [...document.querySelectorAll('[data-ly-modal]')].at(-1);
	if (!card) return null;
	const box = card.getBoundingClientRect();
	const rules = [];
	const drawn = (style, side) =>
		parseFloat(style['border' + side + 'Width']) > 0
		&& style['border' + side + 'Style'] !== 'none'
		&& style['border' + side + 'Color'] !== 'rgba(0, 0, 0, 0)';
	for (const node of card.querySelectorAll('*')) {
		const rect = node.getBoundingClientRect();
		if (rect.width < box.width * 0.8) continue;
		const style = getComputedStyle(node);
		// 四边都描了的是一个盒子,不是一条线 -- 内容里的圆角卡片几乎都有整幅那么宽。
		const boxed = ['Top', 'Right', 'Bottom', 'Left'].every((side) => drawn(style, side));
		if (!boxed) {
			for (const side of ['Top', 'Bottom']) {
				if (drawn(style, side)) rules.push({ kind: 'border', side, at: Math.round(rect[side === 'Top' ? 'top' : 'bottom'] - box.top), of: node.className.toString().slice(0, 60) });
			}
		}
		// 一条线也可以是一个矮方块:Scroller 的 top="line" 就是 1px 高、铺满宽、底色 --color-line。
		// 只量 border 的话它整条都看不见。(注释里不能出现反引号 -- 这整段是模板字符串。)
		const filled = style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent';
		if (rect.height > 0 && rect.height <= 2 && filled && parseFloat(style.opacity) > 0.05) {
			rules.push({ kind: 'block', side: 'Top', at: Math.round(rect.top - box.top), of: node.className.toString().slice(0, 60) });
		}
	}
	// 结论按钮就是 .ly-dialog-action -- 那一行里还会站着说明记号之类不做事的东西。
	const actions = [...card.querySelectorAll('[data-ly-dialog-actions] .ly-dialog-action')].map((b) => ({
		words: (b.innerText || '').trim(),
		glyphOnly: Boolean(b.querySelector('svg')) && !(b.innerText || '').trim(),
	}));
	const title = card.querySelector('[data-dialog-title], h2, h3');
	/*
	 * 正文的左缘是滚动视口内衬以内的那条边，不是滚动面的外框：滚动面伸进了弹窗两侧的边距（好让
	 * 滑块落在边距里），外框比正文宽出去一截，量外框会报一个画面上并不存在的错位。
	 */
	const view = card.querySelector('.ly-scroll-view');
	const bodyEdge = view ? view.getBoundingClientRect().left + view.clientLeft + parseFloat(getComputedStyle(view).paddingLeft) : null;
	return {
		width: Math.round(box.width),
		height: Math.round(box.height),
		title: (title?.innerText || '').trim(),
		titleLeft: title ? Math.round(title.getBoundingClientRect().left - box.left) : null,
		bodyLeft: bodyEdge === null ? null : Math.round(bodyEdge - box.left),
		actions,
		rules,
	};
})()`;

interface Audit {
	width: number; height: number; title: string;
	titleLeft: number | null; bodyLeft: number | null;
	actions: { words: string; glyphOnly: boolean }[];
	rules: { kind: string; side: string; at: number; of: string }[];
}

async function audit(what: string, expected: string[]) {
	const report = await app.evaluate<Audit | null>(AUDIT);
	if (!report) { check(false, `${what}：弹窗没出来`); return; }
	console.log(`   ${what} ${report.width}×${report.height}「${report.title}」`);
	console.log(`      按钮：${JSON.stringify(report.actions)}`);
	console.log(`      横线：${report.rules.length ? JSON.stringify(report.rules) : "一条都没有"}`);
	console.log(`      左缘：标题 ${report.titleLeft}px，正文 ${report.bodyLeft}px`);
	check(report.rules.length === 0, `${what}：卡片里没有横贯的分隔线`);
	check(
		report.actions.length > 0 && report.actions.every((a) => !a.glyphOnly && a.words.length > 0),
		`${what}：底下每颗按钮都写着字`,
	);
	for (const word of expected) {
		check(report.actions.some((a) => a.words.includes(word)), `${what}：按钮上找得到「${word}」`);
	}
	if (report.titleLeft !== null && report.bodyLeft !== null) {
		check(Math.abs(report.titleLeft - report.bodyLeft) <= 1, `${what}：正文和标题左缘对齐（差 ${Math.abs(report.titleLeft - report.bodyLeft)}px）`);
	}
}

async function escape() {
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", windowsVirtualKeyCode: 27 });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", windowsVirtualKeyCode: 27 });
	await until(`!document.querySelector('[data-ly-modal]')`, "弹窗没关掉");
	await pause(300);
}

try {
	await until(`document.querySelector('.ly-sidebar-foot button')?.checkVisibility()`, "侧栏没画出来");
	await click(".ly-sidebar-foot button");
	await mark("nav button", "模型设置", "data-nav-qa");
	await until(`document.querySelector('[aria-label="编辑模型"]')`, "模型设置页没有编辑按钮");
	await pause(500);

	console.log("\n[1] 编辑模型");
	await app.evaluate(
		`(()=>{const row=[...document.querySelectorAll('[class~="group/row"]')].find(e=>e.textContent.includes('gemini-3.8-flash-high'));row.querySelector('[aria-label="编辑模型"]').setAttribute('data-edit-qa','');})()`,
	);
	await click("[data-edit-qa]");
	await until(`document.querySelector('[data-ly-modal] input')`, "编辑模型弹窗没出来");
	await pause(600);
	await shot("1-编辑模型");
	await audit("编辑模型", ["取消", "保存"]);
	await escape();

	console.log("\n[2] 删除确认");
	await app.evaluate(
		`(()=>{const row=[...document.querySelectorAll('[class~="group/row"]')].find(e=>e.textContent.includes('deepseek-v4-flash'));const kill=[...row.querySelectorAll('button')].find(b=>/删除|移除/.test(b.getAttribute('data-ly-tip')||b.getAttribute('aria-label')||''));kill.setAttribute('data-kill-qa','');})()`,
	);
	await click("[data-kill-qa]");
	await until(`document.querySelector('[data-ly-dialog-actions]')`, "确认框没出来");
	await pause(600);
	await shot("2-删除确认");
	await audit("删除确认", ["取消"]);
	await escape();

	console.log("\n[3] 拉取模型");
	// 换到那个真答得上 /v1/models 的供应商去。
	await mark("button", "Local", "data-provider-qa");
	await pause(500);
	await mark("button", "拉取模型", "data-fetch-qa");
	await until(`Boolean(document.querySelector('[data-ly-modal] [data-ly-dialog-actions]'))`, "拉取模型弹窗没出来");
	await pause(700);
	await shot("3-拉取模型");
	await audit("拉取模型", ["取消", "导入"]);
	await escape();

	console.log("\n[4] 插件市场源");
	// 先出设置页。侧边栏那个「插件」才是市场视图；设置页导航里同名的那一条是另一页。
	await mark("button", "返回工作区", "data-back-qa");
	await pause(600);
	await mark(".ly-sidebar button, aside button, nav button", "插件", "data-plugins-qa");
	await pause(1_500);
	/*
	 * 走空状态里那颗按钮，不走页头的菜单。
	 *
	 * 菜单那条路探针走不通：落点算得没错、菜单也确实收了，但动作没发生——按下去的那一瞬 Popover
	 * 先把自己拆了，mouseup 落在空处，于是根本没有 click。那是探针和浮层之间的老问题，跟这次改
	 * 的东西无关；这颗按钮是同一张弹窗的另一个入口，而且现在它自己也写着字了。
	 */
	// 公开那一栏空了才画这块空状态；个人栏的空是另一句话，没有按钮。
	await mark("button", "公开", "data-public-qa");
	// 等那颗按钮真的画出来再拍。骨架屏还在转的时候拍，拍到的是「读取中」，不是这一轮要看的东西。
	await until(
		`[...document.querySelectorAll('button')].some(b=>b.checkVisibility()&&(b.innerText||'').includes('管理插件市场'))`,
		"插件页的空状态没画出来",
	);
	await pause(400);
	await shot("4a-插件市场空状态");
	await mark("button", "管理插件市场", "data-source-qa");
	await until(`Boolean(document.querySelector('[data-ly-dialog-actions]'))`, "市场源弹窗没出来");
	await pause(600);
	await shot("4-插件市场源");
	await audit("插件市场源", ["完成"]);
	await escape();

	console.log("\n[5] 添加代码托管账号");
	await pause(400);
	await click(".ly-sidebar-foot button");
	await mark("nav button", "代码托管", "data-forge-qa");
	await pause(600);
	await mark("button", "添加账号", "data-forge-add-qa");
	await pause(600);
	await shot("5-添加代码托管账号");
	/*
	 * 这一段不是弹窗，是设置页里的一张表单——`audit` 找的是 `[data-ly-modal]`，这里没有。
	 * 要证的只有一件事：那两颗结论按钮上写着字，不是一个盾牌加一个叉。
	 */
	const forge = await app.evaluate<{ words: string; glyphOnly: boolean }[]>(
		`[...document.querySelectorAll('button')].filter(b=>/验证|取消/.test(b.innerText||'')||(b.querySelector('svg.lucide-shield-check')&&!b.innerText.trim())).map(b=>({words:(b.innerText||'').trim(),glyphOnly:Boolean(b.querySelector('svg'))&&!(b.innerText||'').trim()}))`,
	);
	console.log(`      按钮：${JSON.stringify(forge)}`);
	check(forge.length >= 2 && forge.every((b) => !b.glyphOnly && b.words.length > 0), "添加账号：两颗结论按钮都写着字");

	console.log(`\n截图写到 ${OUT}`);
	console.log(failures.length === 0 ? "\n全部通过" : `\n${failures.length} 条没过：\n- ${failures.join("\n- ")}`);
} catch (error) {
	console.error("\n探针自己出错了:", error);
	failures.push(String(error));
} finally {
	await app.stop();
	await new Promise<void>((resolve) => catalogue.close(() => resolve()));
}

if (failures.length > 0) process.exitCode = 1;
