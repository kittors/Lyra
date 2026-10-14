/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * A conversation's own worktree over its life, end to end in the real window: the chip that says how
 * far it has moved from main, syncing main in, merging back, a sync stopped on a conflict — abandoned,
 * then handed to the conversation, which settles it — archiving (the folder goes), taking it out of the
 * archive (the folder comes back), the delete dialog naming what would be left behind, and a worktree
 * that could not be made.
 *
 * A throwaway repository is the project; a fake relay plays the model. Work "done in the worktree" is
 * committed by the probe with git, as a person or the model would. Checked from what a person sees —
 * the chip, the menu, the dialog — and from the disk and git.
 *
 *   node --experimental-strip-types e2e/worktree-lifecycle-demo.ts      # records into the Desktop folder `OUT` names
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rename, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { relaySettings, startFakeImageRelay } from "./fake-image-relay.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const PORT = 9481;
const OUT = join(homedir(), "Desktop", "Lyra工作树测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "✅" : "❌"} ${name}\n     ${detail}`);
}

let app: RunningApp;
async function shot(name: string) {
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	const file = join(OUT, `${stamp}_${name}.png`);
	await writeFile(file, Buffer.from(data, "base64"));
	console.log(`   📸 ${file}`);
}

/** The worktree chip as drawn: its label, its marks, whether it is greyed, and the warning mark beside it. */
const CHIP = `(() => {
	const chip = [...document.querySelectorAll(".ly-composer-tray button")].find((b) => (b.getAttribute("data-ly-tip") ?? "").startsWith("这个对话的工作树"));
	return {
		tip: chip ? chip.getAttribute("data-ly-tip") : null,
		marks: chip ? (chip.querySelector("[data-ly-worktree-marks]")?.textContent ?? "") : null,
		conflict: Boolean(chip && chip.querySelector("[data-ly-worktree-marks] svg")),
		dimmed: Boolean(chip && chip.className.includes("text-ink-muted")),
		failed: Boolean(document.querySelector("[data-ly-worktree-failed]")),
	};
})()`;

/** The open worktree menu: its status line, its rows (with whether each can be pressed), its note. */
const MENU = `(() => {
	const menu = document.querySelector("[aria-label='工作树']");
	if (!menu) return null;
	return {
		status: menu.querySelector("[data-ly-worktree-status]")?.textContent ?? "",
		rows: [...menu.querySelectorAll("[role='menuitem']")].map((row) => (row.disabled ? "×" : "") + row.textContent.trim()),
		note: menu.querySelector("[data-ly-worktree-note]")?.textContent ?? "",
		conflicts: menu.querySelector("[data-ly-worktree-conflicts]")?.textContent ?? "",
	};
})()`;

interface Chip {
	tip: string | null;
	marks: string | null;
	conflict: boolean;
	dimmed: boolean;
	failed: boolean;
}
interface Menu {
	status: string;
	rows: string[];
	note: string;
	conflicts: string;
}

