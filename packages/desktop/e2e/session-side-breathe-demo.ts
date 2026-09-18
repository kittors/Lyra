/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * 侧边聊天在跑时，侧栏对应那一行要亮呼吸灯。
 *
 * 用法：先 `pnpm --filter @lyra/desktop build`，再
 * `node --experimental-strip-types packages/desktop/e2e/session-side-breathe-demo.ts`
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { startApp, type RunningApp } from "./app.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const out = process.argv[2] ?? join(homedir(), "Desktop", "Lyra侧边聊天呼吸灯测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 19);
const PORT = 9796;
const INSPECT = 9797;
const A = "breathe-a";
const B = "breathe-b";
const PROJECT = "呼吸灯项目";
const WINDOW =
	'process._linkedBinding("electron_browser_window").BrowserWindow.getAllWindows()' +
	".filter((w) => !w.isDestroyed() && w.isVisible())" +
	".sort((a, b) => b.getBounds().width - a.getBounds().width)[0]";

const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => {
	checks.push({ name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
};

async function seed(home: string): Promise<void> {
	const cwd = join(home, "project");
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	await mkdir(cwd, { recursive: true });
	await writeFile(join(cwd, "README.md"), "# breathe\n");
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	const usage = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		total: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
	const metas = [];
	for (const [index, id] of [A, B].entries()) {
		const messages = [
			{ role: "user", content: [{ type: "text", text: `会话 ${id}` }], timestamp: index * 10 },
			{
				role: "assistant",
				content: [{ type: "text", text: `${id} 的上一轮已经结束。` }],
				api: "anthropic-messages",
				provider: "qa",
				model: "qa",
				usage,
				stopReason: "stop",
				timestamp: index * 10 + 1,
			},
		];
		const meta = {
			id,
			title: id === A ? "侧聊正在跑的会话" : "旁边这条是空闲的",
			projectId,
			projectName: PROJECT,
			cwd,
			createdAt: 1 + index,
			updatedAt: 100 - index,
			modelId: "qa/model",
			messageCount: messages.length,
			usage,
			seq: 3,
		};
		metas.push(meta);
		await writeFile(
			join(home, "sessions", projectId, `${id}.jsonl`),
			[
				JSON.stringify({ type: "meta", meta, seq: 0, ts: 1 }),
				...messages.map((message, i) => JSON.stringify({ type: "message", message, seq: i + 1, ts: 1 })),
				JSON.stringify({ type: "meta", meta, seq: 3, ts: 2 }),
			].join("\n") + "\n",
		);
	}
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify(metas));
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1180, height: 780, x: 40, y: 40 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id: projectId, path: cwd, name: PROJECT, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: null,
			permissionMode: "full",
			thinking: "off",
			retryAttempts: 1,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4589, token: null },
			uiLocale: "zh-CN",
			appearance: { theme: "dark" },
		}),
	);
}

function rowProbe(id: string): string {
	return `(()=>{
		const row=document.querySelector('[data-ly-row=${JSON.stringify(id)}]');
		if(!row) return {found:false,mark:null,breathe:false,wave:false};
		const mark=row.querySelector('[data-ly-status-mark]')?.getAttribute('data-ly-status-mark')||null;
		const breathe=row.querySelector('.ly-breathe');
		const wave=breathe?getComputedStyle(breathe.querySelector('i')).animationName.includes('ly-breathe-wave'):false;
		return {found:true,mark,breathe:Boolean(breathe),wave};
	})()`;
}

let app: RunningApp | undefined;
let stopRecording: (() => Promise<void>) | undefined;
const frames: Frame[] = [];

