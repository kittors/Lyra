/* oxlint-disable no-console -- a picture-taker that says what it found and where it put the files */
/**
 * 附件在界面上到底长什么样：输入框上方一张，发出去以后一张。
 *
 * 复现客户报的那一条——两张图、一段录屏、一份 PDF 一起拖进去，一个字没打。三件事要在真窗口里
 * 看，测试替不了：正文里有没有凭空多出 `【文件名】`，那一排附件齐不齐，以及发出去以后同一个文
 * 件是不是只出现了一次。
 *
 * 不是测试——`node e2e/attachment-strip-probe.ts`——但和测试一起放在这儿，因为它用同一套方式
 * 起窗口。跑的是 `out/` 里的产物，所以改完代码要先 `pnpm build`。
 *
 * `LYRA_THEME=dark` 换暗色跑一遍。附件标记的颜色是「色相由门类给、明度由主题给」，只看亮色那一张
 * 等于只验了一半——而糊掉的那一半只在另一个主题下才现形。
 */

import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";

const MODEL = "claude-opus-4-6-thinking";
const MODEL_PORT = 9581;

function startModel() {
	const server = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
			const sse = (p: unknown) => res.write(`event: ${(p as { type: string }).type}\ndata: ${JSON.stringify(p)}\n\n`);
			sse({ type: "message_start", message: { id: "m1", role: "assistant", content: [], usage: { input_tokens: 1200, output_tokens: 0 } } });
			sse({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
			sse({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "收到，我看一下这几个文件。" } });
			sse({ type: "content_block_stop", index: 0 });
			sse({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 40 } });
			sse({ type: "message_stop" });
			res.end();
		});
	});
	server.listen(MODEL_PORT, "127.0.0.1");
	return server;
}

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 920, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [
				{
					id: "relay", name: "Relay", baseUrl: `http://127.0.0.1:${MODEL_PORT}`, api: "anthropic-messages",
					apiKey: "not-a-key", enabled: true,
					models: [{
						id: `relay/${MODEL}`, providerId: "relay", modelId: MODEL, name: MODEL,
						contextWindow: 200000, maxOutputTokens: 8192,
						supportsThinking: true, supportsImages: true, supportsTools: true,
					}],
				},
			],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			/*
			 * 主题在这里定，不在页面上临时加个 class。
			 *
			 * `applyTheme` 除了切 class 还会把整套颜色写成 `:root` 上的行内变量，而行内变量压得过任何
			 * 规则——只加 class 的话，标记的颜色换了、它底下的背景没换，拍出来是「亮底配暗色字」，一张
			 * 现实中不存在的图。`normalizeSettings` 会把没写的字段补成默认值，所以这里只说主题。
			 */
			appearance: { theme: process.env.LYRA_THEME === "dark" ? "dark" : "light" },
			defaultModelId: `relay/${MODEL}`, permissionMode: "full", thinking: "high", retryAttempts: 1,
			hooks: [], scheduledTasks: [], disabledPlugins: [], alwaysAllow: [],
			sync: { enabled: false, port: 4525, token: null },
		}),
	);
}

/**
 * 四个文件，一次拖进去。
 *
 * 走 `drop` 而不是去戳那个 `<input type=file>`：拖放是客户实际做的动作，而且 `ComposerShell`
 * 的 `onDrop` 就是附件进来的那扇门。图片用 canvas 现画，带个大字，这样截图里一眼能认出哪张是
 * 哪张——一个 1×1 的空 PNG 是看不出缩略图对不对的。
 */
