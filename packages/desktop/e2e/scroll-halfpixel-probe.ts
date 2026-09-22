/**
 * 贴底跟随在亚像素上留下的那点抖，量出来。
 *
 * `node --experimental-strip-types e2e/scroll-halfpixel-probe.ts`
 *
 * 现场：一条回复还在写的时候又发一条，前一条写完、新气泡上屏、模型进入长思考——从这一刻起气泡和
 * 它下面那行 loading 一起上下跳，每次一个物理像素（2 倍屏上就是 0.5 CSS px），几秒里跳十几次。录
 * 屏逐帧量出来的是「整块内容在平移」，而平移的那一帧上文字一个像素都没变：动的不是布局里的什么
 * 东西，是滚动位置本身。
 *
 * 根因在 `targetScrollTop`。目标位置是 `scrollHeight - clientHeight`，两个四舍五入过的整数相减，
 * 必然是整数；而内容真正的高度带小数——中文正文按 26.25px 一行排版，转录的可滚动上限尾数就在
 * .023 / .273 / .523 / .773 上循环。写整数就把内容停在离底不等的地方，每长一行换一个差额，那个差
 * 额就是画面上的抖。改成写过末端一个像素，让浏览器按精确几何夹回去——那个值 DOM 上没有任何属性
 * 给得出来，只有浏览器的夹取知道。
 *
 * 这个文件是那件事的量具，也是它往后的回归防线。每一帧记三样：
 *
 *   - `scrollTop` 的浮点原值，以及视口和内容各自的**精确**高度（`getBoundingClientRect`）；
 *   - 每一次对 `scrollTop` 的写入：要写多少、写之前是多少、写完被夹成了多少。实例上盖一层属性
 *     描述符，原型上的原件照常转发，应用代码一个字都不用改；
 *   - 有写入记录的位移，和没有写入记录的位移。后者只可能是浏览器自己动的（滚动锚定、内容变高变矮
 *     时的夹取），也就是 `follow.ts` 顶上那段注释说「分不出来」的那类东西。
 *
 * 修之前：220 次位移里 73 次是亚像素（33%），幅度扎堆在 0.25px（42 次）和 0.75px（14 次），写入
 * 只有 3/220 次被夹。修之后：227 次里 8 次（4%），0.25 和 0.75 一次不剩，169/309 次被夹。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { startApp } from "./app.ts";

const MODEL_PORT = 9576;
const OUT = "/tmp/lyra-halfpixel-probe";
const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let failures = 0;
function check(label: string, passed: boolean, evidence: string): void {
	if (!passed) failures++;
	process.stdout.write(`${passed ? "✓" : "✗"} ${label}\n    ${evidence}\n`);
}

/** 第一轮的正文，够长才撑得出一屏以上的转录。 */
const PROSE =
	"城南老街的尽头，有一家没有招牌的修表兼旧音响铺。在这个所有记忆都能转化为高维数字流、一键备份至云端的年代，陈恪的店里依然弥漫着松香、机油与老旧塑料氧化的气味。" +
	"货架上塞满了开盘带、黑胶和蒙尘的录音卡带。人们叫他磁带收尸人，因为只有那些无法被算法识别、带基霉变扭曲的旧声音，才会被送到这里做最后的抢救。" +
	"入秋后的某个黄昏，檐角的雨滴正断断续续砸在铁皮雨棚上。门铃叮当一响，一个穿着风衣的年轻女人快步走了进来。她脸色有些苍白，手里紧紧攥着一个磨损严重的丝绒盒，像是捧着一块滚烫的炭。" +
	"您就是陈师傅吧，女人声音很轻，带着微不可察的颤抖。陈恪没有立刻抬头，他正用镊子夹着一枚游丝，那东西比头发还细，一口气吹重了就得从头再来。" +
	"盒子打开，里面是一盘没有标签的磁带，外壳裂了一道缝，磁粉在缝隙里结成了块。这种程度的霉变，他一眼就看出来，得先拆壳、重新绕带，再泡药水，慢的话要两个星期。" +
	"女人说她叫苏禾，磁带是父亲留下的。父亲三十五年前出海没再回来，家里什么都没剩下，只有这一盘带子。她想听听里面是什么，哪怕只有一句话。" +
	"陈恪把老花镜往上推了推，拿起放大镜和细镊子，拧开了收音机的开关。电台里流淌着不知名的轻音乐，而空气里，似乎隐隐泛起了一股三十年前东极岛上，咸涩而炽热的海盐味。" +
	"两个星期后苏禾再来时，铺子里正放着那盘带子。沙沙的底噪里先是海浪，然后是一个男人的声音，隔着三十五年的霉斑和药水，一个字一个字地浮上来。" +
	"他说的是天气，是船上的饭菜，是回去以后要给女儿买的那双红皮鞋。录到一半带子卡了一下，声音拖长变形，又自己接了回去。苏禾没有哭，她只是把手按在收音机的木壳上，像是按在一个人的肩膀上。" +
	"陈恪转过身去继续摆弄他的游丝。他修过太多这样的带子，知道声音从霉斑里捞出来的那一刻，屋子里最好不要有第二个人看着。";