try {
	app = await startApp({ port: PORT, inspectPort: INSPECT, seed });
	stopRecording = await startRecording(PORT, frames);
	await app.evaluate("document.fonts.ready");

	async function until(expression: string, ms = 20_000) {
		for (let i = 0; i < ms / 100; i++) {
			if (await app!.evaluate(`Boolean(${expression})`)) return;
			await pause(100);
		}
		throw new Error(`UI condition not reached: ${expression}`);
	}
	async function hold(ms = 900) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			const picture = await app!.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 82 });
			frames.push({ at: Date.now(), data: Buffer.from(picture.data, "base64") });
			await pause(Math.min(180, Math.max(0, end - Date.now())));
		}
	}
	async function click(selector: string) {
		await until(`Boolean(document.querySelector(${JSON.stringify(selector)})?.checkVisibility())`);
		await app!.evaluate(
			`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`,
		);
		await pause(80);
		const at = await app!.evaluate<{ x: number; y: number }>(
			`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
		);
		for (const type of ["mousePressed", "mouseReleased"]) {
			await app!.send("Input.dispatchMouseEvent", { type, ...at, button: "left", clickCount: 1 });
		}
	}
	async function emit(sessionId: string, type: "agent_start" | "agent_end") {
		const event = type === "agent_end" ? { type, reason: "aborted" } : { type };
		await app!.main(
			`${WINDOW}.webContents.send("sidechat:event", ${JSON.stringify({ sessionId, event })})`,
		);
	}

	await until(`Boolean(document.querySelector('[data-ly-row="${A}"]'))`);
	await click(`[data-ly-row="${A}"] > button`);
	await until(`Boolean(document.querySelector(".ly-composer"))`);
	await hold(700);

	const idle = await app.evaluate<{ mark: string | null; breathe: boolean }>(rowProbe(A));
	check("idle row has no breathing light", idle.mark === "idle" && !idle.breathe, idle);

	await app.evaluate(`document.querySelector('button[aria-label="面板"]')?.click()`);
	await until(`Boolean(document.querySelector('[role="menuitem"]'))`);
	await app.evaluate(
		`[...document.querySelectorAll('[role="menuitem"]')].find((e) => e.textContent.trim().startsWith("侧边聊天"))?.click()`,
	);
	await until(`Boolean(document.querySelector('[data-dock-pane="chat"] textarea.ly-composer-text'))`);
	await hold(800);

	await emit(A, "agent_start");
	await until(`document.querySelector('[data-ly-row="${A}"] [data-ly-status-mark="running"]')`);
	const live = await app.evaluate<{ mark: string | null; breathe: boolean; wave: boolean; side: boolean }>(
		`(()=>{
			const row=${rowProbe(A).replace(/;$/, "")};
			return {...row, side:Boolean(document.querySelector('[data-dock-pane="chat"]'))};
		})()`,
	);
	check(
		"side chat running lights the matching row",
		live.mark === "running" && live.breathe && live.wave && live.side,
		live,
	);
	await hold(1600);

	await click(`[data-ly-row="${B}"] > button`);
	await pause(400);
	const afterSwitch = await app.evaluate<{ a: unknown; b: unknown }>(
		`({a:${rowProbe(A)},b:${rowProbe(B)}})`,
	);
	check(
		"switching away keeps the side-chat row breathing",
		(afterSwitch.a as { mark: string; breathe: boolean; wave: boolean }).mark === "running" &&
			(afterSwitch.a as { breathe: boolean }).breathe &&
			(afterSwitch.a as { wave: boolean }).wave &&
			(afterSwitch.b as { mark: string; breathe: boolean }).mark === "idle" &&
			!(afterSwitch.b as { breathe: boolean }).breathe,
		afterSwitch,
	);
	await hold(1200);

	await click(`[data-ly-project="${PROJECT}"] button[aria-expanded]`);
	await until(`document.querySelector('[data-ly-project="${PROJECT}"] button')?.getAttribute('aria-expanded')==='false'`);
	const folded = await app.evaluate<{ running: string | null; rows: number }>(
		`(()=>({
			running:document.querySelector('[data-ly-group-running]')?.getAttribute('data-ly-group-running')||null,
			rows:[...document.querySelectorAll('[data-ly-row]')].filter((el)=>el.checkVisibility()).length,
		}))()`,
	);
	check("collapsed project still shows a running mark for the side chat", folded.running === "1", folded);
	await hold(1100);

	await click(`[data-ly-project="${PROJECT}"] button[aria-expanded]`);
	await until(`Boolean(document.querySelector('[data-ly-row="${A}"]')?.checkVisibility())`);

	await emit(A, "agent_end");
	await until(`document.querySelector('[data-ly-row="${A}"] [data-ly-status-mark="idle"]')`);
	const stopped = await app.evaluate<{ a: unknown; group: string | null }>(
		`({a:${rowProbe(A)},group:document.querySelector('[data-ly-group-running]')?.getAttribute('data-ly-group-running')||null})`,
	);
	check(
		"side chat ending clears the row light",
		(stopped.a as { mark: string; breathe: boolean }).mark === "idle" &&
			!(stopped.a as { breathe: boolean }).breathe &&
			stopped.group === null,
		stopped,
	);
	await hold(1000);
} catch (error) {
	check("verification script completed", false, String(error));
	throw error;
} finally {
	await stopRecording?.();
	await app?.stop();
	await mkdir(out, { recursive: true });
	const pass = checks.filter((item) => item.ok).length;
	const name = `${stamp}_侧边聊天呼吸灯_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ checks }, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 60);
	console.log(`Evidence: ${join(out, name)} (${frames.length} captured frames)`);
	if (checks.some((item) => !item.ok)) process.exitCode = 1;
}
