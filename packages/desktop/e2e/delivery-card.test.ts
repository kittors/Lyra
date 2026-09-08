import assert from "node:assert/strict";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { after, afterEach, before, test } from "node:test";
import { startApp, closeListeningServer, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";

let app: RunningApp;
let server: Server;
let turns = 0;

/**
 * 一份两个方向都装不下的改动。
 *
 * 一行的时候，预览连滚动条都没有，而滚动条正是浮层内衬出问题的地方：菜单要给竖条让开 20px，
 * 一整块 diff 让开之后，右边就空出一条不是代码的底色。写够高也写够宽，那 20px 才量得到。
 */
function written(index: number): string {
	const lines = [`export const value${index} = ${index};`];
	for (let i = 0; i < 40; i++) lines.push(`export const field_${index}_${i} = ${JSON.stringify("横向溢出用的长行".repeat(i === 3 ? 14 : 1))};`);
	return lines.join("\n") + "\n";
}
before(async () => {
	// Only the provider is scripted. File writes, records, IPC and rendering use the real app.
	server = createServer((req, res) => {
		req.resume(); req.on("end", () => {
			const index = turns++;
			const tool = index < 5 ? { name: "write", input: { path: `delivery-${index}.ts`, content: written(index) } } : null;
			res.writeHead(200, { "content-type": "text/event-stream" });
			const emit = (type: string, data: object) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
			emit("message_start", { message: { id: `qa-${index}`, role: "assistant", content: [], usage: { input_tokens: 100, output_tokens: 0 } } });
			emit("content_block_start", { index: 0, content_block: tool ? { type: "tool_use", id: `write-${index}`, name: tool.name, input: {} } : { type: "text", text: "" } });
			emit("content_block_delta", { index: 0, delta: tool ? { type: "input_json_delta", partial_json: JSON.stringify(tool.input) } : { type: "text_delta", text: index === 5 ? `已完成。\n\n[实现说明](${join(app.home, "project", "README.md")})` : "这一轮没有修改文件。" } });
			emit("content_block_stop", { index: 0 });
			emit("message_delta", { delta: { stop_reason: tool ? "tool_use" : "end_turn" }, usage: { output_tokens: 20 } });
			emit("message_stop", {}); res.end();
		});
	});
	await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
	const address = server.address(); assert.ok(address && typeof address !== "string");
	app = await startApp({ port: 9643, seed: async home => {
		await seedInteractions(home, address.port);
		await mkdir(join(home, "private"));
		await writeFile(join(home, "private", "outside.txt"), "PRIVATE_FIXTURE");
		await symlink(join(home, "private"), join(home, "project", "outside"), "junction");
		const path = join(home, "settings.json"), settings = JSON.parse(await readFile(path, "utf8"));
		await writeFile(path, JSON.stringify({ ...settings, permissionMode: "full", projectMemory: false, thinking: "off" }));
	} });
});
after(async () => { try { await app?.stop(); } finally { await closeListeningServer(server); } });
async function until(expression: string) {
	await app.evaluate(`new Promise((resolve,reject)=>{const end=performance.now()+15000;function tick(){if(${expression})resolve();else if(performance.now()<end)requestAnimationFrame(tick);else reject(Error(${JSON.stringify(expression)}+'; '+document.body.innerText.slice(-1000)))}tick()})`);
}
async function frames(n = 20) { await app.evaluate(`new Promise(r=>{let n=${n};function tick(){if(--n)requestAnimationFrame(tick);else r()}requestAnimationFrame(tick)})`); }
async function click(selector: string) {
	await until(`document.querySelector(${JSON.stringify(selector)})?.checkVisibility()`);
	await app.evaluate(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest',behavior:'instant'})`); await frames();
	const point = await app.evaluate<{ x: number; y: number }>(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect();if(!e.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)))throw Error('Obscured '+${JSON.stringify(selector)});return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await app.send("Input.dispatchMouseEvent", { type, ...point, ...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }) });
}
async function send(text: string) {
	await click('[data-dock-pane="conversation"] textarea');
	await app.send("Input.insertText", { text });
	await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", windowsVirtualKeyCode: 13 });
}
afterEach(async t => { if (!t.passed) await screenshot("delivery-failure"); });
async function screenshot(name: string) {
	const dir = process.env.LYRA_E2E_ARTIFACTS; if (!dir) return;
	await mkdir(dir, { recursive: true });
	const shot = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(dir, name + ".png"), Buffer.from(shot.data, "base64"));
}

