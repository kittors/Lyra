/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * A conversation's own worktree, chosen in the composer, end to end in the real window.
 *
 * A throwaway repository is the project; a fake relay plays the model, which runs `pwd` and asks git
 * for the branch so the transcript says where the conversation really ran. Checked from what a
 * person sees: the toggle, the sidebar's groups and its mark, the project and branch chips, the files
 * the window can list, and the disk — where the worktree went and what appeared beside the project.
 *
 *   node --experimental-strip-types e2e/worktree-choice-demo.ts      # records into ~/Desktop/Lyra工作树测试
 *
 * `LYRA_PROBE_BASELINE=1` runs the build from before the toggle: the setting on, one message, and
 * the same measurements — the sidebar and chips as they used to be.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { relaySettings, startFakeImageRelay } from "./fake-image-relay.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const PORT = 9473;
const BASELINE = process.env.LYRA_PROBE_BASELINE === "1";
const OUT = join(homedir(), "Desktop", "Lyra工作树测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const TAG = BASELINE ? "改前_" : "";

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "✅" : "❌"} ${name}\n     ${detail}`);
}

let app: RunningApp;
async function shot(name: string) {
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	const file = join(OUT, `${stamp}_${TAG}${name}.png`);
	await writeFile(file, Buffer.from(data, "base64"));
	console.log(`   📸 ${file}`);
}

/** What the window shows about where the conversation is: groups, the row's mark, the chips. */
const LOOK = `(() => {
	const chips = [...document.querySelectorAll(".ly-composer-tray button")].map((b) => b.getAttribute("data-ly-tip") ?? "").filter(Boolean);
	const toggle = document.querySelector("[data-ly-worktree-toggle]");
	return {
		groups: [...document.querySelectorAll("[data-ly-project]")].map((el) => el.getAttribute("data-ly-project")),
		marks: [...document.querySelectorAll("[data-ly-row] [data-ly-status-mark]")].map((el) => el.getAttribute("data-ly-status-mark")),
		chips,
		toggle: toggle ? toggle.getAttribute("aria-pressed") : null,
	};
})()`;

/**
 * What \`pwd && git branch\` printed in the newest conversation, read from its transcript: the tool's
 * output sits in the folded process block, which is not drawn until opened.
 */
const RAN = `(async () => {
	const newest = (await window.lyra.sessions.list()).sort((a, b) => b.createdAt - a.createdAt)[0];
	const snapshot = newest ? await window.lyra.sessions.transcript(newest.projectId, newest.id) : null;
	return (snapshot?.messages ?? []).filter((m) => m.role === "toolResult").map((m) => (m.content ?? []).map((c) => c.text ?? "").join("")).join("\\n");
})()`;

interface Look {
	groups: string[];
	marks: string[];
	chips: string[];
	toggle: string | null;
}

async function main() {
	await mkdir(OUT, { recursive: true });
	// The project sits alone in a folder of its own, so anything made beside it shows.
	const parent = await mkdtemp(join(tmpdir(), "lyra-wt-parent-"));
	const project = join(parent, "demo-repo");
	await mkdir(join(project, "src"), { recursive: true });
	await writeFile(join(project, "README.md"), "# demo\n");
	await writeFile(join(project, "src", "index.ts"), "export const answer = 42;\n");
	const git = (...args: string[]) => execFileSync("git", args, { cwd: project, encoding: "utf8" });
	git("init", "--initial-branch=main");
	git("config", "user.email", "probe@example.com");
	git("config", "user.name", "Probe");
	git("add", ".");
	git("commit", "-m", "init");

	const relay = await startFakeImageRelay({
		scenes: [{ cue: "看看你在哪", call: "call_where", tool: "bash", args: { command: "pwd && git branch --show-current" }, reply: "看过了，就在这里。" }],
		art: { day: "", night: "" },
		drawMs: 0,
	});

	let home = "";
	app = await startApp({
		port: PORT,
		seed: async (dir) => {
			home = dir;
			await writeFile(join(dir, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 0, y: 0 }));
			await writeFile(
				join(dir, "settings.json"),
				relaySettings(relay.port, project, {
					projects: [{ path: project, name: "演示仓库", pinned: true, lastOpenedAt: Date.now() }],
					worktrees: { autoCreateOnNewSession: BASELINE },
				}),
			);
		},
	});
	const frames: Frame[] = [];
	const stop = await startRecording(PORT, frames);
	const { until, click, type, settled, markByText } = driver(app);
	const look = () => app.evaluate<Look>(LOOK);
	const worktrees = async () => (existsSync(join(home, "worktrees")) ? await readdir(join(home, "worktrees")) : []);
	try {
		await app.evaluate("document.fonts.ready");
		await until(`document.querySelector("main textarea")`, 20000);
		await pause(1200);

		if (!BASELINE) {
			console.log("① 新会话：输入框上有「这次用工作树」，按设置默认关着");
			await until(`document.querySelector("[data-ly-worktree-toggle]")`, 10000);
			const first = await look();
			check("新会话的输入框上有工作树开关，默认跟设置（关）", first.toggle === "false", `aria-pressed=${first.toggle}`);
			await shot("01_新会话_开关关着");
			await click("[data-ly-worktree-toggle]");
			await pause(700);
			const pressed = await look();
			check("点一下：这一次用工作树", pressed.toggle === "true", `aria-pressed=${pressed.toggle}`);
			await shot("02_这次用工作树");
		}

		console.log("② 发一条：让模型说出它在哪个目录、哪个分支");
		await type("看看你在哪");
		await pause(600);
		await click('[aria-label="发送"]');
		await settled(60000);
		await pause(1200);

		const made = await worktrees();
		const beside = (await readdir(parent)).filter((name) => name !== "demo-repo");
		const after = await look();
		const where = await app.evaluate<string>(RAN);
		if (BASELINE) {
			check("（改前）工作树建在项目旁边", beside.length === 1, `项目旁边：${beside.join("、") || "无"}；~/.lyra/worktrees：${made.join("、") || "无"}`);
			check("（改前）侧栏多出一个分组", after.groups.length > 1, `分组：${after.groups.join(" | ")}`);
			await shot("03_改前_侧栏多出一组");
		} else {
			check("工作树建在 ~/.lyra/worktrees 里", made.length === 1 && made[0].startsWith("demo-repo-"), `~/.lyra/worktrees：${made.join("、") || "无"}`);
			check("项目旁边没有多出目录", beside.length === 0, `项目旁边：${beside.join("、") || "无"}`);
			check("会话真的在工作树里跑：pwd 和分支都是它的", where.includes(`/worktrees/${made[0]}`) && where.includes("lyra/session-"), where.replace(/\s+/g, " ").slice(0, 200));
			check("侧栏只有原项目一个分组，没有同名的第二个", after.groups.length === 1 && after.groups[0] === "演示仓库", `分组：${after.groups.join(" | ")}`);
			check("项目 chip 是原项目名，分支 chip 是工作树的分支", after.chips.some((tip) => tip === "demo-repo") && after.chips.some((tip) => tip.startsWith("lyra/session-")), `chips：${after.chips.join(" | ")}`);
			check("开关在已经跑起来的会话上消失", after.toggle === null, `toggle=${after.toggle}`);
			const listed = await app.evaluate<number>(`window.lyra.files.list(${JSON.stringify(join(home, "worktrees", made[0] ?? "missing"))}).then((entries) => entries.length).catch(() => -1)`);
			check("窗口能列出工作树里的文件（不再是空的文件树）", listed > 0, `files.list → ${listed} 项`);
			await shot("03_工作树会话");

			console.log("③ 点别处让行首回到空闲，看工作树标记");
			await markByText("/^新对话$/", "data-probe-new");
			await click("[data-probe-new]");
			await pause(1200);
			const fresh = await look();
			check("从工作树会话点新对话：回到原项目，分支是 main，开关回到默认", fresh.chips.includes("demo-repo") && fresh.chips.includes("main") && fresh.toggle === "false", `chips：${fresh.chips.join(" | ")}；toggle=${fresh.toggle}`);
			check("侧栏上那个会话标着在工作树里", fresh.marks.includes("worktree"), `行首：${fresh.marks.join(" ")}`);
			await shot("04_新对话回到原项目");

			console.log("④ 这次不开开关：直接在项目里跑");
			await type("看看你在哪");
			await pause(600);
			await click('[aria-label="发送"]');
			await settled(60000);
			await pause(1200);
			const second = await look();
			const secondRan = await app.evaluate<string>(RAN);
			check("不开开关就不建工作树", (await worktrees()).length === 1, `~/.lyra/worktrees：${(await worktrees()).join("、")}`);
			check("这一条在项目目录里跑，分支是 main", (secondRan.includes(project) || secondRan.includes(`/private${project}`)) && /\bmain\b/.test(secondRan), secondRan.replace(/\s+/g, " ").slice(-200));
			check("两个会话都在原项目下", second.groups.length === 1, `分组：${second.groups.join(" | ")}`);
			await shot("05_两个会话都在原项目下");
		}
	} finally {
		await stop();
		const passed = results.filter((result) => result.ok).length;
		if (frames.length) {
			const file = join(OUT, `${stamp}_${TAG}工作树按会话选_${passed}of${results.length}.mp4`);
			await encode(frames, file, 30, 1500);
			console.log(`🎬 ${file}`);
		}
		await app.stop();
		relay.close();
		await rm(parent, { recursive: true, force: true });
		console.log(`\n${passed}/${results.length} 通过`);
		if (passed !== results.length) process.exitCode = 1;
	}
}

void main();