const DROP = `(async () => {
	const draw = async (label, colour) => {
		const canvas = document.createElement("canvas");
		canvas.width = 320; canvas.height = 200;
		const ctx = canvas.getContext("2d");
		ctx.fillStyle = colour; ctx.fillRect(0, 0, 320, 200);
		ctx.fillStyle = "#ffffff"; ctx.font = "bold 96px sans-serif";
		ctx.textAlign = "center"; ctx.textBaseline = "middle";
		ctx.fillText(label, 160, 100);
		return await new Promise((done) => canvas.toBlob(done, "image/png"));
	};

	const dt = new DataTransfer();
	dt.items.add(new File([await draw("A", "#3b5bdb")], "截屏2026-09-11 17.36.45.png", { type: "image/png" }));
	dt.items.add(new File([new Uint8Array([0, 1, 2, 3])], "录屏2026-09-11 17.37.06.mov", { type: "video/quicktime" }));
	dt.items.add(new File([await draw("B", "#0b7285")], "HLri6IQWoAAX73p.jpeg", { type: "image/jpeg" }));
	// 剪贴板给的名字：一排里每个都叫这个，等于没说——界面上该退成「图片 N」。
	dt.items.add(new File([await draw("C", "#862e9c")], "image.png", { type: "image/png" }));
	dt.items.add(new File([new Uint8Array([37, 80, 68, 70])], "品类实验室_AI智能分析平台_技术架构白皮书_专业重构版.pdf", { type: "application/pdf" }));
	// 一份真能读成文本的，它的正文会进提示词——但绝不该铺进气泡，编辑一次之后也不该。
	dt.items.add(new File(["## 交接说明 这一段是文件正文，气泡里一个字都不该出现。".repeat(24)], "交接说明.md", { type: "text/markdown" }));

	const shell = document.querySelector("main .ly-composer");
	shell.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
	return true;
})()`;

/**
 * 输入框这一侧的读数。
 *
 * 量的是画出来的结果，不是写进去的值：一行到底是不是一行，看的是所有格子的上边缘在不在同一条
 * 线上；两头化没化开，读的是伪元素算完的 opacity，而不是「属性加上了没有」——属性加对了而渐变
 * 压根没画出来，是这一类改动最典型的失败方式。
 */
const READ_COMPOSER = `(() => {
	const field = document.querySelector("main textarea");
	const shell = field.closest(".ly-composer");
	const strip = shell.querySelector("[data-ly-attachments]");
	const track = strip.querySelector("[data-ly-attachments-track]");
	const tiles = [...track.querySelectorAll("[data-ly-attachment]")];
	const boxes = tiles.map((tile) => tile.getBoundingClientRect());
	const before = getComputedStyle(strip, "::before");
	const after = getComputedStyle(strip, "::after");
	const nameOf = (tile) => {
		const body = tile.querySelector(".ly-attachment-body");
		return body ? body.getAttribute("aria-label") : null;
	};
	return {
		draft: field.value,
		bracketsInDraft: (field.value.match(/【/g) || []).length,
		tiles: tiles.length,
		/*
		 * 独占一行，看的是中线。
		 *
		 * 不是上边缘：图片是 64 见方、文件是 32 高的横条，两者靠中线对齐，上边缘本来就不在一条线
		 * 上——按上边缘数，一排永远会被数成「两行」。
		 */
		rows: new Set(boxes.map((b) => Math.round(b.top + b.height / 2))).size,
		// 两种形状各自一个高度：图片按缩略图边长，横条固定 32。注释里不能有反引号，它会提前结束模板串。
		heights: [...new Set(boxes.map((b) => Math.round(b.height)))].sort((a, b) => a - b),
		widths: boxes.map((b) => Math.round(b.width)),
		scrollable: track.scrollWidth > track.clientWidth + 1,
		overflowBy: track.scrollWidth - track.clientWidth,
		fadeStartAttr: track.hasAttribute("data-fade-start"),
		fadeEndAttr: track.hasAttribute("data-fade-end"),
		fadeStartPainted: Number(before.opacity),
		fadeEndPainted: Number(after.opacity),
		labels: tiles.map(nameOf),
		exts: tiles.map((tile) => {
			const badge = tile.querySelector(".ly-attachment-body .uppercase");
			return badge ? badge.textContent : null;
		}),
	};
})()`;

/**
 * 鼠标停在某一格上时，那两颗按钮画出来没有、被裁掉没有。
 *
 * 叉往格子外面探 8px，而这一排是会横滚的——会滚的容器按内容框裁剪，所以「叉被切掉一半」是这个
 * 布局最容易出的错，而它只在鼠标真的停上去时才看得见。用真实指针，`:hover` 不认 JS 派发的事件。
 */
