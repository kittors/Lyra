/* oxlint-disable no-console -- a probe CLI whose entire output is what it printed */

/**
 * 抓屏抓回来的颜色，和屏幕上本来那个颜色，是不是同一个。
 *
 * 有人报截图之后颜色变了——同一块区域，截出来和屏幕上看着不一样，而微信截图没有这个问题。这个
 * 探针把那句话变成一个数：开一个铺满屏幕的窗口，画上一排数值已知的纯色，用截图走的那条路
 * （`desktopCapturer` → `nativeImage.toBitmap()`）把屏幕抓回来，读出每一块的像素值，跟画上去的
 * 那个值逐个对。
 *
 * 会读到什么，取决于系统交出来的那一帧是哪个色彩空间的：
 *
 *   - 读到 (255, 0, 0)：帧是 sRGB 的，或者链路上已经转过一道。截图里没有色差。
 *   - 读到 (234, 51, 35) 上下：帧是 Display P3 的。这是同一个红色在 P3 里的数值——数值变了，颜色
 *     没变。问题出在下游：把这串数当成 sRGB 画进 canvas，浏览器会再替我们转一次到 P3 去显示，
 *     于是那个红被「扩」了一道，看上去比屏幕上更艳。
 *
 * 灰阶那几块是对照：两个色彩空间的中性轴是同一条，所以纯灰无论如何都该原样回来。灰对了而彩色
 * 不对，那就确凿是色域的事，不是亮度曲线或者别的什么。
 *
 * 跑：`pnpm exec electron e2e/capture-colour-probe.mjs`
 * 头一回跑要给屏幕录制权限——这个进程是 Electron 自己，不是打包出来的 Lyra，系统按两个应用算。
 */

import { app, BrowserWindow, desktopCapturer, screen, systemPreferences } from "electron";