test("real file changes produce one temporary card with internal expansion and stable themed diff previews", async t => {
	await click('[data-ly-row="qa-short"]');
	assert.equal(await app.evaluate(`document.querySelectorAll('[data-turn-delivery]').length`), 0);
	await send("修改五个文件用于验证变更卡片");
	await until(`document.querySelector('[data-turn-delivery]')?.textContent.includes('已编辑 5 个文件')`);
	assert.equal(await app.evaluate(`document.querySelectorAll('[data-turn-delivery]').length`), 1);
	assert.equal(await app.evaluate(`document.querySelectorAll('[data-turn-delivery] [data-delivery-file]:not([inert] *)').length`), 3);
	assert.ok(await app.evaluate(`[...document.querySelectorAll('[data-dock-pane="conversation"] a')].some(e=>e.textContent.includes('实现说明'))`));
	await click('[data-dock-pane="conversation"] a[href$="README.md"]');
	await until(`document.querySelector('[data-dock-pane="file"]')?.innerText.includes('QA fixture')`);
	await click('[data-turn-delivery] [aria-expanded="false"]'); await frames();
	assert.equal(await app.evaluate(`document.querySelectorAll('[data-turn-delivery] [data-delivery-file]:not([inert] *)').length`), 5);
	await click('[data-turn-delivery] [aria-expanded="true"]'); await frames();
	for (const theme of ["light", "dark"]) {
		await app.evaluate(`(async()=>{const s=await window.lyra.settings.get();await window.lyra.settings.save({...s,appearance:{...s.appearance,theme:${JSON.stringify(theme)}}});})()`);
		await until(`document.documentElement.style.colorScheme===${JSON.stringify(theme)}&&!document.documentElement.hasAttribute('data-theme-switching')`);
		await app.evaluate(`document.querySelector('[data-turn-delivery]').scrollIntoView({block:'center',behavior:'instant'})`); await frames();
		const point = await app.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector('[data-delivery-file]').getBoundingClientRect();return {x:r.x+50,y:r.y+r.height/2}})()`);
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
		await until(`document.querySelector('[aria-label="文件变更预览"]')?.textContent.includes('export const')`); await frames();
		const metrics = await app.evaluate<{ preview: DOMRect; row: DOMRect; card: DOMRect; overflow: number; cards: number; inset: { left: number; right: number; bottom: number }; gap: number; rail: number | null }>(`(()=>{const e=document.querySelector('[aria-label="文件变更预览"]'),p=e.getBoundingClientRect(),d=e.querySelector('.ly-diff-scroll').getBoundingClientRect(),row=document.querySelector('[data-delivery-file]').getBoundingClientRect();
			return {preview:p.toJSON(),row:row.toJSON(),card:document.querySelector('[data-turn-delivery]').getBoundingClientRect().toJSON(),overflow:Math.max(0,p.right-innerWidth),cards:document.querySelectorAll('[data-turn-delivery]').length,
			 inset:{left:d.left-p.left,right:p.right-d.right,bottom:p.bottom-Math.min(d.bottom,p.bottom)},gap:row.top-p.bottom,
			 rail:(()=>{const t=e.querySelector('.ly-thumb');return t?Math.round(t.getBoundingClientRect().left-d.right):null})()}})()`);
		t.diagnostic(JSON.stringify({ theme, ...metrics })); assert.equal(metrics.overflow, 0); assert.ok(metrics.preview.x >= 0 && metrics.preview.y >= 0); assert.equal(metrics.cards, 1);
		/*
		 * 预览是从这一行里拉出来的，所以它就是这一行的宽度和这一行的左边缘，并且贴着它。
		 *
		 * 上面那条「没有超出窗口」拦不住这件事：宽度写死 720 的时候，预览在一个普通宽度的窗口里
		 * 比它下面的卡片宽出两百多像素、左右都挂在外面，而窗口还宽得很，overflow 一直是 0。要量
		 * 的是它和这一行的关系，不是它和屏幕的关系。
		 *
		 * 贴着也要量。改成挂在整张卡片上时这几条依然过得去，而预览已经飘到了半张卡片以外——它还
		 * 是那个宽度，只是不再指着任何一行。
		 */
		assert.ok(Math.abs(metrics.preview.width - metrics.row.width) <= 1, `预览要和文件行同宽：${JSON.stringify({ preview: metrics.preview.width, row: metrics.row.width })}`);
		assert.ok(Math.abs(metrics.preview.x - metrics.row.x) <= 1, `预览的左边缘要对着这一行：${JSON.stringify({ preview: metrics.preview.x, row: metrics.row.x })}`);
		assert.ok(metrics.gap >= 0 && metrics.gap <= 12, `预览要贴着这一行，而不是飘在半张卡片以外：${metrics.gap}px`);
		assert.ok(metrics.preview.width <= metrics.card.width, `预览不该宽过卡片：${JSON.stringify({ preview: metrics.preview.width, card: metrics.card.width })}`);
		/*
		 * 代码铺满它所在的卡片——铺到滚动条为止。
		 *
		 * 这块面板自带底色，而浮层的滚动体原本是按菜单来的：上下 6px 外边距、右侧 4px，出了滚动条
		 * 再让开 20px。菜单项没有底色，看不出来；一整块 diff 摆进去，右边就空出 25px 玻璃色、顶上
		 * 空出 6px，代码像是嵌在一张比它大的卡片里。
		 *
		 * 但也不能反过来铺过头：内衬全拆掉之后，滚动条就直接压在最右边那几个字符上。所以右边界不是
		 * 量到卡片边缘，而是量到滑块——够不着它，也别离它太远。
		 */
		assert.ok(metrics.inset.left <= 2, `代码左边要贴着浮层，只留描边：${JSON.stringify(metrics.inset)}`);
		if (metrics.rail === null) assert.ok(metrics.inset.right <= 2, `没有滚动条时右边也该贴着：${JSON.stringify(metrics.inset)}`);
		else assert.ok(metrics.rail >= 0 && metrics.rail <= 6, `代码要一直铺到滚动条边上，既不被它压住也不空一条：距滑块 ${metrics.rail}px`);
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: metrics.preview.x + 40, y: metrics.preview.y + 35 });
		await frames();
		assert.ok(await app.evaluate(`document.querySelector('[aria-label="文件变更预览"]')?.checkVisibility()`), "the diff remains readable when moving into its popup");
		await screenshot(`delivery-${theme}`);
		// 等它真的关掉，不是等够几帧：这些用例共用一个窗口，留着的浮层正好盖在下一条要点的按钮上。
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 15, y: 75 });
		await until(`!document.querySelector('[aria-label="文件变更预览"]')`);
	}

	/*
	 * 经过不算数，停下来才算。
	 *
	 * 卡片自己的两个按钮就在这些行的上方，去够它们必然要横穿这些行——预览要是碰到就开，那趟路上
	 * 它一直是开着的，而它正好开在那两个按钮上面。下界而不是区间：机器慢只会等得更久，那不是这条
	 * 要拦的东西。
	 */
	const rows = await app.evaluate<{ x: number; y: number; top: number }[]>(`[...document.querySelectorAll('[data-turn-delivery] [data-delivery-file]:not([inert] *)')].map(e=>{const r=e.getBoundingClientRect();return {x:r.x+50,y:r.y+r.height/2,top:r.top}})`);
	const last = rows[rows.length - 1];
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: last.x, y: last.y });
	const started = Date.now();
	await until(`document.querySelector('[aria-label="文件变更预览"]')?.textContent.includes('export const')`);
	const waited = Date.now() - started;
	t.diagnostic(`悬停到出现：${waited}ms`);
	assert.ok(waited >= 500, `预览要等鼠标停稳才出现，实际只等了 ${waited}ms`);

	/*
	 * 从最后一个文件往上抬一点，预览不动。
	 *
	 * 这些行是紧挨着的，预览开在它上方 8px——所以那 8px 就是上一行，抬一点点必然落进去。切换要是
	 * 快，整块面板会跳一行的高度、换掉内容、重画一次，从外面看就是「预览没了」。挡住这件事的是
	 * 时间：切换等得和打开一样久，抬上去的这一下还没来得及成为一次切换，鼠标就已经进到预览里了。
	 */
	const place = `(()=>{const e=document.querySelector('[aria-label="文件变更预览"]');if(!e)return '（关了）';const r=e.getBoundingClientRect();return Math.round(r.x)+','+Math.round(r.y)+' '+e.textContent.slice(0,16)})()`;
	// 量在入场之后：`ly-pop-in` 是一段 scale，量在中途拿到的是 0.95 倍的它，和位置无关。
	await frames();
	const settled = await app.evaluate<string>(place);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: last.x, y: last.top - 12 });
	await new Promise((resolve) => setTimeout(resolve, 500));
	assert.equal(await app.evaluate<string>(place), settled, "从最后一个文件往上抬一点，预览既不该关掉也不该跳到上一个文件");
	// 同上：下一条用例第一件事就是点这张卡片上的「撤销」，浮层留着的话它正好压在上面。
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 15, y: 75 });
	await until(`!document.querySelector('[aria-label="文件变更预览"]')`);

	/*
	 * 审核弹窗是一张读代码的纸，不是一张摆着 diff 的表单。
	 *
	 * 原本整页一起滚，还裹在 16px 的内衬里：标题一动就滚出去了，每个文件的名字跟着它走——五个文件
	 * 读到一半，屏幕上没有一处说得出你在看哪个——代码四边内缩，成了弹窗里一块更小的方框，四周露着
	 * 弹窗自己的底色，滚动条离它要滚的正文 16px 远。
	 */
	await click('[data-turn-delivery] button[data-ly-tip="审核全部文件改动"]');
	await until(`document.querySelector('[data-ly-modal] .ly-diff-scroll')`);
	await frames();
	const read = `(()=>{const modal=document.querySelector('[data-ly-modal]'),m=modal.getBoundingClientRect(),view=modal.querySelector('.ly-scroll-view'),v=view.getBoundingClientRect(),
		t=modal.querySelector('[data-dialog-title]').getBoundingClientRect(),n=modal.querySelector('.sticky').getBoundingClientRect(),d=modal.querySelector('.ly-diff-scroll').getBoundingClientRect();
		const thumb=modal.querySelector('.ly-thumb');
		return {title:Math.round(t.top),held:Math.abs(n.top-v.top)<1,inset:{left:Math.round(d.left-m.left),right:Math.round(m.right-d.right)},
			rail:thumb?Math.round(thumb.getBoundingClientRect().left-d.right):null,scrollTop:Math.round(view.scrollTop)}})()`;
	const before = await app.evaluate<{ title: number; held: boolean; inset: { left: number; right: number }; rail: number | null; scrollTop: number }>(read);
	await app.evaluate(`(()=>{document.querySelector('[data-ly-modal] .ly-scroll-view').scrollTop=520})()`);
	await frames();
	const after = await app.evaluate<typeof before>(read);
	t.diagnostic(JSON.stringify({ before, after }));
	assert.ok(after.scrollTop > 0, "弹窗要能滚起来，否则下面几条什么都没验证");
	assert.equal(after.title, before.title, "标题是固定的一条，不该跟着内容滚走");
	assert.ok(after.held, "滚动时文件名要吸在滚动区顶部，否则读到一半不知道在看哪个文件");
	assert.ok(before.inset.left <= 2, `代码左边要贴着弹窗，只留描边：${JSON.stringify(before.inset)}`);
	// 右边界量到滑块而不是弹窗边缘：铺到滚动条为止，既不被它压住也不空一条。同上面预览里的那条。
	if (before.rail === null) assert.ok(before.inset.right <= 2, `没有滚动条时右边也该贴着：${JSON.stringify(before.inset)}`);
	else assert.ok(before.rail >= 0 && before.rail <= 6, `代码要一直铺到滚动条边上：距滑块 ${before.rail}px`);
	for (const type of ["keyDown", "keyUp"] as const) await app.send("Input.dispatchKeyEvent", { type, key: "Escape", windowsVirtualKeyCode: 27 });
	await until(`!document.querySelector('[data-ly-modal]')`);
});

test("local material readers and writes reject links outside an opened project", async () => {
	const path = join(app.home, "project", "outside", "outside.txt");
	const result = await app.evaluate(`(async()=>({read:await window.lyra.files.read(${JSON.stringify(path)}),bytes:await window.lyra.files.bytes(${JSON.stringify(path)}),document:await window.lyra.files.document(${JSON.stringify(path)}),write:await window.lyra.files.write(${JSON.stringify(path)},'overwritten')}))()`);
	assert.deepEqual(result, { read: null, bytes: null, document: null, write: { ok: false, error: "该路径不在已打开的项目内" } });
	assert.equal(await readFile(join(app.home, "private", "outside.txt"), "utf8"), "PRIVATE_FIXTURE");
});

test("undo uses the stored changes, and the next answer cannot retain the previous turn's card", async () => {
	await click('[data-turn-delivery] button[data-ly-tip="撤销这次文件改动"]');
	await until(`document.querySelector('[role="dialog"]')`);
	await app.evaluate(`(()=>{const button=[...document.querySelectorAll('[role="dialog"] button')].find(e=>e.textContent.includes('撤销改动'));if(!button)throw Error('Missing confirm');button.click()})()`);
	/*
	 * 撤销完，这个按钮就不在了——不是变灰留在那儿。
	 *
	 * 灰着的按钮什么都说不出来：浏览器不给 disabled 的元素派鼠标事件，它的 `data-ly-tip` 永远打不开，
	 * 于是它只是一块占位的死灰色，既不说要干什么，也不说为什么不能干。这一轮的文件是不是还撤得动，
	 * 取决于这张卡片管不着的事（之后有没有别人写过它、是不是命令写的），那不是一个值得画出来的状态。
	 */
	await until(`!document.querySelector('[data-turn-delivery] button[data-ly-tip="撤销这次文件改动"]')`);
	for (let i = 0; i < 5; i++) await assert.rejects(readFile(join(app.home, "project", `delivery-${i}.ts`)), { code: "ENOENT" });
	await send("只回答，不改文件");
	await until(`document.body.innerText.includes('这一轮没有修改文件')`);
	assert.equal(await app.evaluate(`document.querySelectorAll('[data-turn-delivery]').length`), 0);
});