const READ_HOVER = `((key) => {
	const tile = document.querySelector('[data-ly-attachment="' + key + '"]');
	const track = tile.closest("[data-ly-attachments-track]");
	const controls = [...tile.querySelectorAll("[data-ly-hover-reveal]")];
	const clip = track.getBoundingClientRect();
	return {
		hovered: tile.matches(":hover"),
		controls: controls.map((control) => {
			const box = control.getBoundingClientRect();
			return {
				opacity: Number(getComputedStyle(control).opacity),
				// 被裁：探出去的部分落到了会滚的那个盒子外面。
				clipped: box.top < clip.top - 0.5 || box.bottom > clip.bottom + 0.5 || box.right > clip.right + 0.5,
			};
		}),
	};
})`;

/** 菜单里那几行，各自是活的还是灰的，以及灰的那些有没有说明为什么。 */
const READ_MENU = `(() => {
	const menu = document.querySelector('[role="menu"], [role="dialog"]');
	if (!menu) {
		return {
			open: false,
			// 没开的时候要能分清是「没点着」还是「点了没开」。
			portals: document.querySelectorAll("body > div").length,
			anyFixed: document.querySelectorAll("body > div .fixed").length,
		};
	}
	const rows = [...menu.querySelectorAll("button")];
	return {
		open: true,
		items: rows.map((row) => {
			const detail = row.querySelector(".text-caption");
			return {
				// 不切行：模板串会把注入代码里的换行转义提前吃掉，注进去就是语法错误。
				label: (row.innerText || "").trim(),
				disabled: row.disabled === true || row.getAttribute("aria-disabled") === "true",
				// 为什么是灰的，现在是常驻的一行小字——禁用的按钮不派发鼠标事件，挂 tooltip 等于没写。
				why: detail ? detail.textContent : null,
			};
		}),
	};
})()`;

/** 气泡这一侧：附件在里面还是外面，同一个文件出现了几次。 */
const READ_BUBBLE = `(() => {
	const message = document.querySelector("[data-question-index]");
	const bubble = message.querySelector(".ly-user-bubble");
	const strip = message.querySelector("[data-ly-attachments]");
	const box = strip && strip.getBoundingClientRect();
	const bub = bubble && bubble.getBoundingClientRect();
	return {
		bubbleText: bubble ? bubble.innerText : null,
		bubbleExists: Boolean(bubble),
		inlineChipsInBubble: bubble ? bubble.querySelectorAll("[data-ly-attachment]").length : 0,
		bracketsInBubble: bubble ? (bubble.innerText.match(/【/g) || []).length : 0,
		stripAboveBubble: Boolean(box && bub) && box.bottom <= bub.top + 1,
		/* visual-details.test.ts 按这一条判「图片和它的气泡右边缘齐平」，改完要还站得住。 */
		rightEdgesMatch: Boolean(box && bub) && Math.round(box.right) === Math.round(bub.right),
		thumbnails: strip ? strip.querySelectorAll("img").length : 0,
		tiles: strip ? strip.querySelectorAll("[data-ly-attachment]").length : 0,
		// 气泡这一侧铺开，所以这里允许不止一行——但每一格仍然一样高。
		tileHeights: strip
			? [...new Set([...strip.querySelectorAll("[data-ly-attachment]")].map((t) => Math.round(t.getBoundingClientRect().height)))]
			: [],
		names: strip
			? [...strip.querySelectorAll(".ly-attachment-body")].map((b) => b.getAttribute("aria-label"))
			: [],
	};
})()`;

