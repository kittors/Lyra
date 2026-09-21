/* oxlint-disable no-console -- 探针把量到的东西打出来，那就是它的产物 */
/**
 * 真窗口里的审批卡片：读取的两种理由，加上命令审批那张共用卡片的对照。
 *
 * 量的是**画出来的结果**：卡片在不在、标签是不是翻译过的「读取文件」而不是裸的 `read`、
 * 长路径有没有把卡片撑破、那句「批准将允许读取：X」排得下排不下。类型检查和 i18n 门禁
 * 只能保证 key 存在，保证不了这些。
 *
 * 外部目录建在 home 下而不是临时目录：`assessRead` 放行 `/tmp` 和 `os.tmpdir()`（和沙箱的
 * `writableRoots` 同一口径），而 e2e 的 profile 正好就在临时目录里——放那儿等于什么都不会问。
 * 密钥那一份是**假的**，路径形状命中 `SECRET_PATH` 就够了，真私钥不参与任何测试。
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

const EXTERNAL = join(homedir(), ".lyra-e2e-external-project-with-a-fairly-long-name");
const EXTERNAL_FILE = join(EXTERNAL, "src", "deeply", "nested", "configuration-loader.ts");
const FAKE_KEY = join(EXTERNAL, ".ssh", "id_ed25519");
const REPO = join(homedir(), ".lyra-e2e-external-repo");
const REPO_FILE = join(REPO, "packages", "server", "src", "handler.ts");
const OUT = join(homedir(), "Desktop", "Lyra读取边界测试");

let app: RunningApp;

/** 第一轮发工具调用，拿到工具结果就收尾。拟标题那一轮也会进来，靠触发词区分。 */
function model(tool: string, input: Record<string, unknown>) {
	return createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => { raw += chunk; });
		req.on("end", () => {
			const body = JSON.parse(raw) as { messages: unknown[] };
			const content = JSON.stringify(body.messages);
			const wantsTool = content.includes("READ_OUTSIDE") && !content.includes("tool_result") && !content.includes("标题");
			res.writeHead(200, { "content-type": "text/event-stream" });
			const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
			emit("message_start", { message: { id: "probe", role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } } });
			if (wantsTool) {
				emit("content_block_start", { index: 0, content_block: { type: "tool_use", id: `call-${tool}`, name: tool, input: {} } });
				emit("content_block_delta", { index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } });
			} else {
				emit("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
				emit("content_block_delta", { index: 0, delta: { type: "text_delta", text: "好的。" } });
			}
			emit("content_block_stop", { index: 0 });
			emit("message_delta", { delta: { stop_reason: wantsTool ? "tool_use" : "end_turn" }, usage: { output_tokens: 5 } });
			emit("message_stop", {});
			res.end();
		});
	});
}

async function settle(ms = 900) {
	await new Promise((r) => setTimeout(r, ms));
}

async function shot(name: string) {
	await mkdir(OUT, { recursive: true });
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
	return join(OUT, `${name}.png`);
}

