/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * 「拉取并选择模型」那个弹窗，在真窗口里量一遍。
 *
 * 客户报的是三样都在同一扇弹窗上：搜索框旁边那个孤零零的勾选框认不出是什么，底下两颗按钮一个
 * ✕ 一个 ✓33、没有字，以及整体「看着很奇怪」——三十三行各自带描边的卡片，默认全选之后满屏在说
 * 边框。量的是这几件事各自的痕迹，不是「看起来好些了」：
 *
 *   - 全选那颗跟搜索框同高同圆角（从前 32 对 34、圆角一个 8px 一个胶囊），并且有可见文字。
 *   - 页脚两颗按钮各自有可见文字，主按钮上的数字还在。
 *   - 每一行的 border-width 是 0：分行交给间距和 hover，不再是一摞卡片。
 *
 * 供应商是本机起的一个 `/v1/models`，不是真的打出去——这一页验的是弹窗长什么样，没有必要为此
 * 花掉一次真实请求，也没有必要把用户的 key 复制进临时 profile（`real-model-import-probe.ts`
 * 那样做是因为它验的是目录默认值，必须走真实清单）。
 */

import { createServer } from "node:http";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";

/** 客户截图里那一批，凑够三十三个——数目本身是变量：全选之后页脚要写得出这个数。 */
const MODELS = [
	"claude-opus-4-6-thinking", "claude-sonnet-4-6", "command/deepseek-v4-flash", "command/deepseek-v4-pro",
	"deepseek-v4-flash:0731", "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.5-flash-thinking",
	"gemini-2.5-pro", "gemini-3-pro-preview", "gpt-5.2", "gpt-5.2-codex", "gpt-5.2-mini", "gpt-5.2-nano",
	"grok-4-fast", "grok-code-fast-1", "kimi-k2-thinking", "llama-4-maverick", "llama-4-scout",
	"minimax-m2", "mistral-large-3", "o4-mini", "qwen3-coder-plus", "qwen3-max", "qwen3-vl-plus",
	"deepseek-r2", "deepseek-v4", "glm-5", "glm-5-air", "step-3", "doubao-2-pro", "hunyuan-t2", "ernie-6",
];

const OUT = join(homedir(), "Desktop", "Lyra拉取模型弹窗测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-");
/** `after` 是带改动的这一版，`before` 由调用方把改动 stash 掉之后再跑一次。 */
const phase = process.argv.includes("--before") ? "before" : "after";

