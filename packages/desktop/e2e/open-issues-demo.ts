/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * 本地未闭环 issue 的真窗口验收：侧栏分区、会话悬停缓存、切会话过渡、空页附件高度、运行行不再带缓存%。
 *
 * 用法：先 `pnpm --filter @lyra/desktop build`，再
 * `node --experimental-strip-types packages/desktop/e2e/open-issues-demo.ts`
 */
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, closeListeningServer, type RunningApp } from "./app.ts";
import { startRecording, encode, type Frame } from "./record.ts";
import { issueModel } from "./issues-fixture.ts";
import { emptyUsage, type AssistantMessage, type Message } from "@lyra/core";

const out = join(homedir(), "Desktop", "Lyra未修复issue验收");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 19);
const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => {
	checks.push({ name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
};

const model = issueModel();
await new Promise<void>((resolve) => model.server.listen(0, "127.0.0.1", resolve));
const address = model.server.address();
if (!address || typeof address === "string") throw new Error("No fixture port");

let app: RunningApp | undefined;
let stopRecording: (() => Promise<void>) | undefined;
const frames: Frame[] = [];
const pause = (ms = 1000) => new Promise((resolve) => setTimeout(resolve, ms));

async function seed(home: string) {
	const lyra = join(home, "lyra-project");
	const shop = join(home, "shop-project");
	await mkdir(lyra, { recursive: true });
	await mkdir(shop, { recursive: true });
	await writeFile(join(lyra, "README.md"), "# Lyra fixture\n");
	await writeFile(join(shop, "README.md"), "# 数图可视化品类空间\n");
	const lyraId = createHash("sha256").update(lyra).digest("hex").slice(0, 16);
	const shopId = createHash("sha256").update(shop).digest("hex").slice(0, 16);
	const at = Date.now() - 60_000;
	const usage = { ...emptyUsage(), input: 20_000, cacheRead: 80_000, cacheWrite: 0, total: 100_000 };
	const assistant = (text: string): AssistantMessage => ({
		role: "assistant",
		content: [{ type: "text", text }],
		stopReason: "stop",
		usage,
		timestamp: at,
		api: "anthropic-messages",
		provider: "issue",
		model: "fixture",
	});
	const thread = (ask: string, reply: string): Message[] => [
		{ role: "user", content: [{ type: "text", text: ask }], timestamp: at },
		assistant(reply),
	];
	const meta = (id: string, title: string, projectId: string, projectName: string, cwd: string, count: number) => ({
		id, title, projectId, projectName, cwd, createdAt: at, updatedAt: at, modelId: "issue/fixture", messageCount: count, usage, seq: count + 2,
	});
	const lyraMessages = thread("核对侧栏置顶和项目分区。", "Lyra 会话正文，用来对照切换。");
	const shopMessages = thread("打开数图这个未置顶项目。", "数图会话正文，切换后应平滑出现。");
	const pinMessages = thread("这条会话被置顶。", "置顶会话正文。");
	const lyraMeta = meta("issue-lyra", "Lyra 会话", lyraId, "Lyra", lyra, lyraMessages.length);
	const shopMeta = meta("issue-shop", "数图会话", shopId, "数图可视化品类空间", shop, shopMessages.length);
	const pinMeta = meta("issue-pin", "置顶的这条会话", lyraId, "Lyra", lyra, pinMessages.length);
	const writeSession = async (projectId: string, id: string, sessionMeta: typeof lyraMeta, messages: Message[]) => {
		const dir = join(home, "sessions", projectId);
		await mkdir(dir, { recursive: true });
		await writeFile(
			join(dir, `${id}.jsonl`),
			[
				JSON.stringify({ type: "meta", meta: sessionMeta, seq: 1, ts: at }),
				...messages.map((message, i) => JSON.stringify({ type: "message", message, seq: i + 2, ts: at })),
				JSON.stringify({ type: "meta", meta: sessionMeta, seq: sessionMeta.seq, ts: at }),
			].join("\n") + "\n",
		);
	};
	await writeSession(lyraId, "issue-lyra", lyraMeta, lyraMessages);
	await writeSession(shopId, "issue-shop", shopMeta, shopMessages);
	await writeSession(lyraId, "issue-pin", pinMeta, pinMessages);
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify([pinMeta, lyraMeta, shopMeta]));
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1440, height: 900 }));
	await writeFile(join(home, "settings.json"), JSON.stringify({
		uiLocale: "zh-CN",
		permissionMode: "full",
		projectMemory: false,
		thinking: "off",
		mcpServers: [],
		hooks: [],
		sync: { enabled: false },
		appearance: { reduceMotion: "off" },
		pinnedSessionIds: ["issue-pin"],
		projects: [
			{ path: lyra, name: "Lyra", pinned: true, lastOpenedAt: at },
			{ path: shop, name: "数图可视化品类空间", pinned: false, lastOpenedAt: at - 1000 },
		],
		defaultModelId: "issue/fixture",
		providers: [{
			id: "issue", name: "本地隔离模型", api: "anthropic-messages",
			baseUrl: `http://127.0.0.1:${address.port}`, apiKey: "test", enabled: true,
			models: [{ id: "issue/fixture", providerId: "issue", modelId: "fixture", name: "隔离测试", contextWindow: 128000, maxOutputTokens: 4096, supportsImages: true, supportsTools: true, supportsThinking: true }],
		}],
	}));
}