/** 画上去的那些颜色，和它们在 Display P3 里对应的数值——用来认出「读到的是 P3」。 */
const SWATCHES = [
	{ name: "红", css: "#FF0000", srgb: [255, 0, 0], p3: [234, 51, 35] },
	{ name: "绿", css: "#00FF00", srgb: [0, 255, 0], p3: [117, 251, 76] },
	{ name: "蓝", css: "#0000FF", srgb: [0, 0, 255], p3: [0, 0, 245] },
	{ name: "黄", css: "#FFFF00", srgb: [255, 255, 0], p3: [255, 255, 90] },
	{ name: "青", css: "#00FFFF", srgb: [0, 255, 255], p3: [125, 252, 254] },
	{ name: "品红", css: "#FF00FF", srgb: [255, 0, 255], p3: [238, 60, 253] },
	// 中性轴：两个色彩空间在这条线上重合，所以这三块无论如何都该原样回来。
	{ name: "白", css: "#FFFFFF", srgb: [255, 255, 255], p3: [255, 255, 255] },
	{ name: "中灰", css: "#808080", srgb: [128, 128, 128], p3: [128, 128, 128] },
	{ name: "黑", css: "#000000", srgb: [0, 0, 0], p3: [0, 0, 0] },
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function page() {
	const cells = SWATCHES.map(
		(swatch, index) =>
			`<div style="position:absolute;left:0;top:${(index / SWATCHES.length) * 100}%;width:100%;height:${100 / SWATCHES.length}%;background:${swatch.css}"></div>`,
	).join("");
	/*
	 * 不留任何渐变、圆角和抗锯齿——每一块内部都是同一个数值，取样点落在哪儿都一样。
	 *
	 * `color-scheme: only light` 是防系统深色模式给页面加一层反色滤镜；那会让读到的数跟画上去的
	 * 对不上，而原因跟色彩空间毫无关系。
	 */
	return `data:text/html,${encodeURIComponent(
		`<!doctype html><html><head><meta name="color-scheme" content="only light"></head><body style="margin:0;background:#000;overflow:hidden">${cells}</body></html>`,
	)}`;
}

async function main() {
	if (process.platform === "darwin" && systemPreferences.getMediaAccessStatus("screen") !== "granted") {
		await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width: 1, height: 1 } }).catch(() => []);
		console.log("没有屏幕录制权限。系统应该已经弹了框——给了之后重跑一次（权限对已经启动的进程不生效）。");
		app.quit();
		return;
	}

	const display = screen.getPrimaryDisplay();
	const { bounds } = display;
	const scaleFactor = display.scaleFactor || 1;

	const win = new BrowserWindow({
		x: bounds.x,
		y: bounds.y,
		width: bounds.width,
		height: bounds.height,
		frame: false,
		hasShadow: false,
		alwaysOnTop: true,
		enableLargerThanScreen: true,
		show: false,
		backgroundColor: "#000000",
	});
	win.setAlwaysOnTop(true, "screen-saver");
	win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
	win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
	await win.loadURL(page());
	win.showInactive();
	// 让合成器把这一帧真的推上屏幕。抓的是屏幕，不是页面——页面画完不等于屏幕上有。
	await wait(700);

	const sources = await desktopCapturer.getSources({
		types: ["screen"],
		thumbnailSize: { width: Math.round(bounds.width * scaleFactor), height: Math.round(bounds.height * scaleFactor) },
		fetchWindowIcons: false,
	});
	const source = sources.find((candidate) => candidate.display_id === String(display.id)) ?? sources[0];
	const image = source.thumbnail;
	const size = image.getSize();
	// 截图走的就是这条路：原始 BGRA，然后自己换成 RGBA。这里照抄，才量得到同一条链路。
	const pixels = image.toBitmap();

	const read = (x, y) => {
		const at = (y * size.width + x) * 4;
		return [pixels[at + 2], pixels[at + 1], pixels[at + 0], pixels[at + 3]];
	};

	win.hide();

	const rows = SWATCHES.map((swatch, index) => {
		// 每一块的正中间，横向也取中间——避开边缘可能的一两个过渡像素。
		const y = Math.round(((index + 0.5) / SWATCHES.length) * size.height);
		const x = Math.round(size.width / 2);
		const [r, g, b, a] = read(x, Math.min(size.height - 1, y));
		const dist = (to) => Math.round(Math.hypot(r - to[0], g - to[1], b - to[2]));
		return {
			块: swatch.name,
			画上去: swatch.css,
			读回来: `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase()}`,
			rgba: `${r},${g},${b},${a}`,
			离sRGB: dist(swatch.srgb),
			离P3: dist(swatch.p3),
		};
	});

	console.log("");
	console.log(`显示器 ${display.id} ${bounds.width}×${bounds.height} @${scaleFactor}x，抓回来 ${size.width}×${size.height}`);
	console.log(`色深 ${display.colorDepth} 位，颜色空间 ${display.colorSpace ?? "(未报告)"}`);
	console.log("");
	console.table(rows);

	const colour = rows.filter((row) => !["白", "中灰", "黑"].includes(row.块));
	const grey = rows.filter((row) => ["白", "中灰", "黑"].includes(row.块));
	const worstColour = Math.max(...colour.map((row) => row.离sRGB));
	const worstGrey = Math.max(...grey.map((row) => row.离sRGB));
	const nearerP3 = colour.filter((row) => row.离P3 < row.离sRGB).length;

	console.log("");
	console.log(`彩色块离 sRGB 最远 ${worstColour}；灰阶块离 sRGB 最远 ${worstGrey}`);
	console.log(`${nearerP3}/${colour.length} 个彩色块更靠近 Display P3 的数值`);
	if (worstColour <= 3) {
		console.log("→ 抓回来的就是画上去的：这条链路上没有色彩空间转换，色差不在这里。");
	} else if (nearerP3 >= colour.length - 1 && worstGrey <= 3) {
		console.log("→ 帧是 Display P3 的：数值变了、颜色没变。把它当 sRGB 画进 canvas 才是色差的来源。");
	} else {
		console.log("→ 对不上任何一种已知情形，把上面这张表整个留下来。");
	}

	await roundTrip(win, pixels, size, SWATCHES.length);

	app.quit();
}

/**
 * 抓回来的那串数走完渲染端那条路，还是不是屏幕上那个颜色。
 *
 * 上半场只证明了「抓回来的数是 P3 的」。这半场证明改动确实接上了：同一串数分别按新旧两种做法
 * 走一遍——旧的是 `new ImageData(…)` 不带 colorSpace、画进默认画布，新的是两头都声明 P3——然后
 * 都问同一个问题：把它读成 sRGB，得到的是不是当初画上去的那个值。
 *
 * 还要看交出去的文件。`toDataURL` 会按画布的色彩空间给 PNG 写上对应的 ICC（`iCCP`）或者色彩点
 * 位标记（`cICP`）；没有标记的 P3 数值就是一张骗人的图——它在任何看图软件里都会被当 sRGB 读。
 * 所以这里连 PNG 的 chunk 一起数。
 *
 * 在窗口自己的页面里跑：渲染端那条路要的是一个真的浏览器环境，主进程里没有 canvas。
 */
