/* oxlint-disable no-console -- 探针把量到的东西打出来，那就是它的产物 */
/**
 * 撤回唯一一条消息之后，主列该是什么。
 *
 * 用户报的样子：会话还在侧边栏里选着，转录空了，中间一整片空白，左上角孤零零一行「已暂停 ▶」。
 * 期望的样子：和新对话一样的空状态——插画、标题、四张卡片，外加输入框里躺着刚撤回的那句话。
 *
 * 量的是画出来的结果：`data-ly-chat-surface` 的取值、那一行在不在、草稿回没回到输入框。
 * 固件特意只造一轮对话：`revertMessage` 对最后一条用户消息不弹确认，而这一条同时也是第一条,
 * 撤回它会把整个转录清空——正是用户遇到的那一种。
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

const OUT = join(homedir(), "Desktop", "Lyra撤回空会话测试");
const ONLY_MESSAGE = "你可以看看 /Users/kittors/Documents/国网项目开发 这里面有啥吗？";
/** 计划里正在做的那一步，浮在转录右上角的那张卡片上写的就是它。 */
const PLAN_STEP = "看过那个目录里的三个子项目";
/** 侧边聊天里那句关于主会话的结论——主会话撤空之后，它说的事已经不存在了。 */
const SIDE_ANSWER = "目录已经看完了，三个子项目都在。";

let app: RunningApp;

async function settle(ms = 700) {
	await new Promise((r) => setTimeout(r, ms));
}

async function shot(name: string) {
	await mkdir(OUT, { recursive: true });
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
	return join(OUT, `${name}.png`);
}

/** 主列此刻画的是哪一面，以及那些不该留下的东西留下没有。 */
async function surfaceState() {
	return app.evaluate<{
		surface: string; hasEmptyMark: boolean; heading: string; cards: number;
		resumeRow: string; composerDraft: string; transcriptRows: number; composers: number;
		taskCard: string; taskCardAt: string; sidePanel: string;
	}>(`(()=>{
		const pane = document.querySelector('[data-ly-split-pane]') || document.body;
		const surfaceEl = pane.querySelector('[data-ly-chat-surface]');
		const heading = pane.querySelector('[data-ly-chat-surface="empty"] h1');
		// 「已暂停 · ▶」那一行：认它里面的继续按钮，别认样式。
		const resume = pane.querySelector('[data-resume-continue]');
		const row = resume ? resume.closest('div') : null;
		const textarea = pane.querySelector('main textarea') || document.querySelector('textarea');
		/*
		 * 那张计划卡片，和旁边那场对话：两样都不该比它们讲的那段历史活得更久。
		 *
		 * 不限 placement：摆出侧边面板之后主列不够 772px，卡片就从右上角挪到输入框上方去了
		 * （见 Conversation 里的 roomToFloat）。问「它在不在」的时候写死 floating，量到的空
		 * 只是它换了个地方。
		 */
		const plan = document.querySelector('[data-ly-task-list]');
		const side = document.querySelector('[data-dock-pane="chat"]');
		return {
			surface: surfaceEl ? surfaceEl.getAttribute('data-ly-chat-surface') : '(没有主列)',
			hasEmptyMark: !!pane.querySelector('[data-ly-chat-surface="empty"] img'),
			heading: heading ? heading.textContent.trim() : '',
			cards: pane.querySelectorAll('[data-ly-chat-surface="empty"] .grid button').length,
			resumeRow: row ? row.textContent.trim() : '',
			composerDraft: textarea ? textarea.value : '(没有输入框)',
			transcriptRows: pane.querySelectorAll('[data-ly-transcript-rows] > *').length,
			composers: pane.querySelectorAll('textarea').length,
			taskCard: plan ? plan.innerText.trim() : '',
			taskCardAt: plan ? plan.getAttribute('data-ly-task-list') : '(没画)',
			sidePanel: side ? side.innerText.trim() : '(面板没开)',
		};
	})()`);
}

