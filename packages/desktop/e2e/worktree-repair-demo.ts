/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * Worktree conversations from before `SessionMeta.worktree`, filed back under their project at start-up.
 *
 * Seeds the shape such conversations were left in: a repository registered as a project, a worktree
 * made beside it the old way (`<repo>-<id8>` on `lyra/session-<id8>`) with a conversation running in
 * it and no record of where it came from, and a second one whose folder is gone and only its branch
 * is left — filed the way a scheduled run filed it, under the worktree's own folder name. Two that
 * must be left alone ride along: a conversation in the project itself, and an archived one in a
 * worktree somebody made by hand.
 *
 * Checked from what a person sees once the app is up: one group, the rows in it, the fork mark, the
 * order of the list, the chips of the opened conversation, and the worktree's files listed and a commit
 * made from it through the window. Started a second time on the same profile, nothing is written again.
 *
 *   node --experimental-strip-types e2e/worktree-repair-demo.ts      # records into the Desktop folder `OUT` names
 *
 * `LYRA_PROBE_BASELINE=1` only names the files as the build from before the repair; run it against
 * that build to see the same measurements fail.
 */

import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const PORT = 9496;
const BASELINE = process.env.LYRA_PROBE_BASELINE === "1";
const OUT = join(homedir(), "Desktop", "Lyra工作树测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const TAG = BASELINE ? "改前_" : "";
const PROJECT_NAME = "演示仓库";

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

const projectIdFor = (cwd: string) => createHash("sha256").update(cwd).digest("hex").slice(0, 16);
const ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

interface Seeded {
	id: string;
	title: string;
	cwd: string;
	projectId: string;
	projectName: string;
	updatedAt: number;
	archived?: boolean;
}

/** One conversation as the JSONL store kept it — a meta record, a question and an answer, seq from 1. */
async function writeLog(home: string, one: Seeded): Promise<Record<string, unknown>> {
	const meta = {
		id: one.id,
		title: one.title,
		cwd: one.cwd,
		projectId: one.projectId,
		projectName: one.projectName,
		createdAt: one.updatedAt - 60_000,
		updatedAt: one.updatedAt,
		modelId: "none",
		messageCount: 2,
		usage: ZERO,
		seq: 3,
		...(one.archived ? { archived: true } : {}),
	};
	const lines = [
		{ seq: 1, ts: meta.createdAt, type: "meta", meta },
		{ seq: 2, ts: meta.createdAt + 1000, type: "message", message: { role: "user", content: [{ type: "text", text: one.title }], timestamp: meta.createdAt + 1000 } },
		{ seq: 3, ts: one.updatedAt, type: "message", message: { role: "assistant", content: [{ type: "text", text: "改好了。" }], timestamp: one.updatedAt } },
	];
	await mkdir(join(home, "sessions", one.projectId), { recursive: true });
	await writeFile(join(home, "sessions", one.projectId, `${one.id}.jsonl`), `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
	return meta;
}

interface Meta {
	id: string;
	cwd: string;
	projectName: string;
	updatedAt: number;
	seq: number;
	archived?: boolean;
	worktree?: { project: string; branch: string; base?: string };
}

/** Where each row is drawn: the group above it, the mark at its start and what hovering that mark says. */
const LOOK = `(() => {
	const rows = [...document.querySelectorAll("[data-ly-row]")].map((row) => ({
		id: row.getAttribute("data-ly-row"),
		mark: row.querySelector("[data-ly-status-mark]")?.getAttribute("data-ly-status-mark") ?? null,
		tip: row.querySelector("[data-ly-status-mark]")?.closest("[data-ly-tip]")?.getAttribute("data-ly-tip") ?? null,
		group: row.closest("[data-ly-band]")?.querySelector("[data-ly-project]")?.getAttribute("data-ly-project") ?? null,
	}));
	return {
		groups: [...document.querySelectorAll("[data-ly-project]")].map((el) => el.getAttribute("data-ly-project")),
		rows,
		chips: [...document.querySelectorAll(".ly-composer-tray button")].map((b) => b.getAttribute("data-ly-tip") ?? "").filter(Boolean),
	};
})()`;

interface Look {
	groups: string[];
	rows: { id: string; mark: string | null; tip: string | null; group: string | null }[];
	chips: string[];
}

async function main() {
	await mkdir(OUT, { recursive: true });
	/*
	 * Where an old worktree went: beside the repository, under the canonical spelling `createWorktree`
	 * returned (`/private/var/…` on macOS). The project stays registered the way a person picked it
	 * (`/var/…`), so the field written back has to be spelled as the project is, or the sidebar opens a
	 * second group for the same folder.
	 */
	const parent = await mkdtemp(join(tmpdir(), "lyra-wt-repair-"));
	const parentReal = realpathSync(parent);
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

	const now = Date.now();
	const living = randomUUID();
	const livingTree = join(parentReal, `demo-repo-${living.slice(0, 8)}`);
	git("worktree", "add", "-B", `lyra/session-${living.slice(0, 8)}`, livingTree);
	// A scheduled run named its worktree from a throwaway id, not the conversation's: only the folder and branch agree.
	const goneId = randomUUID();
	const goneTag = Math.random().toString(36).slice(2, 10).padEnd(8, "x");
	const goneTree = join(parentReal, `demo-repo-${goneTag}`);
	git("worktree", "add", "-B", `lyra/session-${goneTag}`, goneTree);
	await rm(goneTree, { recursive: true, force: true });
	const handTree = join(parentReal, "demo-repo-notes");
	git("worktree", "add", "-b", "notes", handTree);

	const seeded: Record<"living" | "gone" | "plain" | "hand", Seeded> = {
		plain: { id: randomUUID(), title: "在项目里改 README", cwd: project, projectId: projectIdFor(project), projectName: "demo-repo", updatedAt: now - 1 * 3600_000 },
		living: { id: living, title: "在工作树里加一个函数", cwd: livingTree, projectId: projectIdFor(project), projectName: "demo-repo", updatedAt: now - 2 * 3600_000 },
		gone: { id: goneId, title: "定时整理依赖", cwd: goneTree, projectId: projectIdFor(goneTree), projectName: basename(goneTree), updatedAt: now - 5 * 3600_000 },
		hand: { id: randomUUID(), title: "手建工作树里的笔记", cwd: handTree, projectId: projectIdFor(project), projectName: "demo-repo", updatedAt: now - 26 * 3600_000, archived: true },
	};

	const home = await mkdtemp(join(tmpdir(), "lyra-e2e-"));
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id: "demo", name: PROJECT_NAME, path: project, pinned: true, lastOpenedAt: now }],
			defaultModelId: null,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4535, token: null },
			appearance: { theme: "light" },
		}),
	);
	const index = [];
	for (const one of [seeded.plain, seeded.living, seeded.gone, seeded.hand]) index.push(await writeLog(home, one));
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify(index));

	const frames: Frame[] = [];
	let stop: (() => Promise<void>) | null = null;
	try {
		app = await startApp({ port: PORT, reuseHome: home });
		stop = await startRecording(PORT, frames);
		const { until, click, hover, markByText } = driver(app);
		const list = () => app.evaluate<Meta[]>(`window.lyra.sessions.list()`);
		const look = () => app.evaluate<Look>(LOOK);
		const meta = (all: Meta[], key: keyof typeof seeded) => all.find((one) => one.id === seeded[key].id);
		await app.evaluate("document.fonts.ready");
		await until(`document.querySelector("[data-ly-row]")`, 20000);
		// The repair runs in the background; the sidebar follows the change it pushes. Polled from here: `until` wraps its expression in `Boolean`, which a promise always passes.
		for (const end = Date.now() + (BASELINE ? 3000 : 15000); Date.now() < end; await pause(250)) {
			if ((await list()).filter((one) => one.worktree).length >= 2) break;
		}
		await pause(1500);

		console.log("① 启动后：两个旧工作树会话归到原项目下");
		const first = await list();
		const shown = await look();
		const livingMeta = meta(first, "living");
		const goneMeta = meta(first, "gone");
		check(
			"目录还在的那个认出来了：worktree 指回项目（项目登记的写法）、分支是它检出的那条，cwd 不变",
			livingMeta?.worktree?.project === project && livingMeta.worktree.branch === `lyra/session-${living.slice(0, 8)}` && livingMeta.cwd === livingTree,
			JSON.stringify({ cwd: livingMeta?.cwd, worktree: livingMeta?.worktree }),
		);
		check(
			"目录已经删了的那个按「仓库旁边 + 分支还在」推出来，cwd 不变",
			goneMeta?.worktree?.project === project && goneMeta.worktree.branch === `lyra/session-${goneTag}` && goneMeta.cwd === goneTree,
			JSON.stringify({ cwd: goneMeta?.cwd, worktree: goneMeta?.worktree }),
		);
		check(
			"定时任务式的那个，项目名从工作树文件夹名改成项目的名字",
			goneMeta?.projectName === PROJECT_NAME && livingMeta?.projectName === PROJECT_NAME,
			`目录在：${livingMeta?.projectName}；目录删了：${goneMeta?.projectName}（原来是 ${seeded.gone.projectName}）`,
		);
		check(
			"侧栏只有原项目一个分组",
			shown.groups.length === 1 && shown.groups[0] === PROJECT_NAME,
			`分组：${shown.groups.join(" | ")}`,
		);
		const rowOf = (key: keyof typeof seeded) => shown.rows.find((row) => row.id === seeded[key].id);
		check(
			"两个旧工作树会话的行都在这一组里，行首是 ⑂，悬停说出它的分支",
			rowOf("living")?.group === PROJECT_NAME &&
				rowOf("gone")?.group === PROJECT_NAME &&
				rowOf("living")?.mark === "worktree" &&
				rowOf("gone")?.mark === "worktree" &&
				Boolean(rowOf("living")?.tip?.includes(`lyra/session-${living.slice(0, 8)}`)),
			JSON.stringify([rowOf("living"), rowOf("gone")]),
		);
		check("项目里那个普通会话还是空闲的圆点，没被当成工作树", rowOf("plain")?.mark === "idle", JSON.stringify(rowOf("plain")));
		const order = first.filter((one) => !one.archived).map((one) => one.id);
		const expectedOrder = [seeded.plain.id, seeded.living.id, seeded.gone.id];
		check(
			"列表里的位置没变：updatedAt 一个都没动，顺序还是 普通 → 目录在 → 目录删了",
			(["plain", "living", "gone", "hand"] as const).every((key) => meta(first, key)?.updatedAt === seeded[key].updatedAt) && JSON.stringify(order) === JSON.stringify(expectedOrder),
			(["plain", "living", "gone", "hand"] as const).map((key) => `${key}: ${meta(first, key)?.updatedAt === seeded[key].updatedAt ? "未变" : `${seeded[key].updatedAt} → ${meta(first, key)?.updatedAt}`}`).join("，"),
		);
		const handMeta = meta(first, "hand");
		check(
			"认不出的不动：手建的工作树（分支不是 lyra/session-）没被写上 worktree",
			handMeta !== undefined && handMeta.worktree === undefined && handMeta.projectName === "demo-repo",
			JSON.stringify({ projectName: handMeta?.projectName, worktree: handMeta?.worktree ?? null }),
		);
		const listed = await app.evaluate<number>(`window.lyra.files.list(${JSON.stringify(livingTree)}).then((entries) => entries.length).catch(() => -1)`);
		check("窗口能列出那棵旧工作树里的文件（不再是空的文件树）", listed > 0, `files.list → ${listed === -1 ? "被拒" : `${listed} 项`}`);
		// The same gate stood in front of committing: the third symptom, checked by committing.
		await writeFile(join(livingTree, "NOTES.md"), "written in the old worktree\n");
		const committed = await app.evaluate<{ ok: boolean; error?: string }>(`window.lyra.git.commit(${JSON.stringify(livingTree)}, "从旧工作树提交")`);
		const tip = git("log", "-1", "--format=%s", `lyra/session-${living.slice(0, 8)}`).trim();
		check("从那棵旧工作树里能提交了，提交落在它自己的分支上", committed.ok && tip === "从旧工作树提交", `git.commit → ${JSON.stringify(committed)}；lyra/session-${living.slice(0, 8)} 上最新一条：${tip}`);
		// On the fork, so the picture says what it means: the label names the branch. Only where there is a fork to point at.
		const fork = `[data-ly-row="${seeded.living.id}"] [data-ly-tip]:has(> [data-ly-status-mark="worktree"])`;
		if (await app.evaluate<boolean>(`Boolean(document.querySelector(${JSON.stringify(fork)}))`)) {
			await hover(fork);
			await pause(1200);
		}
		await shot("01_旧工作树会话归位到原项目");
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 900, y: 560 });
		await pause(1000);

		console.log("② 打开目录还在的那个：项目 chip 是原项目，分支 chip 是工作树的分支");
		await click(`[data-ly-row="${seeded.living.id}"]`);
		await until(`document.querySelectorAll(".ly-composer-tray button").length > 0`, 15000).catch(() => {});
		await pause(1800);
		const opened = await look();
		check(
			"打开后：项目 chip 是 demo-repo（不是工作树文件夹名），分支是 lyra/session-…（ADR-0040 起在工作树 chip 上）",
			opened.chips.includes("demo-repo") &&
				opened.chips.some((tip) => tip === `lyra/session-${living.slice(0, 8)}` || tip === `这个对话的工作树：lyra/session-${living.slice(0, 8)}`),
			`chips：${opened.chips.join(" | ")}`,
		);
		await shot("02_打开归位后的工作树会话");
		// Back to a new conversation before quitting, so the restart below is a change on screen rather than the same picture again.
		await markByText("/^新对话$/", "data-probe-new");
		await click("[data-probe-new]");
		await pause(1500);
		const seqs = Object.fromEntries((await list()).map((one) => [one.id, one.seq]));
		await stop();
		stop = null;
		await app.stop();

		console.log("③ 同一份数据再起一次：不再写任何东西");
		app = await startApp({ port: PORT, reuseHome: home });
		stop = await startRecording(PORT, frames);
		const again = driver(app);
		await app.evaluate("document.fonts.ready");
		await again.until(`document.querySelector("[data-ly-row]")`, 20000);
		await pause(3000);
		const second = await list();
		const unchanged = second.every((one) => seqs[one.id] === one.seq);
		const regrouped = await look();
		check(
			"第二次启动：每个会话的 seq 都没涨（归位只写一次），侧栏还是一组",
			unchanged && regrouped.groups.length === 1 && regrouped.groups[0] === PROJECT_NAME,
			`${second.map((one) => `${one.id.slice(0, 8)}:${seqs[one.id]}→${one.seq}`).join("，")}；分组：${regrouped.groups.join(" | ")}`,
		);
		await shot("03_重启后仍在原项目下");
		await pause(1200);
	} finally {
		await stop?.().catch(() => {});
		const passed = results.filter((result) => result.ok).length;
		if (frames.length) {
			const file = join(OUT, `${stamp}_${TAG}旧工作树会话归位_${passed}of${results.length}.mp4`);
			// A screencast only sends a frame when something changes; holding each still for up to 2.5s keeps every step readable.
			await encode(frames, file, 30, 2500);
			console.log(`🎬 ${file}`);
		}
		await app?.stop();
		await rm(home, { recursive: true, force: true });
		await rm(parent, { recursive: true, force: true });
		console.log(`\n${passed}/${results.length} 通过`);
		if (passed !== results.length) process.exitCode = 1;
	}
}

void main();
