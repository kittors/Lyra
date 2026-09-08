/**
 * 地址栏能不能搜，以及浏览器是不是真的一个会话一份。
 *
 * `node --experimental-strip-types e2e/browser-omnibox-probe.ts [dir]`
 *
 * 两件事都只有在跑起来的窗口里才算数：
 *
 *   - 往地址栏里打「天气 预报」，它必须去搜，而不是把这四个字当成主机名解析成 `xn--` 再报
 *     `ERR_ADDRESS_UNREACHABLE`——那正是这次要修的现象。图标、下拉里第一行写的是哪一件事、
 *     回车之后标签真正停在哪个地址，三样一起量。
 *   - 会话切走再切回来：另一个会话的页面不能出现在这个会话的面板里，而自己的页面必须还是原来
 *     那一张——不是重新加载出来的一张。后者用页面里自己留的记号判断，重载会把记号带走。
 *
 * 搜索引擎指向本地那台 fixture 服务器，所以这条探针不需要外网，也不会真的去请求必应。
 */

import { createServer, type Server } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

const dir = process.argv[2] ?? "/tmp/lyra-browser-omnibox";
await mkdir(dir, { recursive: true });

const server: Server = createServer((req, res) => {
	const url = new URL(req.url ?? "/", "http://127.0.0.1");
	res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
	res.end(`<!doctype html><title>${url.pathname === "/search" ? `搜索：${url.searchParams.get("q") ?? ""}` : url.pathname}</title><body style="font:16px system-ui;padding:40px"><h1>${url.pathname}</h1><p id="q">${url.searchParams.get("q") ?? ""}</p></body>`);
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
if (!address || typeof address === "string") throw new Error("fixture server has no port");
const port = address.port;
const site = `http://127.0.0.1:${port}`;

const app = await startApp({ port: 9731, seed: async (home) => {
	await seedInteractions(home);
	const path = join(home, "settings.json");
	const settings = JSON.parse(await readFile(path, "utf8"));
	settings.alwaysAllow = [site];
	settings.screenshot = { enabled: false, shortcut: "" };
	await writeFile(path, JSON.stringify(settings));
} });

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const shot = async (name: string) => {
	const result = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(dir, `${name}.png`), Buffer.from(result.data, "base64"));
};
let failures = 0;
const check = (label: string, passed: boolean, evidence: unknown) => {
	if (!passed) failures++;
	process.stdout.write(`  ${passed ? "✓" : "✗"} ${label}\n      ${typeof evidence === "string" ? evidence : JSON.stringify(evidence)}\n`);
};
/** 真的鼠标，不是 `.click()`：侧栏那一行认的是指针事件。 */
const openSession = async (id: string) => {
	const point = await app.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector('[data-ly-row=${JSON.stringify(id)}]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", button: "left", clickCount: 1, ...point });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", button: "left", clickCount: 1, ...point });
	await wait(1200);
};
const state = () => app.evaluate<{ tabs: { id: string; sessionId: string | null; url: string }[]; activeId: string | null }>("window.lyra.browser.state()");
/** 面板画出来的页面：谁有 `<webview>`，谁在屏幕上。 */
const pages = () => app.evaluate<{ mounted: string[]; visible: string[] }>(`(() => {
	const all = [...document.querySelectorAll('[data-browser-page]')];
	return { mounted: all.map((p) => p.dataset.browserPage), visible: all.filter((p) => p.parentElement.style.visibility === 'visible').map((p) => p.dataset.browserPage) };
})()`);
const typeAddress = async (text: string) => {
	// `select()` as well as `focus()`: a field that already had the focus does not fire `onFocus`
	// again, so without this the second `insertText` appends to the first.
	await app.evaluate(`(()=>{const el=document.querySelector('[aria-label="地址栏或搜索"]');el.focus();el.select();})()`);
	await app.send("Input.insertText", { text });
	await wait(400);
};
const pressEnter = async () => {
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
	await wait(1200);
};

try {
	await openSession("qa-short");
	const opened = await app.evaluate<string>(`window.lyra.browser.command({type:'open',url:'${site}/page',sessionId:'qa-short'}).then(()=>'ok',(e)=>e.message)`);
	await wait(1500);
	if (opened !== "ok") {
		const diagnosis = await app.evaluate(`(() => ({
			pane: Boolean(document.querySelector('[data-dock-pane="browser"]')),
			panel: Boolean(document.querySelector('[data-browser-panel]')),
			pages: document.querySelectorAll('[data-browser-page]').length,
			rowSelected: document.querySelector('[data-ly-row="qa-short"]')?.getAttribute('aria-current'),
		}))()`);
		check("第一次打开页面", false, { opened, diagnosis });
		throw new Error(opened);
	}

	// 1. 默认引擎在文案里说得出名字。
	const placeholder = await app.evaluate<string>(`document.querySelector('[aria-label="地址栏或搜索"]').placeholder`);
	check("默认必应，地址栏自己说了", placeholder.includes("必应"), placeholder);

	// 2. 打字的时候就分得清「这是网址」和「这是要搜的词」。
	await typeAddress(`${site}/second`);
	const asUrl = await app.evaluate<{ kind: string; rows: string[] }>(`(() => ({ kind: document.querySelector('[data-omnibox-kind]').dataset.omniboxKind, rows: [...document.querySelectorAll('[data-omnibox-choice]')].map((r) => r.dataset.omniboxChoice + ':' + r.textContent) }))()`);
	check("输入网址时给的是「打开」", asUrl.kind === "open" && asUrl.rows[0]?.startsWith("open:"), asUrl);
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", windowsVirtualKeyCode: 27 });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", windowsVirtualKeyCode: 27 });
	await wait(300);

	await typeAddress("天气 预报");
	const asQuery = await app.evaluate<{ kind: string; rows: string[] }>(`(() => ({ kind: document.querySelector('[data-omnibox-kind]').dataset.omniboxKind, rows: [...document.querySelectorAll('[data-omnibox-choice]')].map((r) => r.dataset.omniboxChoice + ':' + r.textContent) }))()`);
	check("输入词时给的是「搜索」", asQuery.kind === "search" && (asQuery.rows[0] ?? "").includes("用必应搜索"), asQuery);
	// 建议行里那句话有没有被挤掉：写得下却截断，比截断本身更容易被当成「就这么设计的」。
	const fit = await app.evaluate<{ list: number; field: number; label: number; needs: number; detail: number; clipped: boolean }>(`(() => {
		const row = document.querySelector('[data-omnibox-choice]');
		const label = row.querySelector('[data-omnibox-label]'), detail = row.querySelector('[data-omnibox-detail]');
		return {
			list: Math.round(document.querySelector('[data-omnibox-list]').getBoundingClientRect().width),
			field: Math.round(document.querySelector('[aria-label="地址栏或搜索"]').getBoundingClientRect().width),
			label: Math.round(label.getBoundingClientRect().width),
			needs: label.scrollWidth,
			detail: Math.round(detail.getBoundingClientRect().width),
			clipped: label.scrollWidth > Math.ceil(label.getBoundingClientRect().width),
		};
	})()`);
	check("下拉和地址栏一样宽", Math.abs(fit.list - fit.field) <= 1, fit);
	check("写得下的建议没有被截断", !fit.clipped, fit);
	await shot("01-omnibox-search");

	// 3. 换成本地那台「搜索引擎」，回车真的落在搜索结果页上。
	await app.evaluate(`window.lyra.settings.get().then(s=>window.lyra.settings.save({...s,browser:{...s.browser,searchEngine:'custom',searchUrl:'${site}/search?q=%s'}}))`);
	await wait(700);
	await typeAddress("天气 预报");
	await pressEnter();
	const searched = await state();
	const tab = searched.tabs.find((entry) => entry.id === searched.activeId);
	check("回车落在搜索结果页", tab?.url === `${site}/search?q=%E5%A4%A9%E6%B0%94%20%E9%A2%84%E6%8A%A5`, tab?.url ?? "无标签");
	const rendered = await app.evaluate<string>(`document.querySelector('[data-browser-page="${tab?.id}"]').executeJavaScript("document.querySelector('#q').textContent")`);
	check("搜索词按 UTF-8 到了服务端", rendered === "天气 预报", rendered);
	await shot("02-search-result");

	// 4. 在这张页面上留个记号，切走再回来用它判断有没有被重载。
	await app.evaluate(`document.querySelector('[data-browser-page="${tab?.id}"]').executeJavaScript("document.body.dataset.identity='kept'")`);

	// 5. 另一个会话：看不到别人的标签，自己的页面是自己的。
	await openSession("qa-long");
	const away = await pages();
	check("切到别的会话，别人的页面不再显示", away.visible.length === 0, away);
	check("刚离开的会话，页面仍然留着（切回来不用重载）", away.mounted.includes(tab?.id ?? ""), away);
	const empty = await app.evaluate<boolean>(`Boolean(document.querySelector('[data-browser-empty]'))`);
	check("新会话的浏览器是空的，不是别人的页面", empty, empty);
	await shot("03-other-session-empty");

	await app.evaluate(`window.lyra.browser.command({type:'open',url:'${site}/long',sessionId:'qa-long'})`);
	await wait(1500);
	const both = await pages();
	const longTab = (await state()).tabs.find((entry) => entry.sessionId === "qa-long");
	check("这个会话开的页面归它自己", both.visible.length === 1 && both.visible[0] === longTab?.id, { both, longTab: longTab?.id });
	await shot("04-second-session");

	// 6. 切回去：同一张页面，不是重新加载出来的一张。
	await openSession("qa-short");
	const back = await pages();
	check("切回来显示的还是自己的那张", back.visible[0] === tab?.id, back);
	const identity = await app.evaluate<string>(`document.querySelector('[data-browser-page="${tab?.id}"]').executeJavaScript("document.body.dataset.identity")`);
	check("页面没有被重载，记号还在", identity === "kept", identity);
	await shot("05-back-to-first");

	// 7. 设置页：换一家搜索引擎，地址栏跟着改口；自定义地址填错了要当场说出错在哪。
	const settings = await app.evaluate<string>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		const inSettings = () => [...document.querySelectorAll("button")].some((b) => (b.textContent || "").includes("返回工作区"));
		if (!inSettings()) { document.querySelector(".ly-sidebar-foot button")?.click(); await wait(1200); }
		if (!inSettings()) return "设置没打开";
		const nav = [...document.querySelectorAll("nav button")].find((b) => (b.textContent || "").trim() === "浏览器");
		if (!nav) return "找不到浏览器设置";
		nav.click(); await wait(1200);
		return "已打开";
	})()`);
	check("设置里有「浏览器」这一页", settings === "已打开", settings);
	const engines = await app.evaluate<string[]>(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		document.querySelector('[aria-label="搜索引擎"]').click();
		await wait(500);
		return [...document.querySelectorAll('[role="menuitem"],[role="option"]')].map((e) => e.textContent.trim());
	})()`);
	check("可选的引擎摆在那里", ["必应", "Google", "百度", "DuckDuckGo", "自定义"].every((name) => engines.includes(name)), engines);
	await shot("06-settings-engines");
	await app.evaluate(`(async () => {
		const wait = (ms) => new Promise((r) => setTimeout(r, ms));
		[...document.querySelectorAll('[role="menuitem"],[role="option"]')].find((e) => e.textContent.trim() === "自定义").click();
		await wait(900);
	})()`);
	// 缺 %s 的地址没有地方放搜索词：提交时必须被拦下并说明白。
	await app.evaluate(`(() => { const el = document.querySelector('[aria-label="自定义搜索地址"]'); el.focus(); el.select(); })()`);
	await app.send("Input.insertText", { text: "https://s.example.com/find" });
	await app.evaluate(`document.querySelector('[aria-label="自定义搜索地址"]').blur()`);
	await wait(600);
	const complaint = await app.evaluate<string>(`document.querySelector('[data-search-custom] p').textContent`);
	check("填错了当场说清楚", complaint.includes("%s"), complaint);
	await shot("07-settings-custom-invalid");
	const stored = JSON.parse(await readFile(join(app.home, "settings.json"), "utf8"));
	check("说不清的地址不写进设置", stored.browser?.searchUrl !== "https://s.example.com/find", stored.browser ?? {});

} catch (error) {
	// `process.exit` in the finally below would otherwise swallow this on its way out.
	failures++;
	process.stdout.write(`  ✗ 探针自己挂了\n      ${error instanceof Error ? error.stack : String(error)}\n`);
} finally {
	process.stdout.write(failures === 0 ? "\n全部通过\n" : `\n${failures} 项没过\n`);
	await app.stop();
	await new Promise<void>((resolve) => server.close(() => resolve()));
	process.exit(failures === 0 ? 0 : 1);
}