/** 只留一轮对话，这样撤回第一条就是撤回最后一条：不弹确认，且清空整个转录。 */
async function seedOneTurn(home: string, modelPort: number) {
	await seedInteractions(home, modelPort);
	const cwd = join(home, "project");
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	/*
	 * 一份没做完的计划，因为「做完的会自己收起来」——`TaskList` 在 done === total 时返回 null。
	 * 固件要是给一份全打了勾的，那张卡片本来就不会画出来，这条探针就白量了。
	 */
	const todos = [
		{ content: PLAN_STEP, status: "in_progress", activeForm: PLAN_STEP },
		{ content: "跑一遍单测", status: "pending" },
		{ content: "打包", status: "pending" },
		{ content: "推送", status: "pending" },
	];
	const messages = [
		{ role: "user", content: [{ type: "text", text: ONLY_MESSAGE }], timestamp: 10 },
		// 有调用才有结果：`rebuildToolRuns` 是照着 assistant 上的 toolCall 建卡片的。
		{ role: "assistant", content: [{ type: "toolCall", id: "plan-1", name: "todo_write", arguments: { todos } }], api: "anthropic-messages", provider: "qa", model: "qa", usage, stopReason: "toolUse", timestamp: 10.4 },
		{ role: "toolResult", toolCallId: "plan-1", toolName: "todo_write", content: [{ type: "text", text: "Task list updated (0/4 done)" }], isError: false, details: { kind: "todo", todos }, timestamp: 10.6 },
		/*
		 * `aborted` 而不是 `stop`：这一半才是用户截图里的状态。
		 *
		 * `howItStopped` 从这里读出 `stopped === "user"`，`ResumeRow` 于是画出「已暂停 · ▶」。
		 * 固件要是用正常结束的回复，撤回之后那一行本来就不会在，这条探针就只验了空状态那一半，
		 * 而「已暂停」残留——用户红框圈出来的那个东西——根本没被测到。
		 */
		{ role: "assistant", content: [{ type: "text", text: "那个目录里有三个子项目。" }], api: "anthropic-messages", provider: "qa", model: "qa", usage, stopReason: "aborted", timestamp: 11 },
	];
	/*
	 * 旁边那场对话，讲的全是主会话里的事。
	 *
	 * 写成磁盘存档而不是在界面上现问一遍，正好压中容易漏的那条路：重开应用之后面板是照着这份
	 * 快照画出来的，主进程内存里一个 `SideChat` 实例都没有（`sideChatState` 读快照并不建实例）。
	 */
	await mkdir(join(home, "sidechats"), { recursive: true });
	await writeFile(join(home, "sidechats", "qa-short.json"), JSON.stringify({ messages: [
		{ role: "user", content: [{ type: "text", text: "预计要多久才可以完成呢？" }], timestamp: 20 },
		{ role: "assistant", content: [{ type: "text", text: SIDE_ANSWER }], api: "anthropic-messages", provider: "qa", model: "qa", usage, stopReason: "stop", timestamp: 21 },
	] }));
	const meta = { id: "qa-short", title: "查看国网项目开发目录", projectId, projectName: "交互验证", cwd, createdAt: 1, updatedAt: 2, modelId: "qa/model", messageCount: messages.length, usage, seq: messages.length + 1 };
	await writeFile(
		join(home, "sessions", projectId, "qa-short.jsonl"),
		[JSON.stringify({ type: "meta", meta, seq: 0, ts: 1 }),
			...messages.map((message, i) => JSON.stringify({ type: "message", message, seq: i + 1, ts: 1 })),
			JSON.stringify({ type: "meta", meta, seq: meta.seq, ts: 2 })].join("\n") + "\n",
	);
	const indexFile = join(home, "sessions", "index.json");
	const metas = JSON.parse(await readFile(indexFile, "utf8")) as { id: string }[];
	await writeFile(indexFile, JSON.stringify(metas.map((m) => (m.id === "qa-short" ? meta : m))));
}