async function clip(app: Awaited<ReturnType<typeof startApp>>, selector: string, pad = 14) {
	const box = await app.evaluate<{ x: number; y: number; width: number; height: number }>(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		const r = el.getBoundingClientRect();
		return { x: Math.round(r.left) - ${pad}, y: Math.round(r.top) - ${pad}, width: Math.round(r.width) + ${pad * 2}, height: Math.round(r.height) + ${pad * 2} };
	})()`);
	return await app.send<{ data: string }>("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 2 } });
}

const out = process.argv[2] ?? "/tmp/lyra-attachments";
const model = startModel();
const app = await startApp({ port: 9472, seed });

try {
	await new Promise((r) => setTimeout(r, 1600));
	await app.evaluate(DROP);
	// 一段录屏和一份 PDF 都会弹一条「读不成文本」的提示，等它自己退场再拍。
	await new Promise((r) => setTimeout(r, 5200));

	const composer = await app.evaluate<Record<string, unknown>>(READ_COMPOSER);
	console.log("输入框：", JSON.stringify(composer, null, 1));
	await writeFile(`${out}-composer.png`, Buffer.from((await clip(app, "main .ly-composer")).data, "base64"));
	console.log(`wrote ${out}-composer.png`);


	/*
	 * 鼠标真的停到最后一格上。
	 *
	 * 最后一格是最靠边的那一个，也是它右上角的叉最可能被会滚的容器切掉的地方。`:hover` 不认 JS
	 * 派发的事件，所以这里走 CDP 的真实指针——`evaluate` 里 dispatch 一个 mouseover 拿到的是
	 * 「事件收到了」，不是「CSS 认它」。
	 */
	/*
	 * 停在第一格上，不是最后一格。
	 *
	 * 六个附件已经把这一排撑出了输入框（766 > 630），而没滚过去之前最后那一格整个在可视区外——
	 * 被裁掉的东西不参与命中测试，鼠标停上去既不 hover 也点不着。这一条是探针自己踩的坑，但它同
	 * 时也确认了裁剪是真的在发生。
	 */
	const lastKey = await app.evaluate<string>(`document.querySelector("main .ly-composer [data-ly-attachment]").getAttribute("data-ly-attachment")`);
	const spot = await app.evaluate<{ x: number; y: number }>(`(() => {
		const r = document.querySelector("main .ly-composer [data-ly-attachment]").getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: spot.x, y: spot.y });
	await new Promise((r) => setTimeout(r, 500));
	const hover = await app.evaluate<Record<string, unknown>>(`(${READ_HOVER})(${JSON.stringify(lastKey)})`);
	console.log("悬停：", JSON.stringify(hover, null, 1));
	await writeFile(`${out}-hover.png`, Buffer.from((await clip(app, "main .ly-composer")).data, "base64"));
	console.log(`wrote ${out}-hover.png`);

	/*
	 * 点开那一格的「更多」。
	 *
	 * 这一批附件是 `DataTransfer` 现造的，磁盘上并不存在，所以「打开」「在访达中显示」「复制路径」
	 * 都该是灰的，并且每一行都得说出为什么——一个不解释自己的禁用项，和一个点下去没反应的按钮，
	 * 对用的人是同一件事。
	 */
	const more = await app.evaluate<{ x: number; y: number; on: string; label: string } | null>(`(() => {
		const button = document.querySelector("main .ly-composer [data-ly-attachment] [data-ly-hover-reveal]:last-of-type button");
		if (!button) return null;
		const r = button.getBoundingClientRect();
		const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
		// 算出来的这个点，实际压在谁身上——对不上就是坐标算错了，而不是按钮坏了。
		const at = document.elementFromPoint(x, y);
		return { x, y, on: at ? at.tagName + "." + String(at.className).split(" ")[0] : "null", label: button.getAttribute("aria-label") || "" };
	})()`);
	if (more) {
		console.log("更多按钮：", JSON.stringify(more));
		/*
		 * 等到那个点真的压在按钮上再按下去。
		 *
		 * `getBoundingClientRect` 给的是此刻的排版，而命中测试用的是合成之后的位置——附件刚进来
		 * 那几帧里两者对不上，算出来的坐标会落到输入框外面的空处。既有的 `approval-question`
		 * 那支探针也是这么等的，这不是本地的怪毛病。
		 */
		for (let tries = 0; tries < 20; tries++) {
			const onTarget = await app.evaluate<boolean>(`(() => {
				const button = document.querySelector("main .ly-composer [data-ly-attachment] [data-ly-hover-reveal]:last-of-type button");
				const r = button.getBoundingClientRect();
				return button.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
			})()`);
			if (onTarget) break;
			await new Promise((r) => setTimeout(r, 100));
		}
		const at = await app.evaluate<{ x: number; y: number; on: string }>(`(() => {
			const button = document.querySelector("main .ly-composer [data-ly-attachment] [data-ly-hover-reveal]:last-of-type button");
			const r = button.getBoundingClientRect();
			const x = Math.round(r.left + r.width / 2), y = Math.round(r.top + r.height / 2);
			const el = document.elementFromPoint(x, y);
			return { x, y, on: el ? el.tagName + "." + String(el.className).split(" ")[0] : "null" };
		})()`);
		console.log("稳定之后：", JSON.stringify(at));
		console.log("各层矩形：", await app.evaluate<string>(`(() => {
			const box = (el) => { const r = el.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)].join(","); };
			const composer = document.querySelector("main .ly-composer");
			const track = composer.querySelector("[data-ly-attachments-track]");
			const tiles = [...composer.querySelectorAll("[data-ly-attachment]")];
			const last = tiles[tiles.length - 1];
			return JSON.stringify({
				composer: box(composer),
				track: box(track),
				trackClient: track.clientWidth + "x" + track.clientHeight,
				trackScroll: track.scrollWidth + " left=" + track.scrollLeft,
				lastTile: box(last),
				moreBtn: box(last.querySelector('[data-ly-hover-reveal]:last-of-type button')),
			});
		})()`));
		more.x = at.x;
		more.y = at.y;
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
			await app.send("Input.dispatchMouseEvent", {
				type,
				x: more.x,
				y: more.y,
				...(type === "mouseMoved" ? {} : { button: "left", clickCount: 1 }),
			});
		}
		await new Promise((r) => setTimeout(r, 600));
		// 真实指针没点开的话，再用 JS 点一次——两者的差别本身就是诊断。
		if (!(await app.evaluate<boolean>(`Boolean(document.querySelector('[role="menu"]'))`))) {
			console.log("真实指针没点开，改用 JS 点一次");
			console.log("点到的是：", await app.evaluate<string>(`(() => {
				const el = document.elementFromPoint(${more.x}, ${more.y});
				return el ? el.tagName + " " + (el.getAttribute("aria-label") || el.className) : "null";
			})()`));
			await app.evaluate(`document.querySelector("main .ly-composer [data-ly-attachment] [data-ly-hover-reveal]:last-of-type button").click()`);
			await new Promise((r) => setTimeout(r, 600));
		}
		console.log("格子上的菜单：", JSON.stringify(await app.evaluate<Record<string, unknown>>(READ_MENU), null, 1));
		await writeFile(`${out}-menu.png`, Buffer.from((await clip(app, "main .ly-composer", 120)).data, "base64"));
		console.log(`wrote ${out}-menu.png`);
		await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", windowsVirtualKeyCode: 27 });
		await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", windowsVirtualKeyCode: 27 });
		await new Promise((r) => setTimeout(r, 400));
	}

	/*
	 * 再拖八张图进去，把这一排撑到超出输入框。
	 *
	 * 撑开的必须是图片：文件现在不上这一排，它的全部存在是句子里那枚标记（见 `Composer` 的 `strip`）。
	 * 横滚、两头化开、以及「叉会不会被会滚的容器切掉」，都只有溢出之后才存在，不撑开就等于没验。
	 */
	await app.evaluate(`(async () => {
		const draw = async (label, colour) => {
			const canvas = document.createElement("canvas");
			canvas.width = 320; canvas.height = 200;
			const ctx = canvas.getContext("2d");
			ctx.fillStyle = colour; ctx.fillRect(0, 0, 320, 200);
			ctx.fillStyle = "#ffffff"; ctx.font = "bold 96px sans-serif";
			ctx.textAlign = "center"; ctx.textBaseline = "middle";
			ctx.fillText(label, 160, 100);
			return await new Promise((done) => canvas.toBlob(done, "image/png"));
		};
		const dt = new DataTransfer();
		const tones = ["#c92a2a", "#a61e4d", "#5f3dc4", "#1864ab", "#0b7285", "#2b8a3e", "#e67700", "#495057"];
		for (let i = 0; i < 8; i++) {
			dt.items.add(new File([await draw(String(i + 1), tones[i])], "image.png", { type: "image/png" }));
		}
		document.querySelector("main .ly-composer").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
		return true;
	})()`);
	await new Promise((r) => setTimeout(r, 3000));

	const crowded = await app.evaluate<Record<string, unknown>>(READ_COMPOSER);
	console.log("撑开之后：", JSON.stringify(crowded, null, 1));
	await writeFile(`${out}-crowded.png`, Buffer.from((await clip(app, "main .ly-composer")).data, "base64"));
	console.log(`wrote ${out}-crowded.png`);

	// 往右拨到底：左边那一头该化开，右边那一头该收掉。
	await app.evaluate(`(() => {
		const track = document.querySelector("main .ly-composer [data-ly-attachments-track]");
		track.scrollLeft = track.scrollWidth;
		return true;
	})()`);
	await new Promise((r) => setTimeout(r, 600));
	const scrolled = await app.evaluate<Record<string, unknown>>(READ_COMPOSER);
	console.log("拨到最右：", JSON.stringify(scrolled, null, 1));

	/*
	 * 拨到底之后，最后那一格的叉还完整吗。
	 *
	 * 会滚的容器按内容框裁剪，而取下附件的那个叉往格子外面探 8px——这两件事凑在一起就是「最靠边
	 * 那个附件的叉被切掉一半」。轨道自带的那圈内边距就是为它留的，而这里是唯一能证明它留够了的
	 * 地方：不滚到头，最靠边的格子根本不在可视区里。
	 */
	const edgeSpot = await app.evaluate<{ x: number; y: number }>(`(() => {
		const tiles = [...document.querySelectorAll("main .ly-composer [data-ly-attachment]")];
		const r = tiles[tiles.length - 1].getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: edgeSpot.x, y: edgeSpot.y });
	await new Promise((r) => setTimeout(r, 500));
	const edgeKey = await app.evaluate<string>(`(() => {
		const tiles = [...document.querySelectorAll("main .ly-composer [data-ly-attachment]")];
		return tiles[tiles.length - 1].getAttribute("data-ly-attachment");
	})()`);
	console.log("最靠边那一格：", JSON.stringify(await app.evaluate<Record<string, unknown>>(`(${READ_HOVER})(${JSON.stringify(edgeKey)})`)));
	await writeFile(`${out}-edge.png`, Buffer.from((await clip(app, "main .ly-composer")).data, "base64"));
	console.log(`wrote ${out}-edge.png`);
	await writeFile(`${out}-scrolled.png`, Buffer.from((await clip(app, "main .ly-composer")).data, "base64"));
	console.log(`wrote ${out}-scrolled.png`);

	// 再拨回最左：该轮到右边那一头化开，左边收掉。
	await app.evaluate(`(() => {
		document.querySelector("main .ly-composer [data-ly-attachments-track]").scrollLeft = 0;
		return true;
	})()`);
	await new Promise((r) => setTimeout(r, 600));
	const atStart = await app.evaluate<Record<string, unknown>>(READ_COMPOSER);
	console.log("拨回最左：", JSON.stringify({
		fadeStartAttr: atStart.fadeStartAttr,
		fadeEndAttr: atStart.fadeEndAttr,
		fadeStartPainted: atStart.fadeStartPainted,
		fadeEndPainted: atStart.fadeEndPainted,
	}));
	await writeFile(`${out}-at-start.png`, Buffer.from((await clip(app, "main .ly-composer")).data, "base64"));
	console.log(`wrote ${out}-at-start.png`);

	/*
	 * 句子里那枚标记的右键菜单。
	 *
	 * 四个地方点出来的该是同一份：格子上、句子里、气泡外那一排、气泡里那一枚。这里验第二个——它是最
	 * 容易漏的，因为被点到的是 textarea 而不是标记（那一层高亮整层不接事件）。
	 */
	const tokenAt = await app.evaluate<{ x: number; y: number } | null>(`(() => {
		const token = document.querySelector("main .ly-composer .ly-attachment-token");
		if (!token) return null;
		const r = token.getBoundingClientRect();
		return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
	})()`);
	if (tokenAt) {
		for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
			await app.send("Input.dispatchMouseEvent", {
				type,
				...tokenAt,
				...(type === "mouseMoved" ? {} : { button: "right", clickCount: 1 }),
			});
		}
		await new Promise((r) => setTimeout(r, 700));
		console.log("标记上的菜单：", JSON.stringify(await app.evaluate<Record<string, unknown>>(READ_MENU), null, 1));
		await app.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", windowsVirtualKeyCode: 27 });
		await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", windowsVirtualKeyCode: 27 });
		await new Promise((r) => setTimeout(r, 400));
	}

	/*
	 * 光标进不到标记里面。
	 *
	 * 停进去之后，方向键一格一格地穿过它，打一个字它就废了——配不上任何附件，当场退化成一串裸方括
	 * 号，而人看不出自己刚破坏了什么。这里把光标硬塞到一枚标记的正中间，看它自己弹出来没有。
	 */
	/*
	 * 用真的方向键，不是派发一个 `select` 事件。
	 *
	 * React 的 `onSelect` 不是原生的那个 select——它由 SelectEventPlugin 从 focus / 按键 / 鼠标这些
	 * 事件里合成出来。手写一个 `new Event("select")` 派发过去，React 那一侧什么都不会发生，于是这条
	 * 读数会说「光标停在标记里出不来」，而真窗口里它是好的。第一次跑出来就是这种假红。
	 */
	const caret = await app.evaluate<{ open: number; close: number }>(`(() => {
		const field = document.querySelector("main textarea");
		const open = field.value.indexOf("【");
		const close = field.value.indexOf("】", open);
		field.focus();
		// 停在标记右缘外面，等下按左箭头往里走。
		field.setSelectionRange(close + 2, close + 2);
		return { open, close };
	})()`);
	for (let i = 0; i < 2; i++) {
		await app.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 });
		await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 });
		await new Promise((r) => setTimeout(r, 200));
	}
	console.log("光标夹取：", JSON.stringify(await app.evaluate<Record<string, unknown>>(`(() => {
		const field = document.querySelector("main textarea");
		const at = field.selectionStart;
		return {
			mark: [${caret.open}, ${caret.close + 1}],
			landed: at,
			// 往左走两下，应该已经整枚跨过去停在标记左边，而不是卡在里面
			insideAfterwards: at > ${caret.open} && at < ${caret.close + 1},
		};
	})()`), null, 1));

	/* 框住半枚，该自己长成整枚——复制走的和删掉的都得是完整的一枚。 */
	await app.evaluate(`(() => {
		const field = document.querySelector("main textarea");
		field.setSelectionRange(${caret.open + 3}, ${caret.close + 4});
		return true;
	})()`);
	await app.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39, modifiers: 8 });
	await app.send("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39, modifiers: 8 });
	await new Promise((r) => setTimeout(r, 300));
	console.log("选区扩展：", JSON.stringify(await app.evaluate<number[]>(`(() => {
		const field = document.querySelector("main textarea");
		return [field.selectionStart, field.selectionEnd];
	})()`)));

	/*
	 * 两条删除路径，各验一条。
	 *
	 * 图片在这一排上有自己的格子，按那个叉——标记跟着从句子里消失。文件不在这一排上，它的全部存在
	 * 就是句子里那枚标记，所以删法反过来：把那段字删掉，附件跟着卸下来。后一条是「双向」里的另一
	 * 个方向，也是文件唯一的删除入口。
	 */
	const before = await app.evaluate<string>(`document.querySelector("main textarea").value`);
	await app.evaluate(`(() => {
		const tile = document.querySelector("main .ly-composer [data-ly-attachment]");
		tile.querySelector('[data-ly-hover-reveal] button[aria-label^="移除"]').click();
		return true;
	})()`);
	await new Promise((r) => setTimeout(r, 700));
	console.log("按叉删图片：", JSON.stringify({
		before,
		after: await app.evaluate<string>(`document.querySelector("main textarea").value`),
		tilesLeft: await app.evaluate<number>(`document.querySelectorAll("main .ly-composer [data-ly-attachment]").length`),
	}, null, 1));

	/* 把那份 md 的标记从句子里删掉——附件该跟着走。 */
	const beforeText = await app.evaluate<string>(`document.querySelector("main textarea").value`);
	await app.evaluate(`(() => {
		const field = document.querySelector("main textarea");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, field.value.replace("【交接说明.md】", "").replace(/[ ]{2,}/g, " "));
		field.dispatchEvent(new Event("input", { bubbles: true }));
		return true;
	})()`);
	await new Promise((r) => setTimeout(r, 700));
	const removed = {
		before: beforeText,
		after: await app.evaluate<string>(`document.querySelector("main textarea").value`),
		/* 附件总数（不只是这一排上的）：文件卸没卸下来看的是它。 */
		attachmentsLeft: await app.evaluate<number>(
			`document.querySelectorAll("main .ly-composer [data-ly-attachment]").length + (document.querySelector("main textarea").value.match(/【/g) || []).length`,
		),
	};
	console.log("删标记卸文件：", JSON.stringify(removed, null, 1));

	/*
	 * 换一种界面语言。
	 *
	 * 「图片 1」是一句会翻译的话，而正文里那枚标记是放文件那天写下的。不跟着改写的话，界面换成英文
	 * 之后附件条上那一格叫 `Image 1`、句子里还写着 `【图片 1】`，两边一对不上，那枚标记就不再是标记。
	 */
	const beforeLocale = await app.evaluate<string>(`document.querySelector("main textarea").value`);
	await app.evaluate(`(async () => {
		const settings = await window.lyra.settings.get();
		await window.lyra.settings.save({ ...settings, uiLocale: "en" });
		return true;
	})()`);
	await new Promise((r) => setTimeout(r, 1500));
	console.log("换成英文：", JSON.stringify({
		before: beforeLocale,
		after: await app.evaluate<string>(`document.querySelector("main textarea").value`),
		/* 标记还认得出来吗——认不出就没有高亮，那一段会退回成普通文字。 */
		stillMarked: await app.evaluate<number>(`document.querySelectorAll("main .ly-composer .ly-attachment-token").length`),
		tiles: await app.evaluate<number>(`document.querySelectorAll("main .ly-composer [data-ly-attachment]").length`),
		firstTile: await app.evaluate<string>(
			`document.querySelector("main .ly-composer .ly-attachment-body")?.getAttribute("aria-label") ?? ""`,
		),
	}, null, 1));
	await writeFile(`${out}-en.png`, Buffer.from((await clip(app, "main .ly-composer")).data, "base64"));
	console.log(`wrote ${out}-en.png`);
	// 换回去，后面那几步的断言是按中文写的。
	await app.evaluate(`(async () => {
		const settings = await window.lyra.settings.get();
		await window.lyra.settings.save({ ...settings, uiLocale: "zh-CN" });
		return true;
	})()`);
	await new Promise((r) => setTimeout(r, 1200));

	await app.evaluate(`(() => {
		const field = document.querySelector("main textarea");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		// 接在标记后面，不是覆盖：气泡里那几枚标签正是这一步要看的东西。
		setter.call(field, field.value + " 这几个文件看一下");
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		return true;
	})()`);
	await new Promise((r) => setTimeout(r, 4500));

	const bubble = await app.evaluate<Record<string, unknown>>(READ_BUBBLE);
	console.log("气泡：", JSON.stringify(bubble, null, 1));
	await writeFile(`${out}-sent.png`, Buffer.from((await clip(app, "[data-question-index]", 18)).data, "base64"));
	console.log(`wrote ${out}-sent.png`);

	/*
	 * 改一个字再发一遍。
	 *
	 * 编辑改的是措辞，不是这条消息附了什么——而附件和 `displayText` 从前不跟着走，于是编辑一次
	 * 附件就从界面上消失一次。这一步要跨 5 层（组件 → store → preload → 主进程 → core），全是
	 * 透传，所以只要有一层漏掉参数，这里就看得见。
	 */
	await app.evaluate(`(() => {
		document.querySelector('[data-question-index] button[aria-label="编辑并重新发送"]').click();
		return true;
	})()`);
	await new Promise((r) => setTimeout(r, 700));
	await app.evaluate(`(() => {
		const field = document.querySelector("[data-question-index] textarea");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, "改一个字：这几个文件仔细看一下");
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		return true;
	})()`);
	await new Promise((r) => setTimeout(r, 4500));

	const edited = await app.evaluate<Record<string, unknown>>(READ_BUBBLE);
	console.log("编辑后：", JSON.stringify(edited, null, 1));
	await writeFile(`${out}-edited.png`, Buffer.from((await clip(app, "[data-question-index]", 18)).data, "base64"));
	console.log(`wrote ${out}-edited.png`);
} finally {
	await app.stop();
	model.closeAllConnections?.();
	await new Promise<void>((done) => {
		model.close(() => done());
		setTimeout(done, 1500);
	});
}
