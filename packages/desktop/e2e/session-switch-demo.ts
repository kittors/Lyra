/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * 会话切换：整页淡入，文件卡不再从上往下展开。用本机真实大会话（上千条）来切。
 *
 * 用法：先 `pnpm --filter @lyra/desktop build`，再
 * `node --experimental-strip-types packages/desktop/e2e/session-switch-demo.ts`
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { encode, startRecording, type Frame } from "./record.ts";

const out = join(homedir(), "Desktop", "Lyra会话切换测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 19);
const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => {
	checks.push({ name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
};

const REAL_INDEX = join(homedir(), ".lyra", "sessions", "index.json");
const index = JSON.parse(await readFile(REAL_INDEX, "utf8")) as { id: string; title: string; messageCount: number; projectId: string }[];
const ranked = [...index].sort((a, b) => (b.messageCount ?? 0) - (a.messageCount ?? 0));
const huge = ranked.filter((session) => (session.messageCount ?? 0) >= 1000).slice(0, 2);
const cardSession = index.find((session) => session.title.includes("记录会话交互与输入框"));
if (huge.length < 2) throw new Error(`need two sessions with ≥1000 messages, have ${huge.map((s) => s.messageCount)}`);
if (!cardSession) throw new Error("missing the file-change session from the screenshot");

async function seedFromReal(home: string) {
	const env = { ...process.env, DEVELOPER_DIR: "/Library/Developer/CommandLineTools" };
	await promisify(execFile)("cp", ["-R", `${join(homedir(), ".lyra")}/.`, home], { env, maxBuffer: 64 * 1024 * 1024 });
	for (const secret of ["credentials.json", "vault.key", "forges.json"]) await rm(join(home, secret), { force: true });
	const file = join(home, "settings.json");
	try {
		const settings = JSON.parse(await readFile(file, "utf8")) as { providers?: { apiKey?: string }[]; sync?: { enabled?: boolean; port?: number } };
		for (const provider of settings.providers ?? []) provider.apiKey = "";
		if (settings.sync) settings.sync = { ...settings.sync, enabled: false, port: 4523 };
		await writeFile(file, JSON.stringify(settings));
	} catch { /* defaults still boot the copied sessions */ }
	const indexPath = join(home, "sessions", "index.json");
	const list = JSON.parse(await readFile(indexPath, "utf8")) as { id: string; projectId?: string; updatedAt?: number }[];
	const now = Date.now();
	const pinned = [huge[0], huge[1], cardSession];
	for (const [i, session] of pinned.entries()) {
		const row = list.find((entry) => entry.id === session.id);
		if (row) row.updatedAt = now - i;
		const log = join(home, "sessions", session.projectId, `${session.id}.jsonl`);
		try {
			const lines = (await readFile(log, "utf8")).trim().split("\n");
			const last = JSON.parse(lines[lines.length - 1]) as { type?: string; meta?: { updatedAt?: number }; seq?: number };
			if (last.type === "meta" && last.meta) {
				last.meta = { ...last.meta, updatedAt: now - i };
				last.seq = (last.seq ?? 0) + 1;
				lines.push(JSON.stringify(last));
				await writeFile(log, lines.join("\n") + "\n");
			}
		} catch { /* row still exists in the index */ }
	}
	list.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
	await writeFile(indexPath, JSON.stringify(list));
}

let app: RunningApp | undefined;
let stopRecording: (() => Promise<void>) | undefined;
const frames: Frame[] = [];
const pause = (ms = 1000) => new Promise((resolve) => setTimeout(resolve, ms));

try {
	app = await startApp({ port: 9766, seed: seedFromReal });
	const page = app;
	stopRecording = await startRecording(9766, frames);
	await page.evaluate("document.fonts.ready");

	async function until(expression: string, ms = 40_000) {
		for (let i = 0; i < ms / 100; i++) {
			if (await page.evaluate(`Boolean(${expression})`)) return;
			await pause(100);
		}
		throw new Error(`UI condition not reached: ${expression}`);
	}
	async function click(selector: string) {
		await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
		await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
		const at = await page.evaluate<[number, number]>(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`);
		for (const type of ["mousePressed", "mouseReleased"]) await page.send("Input.dispatchMouseEvent", { type, x: at[0], y: at[1], button: "left", clickCount: 1 });
	}
	async function revealRow(id: string) {
		for (let i = 0; i < 16; i++) {
			if (await page.evaluate(`Boolean(document.querySelector(${JSON.stringify(`[data-ly-row="${id}"]`)}))`)) return;
			const expanded = await page.evaluate<number>(`(()=>{const b=[...document.querySelectorAll('button')].find(el=>/展开显示/.test(el.textContent||'')); if(!b) return 0; b.click(); return 1;})()`);
			if (!expanded) break;
			await pause(200);
		}
		await until(`Boolean(document.querySelector(${JSON.stringify(`[data-ly-row="${id}"]`)}))`);
	}
	async function hold(ms = 1000) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			const picture = await page.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 82 });
			frames.push({ at: Date.now(), data: Buffer.from(picture.data, "base64") });
			await pause(Math.min(200, Math.max(0, end - Date.now())));
		}
	}
	async function switchFade(fromId: string, toId: string) {
		await revealRow(toId);
		await until(`document.querySelector('[data-ly-session]')?.getAttribute('data-ly-session')===${JSON.stringify(fromId)}`, 40_000);
		return page.evaluate<[number, number, number, number]>(`new Promise(resolve=>{
			let min=1,max=0,shifted=0,longest=0,last=performance.now(),clicked=false;
			const start=performance.now();
			function tick(now){
				const gap=now-last; if(gap>longest) longest=gap; last=now;
				if(!clicked){
					clicked=true;
					document.querySelector(${JSON.stringify(`[data-ly-row="${toId}"] > button`)})?.click();
				}
				const el=document.querySelector('.ly-transcript');
				if(el){
					const style=getComputedStyle(el);
					const opacity=+style.opacity;
					min=Math.min(min,opacity); max=Math.max(max,opacity);
					if(style.transform && style.transform!=='none') shifted=1;
				}
				if(now-start<520) requestAnimationFrame(tick);
				else resolve([min,max,shifted,Math.round(longest)]);
			}
			requestAnimationFrame(tick);
		})`);
	}

	await until(`document.querySelectorAll('[data-ly-row]').length>0`);
	if (await page.evaluate(`Boolean(document.querySelector('[data-ly-tab="chats"]'))`)) {
		await click('[data-ly-tab="chats"]');
	}
	console.log(`huge ${huge[0].messageCount} → ${huge[1].messageCount}, card ${cardSession.messageCount}`);

	await revealRow(huge[0].id);
	await click(`[data-ly-row="${huge[0].id}"] > button`);
	await until(`document.querySelector('[data-ly-session]')?.getAttribute('data-ly-session')===${JSON.stringify(huge[0].id)}`);
	await hold(1400);

	const toSecond = await switchFade(huge[0].id, huge[1].id);
	await until(`document.querySelector('[data-ly-session]')?.getAttribute('data-ly-session')===${JSON.stringify(huge[1].id)}`);
	check("large session fades in without sliding", toSecond[0] <= 0.2 && toSecond[1] >= 0.99 && toSecond[2] === 0, {
		from: huge[0].messageCount, to: huge[1].messageCount, min: toSecond[0], max: toSecond[1], shifted: toSecond[2], longestFrame: toSecond[3],
	});
	await hold(1400);

	const toCard = await switchFade(huge[1].id, cardSession.id);
	await until(`document.querySelector('[data-ly-session]')?.getAttribute('data-ly-session')===${JSON.stringify(cardSession.id)}`);
	check("switch from a large session still fades", toCard[0] <= 0.2 && toCard[1] >= 0.99 && toCard[2] === 0, {
		min: toCard[0], max: toCard[1], shifted: toCard[2], longestFrame: toCard[3],
	});
	await until(`Boolean(document.querySelector('[data-turn-delivery]'))`);
	const card = await page.evaluate<[number, number, string]>(`(()=>{
		const el=document.querySelector('[data-turn-delivery]');
		const parent=el&&el.parentElement;
		return [el?el.getBoundingClientRect().height:0, parent&&parent.classList.contains('ly-reveal')?1:0, parent?parent.className:'none'];
	})()`);
	check("file-change card is on screen", card[0] > 80, { height: card[0], parent: card[2] });
	check("file-change card is not unfolding from the top", card[1] === 0, { height: card[0], parent: card[2] });
	await hold(1600);

	const back = await switchFade(cardSession.id, huge[0].id);
	await until(`document.querySelector('[data-ly-session]')?.getAttribute('data-ly-session')===${JSON.stringify(huge[0].id)}`);
	check("returning to the 4000+ session still fades", back[0] <= 0.2 && back[1] >= 0.99 && back[2] === 0, {
		messages: huge[0].messageCount, min: back[0], max: back[1], longestFrame: back[3],
	});
	await hold(1400);
} catch (error) {
	check("verification script completed", false, String(error));
	throw error;
} finally {
	await stopRecording?.();
	await app?.stop();
	await mkdir(out, { recursive: true });
	const pass = checks.filter((item) => item.ok).length;
	const name = `${stamp}_会话切换_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({
		fixture: "Copied ~/.lyra (credentials stripped). Two sessions ≥1000 messages plus the file-change session.",
		sessions: { huge, card: cardSession },
		checks,
	}, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 60);
	console.log(`Evidence: ${join(out, name)} (${frames.length} captured frames)`);
	if (checks.some((item) => !item.ok)) process.exitCode = 1;
}