/** 卡片实际画成什么样，从 DOM 上读，不看我们自己传进去的值。 */
async function cardState() {
	return app.evaluate<{
		visible: boolean; title: string; kindLabel: string; detail: string; reasonLine: string;
		titleLines: number; cardWidth: number; cardRight: number; viewportWidth: number; overflowX: number;
		buttons: string[]; buttonTexts: string[]; buttonBox: { w: number; h: number }[];
	}>(`(()=>{
		const empty = { visible:false, title:'', kindLabel:'', detail:'', reasonLine:'', titleLines:0, cardWidth:0, cardRight:0, viewportWidth:innerWidth, overflowX:0, buttons:[], buttonTexts:[], buttonBox:[] };
		const card = document.querySelector('[data-approval-card]');
		if (!card) return empty;
		const head = card.firstElementChild;
		const spans = head ? [...head.querySelectorAll('span')] : [];
		const pre = card.querySelector('pre');
		const p = card.querySelector('p');
		const box = card.getBoundingClientRect();
		const widest = Math.max(0, ...[...card.querySelectorAll('*')].map(el => el.scrollWidth - el.clientWidth));
		const titleEl = spans[0];
		const lineHeight = titleEl ? parseFloat(getComputedStyle(titleEl).lineHeight) : 0;
		return {
			visible: box.width > 0 && box.height > 0,
			title: titleEl ? titleEl.textContent.trim() : '',
			kindLabel: spans[1] ? spans[1].textContent.trim() : '',
			detail: pre ? pre.textContent.trim() : '',
			reasonLine: p ? p.textContent.trim() : '',
			titleLines: titleEl && lineHeight ? Math.round(titleEl.getBoundingClientRect().height / lineHeight) : 0,
			cardWidth: Math.round(box.width),
			cardRight: Math.round(box.right),
			viewportWidth: innerWidth,
			overflowX: widest,
			buttons: [...card.querySelectorAll('button')].map(b => (b.getAttribute('aria-label') || b.textContent || '').trim()).filter(Boolean),
			// 决策按钮自己画出来的字，和它们的实际尺寸——纯图标按钮这里会是空串。
			buttonTexts: [...card.querySelectorAll('[aria-busy] button')].map(b => (b.textContent || '').trim()),
			buttonBox: [...card.querySelectorAll('[aria-busy] button')].map(b => { const r = b.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; }),
		};
	})()`);
}

async function run(label: string, port: number, tool: string, input: Record<string, unknown>) {
	const server = model(tool, input);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	if (!address || typeof address === "string") throw new Error("no port");

	app = await startApp({
		port,
		seed: async (home) => {
			await seedInteractions(home, address.port);
			const file = join(home, "settings.json");
			const settings = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
			// `full` 不问任何东西；这里要看的正是被问的那一刻。
			await writeFile(file, JSON.stringify({ ...settings, permissionMode: "auto", thinking: "off", projectMemory: false, appearance: { theme: "dark", reduceMotion: "on" } }));
		},
	});
	await app.evaluate("document.fonts.ready");
	await settle(1200);

	// 打开一个会话，发一句带触发词的话。
	await app.evaluate(`(()=>{const b=document.querySelector('[data-ly-row="qa-short"] > button'); if(b) b.click(); return true;})()`);
	await settle(800);
	await app.evaluate(`(()=>{const t=document.querySelector('main textarea'); if(!t) return false;
		const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
		set.call(t,'READ_OUTSIDE 请读一下那个文件'); t.dispatchEvent(new Event('input',{bubbles:true})); return true;})()`);
	await settle(400);
	await app.evaluate(`(()=>{const t=document.querySelector('main textarea'); if(!t) return false;
		t.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); return true;})()`);

	// 等审批卡片被画出来。
	let state = await cardState();
	for (let i = 0; i < 40 && !state.visible; i++) { await settle(500); state = await cardState(); }

	const png = await shot(label);
	await app.stop();
	await closeListeningServer(server);
	return { state, png };
}