let app: RunningApp;
const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "✅" : "❌"} ${name}\n     ${detail}`);
}

const WAIT = `(ms) => new Promise((r) => setTimeout(r, ms))`;

async function until(expression: string) {
	await app.evaluate(
		`new Promise((resolve,reject)=>{const end=Date.now()+20000;const step=()=>{if(${expression})resolve();else if(Date.now()<end)requestAnimationFrame(step);else reject(new Error(${JSON.stringify(expression)}));};step();})`,
	);
}

/** 真实指针，不是合成事件——照 `real-model-import-probe.ts` 里已经验过的那套。 */
async function click(selector: string) {
	await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`);
	await app.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
	await app.evaluate(
		`new Promise((resolve,reject)=>{let previous='',stable=0;const end=Date.now()+5000;const step=()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return reject(new Error('Target disappeared'));const r=e.getBoundingClientRect(),current=[r.x,r.y,r.width,r.height].join(',');stable=current===previous?stable+1:0;previous=current;if(stable>=3)resolve();else if(Date.now()<end)requestAnimationFrame(step);else reject(new Error('Target kept moving'));};requestAnimationFrame(step);})`,
	);
	const point = await app.evaluate<{ x: number; y: number }>(
		`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
	);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
		await app.send("Input.dispatchMouseEvent", { type, ...point, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
	}
}

/** 按可见文字或 tooltip 点一个控件：先打记号，再用真实鼠标点那个记号。 */
async function byLabel(text: string, scope = "button") {
	const match = `(e)=>e.checkVisibility()&&((e.innerText||'').trim()===${JSON.stringify(text)}||e.getAttribute('data-ly-tip')===${JSON.stringify(text)}||e.getAttribute('aria-label')===${JSON.stringify(text)})`;
	await until(`[...document.querySelectorAll(${JSON.stringify(scope)})].some(${match})`);
	await app.evaluate(
		`(()=>{document.querySelector('[data-probe-qa]')?.removeAttribute('data-probe-qa');[...document.querySelectorAll(${JSON.stringify(scope)})].find(${match}).setAttribute('data-probe-qa','');})()`,
	);
	await click("[data-probe-qa]");
}

async function shot(name: string) {
	await app.evaluate(
		`Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect?.getComputedTiming().endTime)).map(a=>a.finished.catch(()=>{}))).then(()=>new Promise(requestAnimationFrame))`,
	);
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	const file = join(OUT, `${stamp}_${name}.png`);
	await writeFile(file, Buffer.from(data, "base64"));
	console.log(`   📸 ${file}`);
}

async function main() {
	await mkdir(OUT, { recursive: true });
	const endpoint = createServer((req, res) => {
		if (!req.url?.endsWith("/models")) {
			res.writeHead(404).end("{}");
			return;
		}
		res.writeHead(200, { "content-type": "application/json" });
		res.end(JSON.stringify({ data: MODELS.map((id) => ({ id })) }));
	});
	await new Promise<void>((resolve) => endpoint.listen(0, "127.0.0.1", resolve));
	const address = endpoint.address();
	if (!address || typeof address === "string") throw new Error("夹具没拿到端口");
	const port = address.port;

	app = await startApp({
		port: 9417,
		seed: async (home) => {
			const cwd = join(home, "project");
			await mkdir(cwd, { recursive: true });
			await writeFile(join(home, "window.json"), JSON.stringify({ width: 1400, height: 900 }));
			await writeFile(
				join(home, "settings.json"),
				JSON.stringify({
					uiLocale: "zh-CN",
					permissionMode: "full",
					projectMemory: false,
					thinking: "off",
					mcpServers: [],
					hooks: [],
					sync: { enabled: false },
					// 动画关掉，两次跑之间的截图才比得了。
					appearance: { reduceMotion: "on" },
					projects: [{ path: cwd, name: "弹窗验收", pinned: true, lastOpenedAt: Date.now() }],
					defaultModelId: null,
					providers: [
						{
							id: "probe",
							name: "探针供应商",
							api: "openai-responses",
							baseUrl: `http://127.0.0.1:${port}/v1`,
							apiKey: "probe-key",
							enabled: true,
							models: [],
						},
					],
				}),
			);
		},
	});

	try {
		await app.evaluate("document.fonts.ready");

		// 设置页 → 模型设置 → 拉取模型。走真实导航，不直接改 store。
		await click(".ly-sidebar-foot button");
		await byLabel("模型设置", "nav button");
		await until(`[...document.querySelectorAll("button")].some((b)=>b.checkVisibility()&&/拉取模型/.test(b.innerText+(b.getAttribute('data-ly-tip')??'')))`);
		await byLabel("拉取模型");
		await until(`document.querySelector('[data-ly-modal]')`);
		await app.evaluate(`(${WAIT})(600)`);

		await shot(`${phase}_01_弹窗默认全选`);

		/*
		 * 滑块压字：客户第二张截图里，右端那一列「200K」被滚动条盖掉了半个字。
		 *
		 * 量的是画出来的几何，四件事：
		 *   - 最右那列字的右缘到滑块左缘隔多远——负数就是压上了；
		 *   - 那列字的右缘还跟上面「全选」的右缘对不对齐。让开滑块有两种办法，一种是把列表缩窄，那会
		 *     让这两条边错开一截，这一项就是冲着它来的；
		 *   - 行的底色两边是不是都画得出来。行本来就比字宽出去一点（`-mx-2.5`），可滚动面按内容区
		 *     裁横向，宽出去的那一点从来没显示过；
		 *   - 滑块还在弹窗里面，没有贴到卡片边上。
		 */
		const edges = await app.evaluate<{
			thumb: { left: number; right: number } | null;
			text: number;
			selectAll: number;
			row: { left: number; right: number };
			view: { left: number; right: number };
			card: number;
		}>(`(() => {
			const modal = document.querySelector('[data-ly-modal]');
			const rect = (el) => el.getBoundingClientRect();
			const thumb = modal.querySelector('.ly-thumb');
			const view = modal.querySelector('.ly-scroll-view');
			const row = modal.querySelector('label');
			const size = row.lastElementChild;
			const selectAll = [...modal.querySelectorAll('button')].find((b) => /全选/.test(b.innerText || ''));
			const box = rect(view);
			return {
				thumb: thumb ? { left: rect(thumb).left, right: rect(thumb).right } : null,
				text: rect(size).right,
				selectAll: rect(selectAll).right,
				row: { left: rect(row).left, right: rect(row).right },
				view: { left: box.left + view.clientLeft, right: box.left + view.clientLeft + view.clientWidth },
				card: rect(modal).right,
			};
		})()`);
		const gap = edges.thumb ? Math.round((edges.thumb.left - edges.text) * 10) / 10 : Number.NaN;
		check(
			"最右一列的字不压在滑块底下",
			edges.thumb !== null && gap >= 4,
			edges.thumb ? `字的右缘到滑块左缘 ${gap}px（负数 = 压住）` : "没有滑块——列表没溢出，量不到",
		);
		check(
			"最右一列仍跟「全选」右缘对齐（列表没有被缩窄）",
			Math.abs(edges.text - edges.selectAll) <= 1,
			`字右缘 ${Math.round(edges.text)}，全选右缘 ${Math.round(edges.selectAll)}`,
		);
		check(
			"行的底色两边都画得出来，不被滚动面裁掉",
			edges.row.left >= edges.view.left - 0.5 && edges.row.right <= edges.view.right + 0.5,
			`行 ${Math.round(edges.row.left)}–${Math.round(edges.row.right)}，滚动面可见区 ${Math.round(edges.view.left)}–${Math.round(edges.view.right)}`,
		);
		check(
			"滑块在弹窗里面，离卡片边缘还有距离",
			edges.thumb !== null && edges.card - edges.thumb.right >= 4,
			edges.thumb ? `滑块右缘到卡片右缘 ${Math.round((edges.card - edges.thumb.right) * 10) / 10}px` : "没有滑块",
		);
		// 指针停在第二行上，拍一张底色：它该比字两边各宽出去一点，右边不该碰到滑块。
		const hover = await app.evaluate<{ x: number; y: number }>(
			`(() => { const r = document.querySelectorAll('[data-ly-modal] label')[1].getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
		);
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...hover });
		await app.evaluate(`(${WAIT})(250)`);
		await shot(`${phase}_01b_悬停一行`);
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });

		const measured = await app.evaluate<{
			rows: number;
			footerCount: number;
			selectAll: { text: string; height: number; radius: string } | null;
			field: { height: number; radius: string } | null;
			footer: { text: string; width: number }[];
			rowBorders: number[];
			namelessInBody: number;
			sidebar: string;
			shell: string;
		}>(`(() => {
			const modal = document.querySelector('[data-ly-modal]');
			const px = (v) => Math.round(parseFloat(v));
			const box = (el) => el ? { text: (el.innerText||'').trim(), height: px(getComputedStyle(el).height), radius: getComputedStyle(el).borderTopLeftRadius } : null;
			const fieldEl = modal.querySelector('[data-ly-field]');
			const buttons = [...modal.querySelectorAll('button')].filter((b) => b.checkVisibility());
			const selectAllEl = buttons.find((b) => /全选/.test(b.innerText||''));
			// 页脚按它自己的记号找。从前取「弹窗最后一个子元素」，弹窗换成 DialogFrame 之后那是整个框，
			// 每一行的勾选框都被数成了页脚按钮。
			const footerEl = modal.querySelector('[data-ly-dialog-actions]');
			const footerButtons = [...footerEl.querySelectorAll('button')].filter((b) => b.checkVisibility());
			const rows = [...modal.querySelectorAll('label')];
			const root = getComputedStyle(document.documentElement);
			/*
			 * 「弹窗主体里有几颗按钮一个字都没有」——右上角那颗关掉的 ✕ 不算：一个角上的叉是
			 * 所有弹窗的通用记号，而页脚和工具行里的按钮不是。
			 */
			const header = modal.firstElementChild;
			const nameless = buttons.filter((b) => !header.contains(b) && !rows.some((r) => r.contains(b)) && !(b.innerText||'').trim()).length;
			return {
				rows: rows.length,
				footerCount: footerButtons.length,
				selectAll: box(selectAllEl),
				field: fieldEl ? { height: px(getComputedStyle(fieldEl).height), radius: getComputedStyle(fieldEl).borderTopLeftRadius } : null,
				footer: footerButtons.map((b) => ({ text: (b.innerText||'').trim(), width: Math.round(b.getBoundingClientRect().width) })),
				rowBorders: [...new Set(rows.map((r) => px(getComputedStyle(r).borderTopWidth)))],
				namelessInBody: nameless,
				sidebar: root.getPropertyValue('--color-sidebar').trim(),
				shell: root.getPropertyValue('--color-shell').trim(),
			};
		})()`);

		check("弹窗拉到了三十三个模型", measured.rows === MODELS.length, `${measured.rows} 行`);

		check(
			"全选那颗有可见文字",
			Boolean(measured.selectAll?.text),
			`文字：${JSON.stringify(measured.selectAll?.text ?? "")}`,
		);
		check(
			"全选那颗跟搜索框同高同圆角",
			Boolean(measured.selectAll && measured.field) &&
				measured.selectAll?.height === measured.field?.height &&
				measured.selectAll?.radius === measured.field?.radius,
			`全选 ${measured.selectAll?.height}px / ${measured.selectAll?.radius}；搜索框 ${measured.field?.height}px / ${measured.field?.radius}`,
		);

		check(
			"页脚两颗按钮都有可见文字",
			measured.footerCount === 2 && measured.footer.every((b) => b.text.length > 0),
			JSON.stringify(measured.footer),
		);
		check(
			"主按钮上的数字还在（按下去会导入几个）",
			/\d/.test(measured.footer.at(-1)?.text ?? ""),
			`主按钮：${JSON.stringify(measured.footer.at(-1)?.text ?? "")}`,
		);
		check(
			"弹窗主体里没有一颗无字按钮",
			measured.namelessInBody === 0,
			`无字按钮 ${measured.namelessInBody} 颗（右上角关闭的 ✕ 不计）`,
		);

		check(
			"每行不再是一张带描边的卡片",
			measured.rowBorders.length === 1 && measured.rowBorders[0] === 0,
			`行 border-width 取值：${JSON.stringify(measured.rowBorders)}px`,
		);

		/*
		 * 顺带把 Windows 那条 header 的病根量出来:
		 * 系统画的最小化/最大化/关闭落在 `.ly-window-header` 里，那条带子是 sidebar 这一档，
		 * 而 `titleBarOverlay` 从前拿的是 shell。两个值不相等，就是右上角那块补丁的来源。
		 */
		check(
			"header 的底色与窗口底色确实是两档（Windows 右上角那块补丁的来源）",
			measured.sidebar !== measured.shell && Boolean(measured.sidebar) && Boolean(measured.shell),
			`--color-sidebar ${measured.sidebar} ≠ --color-shell ${measured.shell}`,
		);

		// 取消全选，看那颗按钮换不换词、页脚的数字跟不跟。
		// 改动前那一版没有可见文字，只有 tooltip，`byLabel` 认 `data-ly-tip`——两版都点得到，
		// 「点得到」和「读得懂」本来就是两件事，这里问的是前者。
		await byLabel(measured.selectAll?.text || "取消全选");
		await app.evaluate(`(${WAIT})(300)`);
		const cleared = await app.evaluate<{ selectAll: string; footer: string[] }>(`(() => {
			const modal = document.querySelector('[data-ly-modal]');
			const buttons = [...modal.querySelectorAll('button')].filter((b) => b.checkVisibility());
			return {
				selectAll: (buttons.find((b) => /全选/.test(b.innerText||''))?.innerText||'').trim(),
				footer: [...modal.querySelector('[data-ly-dialog-actions]').querySelectorAll('button')].map((b) => (b.innerText||'').trim()),
			};
		})()`);
		check(
			"全选与取消全选来回切，页脚跟着改口",
			cleared.selectAll.length > 0 && cleared.footer.every((t) => t.length > 0),
			`全选那颗现在写着 ${JSON.stringify(cleared.selectAll)}；页脚 ${JSON.stringify(cleared.footer)}`,
		);
		await shot(`${phase}_02_一个都不选`);
	} finally {
		const passed = results.filter((r) => r.ok).length;
		console.log(`\n${passed}/${results.length} 通过　（${phase}）`);
		const home = app.home;
		await app.stop();
		await rm(home, { recursive: true, force: true });
		endpoint.close();
		if (passed !== results.length) process.exitCode = 1;
	}
}

await main();