async function main() {
	await mkdir(OUT, { recursive: true });
	const parent = await mkdtemp(join(tmpdir(), "lyra-wtlife-"));
	const project = join(parent, "demo-repo");
	await mkdir(join(project, "src"), { recursive: true });
	await writeFile(join(project, "README.md"), "# demo\n");
	await writeFile(join(project, "src", "index.ts"), "export const answer = 42;\n");
	const gitIn = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
	const git = (...args: string[]) => gitIn(project, ...args);
	git("init", "--initial-branch=main");
	git("config", "user.email", "probe@example.com");
	git("config", "user.name", "Probe");
	git("add", ".");
	git("commit", "-m", "init");
	const commit = async (cwd: string, file: string, text: string) => {
		await mkdir(join(cwd, file, ".."), { recursive: true });
		await writeFile(join(cwd, file), text);
		gitIn(cwd, "add", file);
		gitIn(cwd, "-c", "user.email=probe@example.com", "-c", "user.name=Probe", "commit", "-q", "-m", `edit ${file}`);
	};

	const relay = await startFakeImageRelay({
		scenes: [
			{ cue: "开个工作树", call: "call_where", tool: "bash", args: { command: "git branch --show-current" }, reply: "在自己的工作树里了。" },
			{
				cue: "这些文件有冲突",
				call: "call_resolve",
				tool: "bash",
				args: { command: "printf '# demo — kept both sides\\n' > README.md && git add README.md && git -c user.email=probe@example.com -c user.name=Probe commit --no-edit -q && git log -1 --format=%s" },
				reply: "冲突解决了，两边的意思都留下了，合并已经提交。",
			},
		],
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
					worktrees: { autoCreateOnNewSession: false },
				}),
			);
		},
	});
	const frames: Frame[] = [];
	const stop = await startRecording(PORT, frames);
	const { until, click, type, settled, markByText } = driver(app);
	const chip = () => app.evaluate<Chip>(CHIP);
	const menu = () => app.evaluate<Menu | null>(MENU);
	/** What makes the chip read git again when someone committed outside the window: the window coming forward. */
	const focusWindow = async () => {
		await app.evaluate(`window.dispatchEvent(new Event("focus"))`);
		await pause(900);
	};
	const openMenu = async () => {
		if (!(await menu())) {
			await click(".ly-composer-tray button[data-ly-tip^='这个对话的工作树']");
			await until(`document.querySelector("[aria-label='工作树'] [data-ly-worktree-status]")`, 10000);
		}
		await pause(900);
	};
	const closeMenu = async () => {
		if (await menu()) {
			await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
			await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
			await pause(600);
		}
	};
	const pressRow = async (label: string) => {
		await markByText(`/^${label}/`, "data-probe-row");
		await click("[data-probe-row]");
	};
	try {
		await app.evaluate("document.fonts.ready");
		await until(`document.querySelector("main textarea")`, 20000);
		await pause(1200);

		console.log("① 新会话开工作树，发一条");
		await click("[data-ly-worktree-toggle]");
		await pause(500);
		await type("开个工作树");
		await pause(500);
		await click('[aria-label="发送"]');
		await settled(60000);
		await pause(1200);
		const made = existsSync(join(home, "worktrees")) ? await readdir(join(home, "worktrees")) : [];
		const tree = join(home, "worktrees", made[0] ?? "missing");
		const session = await app.evaluate<{ id: string; projectId: string; branch: string } | null>(
			`window.lyra.sessions.list().then((all) => { const one = all.find((meta) => meta.worktree); return one ? { id: one.id, projectId: one.projectId, branch: one.worktree.branch } : null; })`,
		);
		const first = await chip();
		check("建了工作树，会话记着它的分支", made.length === 1 && Boolean(session), `~/.lyra/worktrees：${made.join("、") || "无"}；分支 ${session?.branch}`);
		check("输入框上是工作树 chip：⑂ 分支名，没有领先落后", first.tip === `这个对话的工作树：${session?.branch}` && first.marks === "", JSON.stringify(first));
		await shot("01_工作树会话的chip");

		console.log("② 工作树里提交两个，main 上来了一个：chip 说 ↑2 ↓1");
		await commit(tree, "src/feature.ts", "export const feature = true;\n");
		await commit(tree, "docs/feature.md", "# feature\n");
		await commit(project, "CHANGELOG.md", "## main moved on\n");
		await focusWindow();
		const moved = await chip();
		check("chip 上是 ↑2↓1", moved.marks === "↑2↓1", JSON.stringify(moved));
		await shot("02_领先2落后1");

		console.log("③ 打开菜单：从哪切出、领先落后，合并和同步都能点");
		await openMenu();
		const opened = await menu();
		check("菜单说：从 main 切出 · 领先 2 · 落后 1", opened?.status.includes("从 main 切出 · 领先 2 · 落后 1") === true, opened?.status ?? "没开");
		check("合并到 main、从 main 同步都能点", Boolean(opened?.rows.includes("合并到 main") && opened.rows.includes("从 main 同步")), (opened?.rows ?? []).join(" | "));
		await shot("03_工作树菜单");

		console.log("④ 从 main 同步");
		await pressRow("从 main 同步");
		await until(`document.querySelector("[data-ly-worktree-note]")`, 15000);
		await pause(1000);
		const synced = await menu();
		check("菜单里写着同步了 1 个提交", synced?.note === "已从 main 同步 1 个提交", synced?.note ?? "");
		check("main 的提交进了工作树", existsSync(join(tree, "CHANGELOG.md")), `CHANGELOG.md 在工作树里：${existsSync(join(tree, "CHANGELOG.md"))}`);
		check("落后清零：chip 是 ↑2（同步留下的合并提交不算）", (await chip()).marks === "↑2", JSON.stringify(await chip()));
		await shot("04_同步之后");

		console.log("⑤ 合并到 main");
		await pressRow("合并到 main");
		await until(`(document.querySelector("[data-ly-worktree-note]")?.textContent ?? "").includes("合并到")`, 15000);
		await pause(1000);
		const merged = await menu();
		check("菜单里写着合并了 2 个提交，并给出「归档这个对话」", merged?.note === "已把 2 个提交合并到 main归档这个对话", merged?.note ?? "");
		check("项目目录里的 main 有了工作树的文件，是一个合并提交", existsSync(join(project, "src", "feature.ts")) && git("log", "-1", "--format=%P").split(" ").length === 2, git("log", "-1", "--format=%s"));
		check("合完 chip 既不领先也不落后（main 上的合并提交不算）", (await chip()).marks === "", JSON.stringify(await chip()));
		await shot("05_合并到main");
		await closeMenu();

		console.log("⑥ 两边都改 README，同步：卡在冲突上");
		await commit(project, "README.md", "# demo — main's words\n");
		await commit(tree, "README.md", "# demo — the worktree's words\n");
		await focusWindow();
		await openMenu();
		await pressRow("从 main 同步");
		await until(`document.querySelector("[data-ly-worktree-conflicts]")`, 15000);
		await pause(1000);
		const stuck = await menu();
		check("菜单列出冲突的文件，给出交给对话、放弃两条路", stuck?.conflicts === "README.md" && stuck.rows.includes("交给这个对话解决") && stuck.rows.includes("放弃这次同步"), JSON.stringify(stuck));
		check("合并在冲突解决前点不了", stuck?.rows.some((row) => row.startsWith("×合并到 main") && row.includes("先解决同步的冲突")) === true, (stuck?.rows ?? []).join(" | "));
		check("chip 带上冲突的标记", (await chip()).conflict, JSON.stringify(await chip()));
		await shot("06_同步卡在冲突上");

		console.log("⑦ 放弃这次同步");
		await pressRow("放弃这次同步");
		await until(`!document.querySelector("[data-ly-worktree-conflicts]")`, 15000);
		await pause(900);
		const abandoned = await menu();
		check("放弃之后回到同步前：没有冲突，同步又能点", Boolean(abandoned?.rows.includes("从 main 同步")) && !(await chip()).conflict, JSON.stringify(abandoned?.rows));
		check("工作树里没有半截合并", gitIn(tree, "status", "--porcelain") === "", `git status：${gitIn(tree, "status", "--porcelain") || "干净"}`);
		await shot("07_放弃同步");

		console.log("⑧ 再同步一次，这回交给对话解决");
		await pressRow("从 main 同步");
		await until(`document.querySelector("[data-ly-worktree-conflicts]")`, 15000);
		await pause(700);
		await pressRow("交给这个对话解决");
		await settled(60000);
		await pause(1500);
		const resolved = await chip();
		const asked = await app.evaluate<string>(
			`window.lyra.sessions.transcript(${JSON.stringify(session?.projectId)}, ${JSON.stringify(session?.id)}).then((snap) => (snap?.messages ?? []).filter((m) => m.role === "user").map((m) => (m.content ?? []).map((c) => c.text ?? "").join("")).pop() ?? "")`,
		);
		check("对话收到的是一句说清文件的话", asked.includes("README.md") && asked.includes("这些文件有冲突"), asked.slice(0, 120));
		check("它解决并提交了：冲突标记没了，工作树干净", !resolved.conflict && gitIn(tree, "status", "--porcelain") === "", `${JSON.stringify(resolved)}；${gitIn(tree, "log", "-1", "--format=%s")}`);
		await shot("08_对话解决了冲突");

		console.log("⑨ 合并回去，然后归档：目录收走，已合并的分支一起删");
		await openMenu();
		await pressRow("合并到 main");
		await until(`(document.querySelector("[data-ly-worktree-note]")?.textContent ?? "").includes("合并到")`, 15000);
		await pause(900);
		check("合并成功", (await menu())?.note.startsWith("已把") === true, (await menu())?.note ?? "");
		await pressRow("归档这个对话");
		await pause(2500);
		check("归档后工作树目录没了", !existsSync(tree), `存在：${existsSync(tree)}`);
		check("分支全在 main 里，跟着删了", git("branch", "--list", session?.branch ?? "") === "", git("branch", "--list", "lyra/*") || "没有 lyra/ 分支");
		check("项目目录里的 main 留着全部工作", git("show", "main:README.md").includes("kept both sides"), git("show", "main:README.md"));
		await shot("09_归档之后");

		console.log("⑩ 从归档里拿回来：目录回到原处");
		await app.evaluate(`window.lyra.sessions.setArchived(${JSON.stringify(session?.projectId)}, ${JSON.stringify(session?.id)}, false)`);
		await pause(1500);
		check("取消归档，工作树在原来的路径检出回来", existsSync(join(tree, "README.md")), `存在：${existsSync(tree)}；分支 ${existsSync(tree) ? gitIn(tree, "branch", "--show-current") : "—"}`);
		await click(`[data-ly-row="${session?.id}"]`);
		await pause(1500);
		await focusWindow();
		const back = await chip();
		check("打开它：chip 正常，不是灰的", back.tip !== null && !back.dimmed, JSON.stringify(back));
		await shot("10_取消归档回来了");

		console.log("⑪ 有没提交的改动时归档：目录留着；删除确认说出会留下什么");
		await commit(tree, "src/later.ts", "export const later = 1;\n");
		await writeFile(join(tree, "draft.txt"), "not yet\n");
		await focusWindow();
		const rightClick = async (selector: string) => {
			const at = await app.evaluate<{ x: number; y: number }>(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
			await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
			await app.send("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button: "right", clickCount: 1 });
			await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button: "right", clickCount: 1 });
			await pause(800);
		};
		const row = `[data-ly-row="${session?.id}"]`;
		await rightClick(row);
		await markByText("/^归档$/", "data-probe-archive");
		await click("[data-probe-archive]");
		await pause(2500);
		check("有没提交的改动：归档不收目录", existsSync(join(tree, "draft.txt")), `draft.txt 还在：${existsSync(join(tree, "draft.txt"))}`);
		await click("button[aria-label^='已归档的聊天']");
		await until(`document.querySelector(${JSON.stringify(row)})`, 10000);
		await pause(800);
		await rightClick(row);
		await markByText("/^删除$/", "data-probe-delete");
		await click("[data-probe-delete]");
		// What is on screen frame by frame after the press: the hover card must not end up over the dialog.
		const timeline: string[] = [];
		for (let i = 0; i < 25; i++) {
			timeline.push(await app.evaluate<string>(`(document.querySelector("[data-ly-session-card]") ? "C" : "-") + (document.querySelector("[data-ly-overlay]") ? "D" : "-") + (document.querySelector("[role='menu']") ? "M" : "-")`));
			await pause(60);
		}
		console.log(`     卡片/对话框/菜单 逐 60ms：${timeline.join(" ")}`);
		await until(`document.querySelector("[data-ly-delete-worktree]")`, 10000);
		await pause(900);
		const note = await app.evaluate<string>(`document.querySelector("[data-ly-delete-worktree]")?.textContent ?? ""`);
		check("对话框说：没提交的文件留在工作树里，没合并的提交留在分支上", note.includes("1 个文件没提交") && note.includes("1 个提交没合并"), note);
		check("悬停卡片没有盖在对话框上", !(await app.evaluate<boolean>(`Boolean(document.querySelector("[data-ly-session-card]"))`)), timeline.join(" "));
		const fits = await app.evaluate<{ note: number; dialog: number }>(`(() => { const n = document.querySelector("[data-ly-delete-worktree]").getBoundingClientRect(); const d = document.querySelector(".ly-dialog-surface").getBoundingClientRect(); return { note: Math.round(n.right), dialog: Math.round(d.right) }; })()`);
		check("长路径在对话框里折行，不出界", fits.note <= fits.dialog, JSON.stringify(fits));
		await shot("11_删除确认说工作树");
		await markByText("/^取消$/", "data-probe-cancel");
		await click("[data-probe-cancel]");
		await pause(800);
		await click("button[aria-label='退出归档']");
		await pause(800);

		console.log("⑫ 建不成工作树：同一个位置留一个提醒");
		await rename(join(home, "worktrees"), join(home, "worktrees.kept"));
		await writeFile(join(home, "worktrees"), "a file where the folder should be\n");
		await markByText("/^新对话$/", "data-probe-new");
		await click("[data-probe-new]");
		await pause(1200);
		await click("[data-ly-worktree-toggle]");
		await pause(400);
		await type("开个工作树");
		await pause(400);
		await click('[aria-label="发送"]');
		await settled(60000);
		await pause(1200);
		const failed = await chip();
		check("输入框上出现提醒，而不是工作树 chip", failed.failed && failed.tip === null, JSON.stringify(failed));
		await click("[data-ly-worktree-failed]");
		await until(`document.querySelector("[data-ly-worktree-failed-note]")`, 10000);
		await pause(900);
		const why = await app.evaluate<string>(`document.querySelector("[data-ly-worktree-failed-note]")?.textContent ?? ""`);
		check("点开说清楚：在项目目录里运行，附上原因", why.includes("直接在项目目录里运行") && /worktrees/.test(why), why.slice(0, 200));
		check("没有弹 toast", (await app.evaluate<number>(`document.querySelector("[data-ly-toaster]")?.children.length ?? 0`)) === 0, "");
		await shot("12_没建成工作树");
		await rm(join(home, "worktrees"), { force: true });
		await rename(join(home, "worktrees.kept"), join(home, "worktrees"));
	} finally {
		await stop();
		const passed = results.filter((result) => result.ok).length;
		if (frames.length) {
			const file = join(OUT, `${stamp}_工作树回收与合并_${passed}of${results.length}.mp4`);
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