async function main() {
	await rm(OUT, { recursive: true, force: true });
	const { createServer } = await import("node:http");
	const server = createServer((_req, res) => { res.writeHead(200, { "content-type": "text/event-stream" }); res.end(); });
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("no port");

	app = await startApp({ port: 9721, seed: (home) => seedOneTurn(home, address.port) });
	await app.evaluate("document.fonts.ready");
	await settle(1200);

	// 打开那个会话。
	await app.evaluate(`(()=>{const b=document.querySelector('[data-ly-row="qa-short"] > button'); if(b) b.click(); return !!b;})()`);
	await settle(1200);
	// 再把旁边那场对话摆出来——它讲的全是这个会话里的事。
	const panelMenu = await app.evaluate<boolean>(`(()=>{const b=document.querySelector('button[aria-label="面板"]'); if(!b) return false; b.click(); return true;})()`);
	await settle(600);
	const sideOpened = await app.evaluate<boolean>(`(()=>{const it=[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.includes('侧边聊天')); if(!it) return false; it.click(); return true;})()`);
	await settle(1400);
	const before = await surfaceState();
	const beforeShot = await shot("1-撤回前");

	// 撤回唯一一条用户消息。
	const clicked = await app.evaluate<boolean>(`(()=>{const b=document.querySelector('[data-message-undo]'); if(!b) return false; b.click(); return true;})()`);
	await settle(1800);
	const after = await surfaceState();
	const afterShot = await shot("2-撤回后");

	/*
	 * 再说一句话，看那张计划卡片会不会自己回来。
	 *
	 * 这一步是这条探针里唯一能验到计划的地方：撤空之后主列整个换成了空状态，那张卡片本来就不
	 * 画——它是被顶掉的，不是被清掉的。留着的那份计划要等主列回到转录那一面才会重新露头，而
	 * 撤回把刚才那句话放回了输入框，直接发出去就是最短的一条路。
	 */
	await app.evaluate(`(()=>{const t=document.querySelector('main textarea'); if(t) t.focus(); return !!t;})()`);
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
	await settle(2600);
	const resent = await surfaceState();
	const resentShot = await shot("3-重新说一句之后");

	await app.stop();
	await closeListeningServer(server);

	console.log("=== 撤回前 ===");
	console.log(JSON.stringify(before, null, 2));
	console.log("截图:", beforeShot);
	console.log("\n=== 撤回后 ===");
	console.log(JSON.stringify(after, null, 2));
	console.log("截图:", afterShot);
	console.log("\n=== 重新说一句之后 ===");
	console.log(JSON.stringify(resent, null, 2));
	console.log("截图:", resentShot);

	const checks: [string, boolean][] = [
		["撤回前画的是转录", before.surface === "conversation"],
		["撤回前确实有「已暂停」那一行", before.resumeRow.includes("已暂停")],
		["面板菜单打开了", panelMenu],
		["侧边聊天摆出来了", sideOpened],
		["撤回前那张计划卡片在", before.taskCard.includes(PLAN_STEP)],
		["撤回前转录里确实有内容", before.transcriptRows > 0],
		["撤回前侧边聊天里有那句旧结论", before.sidePanel.includes(SIDE_ANSWER)],
		["撤回按钮点到了", clicked],
		["撤回后画的是空状态", after.surface === "empty"],
		["空状态的插画在", after.hasEmptyMark],
		["空状态的标题在", after.heading.length > 0],
		["四张卡片都在", after.cards === 4],
		["「已暂停」那一行没了", after.resumeRow === ""],
		["撤回的话回到了输入框", after.composerDraft.includes("国网项目开发")],
		["只有一个输入框", after.composers === 1],
		["撤回后侧边聊天里那句旧结论没了", !after.sidePanel.includes(SIDE_ANSWER)],
		["侧边面板还开着，只是空了", after.sidePanel !== "(面板没开)"],
		["重新说一句之后回到转录", resent.surface === "conversation"],
		["那张计划卡片没有跟着回来", !resent.taskCard.includes(PLAN_STEP)],
		["侧边聊天也没有自己回来", !resent.sidePanel.includes(SIDE_ANSWER)],
	];
	console.log("\n=== 判定 ===");
	let bad = 0;
	for (const [name, ok] of checks) { if (!ok) bad++; console.log(`${ok ? "✔" : "✘"} ${name}`); }
	console.log(bad === 0 ? "\n全部成立" : `\n${bad} 条不成立`);
}

await main();
