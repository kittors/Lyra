/* oxlint-disable no-console -- 探针的输出就是它的全部产物 */
/**
 * 悬停预览该在什么时候让开——量的是画出来的那一份。
 *
 * 报的那个 bug：预览开在文件行下方之后，把鼠标抬到卡片头上的「已编辑 N 个文件」那一排，预览
 * 还挂在那儿。指针早就不在任何文件行上了，屏幕上却是一块不对应任何东西的面板，而它正压着
 * 「报告」「撤销」「审核」。原因是关闭只问了一句「出卡片了没有」——而卡片头就在卡片里。
 *
 * 所以这里问的不是「有没有这个元素」，那会把「关掉又立刻重开」读成「一直好好的」。每一步都
 * 连着读四样：可见性、位置、内容，和指针此刻实际压着谁——最后这样是用来排除「其实鼠标根本
 * 没落在我以为的地方」的。要消失的那几步还要按 100ms 连采一串，看清它是关了，还是关了又回来。
 *
 * 反面同样要量：行与行之间、行与浮层之间的跨越不算离开。那几条是这次改动的风险面，红在这里
 * 比红在用户手里便宜。
 */

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

const ARTIFACTS = join(homedir(), "Desktop", "交付卡片悬停测试");
const PREVIEW = '[aria-label="文件变更预览"]';

interface Shot {
	/** 画出来了没有——不是「在 DOM 里没有」。 */
	shown: boolean;
	box: string | null;
	text: string | null;
	/** 指针此刻压着的最深那个元素，以及它属于谁。 */
	under: string | null;
	inCard: boolean;
	onRow: boolean;
	onPopover: boolean;
}

let app: RunningApp | undefined;
let server: Server | undefined;
let turns = 0;
const failures: string[] = [];

/** 够长（出竖向滚动条）的一份改动，预览才真的是一块面板。 */
function written(index: number): string {
	const lines = [`export const value${index} = ${index};`];
	for (let i = 0; i < 40; i++) lines.push(`export const field_${index}_${i} = ${JSON.stringify("内容行")};`);
	return lines.join("\n") + "\n";
}

async function evaluate<T>(expression: string): Promise<T> {
	if (!app) throw new Error("app 还没起来");
	return app.evaluate<T>(expression);
}

async function until(expression: string, note = "") {
	await evaluate(
		`new Promise((resolve,reject)=>{const end=performance.now()+20000;function tick(){if(${expression})resolve();else if(performance.now()<end)requestAnimationFrame(tick);else reject(Error(${JSON.stringify(note || expression)}))}tick()})`,
	);
}

async function frames(n = 20) {
	await evaluate(`new Promise(r=>{let n=${n};function tick(){if(--n)requestAnimationFrame(tick);else r()}requestAnimationFrame(tick)})`);
}

