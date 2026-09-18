/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * 侧栏点会话：行要立刻亮，转录可以后到。
 *
 * 用法：先 `pnpm --filter @lyra/desktop build`，再
 * `node --experimental-strip-types packages/desktop/e2e/session-click-demo.ts`
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { encode, startRecording, type Frame } from "./record.ts";
import { issueModel, seedIssues } from "./issues-fixture.ts";

process.env.LYRA_E2E_SLOW_TRANSCRIPT = "450";

const out = process.argv[2] ?? join(homedir(), "Desktop", "Lyra会话点击测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 19);
const PORT = 9794;
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

try {
	app = await startApp({ port: PORT, seed: (home) => seedIssues(home, address.port) });
	stopRecording = await startRecording(PORT, frames);
	await app.evaluate("document.fonts.ready");

	async function until(expression: string, ms = 20_000) {
		for (let i = 0; i < ms / 100; i++) {
			if (await app!.evaluate(`Boolean(${expression})`)) return;
			await pause(100);
		}
		throw new Error(`UI condition not reached: ${expression}`);
	}
	async function hold(ms = 800) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			const picture = await app!.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 82 });
			frames.push({ at: Date.now(), data: Buffer.from(picture.data, "base64") });
			await pause(Math.min(200, Math.max(0, end - Date.now())));
		}
	}

	await until(`Boolean(document.querySelector('[data-ly-row="issue-demo"]'))`);
	await app.evaluate(`document.querySelector('[data-ly-row="issue-demo"] > button')?.click()`);
	await until(`document.querySelector('[data-ly-row="issue-demo"] > button')?.getAttribute('aria-current')==='page'`);
	await hold(700);

	const click = await app.evaluate<{ highlightMs: number | null; contentMs: number | null; firstLit: boolean }>(`new Promise(resolve=>{
		const row=document.querySelector('[data-ly-row="issue-cold"] > button');
		const start=performance.now();
		let highlightMs=null;
		let contentMs=null;
		let firstLit=false;
		function sample(now){
			const lit=row?.getAttribute('aria-current')==='page';
			if(lit && highlightMs===null){
				highlightMs=Math.round(now-start);
				firstLit=document.querySelector('[data-ly-session]')?.getAttribute('data-ly-session')!=='issue-cold';
			}
			const session=document.querySelector('[data-ly-session]')?.getAttribute('data-ly-session');
			const skeleton=document.querySelector('[data-ly-chat-surface="skeleton"]');
			if((session==='issue-cold' || skeleton) && contentMs===null) contentMs=Math.round(now-start);
			if(highlightMs!==null && contentMs!==null && now-start>80) return resolve({highlightMs,contentMs,firstLit});
			if(now-start>8000) return resolve({highlightMs,contentMs,firstLit});
			requestAnimationFrame(sample);
		}
		row?.click();
		requestAnimationFrame(sample);
	})`);
	check("row lights before the transcript is swapped", click.firstLit && click.highlightMs !== null && click.highlightMs < 50, click);
	check("right column is allowed to arrive later", click.contentMs !== null && click.highlightMs !== null && click.contentMs >= click.highlightMs, click);
	await hold(1200);

	await app.evaluate(`document.querySelector('[data-ly-row="issue-demo"] > button')?.click()`);
	await until(`document.querySelector('[data-ly-row="issue-demo"] > button')?.getAttribute('aria-current')==='page'`);
	await until(`document.querySelector('[data-ly-session]')?.getAttribute('data-ly-session')==='issue-demo'`);
	await hold(400);

	const flash = await app.evaluate<{ seenNew: boolean; oldAfterNew: number; newLit: boolean; oldLit: boolean }>(`new Promise((resolve) => {
		const oldBtn = document.querySelector('[data-ly-row="issue-demo"] > button');
		const nextBtn = document.querySelector('[data-ly-row="issue-cold"] > button');
		let seenNew = false;
		let oldAfterNew = 0;
		const start = performance.now();
		function tick(now) {
			const newLit = nextBtn?.getAttribute('aria-current') === 'page';
			const oldLit = oldBtn?.getAttribute('aria-current') === 'page';
			if (newLit) seenNew = true;
			if (seenNew && oldLit) oldAfterNew++;
			if (now - start > 900) return resolve({ seenNew, oldAfterNew, newLit: Boolean(newLit), oldLit: Boolean(oldLit) });
			requestAnimationFrame(() => tick(performance.now()));
		}
		nextBtn?.click();
		requestAnimationFrame(() => tick(performance.now()));
	})`);
	check("old row does not relight after the new one lights", flash.seenNew && flash.oldAfterNew === 0, flash);
	await hold(700);
	await app.evaluate(`document.querySelector('[data-ly-row="issue-demo"] > button')?.click()`);
	await until(`document.querySelector('[data-ly-row="issue-demo"] > button')?.getAttribute('aria-current')==='page'`);
	await hold(300);

	const burst = await app.evaluate<{ clicks: number; maxClickMs: number; before: string | null; sessions: string[]; lastLit: string | null; expected: string | null }>(`(async()=>{
		const ids=[...document.querySelectorAll('[data-ly-row]')].map(row=>row.getAttribute('data-ly-row')).filter(Boolean);
		const before=document.querySelector('[data-ly-session]')?.getAttribute('data-ly-session')||null;
		const sessions=[];
		const costs=[];
		for(let i=0;i<15;i++){
			const id=ids[i%ids.length];
			const row=document.querySelector('[data-ly-row="'+id+'"] > button');
			const start=performance.now();
			row?.click();
			costs.push(performance.now()-start);
			sessions.push(document.querySelector('[data-ly-session]')?.getAttribute('data-ly-session')||'');
			await new Promise(resolve=>setTimeout(resolve,40));
		}
		const lastLit=document.querySelector('[data-ly-row] > button[aria-current="page"]')?.closest('[data-ly-row]')?.getAttribute('data-ly-row')??null;
		return {clicks:costs.length,maxClickMs:Math.round(Math.max(...costs)),before,sessions,lastLit,expected:ids.length?(ids[(15-1)%ids.length]??null):null};
	})()`);
	check("a burst of clicks stays inside the click handler", burst.maxClickMs < 8, burst);
	check("the transcript does not swap during the burst", Boolean(burst.before) && burst.sessions.every((id) => !id || id === burst.before), { before: burst.before, unique: [...new Set(burst.sessions.filter(Boolean))] });
	check("the last pressed row is the one that is lit", burst.lastLit === burst.expected, burst);
	await hold(1200);
	const after = await app.evaluate<string | null>(`document.querySelector('[data-ly-session]')?.getAttribute('data-ly-session')??null`);
	check("only the last click hydrates after the burst", after === burst.lastLit, { after, lastLit: burst.lastLit });

	await app.evaluate(`document.querySelector('[data-ly-row="issue-demo"] > button')?.click()`);
	await until(`document.querySelector('[data-ly-row="issue-demo"] > button')?.getAttribute('aria-current')==='page'`);
	await hold(900);
} catch (error) {
	check("verification script completed", false, String(error));
	throw error;
} finally {
	await stopRecording?.();
	await app?.stop();
	await closeListeningServer(model.server);
	await mkdir(out, { recursive: true });
	const pass = checks.filter((item) => item.ok).length;
	const name = `${stamp}_会话点击_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ checks }, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 30);
	console.log(`Evidence: ${join(out, name)} (${frames.length} captured frames)`);
	if (checks.some((item) => !item.ok)) process.exitCode = 1;
}