async function main() {
	await rm(EXTERNAL, { recursive: true, force: true });
	await rm(REPO, { recursive: true, force: true });
	await mkdir(join(EXTERNAL, "src", "deeply", "nested"), { recursive: true });
	await mkdir(join(EXTERNAL, ".ssh"), { recursive: true });
	await writeFile(EXTERNAL_FILE, "export const config = { port: 5173 };\n");
	await writeFile(FAKE_KEY, "NOT-A-REAL-KEY-fixture-only\n");

	/*
	 * 同样深的文件，只是这个目录是个仓库。
	 *
	 * 真实的「另一个项目」几乎都是，而授权范围正是靠 `.git` 往上走出来的——没有它就只能停在
	 * 父目录，用户批准了 `src/deeply/nested` 之后读同项目别处还要再问一次。两个场景并排放，
	 * 是为了让这个差别是量出来的，不是我说的。
	 */
	await mkdir(join(REPO, ".git"), { recursive: true });
	await mkdir(join(REPO, "packages", "server", "src"), { recursive: true });
	await writeFile(REPO_FILE, "export const handler = () => 200;\n");

	try {
		const outside = await run("1-跨项目读取", 9711, "read", { path: EXTERNAL_FILE });
		console.log("\n=== 场景一：读另一个项目 ===");
		console.log(JSON.stringify(outside.state, null, 2));
		console.log("截图:", outside.png);

		const key = await run("2-密钥读取", 9712, "read", { path: FAKE_KEY });
		console.log("\n=== 场景二：读密钥（假固件）===");
		console.log(JSON.stringify(key.state, null, 2));
		console.log("截图:", key.png);

		const repo = await run("3-读另一个仓库", 9713, "read", { path: REPO_FILE });
		console.log("\n=== 场景三：读另一个 git 仓库的深层文件 ===");
		console.log(JSON.stringify(repo.state, null, 2));
		console.log("截图:", repo.png);

		/*
		 * 命令审批走的是同一张卡片。
		 *
		 * `PermissionChoices` 是所有审批类型共用的，按钮改带字就动到了 bash/write/edit/network
		 * 每一种。这一条不是为读取边界测的，是为「别把别人的卡片改坏」测的。
		 * 删一个不存在的临时路径：工作区之外所以会问，而就算真跑了也什么都删不掉。
		 */
		const command = await run("4-命令审批对照", 9714, "bash", { command: `rm -rf ${join(homedir(), ".lyra-e2e-nonexistent-xyz")}`, description: "清理临时目录" });
		console.log("\n=== 场景四：命令审批（共用卡片的对照）===");
		console.log(JSON.stringify(command.state, null, 2));
		console.log("截图:", command.png);

		const checks: [string, boolean][] = [
			["仓库的授权范围走到了仓库根", repo.state.reasonLine.includes(REPO)],
			["场景三卡片没有横向溢出", repo.state.overflowX === 0],
			["标题只给文件名，不铺整条路径", repo.state.title.endsWith("handler.ts") && !repo.state.title.includes("/packages/")],
			["理由行不是标题的复述", repo.state.reasonLine !== "" && !repo.state.title.includes(repo.state.reasonLine)],
			["等宽区只有路径，没有中文说明", repo.state.detail === REPO_FILE],
			["标题没有折行", repo.state.titleLines === 1],
			["三个按钮都带文字", repo.state.buttons.join("|").includes("拒绝") && repo.state.buttons.join("|").includes("以后不再问") && repo.state.buttons.join("|").includes("允许一次")],
			["按钮不是纯图标（有可见文字）", repo.state.buttonTexts.every((t) => t.length > 0)],
			["场景一弹出了审批卡片", outside.state.visible],
			["理由是「项目之外」", outside.state.title.includes("项目之外")],
			["标签翻译成了「读取文件」", outside.state.kindLabel === "读取文件"],
			["写明了批准之后会怎样", outside.state.reasonLine.includes("不再询问")],
			["卡片没有横向溢出", outside.state.overflowX === 0],
			["卡片没有超出视口", outside.state.cardRight <= outside.state.viewportWidth],
			["场景二弹出了审批卡片", key.state.visible],
			["理由是「密钥」", key.state.title.includes("密钥")],
			["密钥的说明是「按文件批准」而不是给目录", key.state.reasonLine.includes("按文件") && !key.state.reasonLine.includes("里的文件")],
			["场景二卡片没有横向溢出", key.state.overflowX === 0],
			["命令审批的卡片还在", command.state.visible],
			["命令审批的标签是「执行命令」", command.state.kindLabel === "执行命令"],
			["命令审批的按钮也带文字", command.state.buttonTexts.length === 3 && command.state.buttonTexts.every((t) => t.length > 0)],
			["命令审批显示的是命令本身", command.state.detail.includes("rm -rf")],
			["命令审批卡片没有横向溢出", command.state.overflowX === 0],
		];
		console.log("\n=== 判定 ===");
		let bad = 0;
		for (const [name, ok] of checks) { if (!ok) bad++; console.log(`${ok ? "✔" : "✘"} ${name}`); }
		console.log(bad === 0 ? "\n全部成立" : `\n${bad} 条不成立`);
	} finally {
		await rm(EXTERNAL, { recursive: true, force: true });
		await rm(REPO, { recursive: true, force: true });
	}
}

await main();