function wait(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function move(x: number, y: number) {
	if (!app) throw new Error("app 还没起来");
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
}

async function click(selector: string) {
	if (!app) throw new Error("app 还没起来");
	await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`, `等不到 ${selector}`);
	await evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`);
	await frames();
	const point = await evaluate<{ x: number; y: number }>(
		`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
	);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"])
		await app.send("Input.dispatchMouseEvent", { type, ...point, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
}

async function send(text: string) {
	if (!app) throw new Error("app 还没起来");
	await click('[data-dock-pane="conversation"] textarea');
	await app.send("Input.insertText", { text });
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
}

async function shoot(name: string) {
	if (!app) throw new Error("app 还没起来");
	await mkdir(ARTIFACTS, { recursive: true });
	const shot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(ARTIFACTS, name + ".png"), Buffer.from(shot.data, "base64"));
}

/**
 * 可见性、位置、内容、指针压着谁——一次读齐，任何一样单独看都会骗人。
 *
 * 「压着谁」按坐标问 `elementFromPoint`，不问 `:hover`。第一版读的是
 * `querySelectorAll(':hover')` 的最后一项——那是**文档顺序**的最后一项，不是最深的那个，于是
 * 停在卡片头上的那一步报回来「压着一个文件行」，而同一时刻 `elementFromPoint` 说压着的是标题。
 * 两个读数只能有一个是真的，而分辨不出哪个真，这一步就等于没验：指针要是真落在了另一个文件行
 * 上，预览关掉恰恰是新写的判定出了错。指针不动，所以目标坐标就是指针位置，按点问最直接。
 */
async function shot(at?: { x: number; y: number }): Promise<Shot> {
	const deep = at
		? `document.elementFromPoint(${at.x},${at.y})`
		: `(()=>{const c=[...document.querySelectorAll(':hover')];let d=null;for(const e of c)if(!d||d.contains(e))d=e;return d})()`;
	return evaluate<Shot>(
		`(()=>{const e=document.querySelector(${JSON.stringify(PREVIEW)});
		const deep=${deep};
		const r=e?e.getBoundingClientRect():null;
		return {shown:Boolean(e&&e.checkVisibility()),
			box:r?Math.round(r.x)+','+Math.round(r.y)+' '+Math.round(r.width)+'x'+Math.round(r.height):null,
			text:e?(e.textContent||'').trim().replace(/\\s+/g,' ').slice(0,26):null,
			under:deep?deep.tagName.toLowerCase()+(deep.className?'.'+String(deep.className).split(' ').slice(0,2).join('.'):''):null,
			inCard:Boolean(deep&&deep.closest('[data-turn-delivery]')),
			onRow:Boolean(deep&&deep.closest('[data-delivery-file]')),
			onPopover:Boolean(deep&&deep.closest('[data-ly-popover]'))}})()`,
	);
}

/** 连采一串，把「关掉又重开」和「一直没关」分开。 */
async function watch(ms: number, at?: { x: number; y: number }, step = 100): Promise<Shot[]> {
	const shots: Shot[] = [];
	for (let spent = 0; spent < ms; spent += step) {
		await wait(step);
		shots.push(await shot(at));
	}
	return shots;
}

function trail(shots: Shot[]): string {
	return shots.map((s) => (s.shown ? "有" : "无")).join("");
}

function check(ok: boolean, note: string) {
	console.log((ok ? "  ✓ " : "  ✗ ") + note);
	if (!ok) failures.push(note);
}

/**
 * 视口高度，用 CDP 覆盖掉。
 *
 * 预览开在行的上方还是下方，是 `Popover` 按两侧余量自己决定的——而交付卡片钉在会话最底部
 * （`latestDeliveryTimestamp` 只认最后一条消息，往后再发一轮这张卡片就归那一轮、内容为空），
 * 所以它上方永远是一整屏、下方只有 composer 那一条。默认量出来必然是「开在上方」，而开在上方
 * 的预览整个盖住卡片头，「把鼠标移到卡片头上」就成了「把鼠标移到预览上」。
 *
 * 报 bug 的那张截图是另一半：那张卡片只有两个文件、贴在可视区上部，停的是第一个文件行——它
 * 下方的余量反超了上方，预览于是开在行下面，卡片头露在外头。
 *
 * 复现它要把视口调**矮**，不是调高。滚到底时卡片底下那截留白（composer 那一条）是定数，所以
 * 卡片头的位置随视口一起降，而行下方的余量不变：视口 800 时第一行上方 397、下方 343，开上方；
 * 视口 620 时上方 197、下方 343，开下方。撑高只会把上方余量喂得更饱——第一版探针就是这么
 * 撑到 1040 还是开在上方的。改的是视口尺寸，不是被测的那段逻辑。
 */
async function resize(width: number, height: number) {
	if (!app) throw new Error("app 还没起来");
	await app.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 0, mobile: false });
	await frames();
}

/**
 * 还原成进来时的尺寸，用 `setDeviceMetricsOverride` 显式设回去。
 *
 * `clearDeviceMetricsOverride` 发出去没报错，而后面量到的位置一个像素都没动——预览还开在
 * 矮视口那一侧。改成把原尺寸再设一遍，并且回读 `innerHeight` 确认，不信那条命令的回执。
 */
async function unresize(width: number, height: number) {
	await resize(width, height);
	const now = await viewport();
	console.log("视口还原到 " + JSON.stringify(now) + (now.height === height ? "" : "（没设回去！）"));
}

async function viewport(): Promise<{ width: number; height: number }> {
	return evaluate<{ width: number; height: number }>(`({width:innerWidth,height:innerHeight})`);
}

/** 预览此刻开在这一行的上方还是下方。 */
async function side(index: number): Promise<"上方" | "下方" | "没开"> {
	return evaluate<"上方" | "下方" | "没开">(
		`(()=>{const e=document.querySelector(${JSON.stringify(PREVIEW)});if(!e)return '没开';
		const p=e.getBoundingClientRect(),r=document.querySelectorAll('[data-turn-delivery] [data-delivery-file]')[${index}].getBoundingClientRect();
		return p.top>=r.bottom?'下方':'上方'})()`,
	);
}

/** 卡片里这个点现在归谁——移上去之前先问，免得测的是另一件事。 */
async function owner(selector: string): Promise<{ x: number; y: number; hit: string } | null> {
	return evaluate<{ x: number; y: number; hit: string } | null>(
		`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();
		const x=Math.round(r.x+Math.min(50,r.width/2)),y=Math.round(r.y+r.height/2);const u=document.elementFromPoint(x,y);
		return {x,y,hit:u?(u.closest('[data-ly-popover]')?'浮层':(e.contains(u)?'目标':(u.closest('[data-turn-delivery]')?'卡片里别处':'卡片外'))):'null'}})()`,
	);
}

/** 停在一个文件行上把预览叫出来，返回这一行的坐标。 */
async function openOn(index: number): Promise<{ x: number; y: number; top: number; bottom: number }> {
	const row = await evaluate<{ x: number; y: number; top: number; bottom: number }>(
		`(()=>{const rows=[...document.querySelectorAll('[data-turn-delivery] [data-delivery-file]:not([inert] *)')];const e=rows[${index}]||rows[rows.length-1];const r=e.getBoundingClientRect();return {x:Math.round(r.x+50),y:Math.round(r.y+r.height/2),top:Math.round(r.top),bottom:Math.round(r.bottom)}})()`,
	);
	await move(row.x, row.y);
	await until(`document.querySelector(${JSON.stringify(PREVIEW)})?.textContent.includes('export const')`, "等不到悬停预览");
	await frames();
	// 打印它到底是哪一行：交付记录的文件顺序不一定是写入顺序，而下面几条都以「这一行」为出发点。
	console.log(
		"  悬停在 " + (await evaluate<string>(`(()=>{const e=document.elementFromPoint(${row.x},${row.y});const b=e&&e.closest('[data-delivery-file]');return b?b.getAttribute('data-delivery-file').split(/[\\\\/]/).pop():'（不是文件行！）'})()`)),
	);
	return row;
}

/** 把预览彻底收掉，再开下一场——上一场留下的浮层正好压在下一场要去的地方。 */
async function reset() {
	await move(15, 75);
	await until(`!document.querySelector(${JSON.stringify(PREVIEW)})`, "预览关不掉");
}

async function main() {
	server = createServer((request, response) => {
		request.resume();
		request.on("end", () => {
			const index = turns++;
			const tool = index < 5 ? { name: "write", input: { path: `delivery-${index}.ts`, content: written(index) } } : null;
			response.writeHead(200, { "content-type": "text/event-stream" });
			const emit = (type: string, data: object) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
			emit("message_start", { message: { id: `probe-${index}`, role: "assistant", content: [], usage: { input_tokens: 100, output_tokens: 0 } } });
			emit("content_block_start", { index: 0, content_block: tool ? { type: "tool_use", id: `write-${index}`, name: tool.name, input: {} } : { type: "text", text: "" } });
			emit("content_block_delta", { index: 0, delta: tool ? { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } : { type: "text_delta", text: "五个文件都写好了。" } });
			emit("content_block_stop", { index: 0 });
			emit("message_delta", { delta: { stop_reason: tool ? "tool_use" : "end_turn" }, usage: { output_tokens: 20 } });
			emit("message_stop", {});
			response.end();
		});
	});
	await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
	const address = server.address();
	assert.ok(address && typeof address !== "string");
	const port = address.port;

	app = await startApp({
		port: 9697,
		seed: async (home) => {
			await seedInteractions(home, port);
			const path = join(home, "settings.json");
			const settings = JSON.parse(await readFile(path, "utf8"));
			await writeFile(path, JSON.stringify({ ...settings, permissionMode: "full", projectMemory: false, thinking: "off" }));
		},
	});

	await click('[data-ly-row="qa-short"]');
	await send("改五个文件，用来看交付卡片的悬停预览");
	await until(`document.querySelector('[data-turn-delivery]')?.textContent.includes('已编辑 5 个文件')`, "等不到交付卡片");
	await frames();
	const layout = await evaluate<{ card: string; rows: number; header: string }>(
		`(()=>{const card=document.querySelector('[data-turn-delivery]').getBoundingClientRect();
		const head=document.querySelector('[data-turn-delivery] .min-h-16').getBoundingClientRect();
		return {card:Math.round(card.x)+','+Math.round(card.y)+' '+Math.round(card.width)+'x'+Math.round(card.height),
			rows:document.querySelectorAll('[data-turn-delivery] [data-delivery-file]:not([inert] *)').length,
			header:Math.round(head.x)+','+Math.round(head.y)+' '+Math.round(head.width)+'x'+Math.round(head.height)}})()`,
	);
	console.log("版面：" + JSON.stringify(layout));

	/*
	 * 第一场：预览开在文件行下方，卡片头露在外面——报 bug 的那张截图。
	 *
	 * 两手一起：先把折叠的两行展开——卡片越高，滚到底时它的头就越靠上，第一行上方的余量就越小；
	 * 再把视口逐档调矮，直到量到预览真的翻到了行下面。哪一档管用是算不出来的（卡片底下那截留白
	 * 不是个定数），所以试着量，量到为止。
	 */
	const full = await viewport();
	console.log("\n视口：" + JSON.stringify(full));
	await click("[data-turn-delivery] button[aria-expanded]");
	await until(`document.querySelectorAll('[data-turn-delivery] [data-delivery-file]:not([inert] *)').length>=5`, "展不开那两行");
	await reset();

	let where: "上方" | "下方" | "没开" = "没开";
	let short = full;
	let hovered = { x: 0, y: 0, top: 0, bottom: 0 };
	for (const height of [620, 560, 500, 460]) {
		await resize(full.width, height);
		short = await viewport();
		await evaluate(`document.querySelector('[data-turn-delivery]').scrollIntoView({block:'end',behavior:'instant'})`);
		await frames();
		hovered = await openOn(0);
		where = await side(0);
		console.log("视口 " + JSON.stringify(short) + " → 预览开在第一行的" + where);
		if (where === "下方") break;
		await reset();
	}
	const opened = await shot(hovered);
	console.log("停在第一个文件行上：" + JSON.stringify(opened));
	console.log(where === "下方" ? "→ 和报 bug 的截图一致：卡片头露在预览外面" : "→ 没能把它翻到下面，一、二两条会跳过");
	assert.ok(opened.shown, "预览都没开起来，后面几条无从谈起");
	await shoot("1-预览开在行下方");

	/*
	 * 一、抬到卡片头上的标题——报的就是这一下。
	 */
	console.log("\n=== 一、从文件行抬到卡片头上的「已编辑 N 个文件」 ===");
	const title = await owner("[data-turn-delivery] .min-h-16 p");
	console.log("目标点：" + JSON.stringify(title));
	if (title?.hit !== "目标") console.log("  （这个点归" + title?.hit + "，不是卡片头，跳过——见上面 `resize` 那段）");
	else {
		await move(title.x, title.y);
		const onTitle = await watch(700, title);
		console.log("700ms 内每 100ms 一采：" + trail(onTitle) + "  末帧 " + JSON.stringify(onTitle.at(-1)));
		check(!onTitle.at(-1)?.shown, "抬到卡片头上，预览要消失");
		check(onTitle.at(-1)?.inCard === true, "而鼠标确实还压在卡片里（否则这条测的是「移出了卡片」）");
		await shoot("2-抬到卡片头之后");
	}

	/*
	 * 二、抬到那一排按钮上——预览要是开在它们身上，不让开就点不着。
	 */
	console.log("\n=== 二、从文件行抬到「审核」按钮上 ===");
	await reset();
	await openOn(0);
	const button = await owner('[data-turn-delivery] button[data-ly-tip="审核全部文件改动"]');
	console.log("目标点：" + JSON.stringify(button));
	if (button?.hit !== "目标") console.log("  （这颗按钮归" + button?.hit + "，跳过）");
	else {
		await move(button.x, button.y);
		const onButton = await watch(700, button);
		console.log("采样：" + trail(onButton) + "  末帧 " + JSON.stringify(onButton.at(-1)));
		check(!onButton.at(-1)?.shown, "抬到「审核」上，预览要消失");
		const reachable = await evaluate<string>(
			`(()=>{const b=document.querySelector('[data-turn-delivery] button[data-ly-tip="审核全部文件改动"]');const r=b.getBoundingClientRect();
			const u=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return b.contains(u)?'可点':'被盖住：'+(u?(u.closest('[aria-label]')?.getAttribute('aria-label')||u.className):'null')})()`,
		);
		check(reachable === "可点", "「审核」这一刻要真的点得着，实际：" + reachable);
	}

	/*
	 * 第二场：还原视口，预览回到行的上方——日常最常见的那一半，卡片下缘露在外面。
	 */
	await reset();
	await unresize(full.width, full.height);
	/*
	 * 顺手收回折叠状态，摆成 `delivery-card` 那条 e2e 用例里的形状：三行 + 一行「再显示 2 个
	 * 文件」，停的是最后一个可见行。新加进那条用例的断言就是在这个形状下跑的，所以这里照着摆一遍
	 * ——那条用例这一轮在更早的一步（点「实现说明」开文件面板）就挂了，断言根本没轮到执行。
	 */
	await click('[data-turn-delivery] button[aria-expanded="true"]');
	await until(`document.querySelectorAll('[data-turn-delivery] [data-delivery-file]:not([inert] *)').length===3`, "收不回去");
	await reset();
	await evaluate(`document.querySelector('[data-turn-delivery]').scrollIntoView({block:'end',behavior:'instant'})`);
	await frames();
	await openOn(2);
	console.log("还原视口、收起之后，预览开在最后一个可见行的" + (await side(2)));

	/*
	 * 三、移到「再显示 2 个文件」那一行——它也在卡片里，也不是文件行。
	 */
	console.log("\n=== 三、移到「再显示 2 个文件」上 ===");
	const more = await owner("[data-turn-delivery] button[aria-expanded]");
	console.log("目标点：" + JSON.stringify(more));
	if (!more) console.log("  （这张卡片没有展开行，跳过）");
	else if (more.hit !== "目标") console.log("  （这一行归" + more.hit + "，移上去等于移进预览，跳过）");
	else {
		await move(more.x, more.y);
		const onMore = await watch(700, more);
		console.log("采样：" + trail(onMore) + "  末帧 " + JSON.stringify(onMore.at(-1)));
		check(!onMore.at(-1)?.shown, "移到「再显示 2 个文件」上，预览要消失");
		// 和搬进 e2e 的那句断言逐字一致：关掉的理由必须是「不在任何行上」，不是「出了卡片」。
		check(
			(await evaluate<boolean>(
				`(()=>{const u=document.elementFromPoint(${more.x},${more.y});return Boolean(u&&u.closest('[data-turn-delivery]')&&!u.closest('[data-delivery-file]'))})()`,
			)) === true,
			"关掉的这一刻鼠标要还在卡片里、且不在任何文件行上",
		);
	}

	/*
	 * 四、反面：行与行之间不算离开。这是这次改动最可能弄坏的东西。
	 *
	 * 往下一行走，而不是往上：预览紧贴着行的上方 8px 开，上一行必然压在它底下——「往上抬一点」
	 * 落进的是预览自己，既有的 `delivery-card` e2e 已经在量那一下了。往下这一行是露着的。
	 */
	console.log("\n=== 四、从一个文件行移到下一个文件行（不该关，也不该跳）===");
	await reset();
	const first = await openOn(0);
	const settled = await shot(first);
	const sibling = await evaluate<{ x: number; y: number; hit: string }>(
		`(()=>{const e=document.querySelectorAll('[data-turn-delivery] [data-delivery-file]')[1];const r=e.getBoundingClientRect();const x=Math.round(r.x+50),y=Math.round(r.y+r.height/2);
		const u=document.elementFromPoint(x,y);return {x,y,hit:u?(e.contains(u)?'行':(u.closest('[data-ly-popover]')?'浮层':'别处')):'null'}})()`,
	);
	console.log("目标点：" + JSON.stringify(sibling) + "（出发行 y=" + first.y + "）");
	if (sibling.hit !== "行") console.log("  （下一行被预览盖住了，跳过）");
	else {
		await move(sibling.x, sibling.y);
		const onSibling = await watch(600, sibling);
		console.log("采样：" + trail(onSibling) + "  末帧 " + JSON.stringify(onSibling.at(-1)));
		check(onSibling.every((s) => s.shown), "移到相邻文件行，预览不许关——一次闪烁都不许");
		check(onSibling.at(-1)?.box === settled.box, "也不许跳位置：" + settled.box + " → " + onSibling.at(-1)?.box);
	}

	/*
	 * 五、反面：进预览自己更不算离开——要在里头滚 diff、按那颗撤销。
	 */
	console.log("\n=== 五、从文件行移进预览里（不该关）===");
	await reset();
	await openOn(0);
	const inside = await evaluate<{ x: number; y: number }>(
		`(()=>{const r=document.querySelector(${JSON.stringify(PREVIEW)}).getBoundingClientRect();return {x:Math.round(r.x+40),y:Math.round(r.y+Math.min(60,r.height/2))}})()`,
	);
	await move(inside.x, inside.y);
	const onInside = await watch(600, inside);
	console.log("采样：" + trail(onInside) + "  末帧 " + JSON.stringify(onInside.at(-1)));
	check(onInside.every((s) => s.shown), "移进预览里，预览不许关");
	check(onInside.at(-1)?.onPopover === true, "而鼠标确实压在预览上");

	console.log("\n=== 六、停在预览的滚动条滑块上（不该关）===");
	const thumb = await evaluate<{ x: number; y: number } | null>(
		`(()=>{const t=document.querySelector(${JSON.stringify(PREVIEW)}+' .ly-thumb');if(!t)return null;const r=t.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`,
	);
	if (!thumb) console.log("  （没有竖向滚动条，跳过）");
	else {
		await move(thumb.x, thumb.y);
		const onThumb = await watch(500, thumb);
		console.log("采样：" + trail(onThumb) + "  末帧 " + JSON.stringify(onThumb.at(-1)));
		check(onThumb.every((s) => s.shown), "停在滑块上，预览不许关");
	}
	await shoot("3-预览里");

	/*
	 * 七、出卡片当然还是要关——这条本来就是对的，改完也得照旧对。
	 */
	console.log("\n=== 七、移到卡片外 ===");
	await reset();
	await openOn(0);
	await move(15, 75);
	const outside = await watch(700, { x: 15, y: 75 });
	console.log("采样：" + trail(outside) + "  末帧 " + JSON.stringify(outside.at(-1)));
	check(!outside.at(-1)?.shown, "移到卡片外，预览要消失");

	console.log("\n截图落在 " + ARTIFACTS);
	if (failures.length) throw new Error("没过 " + failures.length + " 条：\n  - " + failures.join("\n  - "));
}

// 不写 finally + process.exit：那会把上面的异常一起吞掉，探针于是永远「通过」。
try {
	await main();
	console.log("\n全部通过");
} finally {
	await app?.stop().catch(() => {});
	if (server) await closeListeningServer(server).catch(() => {});
}
