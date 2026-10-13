/* oxlint-disable no-console -- probe CLI that prints what the real window did */
/**
 * Choosing the image and video model, and making videos, end to end in the real window against a
 * fake relay (ADR-0035, ADR-0036).
 *
 * One relay serves a chat model, two image models and two video models, the way a CliRelay in front
 * of xAI does. What is checked is what a person sees and what the relay was sent: the composer's wand
 * and its menu, a conversation switched from it, a model `@`-named in a message, an edit going to xAI
 * as JSON, a video made from a drawing with its card and player, the player's full-screen button
 * filling the app's window while the screen's own full screen waits in its menu, a drawing redrawn as
 * a video with another model — which also finds its API by trying — the videos in 创作, and the
 * settings rows.
 *
 *   node --experimental-strip-types e2e/media-models-demo.ts   # records into ~/Desktop/Lyra生成模型切换测试
 */

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { startApp, type RunningApp } from "./app.ts";
import { boatPictures, relaySettings, startFakeImageRelay, type Scene } from "./fake-image-relay.ts";
import { driver, encode, pause, startRecording, type Frame } from "./record.ts";

const PORT = 9442;
const OUT = join(homedir(), "Desktop", "Lyra生成模型切换测试");
const stamp = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).replace(/[: ]/g, "-").slice(0, 16);
const DRAW_MS = Number(process.env.LYRA_PROBE_DRAW_MS ?? 4000);

