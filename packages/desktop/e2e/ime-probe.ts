/* oxlint-disable no-console -- 一支说出它看见了什么的探针 */
/**
 * 正在打字的时候，句子里那些标记还在不在。
 *
 * 复现客户截的那一张：草稿里有一枚 `【Lyra界面改进-20260913095611.mp4】`，手一开始打拼音，
 * 整枚标记就塌回成一串方括号加文件名——直到这个字上了屏才变回来。中文每打一个字都要过一次组
 * 字，所以这不是偶发，而是「打中文的全过程里标记都是坏的」。
 *
 * 组字只有真输入法能产生，JS 派发的事件产生不了——`compositionstart` 可以伪造，但伪造出来的那
 * 个不会让 textarea 真的进到组字态，量出来的一切都不算数。所以这里走 CDP 的 `Input.imeSetComposition`，
 * 它走的是和输入法同一条路。
 *
 * 要答三个问题：
 *   1. 组字这一刻，受控的 `value` 里到底有没有那几个未上屏的字母（决定镜像层能不能对齐）；
 *   2. 镜像层这时还在不在，textarea 的字是不是变回了不透明（这就是「露出原文」的机制）；
 *   3. 改完之后，标记在组字的每一刻都还画着，而人照样看得见自己在打什么。
 *
 * 跑 `out/` 里的产物，改完代码要先 `pnpm build`。
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp } from "./app.ts";
import { frameGrabber } from "./record.ts";

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 860, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			appearance: { theme: process.env.LYRA_THEME === "dark" ? "dark" : "light" },
			permissionMode: "full",
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4525, token: null },
		}),
	);
}

/** 一张图进去，草稿里就有了一枚标记。 */
const DROP = `(async () => {
	const canvas = document.createElement("canvas");
	canvas.width = 320; canvas.height = 200;
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = "#3b5bdb"; ctx.fillRect(0, 0, 320, 200);
	const blob = await new Promise((done) => canvas.toBlob(done, "image/png"));
	const dt = new DataTransfer();
	dt.items.add(new File([blob], "Lyra界面改进-20260913095611.png", { type: "image/png" }));
	document.querySelector("main .ly-composer").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
	return true;
})()`;

/**
 * 这一刻屏幕上是什么。
 *
 * 问的是画出来的结果：标记的 span 在不在、它底下的背景色是不是真的画着、textarea 的字透不透明。
 * 只问「composing 这个 state 是 true 还是 false」答的是实现，不是人看见的东西。
 */
const LOOK = `(() => {
	const field = document.querySelector("main textarea");
	const shell = field.closest(".ly-composer");
	const mirror = shell.querySelector("[data-command-mirror]");
	const tokens = mirror ? [...mirror.querySelectorAll(".ly-attachment-token")] : [];
	const body = tokens[0] ? tokens[0].querySelector(".ly-token-body") : null;
	return {
		value: field.value,
		selection: [field.selectionStart, field.selectionEnd],
		mirrorPresent: Boolean(mirror),
		mirrorText: mirror ? mirror.innerText : null,
		tokensPainted: tokens.length,
		tokenBackground: body ? getComputedStyle(body).backgroundColor : null,
		tokenIcon: body ? getComputedStyle(body.querySelector(".ly-token-bracket"), "::before").backgroundImage.slice(0, 28) : null,
		// 这就是「露出原文」的机制：镜像层一撤，底下那行真字就不透明了。
		fieldColour: getComputedStyle(field).color,
		fieldHighlighted: field.getAttribute("data-highlighted"),
		// 人得看得见自己在打什么：组字那几个字母要么由 textarea 画，要么由镜像层画，总得有一处画。
		composedVisibleIn: mirror && mirror.innerText.includes("zhe") ? "mirror" : getComputedStyle(field).color === "rgba(0, 0, 0, 0)" ? "nowhere" : "field",
		// 那条「还没定下来」的下划线，画的是不是正好这几个字母。
		composedRun: (() => {
			const run = mirror ? mirror.querySelector(".ly-composing-token") : null;
			return run ? { text: run.textContent, line: getComputedStyle(run).textDecorationLine } : null;
		})(),
		/*
		 * 两层还对得齐吗。
		 *
		 * 镜像层多画了几个字母而底下那行没跟上的话，整段字会错开——而错开一两像素在截图上看着像抗锯
		 * 齿。所以量高度：镜像比 textarea 的内容高，就是它自己折了一行而底下没折。
		 */
		mirrorHeight: mirror ? Math.round(mirror.getBoundingClientRect().height) : null,
		fieldContentHeight: field.scrollHeight - 24,
		/*
		 * 输入框那一片的底色，到底是从哪一层来的。
		 *
		 * 组字那一段要盖住浏览器刷的高亮块，就得有一层自己的不透明底——而那层底必须和它周围是同一
		 * 个颜色，否则盖出来的是一个看得见的方块。所以得先问清楚周围是什么色，而不是照着变量名猜。
		 */
		backdrop: (() => {
			let node = field;
			while (node) {
				const paint = getComputedStyle(node).backgroundColor;
				if (paint && paint !== "rgba(0, 0, 0, 0)" && paint !== "transparent") return { from: node.className.slice(0, 40), paint };
				node = node.parentElement;
			}
			return null;
		})(),
		inkColour: getComputedStyle(field.closest(".ly-composer")).color,
	};
})()`;

