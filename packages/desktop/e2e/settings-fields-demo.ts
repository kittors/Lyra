/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * 设置里的输入框和下拉：和弹窗按钮同一颗胶囊，菜单也跟着软一圈。
 *
 * 用法：先 `pnpm --filter @lyra/desktop build`，再
 * `node --experimental-strip-types packages/desktop/e2e/settings-fields-demo.ts`
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { startApp, type RunningApp } from "./app.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const out = process.argv[2] ?? join(homedir(), "Desktop", "Lyra设置控件测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 19);
const PORT = 9772;
const checks: { name: string; ok: boolean; measured: unknown }[] = [];
const check = (name: string, ok: boolean, measured: unknown) => {
	checks.push({ name, ok, measured });
	console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(measured)}`);
};

const usage = {
	input: 0,
	output: 0,
	total: 0,
	cacheRead: 0,
	cacheWrite: 0,
	cost: { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 },
};

async function seed(home: string): Promise<void> {
	const project = join(home, "proj");
	const id = createHash("sha256").update(project).digest("hex").slice(0, 16);
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "README.md"), "# proj\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 40, y: 40 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id, name: "proj", path: project, pinned: true, lastOpenedAt: 10 }],
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "off",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4578, token: null },
		}),
	);
	const meta = {
		id: "arch-1",
		title: "已归档的示例",
		cwd: project,
		projectId: id,
		projectName: "proj",
		createdAt: 1_700_000_000_000,
		updatedAt: 1_700_000_000_000,
		modelId: "test",
		messageCount: 2,
		usage,
		seq: 3,
		archived: true,
	};
	await mkdir(join(home, "sessions", id), { recursive: true });
	await writeFile(
		join(home, "sessions", id, "arch-1.jsonl"),
		[
			JSON.stringify({ seq: 0, ts: 1, type: "meta", meta }),
			JSON.stringify({ seq: 1, ts: 1, type: "message", message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 } }),
			JSON.stringify({
				seq: 2,
				ts: 2,
				type: "message",
				message: { role: "assistant", content: [{ type: "text", text: "ok" }], api: "anthropic-messages", provider: "test", model: "test", usage, stopReason: "stop", timestamp: 2 },
			}),
			JSON.stringify({ seq: 3, ts: 2, type: "meta", meta }),
		].join("\n") + "\n",
	);
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify([meta]));
}

function capsule(style: { height: string; borderRadius: string; borderTopWidth: string }): { height: number; radius: number; border: number } {
	return {
		height: Math.round(parseFloat(style.height)),
		radius: parseFloat(style.borderRadius),
		border: parseFloat(style.borderTopWidth),
	};
}

let app: RunningApp | undefined;
let stopRecording: (() => Promise<void>) | undefined;
const frames: Frame[] = [];

try {
	app = await startApp({ port: PORT, seed });
	stopRecording = await startRecording(PORT, frames);
	await app.evaluate("document.fonts.ready");

	async function until(expression: string, ms = 20_000) {
		for (let i = 0; i < ms / 100; i++) {
			if (await app!.evaluate(`Boolean(${expression})`)) return;
			await pause(100);
		}
		throw new Error(`UI condition not reached: ${expression}`);
	}
	async function click(selector: string) {
		await until(`Boolean(document.querySelector(${JSON.stringify(selector)}))`);
		await app!.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
		const at = await app!.evaluate<[number, number]>(
			`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]})()`,
		);
		for (const type of ["mousePressed", "mouseReleased"]) {
			await app!.send("Input.dispatchMouseEvent", { type, x: at[0], y: at[1], button: "left", clickCount: 1 });
		}
	}
	async function openSettings(label: string) {
		if (!(await app!.evaluate(`Boolean([...document.querySelectorAll("nav button")].find((b) => /返回工作区/.test(b.textContent || "")))`))) {
			await click(".ly-sidebar-foot button");
			await until(`Boolean(document.querySelector("nav button"))`);
			await pause(400);
		}
		await app!.evaluate(`(() => {
			const nav = [...document.querySelectorAll("nav button")].find((b) => (b.textContent || "").trim() === ${JSON.stringify(label)});
			if (nav) nav.click();
		})()`);
		await pause(700);
	}
	async function hold(ms = 1000) {
		const end = Date.now() + ms;
		while (Date.now() < end) {
			const picture = await app!.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 82 });
			frames.push({ at: Date.now(), data: Buffer.from(picture.data, "base64") });
			await pause(Math.min(200, Math.max(0, end - Date.now())));
		}
	}

	await openSettings("命令");
	await until(`Boolean(document.querySelector("[data-ly-field]"))`);
	const commands = await app.evaluate<{ field: ReturnType<typeof capsule>; action: ReturnType<typeof capsule> }>(`(() => {
		const read = (el) => {
			if (!el) return { height: 0, radius: 0, border: 0 };
			const s = getComputedStyle(el);
			return { height: Math.round(parseFloat(s.height)), radius: parseFloat(s.borderRadius), border: parseFloat(s.borderTopWidth) };
		};
		return {
			field: read(document.querySelector("input.ly-field")),
			action: read(document.querySelector("[data-ly-create-command]")),
		};
	})()`);
	check("command name field is the dialog capsule", commands.field.height === 34 && commands.field.radius >= 16 && commands.field.border === 0, commands);
	check("create button matches that height", commands.action.height === commands.field.height, commands);
	await hold(1100);

	await openSettings("已归档的聊天");
	await until(`Boolean(document.querySelector("[data-ly-select]"))`);
	const archived = await app.evaluate<{ search: ReturnType<typeof capsule>; select: ReturnType<typeof capsule> }>(`(() => {
		const read = (el) => {
			if (!el) return { height: 0, radius: 0, border: 0 };
			const s = getComputedStyle(el);
			return { height: Math.round(parseFloat(s.height)), radius: parseFloat(s.borderRadius), border: parseFloat(s.borderTopWidth) };
		};
		return {
			search: read(document.querySelector("[data-ly-field]:not([data-ly-select])")),
			select: read(document.querySelector("[data-ly-select]")),
		};
	})()`);
	check("archived search and dropdown share the capsule", archived.search.height === 34 && archived.select.height === 34 && archived.search.radius >= 16 && archived.select.radius >= 16 && archived.search.border === 0 && archived.select.border === 0, archived);
	await hold(800);

	await click("[data-ly-select]");
	await until(`Boolean(document.querySelector("[data-ly-popover]"))`);
	const menu = await app.evaluate<{ radius: number; itemRadius: number }>(`(() => {
		const pop = document.querySelector("[data-ly-popover]");
		const item = pop?.querySelector(".ly-item");
		return {
			radius: pop ? parseFloat(getComputedStyle(pop).borderRadius) : 0,
			itemRadius: item ? parseFloat(getComputedStyle(item).borderRadius) : 0,
		};
	})()`);
	check(
		"dropdown menu is a 16px card with concentric rows",
		menu.radius >= 14 && menu.radius <= 18 && menu.itemRadius >= 8 && menu.itemRadius <= 12,
		menu,
	);
	await hold(1200);

	await openSettings("关于");
	await until(`Boolean(document.querySelector("[data-ly-check-update]"))`);
	const about = await app.evaluate<{ select: ReturnType<typeof capsule>; button: ReturnType<typeof capsule> }>(`(() => {
		const read = (el) => {
			if (!el) return { height: 0, radius: 0, border: 0 };
			const s = getComputedStyle(el);
			return { height: Math.round(parseFloat(s.height)), radius: parseFloat(s.borderRadius), border: parseFloat(s.borderTopWidth) };
		};
		return {
			select: read(document.querySelector("[data-ly-select]")),
			button: read(document.querySelector("[data-ly-check-update]")),
		};
	})()`);
	check("about interval dropdown matches the check-update pill", about.select.height === about.button.height && about.select.radius >= 16 && about.select.border === 0, about);
	await hold(1400);
} catch (error) {
	check("verification script completed", false, String(error));
	throw error;
} finally {
	await stopRecording?.();
	await app?.stop();
	await mkdir(out, { recursive: true });
	const pass = checks.filter((item) => item.ok).length;
	const name = `${stamp}_设置控件_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ checks }, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 60);
	console.log(`Evidence: ${join(out, name)} (${frames.length} captured frames)`);
	if (checks.some((item) => !item.ok)) process.exitCode = 1;
}