try {
	app = await startApp({ port: 9763, seed });
	const page = app;
	stopRecording = await startRecording(9763, frames);
	await page.evaluate("document.fonts.ready");

	async function until(expression: string, ms = 15_000) {
		for (let i = 0; i < ms / 100; i++) {
			if (await page.evaluate(`Boolean(${expression})`)) return;
			await pause(100);
		}
		throw new Error(`UI condition not reached: ${expression}`);
	}
	async function click(selector: string) {
		await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
		await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
		const at = await page.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
		for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
	}
	async function hover(selector: string) {
		await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
		const at = await page.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
		await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
	}

	await until(`Boolean(document.querySelector('[data-ly-tab="projects"]'))`);
	await pause(800);
	await click('[data-ly-tab="projects"]');
	await until(`Boolean(document.querySelector('[data-ly-section="projects"]'))`);
	await pause();

	const sections = await page.evaluate<{ pinned: string; projects: string; shopBelow: boolean; tops: number[] }>(`(()=>{
		const pinned=document.querySelector('[data-ly-section="pinned"]');
		const projects=document.querySelector('[data-ly-section="projects"]');
		const shop=[...document.querySelectorAll('[data-ly-head],button')].find(el=>el.textContent.includes('数图可视化品类空间'));
		const tops=[pinned,projects,shop].map(el=>el?el.getBoundingClientRect().top: -1);
		return {pinned:pinned?.textContent?.trim()??'',projects:projects?.textContent?.trim()??'',shopBelow:tops[2]>tops[1] && tops[1]>tops[0],tops};
	})()`);
	check("projects heading sits between pinned and the unpinned shop project", sections.shopBelow && /项目/.test(sections.projects) && /置顶/.test(sections.pinned), sections);
	await pause();

	await hover('[data-ly-row="issue-lyra"]');
	await pause(800);
	const card = await page.evaluate<{ text: string; hasSessionCache: boolean }>(`(()=>{
		const el=document.querySelector('[data-ly-session-card]');
		const text=el?.innerText??'';
		return {text, hasSessionCache: /全程缓存/.test(text) && /\\d+%/.test(text)};
	})()`);
	check("session hover card shows session-total cache only", card.hasSessionCache, card);
	await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 520, y: 420 });
	await pause();

	await click('[data-ly-tab="chats"]');
	await until(`Boolean(document.querySelector('[data-ly-row="issue-lyra"]'))`);
	await click('[data-ly-row="issue-lyra"] > button');
	await until(`document.querySelector('[data-ly-session]')?.getAttribute('data-ly-session')==='issue-lyra'`);
	await pause();

	const motion = await page.evaluate<{ min: number; max: number; faded: boolean; fromZero: boolean; shifted: boolean }>(`new Promise(resolve=>{
		let min=1,max=0,fromZero=false,shifted=false,clicked=false;
		const start=performance.now();
		function tick(now){
			if(!clicked){
				clicked=true;
				document.querySelector('[data-ly-row="issue-shop"] > button')?.click();
			}
			const el=document.querySelector('.ly-transcript');
			if(el){
				const style=getComputedStyle(el);
				const opacity=parseFloat(style.opacity);
				min=Math.min(min,opacity); max=Math.max(max,opacity);
				if(opacity<=0.08) fromZero=true;
				if(style.transform && style.transform!=='none') shifted=true;
			}
			if(now-start<420) requestAnimationFrame(tick);
			else resolve({min,max,faded:min<0.25 && max>=0.99,fromZero,shifted});
		}
		requestAnimationFrame(tick);
	})`);
	check("session switch fades in from transparent without sliding", motion.faded && motion.fromZero && !motion.shifted, motion);
	await until(`document.querySelector('[data-ly-session]')?.getAttribute('data-ly-session')==='issue-shop'`);
	await pause();

	await page.evaluate(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='新对话')?.click()`);
	await until(`Boolean(document.querySelector('[data-ly-chat-surface="empty"]'))`);
	await pause();

	const box = `(()=>{
		const h=document.querySelector('[data-ly-chat-surface="empty"] h1');
		const c=document.querySelector('main .ly-composer');
		if(!h||!c) return [ -1, -1, -1, 0 ];
		const hr=h.getBoundingClientRect();
		const cr=c.getBoundingClientRect();
		return [ hr.top, cr.top, cr.height, document.querySelectorAll('[data-ly-attachment]').length ];
	})()`;
	type Box = [number, number, number, number];
	const before = await page.evaluate<Box>(box);
	const attachedOk = await page.evaluate<number>(`(()=>{
		const input=document.querySelector('input[type=file]');
		if(!input) return 0;
		const transfer=new DataTransfer();
		transfer.items.add(new File([new Uint8Array([137,80,78,71,13,10,26,10])],'验收附件.png',{type:'image/png'}));
		input.files=transfer.files;
		input.dispatchEvent(new Event('change',{bubbles:true}));
		return 1;
	})()`);
	if (attachedOk !== 1) throw new Error("file input was not on the empty composer");
	let maxShift = 0;
	let minH = before[2];
	let maxH = before[2];
	let tiles = 0;
	for (let i = 0; i < 24; i++) {
		const sample = await page.evaluate<Box>(box);
		if (sample[0] >= 0) maxShift = Math.max(maxShift, Math.abs(sample[0] - before[0]));
		if (sample[2] >= 0) {
			minH = Math.min(minH, sample[2]);
			maxH = Math.max(maxH, sample[2]);
		}
		tiles = Math.max(tiles, sample[3]);
		if (tiles > 0 && maxH > before[2] + 8) break;
		await pause(50);
	}
	const grow = { maxShift, minH, maxH, tiles, headingStable: maxShift <= 12, grew: maxH > minH + 8 };
	check("empty-state heading stays put when a file is attached", grow.headingStable, grow);
	check("composer attachment slot grows instead of popping", grow.grew, grow);
	await pause();

	const after = await page.evaluate<Box>(box);
	check("heading did not jump more than 8px after attach", Math.abs(after[0] - before[0]) <= 8, { before, after });

	await click('[data-ly-row="issue-lyra"] > button');
	await until(`Boolean(document.querySelector('[data-ly-chat-surface="conversation"]'))`);
	await pause();
	model.set("hold");
	await click('[data-dock-pane="conversation"] textarea');
	await page.send("Input.insertText", { text: "跑一轮，核对运行行不再写缓存。" });
	await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
	await until("Boolean(document.querySelector('[data-ly-running]'))");
	await pause();
	const running = await page.evaluate<string>("document.querySelector('[data-ly-running]')?.innerText ?? ''");
	check("running line has no live cache percent", running.length > 0 && !/缓存/.test(running), running);
	model.finish();
	await pause();
} catch (error) {
	check("verification script completed", false, String(error));
	throw error;
} finally {
	model.finish();
	await stopRecording?.();
	await app?.stop();
	await closeListeningServer(model.server);
	await mkdir(out, { recursive: true });
	const pass = checks.filter((item) => item.ok).length;
	const name = `${stamp}_未修复issue_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ fixture: "Isolated LYRA_HOME, local SSE model, real Electron window", checks }, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 60);
	console.log(`Evidence: ${join(out, name)} (${frames.length} captured frames)`);
	if (checks.some((item) => !item.ok)) process.exitCode = 1;
}