const out = process.argv[2] ?? "/tmp/lyra-ime";
const app = await startApp({ port: 9476, seed });
const wire = await frameGrabber(9476);

async function shot(name: string) {
	const box = await wire.evaluate<{ x: number; y: number; width: number; height: number }>(`(() => {
		const r = document.querySelector("main .ly-composer").getBoundingClientRect();
		return { x: Math.round(r.left) - 16, y: Math.round(r.top) - 16, width: Math.round(r.width) + 32, height: Math.round(r.height) + 32 };
	})()`);
	const picture = await wire.send<{ data: string }>("Page.captureScreenshot", { format: "png", clip: { ...box, scale: 2 } });
	await writeFile(`${out}-${name}.png`, Buffer.from(picture.data, "base64"));
	console.log(`wrote ${out}-${name}.png`);
}

try {
	await new Promise((r) => setTimeout(r, 1600));
	await wire.evaluate(DROP);
	await new Promise((r) => setTimeout(r, 1400));

	// 光标落到句末，接着就在那儿打字——和人做的一样。
	const spot = await wire.evaluate<{ x: number; y: number }>(`(() => {
		const r = document.querySelector("main textarea").getBoundingClientRect();
		return { x: Math.round(r.right - 30), y: Math.round(r.top + 14) };
	})()`);
	await wire.send("Input.dispatchMouseEvent", { type: "mousePressed", x: spot.x, y: spot.y, button: "left", clickCount: 1 });
	await wire.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: spot.x, y: spot.y, button: "left", clickCount: 1 });
	await new Promise((r) => setTimeout(r, 300));

	console.log("组字前：", JSON.stringify(await wire.evaluate<Record<string, unknown>>(LOOK), null, 1));
	await shot("idle");

	// 一个字母一个字母地敲，和输入法收到的是同一串。
	for (const text of ["z", "zh", "zhe"]) {
		await wire.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
		await new Promise((r) => setTimeout(r, 260));
		console.log(`组字「${text}」：`, JSON.stringify(await wire.evaluate<Record<string, unknown>>(LOOK), null, 1));
	}
	await shot("composing");

	// 上屏。
	await wire.send("Input.insertText", { text: "这" });
	await new Promise((r) => setTimeout(r, 400));
	console.log("上屏后：", JSON.stringify(await wire.evaluate<Record<string, unknown>>(LOOK), null, 1));
	await shot("committed");

	/*
	 * 标记**前面**打字。
	 *
	 * 组字插在句首，标记整个往右挪——镜像层照着新的 value 画，位置得跟着挪。这一路和句末那一路走的
	 * 是同一段代码，但只有这一路会让标记的起止偏移在组字的每一刻都在变。
	 */
	await wire.evaluate(`(() => {
		const field = document.querySelector("main textarea");
		field.setSelectionRange(0, 0);
		return true;
	})()`);
	await new Promise((r) => setTimeout(r, 200));
	await wire.send("Input.imeSetComposition", { text: "hao", selectionStart: 3, selectionEnd: 3 });
	await new Promise((r) => setTimeout(r, 300));
	const ahead = await wire.evaluate<Record<string, unknown>>(LOOK);
	console.log("句首组字：", JSON.stringify(ahead, null, 1));
	await shot("ahead");
	await wire.send("Input.imeSetComposition", { text: "", selectionStart: 0, selectionEnd: 0 });
	await new Promise((r) => setTimeout(r, 300));

	/*
	 * 一句没有任何标记的白话。
	 *
	 * 这是绝大多数时候的样子，也是这次改动最不能碰坏的一路：没东西要画，镜像层就不铺，字由 textarea
	 * 自己画，组字走的是浏览器原来那条路。
	 */
	await wire.evaluate(`(() => {
		const field = document.querySelector("main textarea");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, "");
		field.dispatchEvent(new Event("input", { bubbles: true }));
		return true;
	})()`);
	await new Promise((r) => setTimeout(r, 400));
	await wire.send("Input.imeSetComposition", { text: "ni", selectionStart: 2, selectionEnd: 2 });
	await new Promise((r) => setTimeout(r, 300));
	console.log("白话组字：", JSON.stringify(await wire.evaluate<Record<string, unknown>>(LOOK), null, 1));
	await shot("plain");
} finally {
	wire.close();
	await app.stop();
}