async function roundTrip(win, pixels, size, rows) {
	// 只把第一块（红）的那一个像素送过去——要验的是色彩空间的换算，不是搬多少字节。
	const y = Math.round((0.5 / rows) * size.height);
	const at = (y * size.width + Math.round(size.width / 2)) * 4;
	const rgba = [pixels[at + 2], pixels[at + 1], pixels[at + 0], pixels[at + 3]];

	const report = await win.webContents.executeJavaScript(`(() => {
		const raw = ${JSON.stringify(rgba)};
		const read = (space) => {
			const canvas = document.createElement("canvas");
			canvas.width = 1; canvas.height = 1;
			const ctx = canvas.getContext("2d", { colorSpace: space });
			ctx.putImageData(new ImageData(new Uint8ClampedArray(raw), 1, 1, { colorSpace: space }), 0, 0);
			const asSrgb = Array.from(ctx.getImageData(0, 0, 1, 1, { colorSpace: "srgb" }).data).slice(0, 3);
			const url = canvas.toDataURL("image/png");
			const bytes = atob(url.slice(url.indexOf(",") + 1));
			let chunks = "";
			for (let i = 0; i < bytes.length; i++) chunks += bytes[i];
			return {
				space: ctx.getContextAttributes().colorSpace,
				asSrgb,
				iCCP: chunks.includes("iCCP"),
				cICP: chunks.includes("cICP"),
				bytes: bytes.length,
				url,
			};
		};
		return { before: read("srgb"), after: read("display-p3") };
	})()`);

	const hex = (v) => `#${v.map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
	const off = (v) => Math.round(Math.hypot(v[0] - 255, v[1] - 0, v[2] - 0));

	console.log("");
	console.log(`抓回来的那个红：${hex(rgba.slice(0, 3))}，它在屏幕上是 #FF0000`);
	console.table({
		"改之前（当 sRGB 用）": { "画布空间": report.before.space, "读成 sRGB": hex(report.before.asSrgb), "离 #FF0000": off(report.before.asSrgb), "PNG 带 ICC": report.before.iCCP || report.before.cICP },
		"改之后（声明 P3）": { "画布空间": report.after.space, "读成 sRGB": hex(report.after.asSrgb), "离 #FF0000": off(report.after.asSrgb), "PNG 带 ICC": report.after.iCCP || report.after.cICP },
	});
	console.log("");
	if (off(report.after.asSrgb) <= 3 && off(report.before.asSrgb) > 20) {
		console.log("→ 声明了色彩空间之后，这串数读回来就是屏幕上那个颜色；不声明的时候差得很远。修对了。");
	} else if (off(report.before.asSrgb) <= 3) {
		console.log("→ 这台机器上两种做法结果一样（多半是 sRGB 显示器），这条链路本来就没有色差。");
	} else {
		console.log("→ 声明之后仍然对不上，整张表留下来看。");
	}
	if (!report.after.iCCP && !report.after.cICP) {
		console.log("⚠ P3 画布导出的 PNG 里没有找到 iCCP/cICP——文件本身没带色彩标记，别处打开会偏色。");
	}
	console.log("");

	/*
	 * 最后一段：这张 PNG 交给剪贴板之前，要先过一道 `nativeImage.createFromBuffer`。
	 *
	 * 落盘那一路是把 PNG 的字节原样写出去，标记跟着走，没有可担心的。剪贴板不是——它先被解码成
	 * 位图。解码时把 ICC 应用掉、数值换算成 sRGB 是对的（255,0,0）；把 ICC 扔掉、数值原样留下才
	 * 是灾难（234,51,35 被当成 sRGB），而这两种情况从外面看一模一样，只有把像素读出来才分得清。
	 */
	const png = Buffer.from(report.after.url.slice(report.after.url.indexOf(",") + 1), "base64");
	const decoded = (await import("electron")).nativeImage.createFromBuffer(png);
	const bytes = decoded.toBitmap();
	const back = [bytes[2], bytes[1], bytes[0]];
	const drift = Math.round(Math.hypot(back[0] - 255, back[1] - 0, back[2] - 0));
	console.log(`剪贴板那一路：nativeImage 解出来是 ${hex(back)}（${decoded.getSize().width}×${decoded.getSize().height}）`);
	if (drift <= 3) console.log("→ 解码时把 P3 换算成了 sRGB：粘出来就是屏幕上那个颜色。");
	else if (Math.hypot(back[0] - rgba[0], back[1] - rgba[1], back[2] - rgba[2]) <= 3) {
		console.log("⚠ 数值原样留着（还是 P3 那串）。如果解码时把标记丢了，粘出来会偏色——需要另想办法。");
	} else console.log("→ 对不上任何一种已知情形，把这一行留下来。");
	console.log("");
}

app.whenReady().then(() =>
	main().catch((error) => {
		console.error(error);
		app.exit(1);
	}),
);
app.on("window-all-closed", () => {});
