/* oxlint-disable no-console -- real-window verification prints measured evidence */
/**
 * 设置里那几颗按钮：和弹窗同一套，带字；归档分组默认收起，搜索才打开匹配的。
 *
 * 用法：先 `pnpm --filter @lyra/desktop build`，再
 * `node --experimental-strip-types packages/desktop/e2e/settings-actions-demo.ts`
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { startApp, type RunningApp } from "./app.ts";
import { encode, pause, startRecording, type Frame } from "./record.ts";

const out = process.argv[2] ?? join(homedir(), "Desktop", "Lyra设置按钮测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 19);
const PORT = 9771;
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
	const alpha = join(home, "alpha");
	const beta = join(home, "beta");
	const projects = [
		{ path: alpha, name: "Alpha" },
		{ path: beta, name: "Beta" },
	].map((project) => ({
		...project,
		id: createHash("sha256").update(project.path).digest("hex").slice(0, 16),
	}));

	await mkdir(alpha, { recursive: true });
	await mkdir(beta, { recursive: true });
	await writeFile(join(alpha, "README.md"), "# Alpha\n");
	await writeFile(join(beta, "README.md"), "# Beta\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 40, y: 40 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: projects.map((project, i) => ({
				id: project.id,
				name: project.name,
				path: project.path,
				pinned: i === 0,
				lastOpenedAt: 10 - i,
			})),
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "off",
			retryAttempts: 3,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4577, token: null },
		}),
	);

	const metas: object[] = [];
	const chats = [
		{ project: projects[0], title: "Alpha 归档甲", id: "arch-a1" },
		{ project: projects[0], title: "Alpha 归档乙", id: "arch-a2" },
		{ project: projects[1], title: "Beta 归档丙", id: "arch-b1" },
	];
	for (const [i, chat] of chats.entries()) {
		await mkdir(join(home, "sessions", chat.project.id), { recursive: true });
		const meta = {
			id: chat.id,
			title: chat.title,
			cwd: chat.project.path,
			projectId: chat.project.id,
			projectName: chat.project.name,
			createdAt: 1_700_000_000_000 + i * 1000,
			updatedAt: 1_700_000_000_000 + i * 1000,
			modelId: "test",
			messageCount: 2,
			usage,
			seq: 3,
			archived: true,
		};
		metas.push(meta);
		await writeFile(
			join(home, "sessions", chat.project.id, `${chat.id}.jsonl`),
			[
				JSON.stringify({ seq: 0, ts: 1, type: "meta", meta }),
				JSON.stringify({
					seq: 1,
					ts: 1,
					type: "message",
					message: { role: "user", content: [{ type: "text", text: chat.title }], timestamp: 1 },
				}),
				JSON.stringify({
					seq: 2,
					ts: 2,
					type: "message",
					message: {
						role: "assistant",
						content: [{ type: "text", text: "ok" }],
						api: "anthropic-messages",
						provider: "test",
						model: "test",
						usage,
						stopReason: "stop",
						timestamp: 2,
					},
				}),
				JSON.stringify({ seq: 3, ts: 2, type: "meta", meta }),
			].join("\n") + "\n",
		);
	}
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify(metas));
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
		await app!.evaluate(
			`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`,
		);
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
			await until(`Boolean(document.querySelector('nav button'))`);
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
	await until(`Boolean(document.querySelector('[data-ly-open-commands="personal"]'))`);
	const commands = await app.evaluate<{ personal: string; project: string; create: string; pills: number }>(`(() => {
		const text = (sel) => (document.querySelector(sel)?.textContent || "").replace(/\\s+/g, " ").trim();
		const personal = text('[data-ly-open-commands="personal"]');
		const project = text('[data-ly-open-commands="project"]');
		const create = text("[data-ly-create-command]");
		const pills = [...document.querySelectorAll("[data-ly-open-commands], [data-ly-create-command]")].filter((el) => el.classList.contains("ly-dialog-action")).length;
		return { personal, project, create, pills };
	})()`);
	check("two folder buttons have different words", commands.personal !== commands.project && commands.personal.includes("个人") && commands.project.includes("项目"), commands);
	check("command actions use the dialog button paint", commands.pills === 3 && commands.create.includes("创建并编辑"), commands);
	await hold(1200);

	await openSettings("已归档的聊天");
	await until(`Boolean(document.querySelector("[data-ly-archive-group]"))`);
	const collapsed = await app.evaluate<{ open: number; closedReveals: number; revealHeights: number[]; deleteAll: string }>(`(() => {
		const groups = [...document.querySelectorAll("[data-ly-archive-group]")];
		const reveals = groups.map((g) => g.querySelector(".ly-reveal"));
		return {
			open: groups.filter((g) => g.getAttribute("data-open") === "true").length,
			closedReveals: reveals.filter((el) => el && el.getBoundingClientRect().height < 2).length,
			revealHeights: reveals.map((el) => el ? Math.round(el.getBoundingClientRect().height) : -1),
			deleteAll: (document.querySelector("[data-ly-delete-all-archived]")?.textContent || "").replace(/\\s+/g, " ").trim(),
		};
	})()`);
	check("archived groups start closed", collapsed.open === 0 && collapsed.closedReveals === collapsed.revealHeights.length && collapsed.revealHeights.length >= 2, collapsed);
	check("delete-all is a labeled dialog button", collapsed.deleteAll.includes("全部删除"), collapsed);
	await hold(1000);

	await click("[data-ly-archive-toggle]");
	await pause(450);
	const expanded = await app.evaluate<{ open: number; openHeight: number; closed: number }>(`(() => {
		const groups = [...document.querySelectorAll("[data-ly-archive-group]")];
		const heights = groups.map((g) => Math.round((g.querySelector(".ly-reveal")?.getBoundingClientRect().height ?? 0)));
		return {
			open: groups.filter((g) => g.getAttribute("data-open") === "true").length,
			openHeight: Math.max(0, ...heights),
			closed: heights.filter((h) => h < 2).length,
		};
	})()`);
	check("clicking a group header opens that group", expanded.open === 1 && expanded.openHeight > 40 && expanded.closed >= 1, expanded);
	await hold(1000);

	await app.evaluate(`document.querySelector('input[placeholder*="搜索已归档"]')?.focus()`);
	await app.send("Input.insertText", { text: "Alpha" });
	await pause(500);
	const searched = await app.evaluate<{ names: string[]; open: number; height: number }>(`(() => {
		const groups = [...document.querySelectorAll("[data-ly-archive-group]")];
		return {
			names: groups.map((g) => (g.querySelector("[data-ly-archive-toggle]")?.textContent || "").replace(/\\s+/g, " ").trim()),
			open: groups.filter((g) => g.getAttribute("data-open") === "true").length,
			height: Math.round(groups[0]?.querySelector(".ly-reveal")?.getBoundingClientRect().height ?? 0),
		};
	})()`);
	check("search keeps only matching groups and opens them", searched.names.length === 1 && /Alpha/.test(searched.names[0] ?? "") && searched.open === 1 && searched.height > 40, searched);
	await hold(1200);

	await openSettings("关于");
	await until(`Boolean(document.querySelector("[data-ly-check-update]"))`);
	const about = await app.evaluate<{ check: string; repo: string; releases: string; pills: number }>(`(() => {
		const text = (sel) => (document.querySelector(sel)?.textContent || "").replace(/\\s+/g, " ").trim();
		const check = text("[data-ly-check-update]");
		const repo = text("[data-ly-open-repo]");
		const releases = text("[data-ly-open-releases]");
		const pills = [...document.querySelectorAll("[data-ly-check-update], [data-ly-open-repo], [data-ly-open-releases]")].filter((el) => el.classList.contains("ly-dialog-action")).length;
		return { check, repo, releases, pills };
	})()`);
	check("about actions have words and dialog paint", about.pills === 3 && about.check.includes("检查更新") && about.repo.length > 0 && about.releases.length > 0, about);
	await hold(1400);
} catch (error) {
	check("verification script completed", false, String(error));
	throw error;
} finally {
	await stopRecording?.();
	await app?.stop();
	await mkdir(out, { recursive: true });
	const pass = checks.filter((item) => item.ok).length;
	const name = `${stamp}_设置按钮_${pass}of${checks.length}`;
	await writeFile(join(out, `${name}.json`), JSON.stringify({ checks }, null, 2));
	if (frames.length) await encode(frames, join(out, `${name}.mp4`), 60);
	console.log(`Evidence: ${join(out, name)} (${frames.length} captured frames)`);
	if (checks.some((item) => !item.ok)) process.exitCode = 1;
}