const results: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "✅" : "❌"} ${name}\n     ${detail}`);
}

const SCENES: Scene[] = [
	{ cue: "纸船", call: "call_draw_boat", args: { prompt: "A red origami paper boat floating on calm blue water at midday, flat illustration", aspect_ratio: "16:9" }, reply: "画好了。" },
	{ cue: "夜晚", call: "call_edit_night", args: { prompt: "Turn the scene into a starry night; keep the boat and the composition", images: ["#1"] }, reply: "改成夜晚了。" },
	{ cue: "视频", tool: "video_generate", call: "call_film", args: { prompt: "The paper boat drifts slowly as night falls", image: "#1", duration: 5 }, reply: "视频做好了。" },
];

let app: RunningApp;

async function shot(name: string) {
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	const file = join(OUT, `${stamp}_${name}.png`);
	await writeFile(file, Buffer.from(data, "base64"));
	console.log(`   📸 ${file}`);
}

const model = (modelId: string, more: Record<string, unknown> = {}) => ({
	id: `grok/${modelId}`,
	providerId: "grok",
	modelId,
	name: modelId,
	contextWindow: 200000,
	maxOutputTokens: 8192,
	supportsThinking: false,
	supportsImages: true,
	supportsTools: true,
	...more,
});

async function main() {
	await mkdir(OUT, { recursive: true });
	const clip = await readFile(join(dirname(fileURLToPath(import.meta.url)), "assets", "video-gen-boat.mp4"));
	const relay = await startFakeImageRelay({ scenes: SCENES, art: await boatPictures(), drawMs: DRAW_MS, video: { clip, polls: 3 } });
	const seen = relay.seen;

	app = await startApp({
		port: PORT,
		seed: async (home) => {
			const cwd = join(home, "project");
			await mkdir(cwd, { recursive: true });
			await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 0, y: 0 }));
			await writeFile(
				join(home, "settings.json"),
				relaySettings(relay.port, cwd, {
					defaultModelId: "grok/grok-4.7",
					providers: [
						{
							id: "grok",
							name: "grok",
							api: "openai-chat-completions",
							baseUrl: `http://127.0.0.1:${relay.port}`,
							apiKey: "probe-key",
							enabled: true,
							models: [
								model("grok-4.7"),
								model("grok-imagine-image", { supportsTools: false }),
								model("grok-imagine-image-quality", { supportsTools: false }),
								model("grok-imagine-video-1.5", { supportsTools: false }),
								model("doubao-seedance-2-5-260628", { supportsTools: false }),
							],
						},
					],
				}),
			);
		},
	});

	const frames: Frame[] = [];
	const stop = await startRecording(PORT, frames);
	const { until, hover, type, submit, settled, click, key } = driver(app);
	const tip = () => app.evaluate<string>(`document.querySelector('[data-ly-media-button]')?.getAttribute('data-ly-tip') ?? ''`);
	try {
		await app.evaluate("document.fonts.ready");
		await pause(1500);

		console.log("⓪ 输入框上的魔法棒");
		await until(`document.querySelector('[data-ly-media-button]')`, 15000);
		const firstTip = await tip();
		check("配了两个生图、两个视频模型：输入框上出现生成模型的图标，悬停说各用谁", /生图：grok-imagine-image/.test(firstTip) && /视频：grok-imagine-video-1\.5/.test(firstTip), firstTip.replace(/\n/g, " / "));
		await hover("[data-ly-media-button]");
		await pause(900);
		await shot("00_输入框上的生成模型图标");

		console.log("① 先画一张：自动用第一个生图模型");
		await type("画一只停在水面上的红色纸船，16:9");
		await submit();
		await until(`document.querySelector('[data-ly-image-card="done"] img')?.naturalWidth > 0`, 60000);
		await settled(60000);
		const first = seen.find((s) => s.path.endsWith("/images/generations"));
		check("没选过：画图用的是第一个生图模型 grok-imagine-image", first?.body.model === "grok-imagine-image", `model=${String(first?.body.model)}`);
		check("grok 生图按 xAI 的写法：带比例，不带 size 和 quality", first?.body.aspect_ratio === "16:9" && !("size" in (first?.body ?? {})) && !("quality" in (first?.body ?? {})), JSON.stringify(first?.body ?? {}).slice(0, 160));
		await pause(800);
		await shot("01_第一张图");

		console.log("② 从输入框的菜单把这个对话切到 grok-imagine-image-quality");
		await click("[data-ly-media-button]");
		await until(`document.querySelector('[data-ly-media-kind="image"]')`, 10000);
		await pause(900);
		const menu = await app.evaluate<string>(`document.querySelector('[role="menu"]').innerText`);
		check("菜单分「生图模型」「视频模型」两节，各有跟随默认", /生图模型/.test(menu) && /视频模型/.test(menu) && /跟随默认/.test(menu) && /doubao-seedance/.test(menu), menu.replace(/\s+/g, " ").slice(0, 200));
		await shot("02_生成模型菜单");
		await click('[data-ly-media-kind="image"] [data-model="grok/grok-imagine-image-quality"] button');
		await until(`document.querySelector('[data-ly-media-button][data-own="true"]')`, 10000);
		await pause(700);
		const switchedTip = await tip();
		check("切换后图标变强调色，悬停说生图用 grok-imagine-image-quality", /grok-imagine-image-quality/.test(switchedTip), switchedTip.replace(/\n/g, " / "));
		await shot("03_这个对话切到_quality");

		console.log("③ 接着改图：用这个对话选的模型，参考图按 xAI 的 JSON 发");
		await type("改成夜晚的样子");
		await submit();
		await until(`document.querySelectorAll('[data-ly-image-card="done"]').length >= 2`, 60000);
		await settled(60000);
		const edit = seen.find((s) => s.path.endsWith("/images/edits"));
		const picture = edit?.body.image as { type?: string; url?: string } | undefined;
		check("改图用的是这个对话选的 grok-imagine-image-quality", edit?.body.model === "grok-imagine-image-quality", `model=${String(edit?.body.model)}`);
		check("参考图按 xAI 的写法：JSON 里的 image 对象，不是表单", picture?.type === "image_url" && String(picture?.url).startsWith("data:image/"), JSON.stringify(picture ?? {}).slice(0, 80));
		await pause(800);
		await shot("04_改图用了这个对话的模型");

		console.log("④ @ 一个模型：候选里有生图与视频模型，发出去就切过去");
		await type("@grok-imagine");
		await app.evaluate(`(()=>{const f=document.querySelector("main textarea");f.focus();f.setSelectionRange(f.value.length,f.value.length);f.dispatchEvent(new Event("select",{bubbles:true}));})()`);
		await until(`[...document.querySelectorAll('.ly-mention-menu')].some((m)=>/生图与视频模型/.test(m.innerText))`, 10000).catch(() => {});
		await pause(900);
		const mention = await app.evaluate<string>(`[...document.querySelectorAll('.ly-mention-menu')].map((m)=>m.innerText).join(' ')`);
		check("打 @ 时候选里列出生图和视频模型，各自标着是哪一类", /grok-imagine-image-quality/.test(mention) && /grok-imagine-video-1\.5/.test(mention) && /生图模型/.test(mention) && /视频模型/.test(mention), mention.replace(/\s+/g, " ").slice(0, 160));
		await shot("05_@候选里的模型");
		await key("Escape", 27);
		await type("@grok-imagine-image 再画一只纸船");
		await submit();
		await until(`document.querySelectorAll('[data-ly-image-card="done"]').length >= 3`, 60000);
		await settled(60000);
		const generations = seen.filter((s) => s.path.endsWith("/images/generations"));
		check("@grok-imagine-image 之后这一张就用它画", generations.at(-1)?.body.model === "grok-imagine-image", `model=${String(generations.at(-1)?.body.model)}`);
		const mentionedTip = await tip();
		check("这个对话也跟着切回 grok-imagine-image", /生图：grok-imagine-image(?!-)/.test(mentionedTip), mentionedTip.replace(/\n/g, " / "));
		await pause(800);
		await shot("06_@之后切换了");

		console.log("⑤ 把这张图做成视频：卡片、进度、播放器");
		// Not 「纸船」: the fake relay picks its scene by the first cue it finds in what was said.
		await type("把这张图做成视频");
		await submit();
		await until(`document.querySelector('[data-ly-video-card="making"]')`, 30000);
		await pause(1500);
		const making = await app.evaluate<string>(`document.querySelector('[data-ly-video-card="making"] figcaption')?.textContent ?? ''`);
		check("生成中写着阶段和已等多久", /(排队中|生成中|提交中)/.test(making) && /已等/.test(making), making);
		await shot("07_视频生成中");
		await until(`document.querySelector('[data-ly-video-card="done"] video')`, 60000);
		await until(`document.querySelector('[data-ly-video-card="done"] video')?.readyState >= 1`, 30000).catch(() => {});
		await settled(60000);
		await pause(1200);
		const caption = await app.evaluate<string>(`document.querySelector('[data-ly-video-card="done"] figcaption')?.textContent ?? ''`);
		check("视频落地：播放器，标题写模型、尺寸、时长", /grok-imagine-video-1\.5 · 960×540 · 5s/.test(caption), caption);
		const submitVideo = seen.find((s) => s.path.endsWith("/videos/generations"));
		check("视频请求按 xAI 的写法：首帧是 data URL，时长 5 秒", String((submitVideo?.body.image as { url?: string } | undefined)?.url).startsWith("data:image/") && submitVideo?.body.duration === 5, JSON.stringify({ ...submitVideo?.body, image: "…" }).slice(0, 160));
		const polls = seen.filter((s) => s.path.endsWith("/videos/vid-1")).length;
		check("轮询到完成为止：排队三次，第四次拿到", polls === 4, `查了 ${polls} 次`);
		await app.evaluate(`document.querySelector('[data-ly-video-card="done"]').scrollIntoView({ block: "center" })`);
		await pause(700);
		const native = await app.evaluate<boolean>(`document.querySelector('[data-ly-video-card="done"] video').hasAttribute('controls')`);
		check("视频用的是项目自己的播放器，不是系统控件", !native && (await app.evaluate<boolean>(`Boolean(document.querySelector('[data-ly-video-card="done"] [data-ly-video-player="paused"] [data-ly-video-play]'))`)), `系统控件=${native}`);
		await shot("08_播放器_暂停时");
		await click('[data-ly-video-card="done"] [data-ly-video-play]');
		await until(`document.querySelector('[data-ly-video-card="done"] [data-ly-video-player="playing"]')`, 10000);
		const center = await app.evaluate<{ x: number; y: number }>(`(()=>{const r=document.querySelector('[data-ly-video-card="done"] [data-ly-video-player]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
		// The clip is five seconds: the bar's stepping aside is measured while it still plays.
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: center.x, y: center.y });
		await pause(2600);
		const hidden = await app.evaluate<{ hidden: boolean; state: string }>(`(()=>{const p=document.querySelector('[data-ly-video-card="done"] [data-ly-video-player]');return {hidden:!p.querySelector('.ly-video-bar').hasAttribute('data-shown'),state:p.getAttribute('data-ly-video-player')};})()`);
		check("播放时指针不动，控制条自己让开", hidden.hidden && hidden.state === "playing", JSON.stringify(hidden));
		await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: center.x + 24, y: center.y });
		await pause(350);
		const back = await app.evaluate<boolean>(`document.querySelector('[data-ly-video-card="done"] .ly-video-bar').hasAttribute('data-shown')`);
		check("指针一动控制条就回来", back, `显示=${back}`);
		const clock = await app.evaluate<string>(`document.querySelector('[data-ly-video-card="done"] [data-ly-video-time]').textContent`);
		check("点中间的播放键就播，时间在走、总长 5 秒", /^0:0[1-4] \/ 0:05$/.test(clock), clock);
		await shot("09_播放器_播放中");
		// Drag on the track: a real pointer, through the player's own scrubber, from 60% back to 30%.
		const rail = await app.evaluate<{ x: number; y: number; w: number }>(`(()=>{const r=document.querySelector('[data-ly-video-card="done"] .ly-video-track').getBoundingClientRect();return {x:r.x,y:r.y+r.height/2,w:r.width};})()`);
		await app.evaluate(`document.querySelector('[data-ly-video-card="done"] video').pause()`);
		for (const [type, x] of [["mouseMoved", rail.x + rail.w * 0.6], ["mousePressed", rail.x + rail.w * 0.6], ["mouseMoved", rail.x + rail.w * 0.45], ["mouseMoved", rail.x + rail.w * 0.3], ["mouseReleased", rail.x + rail.w * 0.3]] as const) {
			await app.send("Input.dispatchMouseEvent", { type, x, y: rail.y, ...(type === "mouseMoved" ? { buttons: x === rail.x + rail.w * 0.6 ? 0 : 1 } : { button: "left", clickCount: 1, buttons: type === "mousePressed" ? 1 : 0 }) });
			await pause(150);
		}
		const sought = await app.evaluate<{ time: number; label: string; rail: number }>(`(()=>{const p=document.querySelector('[data-ly-video-card="done"]');return {time:p.querySelector('video').currentTime,label:p.querySelector('[data-ly-video-time]').textContent,rail:${JSON.stringify(rail.w)}};})()`);
		check("拖进度条能跳到别处：从 60% 拖到 30%，停在 1.5 秒上下", sought.time > 1.2 && sought.time < 1.8, JSON.stringify(sought));
		await pause(700);

		console.log("⑤b 全屏：只铺满 Lyra 自己的窗口；真的占满屏幕在「更多」菜单里");
		const card = '[data-ly-video-card="done"]';
		const large = (size: string) => `document.querySelector('[data-ly-video-player][data-size="${size}"]')`;
		// The same <video> node before and after, and the conversation's scroller, to see nothing behind moved.
		const start = await app.evaluate<{ w: number; h: number; scroll: number }>(`(()=>{
			const v=document.querySelector('${card} video');v.dataset.probeSame='1';v.currentTime=0;void v.play();
			let el=document.querySelector('${card}').parentElement;
			while(el&&!(el.scrollHeight>el.clientHeight&&/auto|scroll/.test(getComputedStyle(el).overflowY)))el=el.parentElement;
			window.__probeScroller=el;
			return {w:innerWidth,h:innerHeight,scroll:el?el.scrollTop:-1};
		})()`);
		await pause(500);
		await hover(`${card} [data-ly-video-full]`);
		await pause(250);
		const t0 = await app.evaluate<number>(`document.querySelector('${card} video').currentTime`);
		await click(`${card} [data-ly-video-full]`);
		await until(large("window"), 5000);
		await pause(800);
		const filled = await app.evaluate<{ open: boolean; rect: number[]; view: number[]; screen: number[]; fullscreen: boolean; same: boolean; time: number; paused: boolean; region: string; topHit: boolean }>(`(()=>{
			const p=document.querySelector('[data-ly-video-player][data-size="window"]');const r=p.getBoundingClientRect();const v=p.querySelector('video');const cs=getComputedStyle(p);
			return {open:p.matches(':popover-open'),rect:[r.x,r.y,r.width,r.height].map(Math.round),view:[innerWidth,innerHeight],screen:[screen.width,screen.height],fullscreen:document.fullscreenElement!==null,same:v.dataset.probeSame==='1',time:v.currentTime,paused:v.paused,
				region:cs.getPropertyValue('app-region')||cs.getPropertyValue('-webkit-app-region'),topHit:p.contains(document.elementFromPoint(innerWidth/2,20))};
		})()`);
		check(
			"点全屏只铺满 Lyra 的窗口：盖住整个窗口，窗口大小没变，没进系统全屏",
			filled.open && filled.rect.join() === `0,0,${filled.view.join()}` && filled.view[0] === start.w && filled.view[1] === start.h && !filled.fullscreen,
			JSON.stringify({ 播放器: filled.rect, 窗口: filled.view, 屏幕: filled.screen, 系统全屏: filled.fullscreen, 顶层: filled.open }),
		);
		check("放大时视频接着播，是同一个 <video>，没有从头开始", filled.same && !filled.paused && filled.time > t0, `点之前 ${t0.toFixed(2)}s → 现在 ${filled.time.toFixed(2)}s，暂停=${filled.paused}`);
		check("铺满时窗口顶上的拖动条让开了：点得到画面", filled.region === "no-drag" && filled.topHit, `app-region=${filled.region}，顶上 20px 点到播放器=${filled.topHit}`);
		const middle = await app.evaluate<{ x: number; y: number }>(`({x:innerWidth/2,y:innerHeight/2})`);
		await app.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: middle.x, y: middle.y, deltaX: 0, deltaY: -600 });
		await pause(500);
		const scrolled = await app.evaluate<number>(`window.__probeScroller?window.__probeScroller.scrollTop:-1`);
		check("在铺满的播放器上滚轮，后面的对话不跟着滚", scrolled === start.scroll, `滚动位置 ${start.scroll} → ${scrolled}`);
		await hover('[data-ly-video-player][data-size="window"] [data-ly-video-full]');
		await pause(900);
		const tipShown = await app.evaluate<{ text: string; inside: boolean; seen: boolean }>(`(()=>{const t=document.querySelector('.ly-tooltip');const p=document.querySelector('[data-ly-video-player][data-size="window"]');return {text:t?.textContent??'',inside:Boolean(t&&p?.contains(t)),seen:Boolean(t&&!t.hidden&&t.checkVisibility())};})()`);
		check("铺满时按钮的提示照样看得见（画在播放器里，不被盖住）", tipShown.seen && tipShown.inside && tipShown.text === "退出全屏", JSON.stringify(tipShown));
		await shot("09b_全屏_只铺满应用窗口");
		await key("Tab", 9);
		await key("Tab", 9);
		await key("Tab", 9);
		const kept = await app.evaluate<boolean>(`document.querySelector('[data-ly-video-player][data-size="window"]').contains(document.activeElement)`);
		check("铺满时按 Tab 不会跑到后面看不见的按钮上", kept, `焦点还在播放器里=${kept}`);
		await key("Escape", 27);
		await until(large("inline"), 5000);
		const after = await app.evaluate<{ same: boolean; card: boolean; open: boolean }>(`(()=>{const p=document.querySelector('${card} [data-ly-video-player]');return {same:p?.querySelector('video')?.dataset.probeSame==='1',card:Boolean(p),open:p?.matches(':popover-open')??true};})()`);
		check("按 Esc 退回对话里的卡片，还是那一个播放器", after.card && after.same && !after.open, JSON.stringify(after));

		await app.evaluate(`document.querySelector('${card} video').pause()`);
		await hover(`${card} [data-ly-video-full]`);
		await pause(250);
		await click(`${card} [data-ly-video-full]`);
		await until(large("window"), 5000);
		await hover('[data-ly-video-player][data-size="window"] [data-ly-video-more]');
		await pause(200);
		await click('[data-ly-video-player][data-size="window"] [data-ly-video-more]');
		await until(`document.querySelector('[data-ly-video-menu]')`, 5000);
		await pause(600);
		const offered = await app.evaluate<string>(`document.querySelector('[data-ly-video-menu]').innerText`);
		check("「更多」里有「屏幕全屏」，写着占满整个屏幕、Esc 退出", /屏幕全屏/.test(offered) && /Esc/.test(offered), offered.replace(/\s+/g, " "));
		await shot("09c_更多菜单_屏幕全屏");
		await click("[data-ly-video-screen]");
		await until(large("screen"), 10000);
		// macOS moves the window into a space of its own; the page is told before the animation ends.
		await until(`innerWidth===screen.width&&innerHeight===screen.height`, 8000).catch(() => {});
		await pause(1200);
		const whole = await app.evaluate<{ view: number[]; screen: number[]; mine: boolean }>(`({view:[innerWidth,innerHeight],screen:[screen.width,screen.height],mine:document.fullscreenElement?.matches('[data-ly-video-player]')??false})`);
		// A notched MacBook keeps the strip beside the camera out of every full-screen window: up to 40pt short.
		check(
			"选「屏幕全屏」才真的占满整块屏幕",
			whole.mine && whole.view[0] === whole.screen[0] && whole.view[1] >= whole.screen[1] - 40 && whole.view[1] > start.h,
			`窗口内容 ${whole.view.join("×")}，屏幕 ${whole.screen.join("×")}（刘海那条留给摄像头），全屏的是播放器=${whole.mine}`,
		);
		await shot("09d_屏幕全屏");
		await key("Escape", 27);
		let byEsc = true;
		await until(large("window"), 6000).catch(async () => {
			byEsc = false;
			await app.evaluate(`document.exitFullscreen()`);
			await until(large("window"), 6000);
		});
		await until(`innerWidth===${start.w}&&innerHeight===${start.h}`, 8000).catch(() => {});
		await pause(800);
		const returned = await app.evaluate<{ view: number[]; open: boolean }>(`(()=>{const p=document.querySelector('[data-ly-video-player][data-size="window"]');return {view:[innerWidth,innerHeight],open:Boolean(p?.matches(':popover-open'))};})()`);
		check("退出屏幕全屏回到铺满窗口那一档（从哪儿来回哪儿去）", byEsc && returned.open && returned.view.join() === `${start.w},${start.h}`, `按 Esc 退出=${byEsc}，窗口内容 ${returned.view.join("×")}，铺满=${returned.open}`);
		await key("Escape", 27);
		await until(large("inline"), 5000);
		await pause(400);

		console.log("⑥ 图片卡片上「再生成」：用另一个视频模型把图做成视频，接口自己试出来");
		await app.evaluate(`document.querySelector('[data-ly-image-card="done"]').scrollIntoView({ block: "center" })`);
		await pause(600);
		await hover('[data-ly-image-card="done"] [data-ly-image-frame="done"]');
		await pause(900);
		await click('[data-ly-image-card="done"] [data-ly-regenerate]');
		await until(`document.querySelector('[data-ly-pick-kind="video"]')`, 10000);
		await pause(800);
		const pick = await app.evaluate<string>(`document.querySelector('[role="menu"]').innerText`);
		check("「再生成」分「换个模型重画」「做成视频」两节", /换个模型重画/.test(pick) && /做成视频/.test(pick), pick.replace(/\s+/g, " ").slice(0, 160));
		await shot("10_再生成菜单");
		const before = seen.length;
		await click('[data-ly-pick-kind="video"] [data-model="grok/doubao-seedance-2-5-260628"] button');
		await until(`document.querySelectorAll('[data-ly-video-card="done"]').length >= 2`, 90000);
		await settled(60000);
		const tried = seen.slice(before).filter((s) => /contents\/generations\/tasks|\/v1\/videos$|\/videos\/generations/.test(s.path)).map((s) => s.path);
		check("Seedance 自动先试方舟格式，接口不在再换，最后在 xAI 格式上做成", tried[0]?.includes("contents/generations/tasks") && tried.at(-1)?.endsWith("/videos/generations") === true, tried.join(" → "));
		const asked = await app.evaluate<string>(`[...document.querySelectorAll('main [data-ly-user-message], main .ly-user-bubble, main [data-role="user"]')].map((e)=>e.innerText).join(' | ') || document.querySelector('main').innerText.slice(-600)`);
		check("发出去的那句话带着 @ 视频模型", /@doubao-seedance-2-5-260628/.test(asked), asked.replace(/\s+/g, " ").slice(-120));
		const filmTip = await tip();
		check("这个对话的视频模型跟着切到了 Seedance", /视频：doubao-seedance-2-5-260628/.test(filmTip), filmTip.replace(/\n/g, " / "));
		await pause(800);
		await shot("11_用Seedance做成视频");

		const media = await readdir(join(app.home, "session-media")).catch(() => [] as string[]);
		check("视频存进了 session-media，按内容哈希命名", media.filter((name) => /^[a-f0-9]{40}\.mp4$/.test(name)).length >= 1, media.filter((name) => name.endsWith(".mp4")).join("、"));

		console.log("⑦ 创作：视频和图片排在一起");
		await click('[data-ly-rail-item="gallery"]');
		await until(`document.querySelector('[data-ly-gallery-tile]')`, 20000);
		await pause(1500);
		const heading = await app.evaluate<string>(`document.querySelector('main h1')?.textContent ?? ''`);
		check("名字改成了「创作」", heading.trim() === "创作", heading);
		const badges = await app.evaluate<number>(`document.querySelectorAll('[data-ly-gallery-tile] .ly-gallery-chip[data-side="end"]').length`);
		check("视频卡片右上角标着播放和时长", badges >= 1, `${badges} 个视频`);
		await shot("12_创作里的视频");
		await app.evaluate(`(()=>{const tile=[...document.querySelectorAll('[data-ly-gallery-tile]')].find((t)=>t.querySelector('video'));tile?.setAttribute('data-probe-film','');})()`);
		await click("[data-probe-film]");
		await until(`document.querySelector('[data-ly-gallery-stage] [data-ly-video-player] video')`, 15000);
		await pause(1500);
		const editBar = await app.evaluate<boolean>(`Boolean(document.querySelector('[data-ly-gallery-detail] textarea')?.checkVisibility())`);
		check("点开视频是播放器，没有改图的输入框", !editBar, `编辑栏可见=${editBar}`);
		await shot("13_创作里播放视频");
		const filmShown = await app.evaluate<string>(`document.querySelector('[data-ly-gallery-stage] video').getAttribute('src')`);
		await hover("[data-ly-gallery-stage] [data-ly-video-player]");
		await pause(300);
		await click("[data-ly-gallery-stage] [data-ly-video-full]");
		await until(`document.querySelector('[data-ly-gallery-stage] [data-ly-video-player][data-size="window"]')`, 5000);
		await pause(500);
		// ← → step between works in 创作; while the clip covers the window they are the clip's.
		await key("ArrowRight", 39);
		await pause(300);
		await key("Escape", 27);
		await pause(700);
		const stayed = await app.evaluate<{ stage: boolean; size: string; src: string }>(`(()=>{const p=document.querySelector('[data-ly-gallery-stage] [data-ly-video-player]');return {stage:Boolean(p),size:p?.getAttribute('data-size')??'',src:p?.querySelector('video')?.getAttribute('src')??''};})()`);
		check("创作里全屏时 → 和 Esc 归播放器：Esc 只退出全屏，详情还开着、还是这条视频", stayed.stage && stayed.size === "inline" && stayed.src === filmShown, JSON.stringify({ ...stayed, src: stayed.src === filmShown ? "同一条" : stayed.src }));
		await key("Escape", 27);
		await pause(1200);

		console.log("⑧ 设置：视频模型的行、默认（自动）、编辑器的用途和视频接口");
		await click("[data-ly-open-settings]");
		await pause(1000);
		await app.evaluate(`(()=>{document.querySelector('[data-probe-nav]')?.removeAttribute('data-probe-nav');[...document.querySelectorAll("nav button")].find((b)=>b.textContent.trim()==="模型设置")?.setAttribute('data-probe-nav','');})()`);
		await click("[data-probe-nav]");
		await until(`document.querySelector('[data-ly-model-row="grok-imagine-video-1.5"]')`, 15000);
		await app.evaluate(`document.querySelector('[data-ly-model-row="grok-imagine-video-1.5"]').scrollIntoView({ block: "center" })`);
		await pause(800);
		const row = (id: string) => app.evaluate<string>(`(()=>{const r=document.querySelector('[data-ly-model-row="${id}"]').closest('.group\\\\/row');return [...r.querySelectorAll('[role="img"]')].map((e)=>e.getAttribute('aria-label')).join('、')+' | '+r.innerText;})()`);
		const videoRow = await row("grok-imagine-video-1.5");
		check("视频模型那一行标着「视频模型」和「默认（自动）」", /视频模型/.test(videoRow) && /默认（自动）/.test(videoRow) && !/支持工具调用/.test(videoRow), videoRow.replace(/\s+/g, " ").slice(0, 160));
		const imageRow = await row("grok-imagine-image");
		check("没设默认生图模型时，第一个生图模型标「默认（自动）」", /默认（自动）/.test(imageRow), imageRow.replace(/\s+/g, " ").slice(0, 120));
		await shot("14_模型列表里的视频模型");
		await click('[data-ly-model-row="doubao-seedance-2-5-260628"]');
		await until(`document.querySelector('[data-ly-model-output] [data-segment="video"]')`, 10000);
		await pause(800);
		const pressed = await app.evaluate<string | null>(`document.querySelector('[data-ly-model-output] [data-segment="video"]').getAttribute('aria-pressed')`);
		const api = await app.evaluate<string>(`[...document.querySelectorAll('label, [data-field], div')].map((e)=>e.innerText).find((t)=>/视频接口/.test(t) && t.length < 200) ?? ''`);
		check("编辑 Seedance：用途是视频，下面有视频接口（自动）", pressed === "true" && /视频接口/.test(api) && /自动/.test(api), `aria-pressed=${pressed}；${api.replace(/\s+/g, " ").slice(0, 120)}`);
		// The choice sits below the prices in a dialog that scrolls: bring it into the picture.
		await app.evaluate(`document.querySelector('[data-ly-model-output]').scrollIntoView({ block: "center" })`);
		await pause(900);
		await shot("15_模型编辑器_用途与视频接口");
		await key("Escape", 27);
		await pause(800);
		await app.evaluate(`(()=>{document.querySelector('[data-probe-nav]')?.removeAttribute('data-probe-nav');[...document.querySelectorAll("nav button")].find((b)=>b.textContent.trim()==="智能体")?.setAttribute('data-probe-nav','');})()`);
		await click("[data-probe-nav]");
		await until(`document.querySelector('[data-agent-profile="video"]')`, 15000);
		await app.evaluate(`document.querySelector('[data-agent-profile="video"]').scrollIntoView({ block: "center" })`);
		await pause(900);
		const session = await app.evaluate<string>(`document.querySelector('[data-agent-profile="image"]').innerText + ' | ' + document.querySelector('[data-agent-profile="video"]').innerText`);
		check("会话设置里有「生图模型」「视频模型」两行", /生图模型/.test(session) && /视频模型/.test(session), session.replace(/\s+/g, " ").slice(0, 200));
		await shot("16_会话设置里的生图和视频模型");
		await pause(1000);
	} finally {
		await stop();
		const passed = results.filter((r) => r.ok).length;
		console.log(`\n${passed}/${results.length} 通过`);
		const home = app.home;
		await app.stop();
		await rm(home, { recursive: true, force: true });
		relay.close();
		if (frames.length > 0) {
			const video = join(OUT, `${stamp}_生成模型切换与视频_${passed}of${results.length}.mp4`);
			await encode(frames, video);
			console.log(`   🎬 ${video}`);
		}
		if (passed !== results.length) process.exitCode = 1;
	}
}

await main();