function sse(res: ServerResponse, payload: unknown): void {
	res.write(`event: ${(payload as { type: string }).type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

/**
 * 两轮，形状完全不同。
 *
 * 第一轮把正文写出来，第二轮开着连接一言不发——后者才是要量的那二十秒。开着而不是直接结束：
 * 界面要停在「正在思考」上，运行指示器和它的秒数、tok/s 读数都得在。
 */
function startModel(): Server {
	let turn = 0;
	const server = createServer((req, res) => {
		let body = "";
		req.on("data", (chunk: Buffer) => { body += chunk.toString(); });
		req.on("end", async () => {
			/*
			 * 按请求内容分派，不按到达顺序。
			 *
			 * 第一次跑就栽在这里：Lyra 会另发一个拟标题的请求，它先到，于是「第一轮」的正文全
			 * 喂给了标题——侧边栏上是小说开头，转录里一个字都没有，而对话本身拿到的是本该给第二
			 * 轮的那段静默。屏幕上看着像「回复没渲染」，其实是发错了人。拟标题那个 max_tokens
			 * 很小，拿它当判据。
			 */
			const parsed = ((): { max_tokens?: number; messages?: { role: string; content: unknown }[] } => {
				try { return JSON.parse(body) as { max_tokens?: number; messages?: { role: string; content: unknown }[] }; } catch { return {}; }
			})();
			const title = (parsed.max_tokens ?? 8192) < 1000;
			if (title) {
				res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
				sse(res, { type: "message_start", message: { id: "msg_title", role: "assistant", content: [], usage: { input_tokens: 0, output_tokens: 0 } } });
				sse(res, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
				sse(res, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "修表铺与旧磁带" } });
				sse(res, { type: "content_block_stop", index: 0 });
				sse(res, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 8 } });
				sse(res, { type: "message_stop" });
				res.end();
				return;
			}
			const id = turn++;
			process.stdout.write(`    ← 对话请求 ${id}：max_tokens=${parsed.max_tokens} 消息数=${parsed.messages?.length}\n`);
			await settle(400);
			res.writeHead(200, {
				"content-type": "text/event-stream",
				"cache-control": "no-cache",
				connection: "keep-alive",
			});
			sse(res, {
				type: "message_start",
				message: { id: `msg_${id}`, role: "assistant", content: [], usage: { input_tokens: 0, output_tokens: 0 } },
			});
			if (id === 0) {
				/*
				 * 先一小段推理再正文，和 `thinking-jump-probe` 同一个形状。
				 *
				 * 设置里开着 thinking，助手轮直接以 text 开头是没验过的形状，不值得在这里赌。
				 */
				sse(res, { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } });
				sse(res, { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "先想个开头。" } });
				sse(res, { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "sig" } });
				sse(res, { type: "content_block_stop", index: 0 });
				sse(res, { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } });
				/*
				 * 上万字，而且写得够慢。三个条件，前两次跑各栽了一个。
				 *
				 * 撑不过一屏，`fitsInView` 就是真，贴底跟随根本不去写 `scrollTop`——第一次跑量到的
				 * 目标和真实上限都是 0。写得太快，第二条就赶不上在第一轮进行中插进去，排队那条路
				 * 没走到——第二次跑第一轮三秒就写完了。
				 *
				 * 第三个是长度本身：整数属性算出的目标和真实上限差多少，取决于内容高度的小数尾数，
				 * 四千字那次只差 0.023px，离 `targetScrollTop` 那个 `< 1` 的临界还远，于是一次写
				 * 都不会发生，静默段二十三帧纹丝不动。要撞上临界，转录得长得多。
				 */
				const long = PROSE.repeat(12);
				for (let at = 0; at < long.length; at += 22) {
					sse(res, { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: long.slice(at, at + 22) } });
					await settle(38);
				}
				sse(res, { type: "content_block_stop", index: 1 });
				sse(res, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 600 } });
				sse(res, { type: "message_stop" });
				res.end();
				return;
			}
			/*
			 * 第二轮：先挂着思考，中途让一次 usage 落地，然后继续挂着。
			 *
			 * 那一下是故意的。运行行上「本轮 N tokens」正是在 usage 头一次落地的那一帧冒出来的，而
			 * 录屏里整块转录就在那一帧往下掉了 38px、下一帧又弹回去。静默的两段是背景，要看的是中间
			 * 那一帧。
			 */
			await settle(12_000);
			sse(res, { type: "message_delta", delta: {}, usage: { output_tokens: 3 } });
			await settle(14_000);
			sse(res, { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
			sse(res, { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "写得不错。" } });
			sse(res, { type: "content_block_stop", index: 0 });
			sse(res, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 5 } });
			sse(res, { type: "message_stop" });
			res.end();
		});
	});
	server.listen(MODEL_PORT, "127.0.0.1");
	return server;
}

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "one.ts"), "export const one = 1\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [
				{
					id: "local",
					name: "Local",
					baseUrl: `http://127.0.0.1:${MODEL_PORT}`,
					api: "anthropic-messages",
					apiKey: "not-a-key",
					enabled: true,
					models: [
						{
							id: "local/scripted",
							providerId: "local",
							modelId: "scripted",
							name: "Scripted",
							contextWindow: 200000,
							maxOutputTokens: 8192,
							supportsThinking: true,
							supportsImages: false,
							supportsTools: true,
						},
					],
				},
			],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: "local/scripted",
			permissionMode: "full",
			thinking: "medium",
			retryAttempts: 1,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4521, token: null },
			appearance: { theme: "light" },
		}),
	);
}

interface Frame {
	t: number;
	/** scrollTop 的浮点原值，不取整。 */
	st: number;
	/** 整数属性：贴底跟随算目标位置就用这两个。 */
	sh: number;
	ch: number;
	/** 精确高度，真实的可滚动上限从这里来。 */
	vh: number;
	th: number;
	/** 运行指示器和最后一条用户气泡画在哪儿。 */
	ry: number | null;
	by: number | null;
	/** 气泡数：到 2 就是第二条上屏了，静默段从那里开始。 */
	nb: number;
	tail: number;
}

interface WriteRecord {
	t: number;
	asked: number;
	before: number;
	after: number;
}

await mkdir(OUT, { recursive: true });
const model = startModel();
const app = await startApp({ port: 9468, seed });

try {
	const dpr = await app.evaluate<number>("window.devicePixelRatio");
	process.stdout.write(`窗口的 devicePixelRatio = ${dpr}\n`);
	await settle(800);

	const type = async (text: string) => {
		await app.evaluate(`(() => {
			const field = document.querySelector("main textarea");
			const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
			setter.call(field, ${JSON.stringify(text)});
			field.dispatchEvent(new Event("input", { bubbles: true }));
			field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
			return true;
		})()`);
	};

	await type("给我写个1000字的小说吧");

	/*
	 * 转录要先存在才装得上记录器——空会话上根本没有这个面。
	 *
	 * 装在第一轮刚开始写的时候：要量的那一段在第二轮，但再晚一点就看不到第一轮结束、新气泡
	 * 上屏那几帧，而录屏里那几帧本身也在抖，而且抖得比后面大得多。
	 */
	const ready = Date.now();
	while (Date.now() - ready < 20_000) {
		const there = await app.evaluate<boolean>(`Boolean(document.querySelector("[data-ly-chat-surface='conversation'] .ly-scroll-view .ly-transcript"))`);
		if (there) break;
		await settle(200);
	}

	await app.evaluate(`(() => {
		const surface = document.querySelector("[data-ly-chat-surface='conversation']");
		const view = surface.querySelector(".ly-scroll-view");
		const store = { frames: [], writes: [], dpr: window.devicePixelRatio };
		window.__jit = store;

		const proto = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
		Object.defineProperty(view, "scrollTop", {
			configurable: true,
			get() { return proto.get.call(this); },
			set(value) {
				const before = proto.get.call(this);
				proto.set.call(this, value);
				store.writes.push({ t: performance.now(), asked: value, before, after: proto.get.call(this) });
			},
		});

		/*
		 * 真实的手势也记下来。
		 *
		 * 窗口开在屏幕左上角，人这会儿多半正在用这台电脑——一次无意的滚轮就会把转录甩到顶上，
		 * 而那看起来和「跟随底部在乱写」一模一样。记下来，分析时把附近的帧整段剔掉。
		 */
		store.gestures = [];
		for (const kind of ["wheel", "touchstart", "touchmove", "keydown"]) {
			view.addEventListener(kind, () => store.gestures.push({ t: performance.now(), kind }), { passive: true, capture: true });
		}

		let last = null;
		let beat = 0;
		const tick = () => {
			const transcript = view.querySelector(".ly-transcript");
			const running = view.querySelector("[data-ly-running]");
			const bubbles = view.querySelectorAll("[data-question-index]");
			const bubble = bubbles[bubbles.length - 1] || null;
			const now = {
				t: Math.round(performance.now()),
				st: proto.get.call(view),
				sh: view.scrollHeight,
				ch: view.clientHeight,
				vh: view.getBoundingClientRect().height,
				th: transcript ? transcript.getBoundingClientRect().height : 0,
				ry: running ? running.getBoundingClientRect().top : null,
				by: bubble ? bubble.getBoundingClientRect().top : null,
				nb: bubbles.length,
				/* 转录末尾那行文字，用来认出模型开始吐字的那一刻。 */
				tail: transcript ? transcript.innerText.length : 0,
			};
			const moved = !last || now.st !== last.st || now.ry !== last.ry || now.by !== last.by || now.sh !== last.sh || now.th !== last.th;
			if (moved || now.t - beat > 1000) {
				store.frames.push(now);
				beat = now.t;
				last = now;
			}
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
		return true;
	})()`);

	// 第一轮写到一半时插第二条，和录屏里一样走排队那条路。
	await settle(9_000);
	await type("你觉得这个小说写得如何呢?");

	// 第一轮写完、气泡上屏、第二轮挂上去思考——要量的就是这一段。
	/*
	 * 逐档改视口高度，把错位量当自变量扫一遍。
	 *
	 * 上一次跑把机制的一半坐实了：真实可滚动上限是 5324.523，而 `scrollHeight - clientHeight`
	 * 算出来是 5324，`scrollTop` 停在 5324.500——半像素错位确实在，`scrollTop` 也确实落在设备
	 * 像素格上。但那一档的差值正好是 0.5，还在 `targetScrollTop` 那个 `< 1` 的容差里，于是一次
	 * 都不写，静默段二十三帧纹丝不动。
	 *
	 * 错位量由内容高度和视口高度各自的小数尾数决定，改视口高度就能把它连续地推过临界。一档一
	 * 档地改，每档停一会儿，看哪一档开始抖、抖的时候差值是多少——这比守着一个碰巧的长度等它自己
	 * 撞上要靠谱得多。
	 */
	const upWait = Date.now();
	while (Date.now() - upWait < 50_000) {
		const n = await app.evaluate<number>(`document.querySelectorAll("[data-question-index]").length`);
		if (n >= 2) break;
		await settle(300);
	}
	await settle(1_500);
	process.stdout.write(`\n第二条上屏了，让它自己跑完\n`);

	/*
	 * 让它自己跑完，别去动它。
	 *
	 * 调查阶段这里曾经逐档去推转录的高度，想把差值推过 `targetScrollTop` 那个 `< 1` 的临界看它
	 * 发作。两个教训留在这儿：改 `padding` 一档回调都不会产生（`ResizeObserver` 不带参数观察的
	 * 是 content-box），差点让人误判成跟随逻辑没在工作；而真正要量的东西根本不用推——第一轮那
	 * 上万字流下来，每一行都是一次贴底写入，抖不抖当场就看得出来。
	 */
	await settle(20_000);
	const png = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(OUT, "thinking.png"), Buffer.from(png.data, "base64"));

	const frames = await app.evaluate<Frame[]>("window.__jit.frames");
	const writes = await app.evaluate<WriteRecord[]>("window.__jit.writes");
	const gestures = await app.evaluate<{ t: number; kind: string }[]>("window.__jit.gestures");
	await writeFile(join(OUT, "frames.json"), JSON.stringify({ dpr, frames, writes, gestures }));

	const touched = (t: number) => gestures.some((g) => Math.abs(g.t - t) < 1000);
	const seen = frames.filter((f) => f.by !== null && f.ry !== null && !touched(f.t));
	const moves = seen
		.slice(1)
		.map((f, i) => ({ from: seen[i], to: f }))
		.filter((m) => m.to.t - m.from.t < 250 && m.to.by !== m.from.by);
	const size = (m: (typeof moves)[number]) => Math.abs((m.to.by as number) - (m.from.by as number));
	const drift = (m: (typeof moves)[number]) =>
		Math.abs(((m.to.by as number) - (m.from.by as number)) - ((m.to.ry as number) - (m.from.ry as number)));
	const sub = moves.filter((m) => size(m) > 0.01 && size(m) < 1.01);
	const tally = new Map<string, number>();
	for (const m of sub) tally.set(size(m).toFixed(3), (tally.get(size(m).toFixed(3)) ?? 0) + 1);

	process.stdout.write(`\n${seen.length} 帧，${writes.length} 次贴底写入，期间真实手势 ${gestures.length} 次\n\n`);

	check("整块转录跟着流式内容走", moves.length > 20, `位移 ${moves.length} 次`);

	/*
	 * 只在内容没长高的那些帧上问这一句。
	 *
	 * 第一轮正在写的时候，新字是落在气泡和 loading 行**之间**的，两者本来就该拉开——拿全部位移
	 * 去问「同不同步」，227 次里 199 次对不上，那是问错了问题。内容一个像素没变而位置却动了，
	 * 那才是滚动位置自己在动，此时整块必须刚性平移。
	 */
	const rigid = moves.filter((m) => m.to.sh === m.from.sh && m.to.th === m.from.th);
	check(
		"内容没变而位置动了的那些帧，气泡和 loading 行刚性平移",
		rigid.every((m) => drift(m) < 0.02),
		`${rigid.length} 次这样的位移里，两者对不上的有 ${rigid.filter((m) => drift(m) >= 0.02).length} 次`,
	);

	/*
	 * 这两条就是修复本身。
	 *
	 * 修之前：220 次位移里 73 次是亚像素（33%），幅度扎堆在 0.25px（42 次）和 0.75px（14 次）——
	 * 每长几行就来一下，屏幕上就是新消息和它下面那行 loading 一起抖。修之后：227 次里只剩 11 次
	 * （4%），0.25 和 0.75 一次都不剩。
	 */
	const ratio = moves.length ? (sub.length * 100) / moves.length : 0;
	check(
		"亚像素位移是零星的，不是每几行就来一次",
		ratio < 12,
		`${sub.length}/${moves.length} = ${ratio.toFixed(0)}%（修复前 33%）；幅度 ${[...tally].map(([k, n]) => `${k}×${n}`).join(" ") || "无"}`,
	);
	const rhythmic = [...tally].filter(([k, n]) => (k === "0.250" || k === "0.750") && n >= 3);
	check(
		"0.25px / 0.75px 那种规律性的抖没有了",
		rhythmic.length === 0,
		rhythmic.length ? `还剩 ${rhythmic.map(([k, n]) => `${k}×${n}`).join(" ")}` : "一次都没有",
	);

	/*
	 * 写进去的值被夹，是修复生效的直接证据。
	 *
	 * `targetScrollTop` 故意写过末端一个像素，浏览器按精确几何把它夹回真正的底——那个值 DOM 上
	 * 没有任何属性给得出来。修复前只有 3/220 次被夹（写的是整数，本来就没到底，无可夹）。
	 */
	const clamped = writes.filter((w) => Math.abs(w.asked - w.after) > 0.001);
	check(
		"贴底写入被浏览器夹到了精确末端",
		clamped.length > writes.length / 4,
		`${clamped.length}/${writes.length} 次被夹（修复前 3/220）；` +
			`例：${clamped.slice(0, 4).map((w) => `要${w.asked.toFixed(2)}→成${w.after.toFixed(2)}`).join("，")}`,
	);

	/*
	 * 内容高度一次跳好几个像素的那些帧——录屏里那次 38px 的下坠就长这样。
	 *
	 * 三个数一起看才说得清是谁动的：内容自己长高了（`th` 变），还是滚动位置被改了（`st` 变），
	 * 还是两者都变了但不同步——最后一种就是「这一帧画出来是错的，下一帧才补上」。
	 */
	const jumps = seen
		.slice(1)
		.map((f, i) => ({ from: seen[i], to: f }))
		.filter((m) => m.to.t - m.from.t < 250 && Math.abs(m.to.th - m.from.th) > 4);
	process.stdout.write(`\n内容高度跳变 ${jumps.length} 次：\n`);
	for (const m of jumps.slice(0, 12)) {
		process.stdout.write(
			`  ${(m.to.t / 1000).toFixed(2)}s  内容 ${m.from.th.toFixed(1)}→${m.to.th.toFixed(1)}  ` +
				`scrollTop ${m.from.st.toFixed(1)}→${m.to.st.toFixed(1)}  ` +
				`气泡 ${(m.from.by as number).toFixed(1)}→${(m.to.by as number).toFixed(1)}  ` +
				`loading ${(m.from.ry as number).toFixed(1)}→${(m.to.ry as number).toFixed(1)}\n`,
		);
	}

	const tails = new Map<string, number>();
	for (const f of frames) {
		const k = (f.st % 1).toFixed(3);
		tails.set(k, (tails.get(k) ?? 0) + 1);
	}
	process.stdout.write(`\nscrollTop 的小数尾数：${[...tails].map(([k, n]) => `${k}×${n}`).join("  ")}\n`);
	process.stdout.write(`完整记录：${join(OUT, "frames.json")}\n`);
} finally {
	await app.stop();
	await new Promise((resolve) => model.close(() => resolve(null)));
}

process.stdout.write(`\n${failures === 0 ? "全部通过" : `${failures} 项未通过`}\n`);
process.exit(failures === 0 ? 0 : 1);
