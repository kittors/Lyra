/**
 * 哪一张画面是哪一块屏幕。
 *
 * `desktopCapturer.getSources({types:["screen"]})` 一次把所有屏幕都拍下来，然后要在里面挑出
 * 「光标所在的那一块」。官方给的办法是 `source.display_id === String(display.id)`，而这条在
 * Windows 上并不总是成立——Electron 自己的实现说得很清楚（v43，`electron_api_desktop_capturer.cc`）：
 *
 *   screen_sources.emplace_back(list->GetSource(i), std::string());   // display_id 初始是空串
 *   #if BUILDFLAG(IS_WIN)
 *     if (using_directx_capturer_) { …按显示器设备名填 display_id… }
 *   #elif BUILDFLAG(IS_MAC)
 *     …一律填…
 *
 * 也就是说 Windows 上只有 DirectX 抓屏这一条路会填 `display_id`，走 GDI 的时候它**永远是空串**。
 * `ScreenCapturerWinDirectx::IsSupported()` 在远程桌面、虚拟机、以及副屏挂在另一块显卡上的机器
 * （双显卡笔记本外接显示器，正是多屏用户最常见的那种配置）上会是 false。就算它是 true，DXGI 也
 * 只枚举得到同一块适配器上的输出，配不上的那些 `display_id` 同样是空串。
 *
 * 空串配不上任何显示器 id，于是原来的 `?? sources[0]` 兜底会拿到**第一块屏幕**——通常是主屏。
 * 表现出来就是：在副屏上按快捷键，遮罩正确地盖住了副屏，画面却是主屏的内容。用户会把这句话说成
 * 「截图不能跨屏幕」。
 *
 * 所以挑选这件事不能只有一条依据。这里按可靠程度排了四道，每一道都说得出自己凭什么：
 *
 *   1. `display_id` 对上了——macOS 和 Windows-DirectX 走这条，最准；
 *   2. 位次对上了——两个平台的屏幕列表都来自同一次 `EnumDisplayMonitors` / 同一份显示器枚举，
 *      顺序是一致的。只在数量相同、且那一位的画面形状也对得上时才认；
 *   3. 形状唯一——只有一块屏幕是这个长宽比，那就是它；
 *   4. 位次对上、形状对不上——比 `sources[0]` 强，因为它至少考虑了「你要的是第几块」。
 *
 * 挑出来的结果带着「凭哪一条挑的」，写进抓屏日志。下一次再有人报「截错屏幕了」，日志里直接就有
 * 答案，不必再靠猜。
 *
 * 纯算术，没有 Electron——所以它能被测（`test/screenshot-display-source.test.ts`），而上面那四条
 * 规则恰好都是「看着对、其实分情况」的那种，正是值得测而不是值得点的。
 */

/** 一个屏幕源，只留挑选用得上的那几项。`desktopCapturer` 的返回值是它的超集。 */
export interface ScreenSource {
	/** 形如 `screen:0:0`。挑不出来的时候写进日志，用来对照。 */
	id: string;
	/** Electron 给的显示器 id，字符串。Windows 走 GDI 时是空串——见文件头。 */
	display_id: string;
	/** 这张画面的实际像素尺寸，`nativeImage.getSize()` 的结果。 */
	size: { width: number; height: number };
}

/** 一块屏幕，同样只留用得上的。 */
export interface DisplayShape {
	id: number;
	bounds: { width: number; height: number };
	scaleFactor: number;
}

/** 凭哪一条挑出来的。写进日志，不参与判断。 */
type SourcePick = "display-id" | "only-one" | "index" | "shape" | "index-mismatched" | "first";

export interface SourceChoice {
	index: number;
	how: SourcePick;
}

/**
 * 两个长宽比算不算同一个。
 *
 * 千分之五：`desktopCapturer` 把画面缩放到请求的框里时是按整数像素取整的，一块 2940×1912 的屏
 * 缩到 1470×956 再算回来，末位会差一点点。比这更松就会把 16:10 和 16:9 混为一谈（1.6 与 1.778
 * 差得远，但 3440×1440 的 2.389 和 21:9 的 2.333 只差 2.4%）。
 */
const ASPECT_TOLERANCE = 0.005;

function aspect(size: { width: number; height: number }): number {
	return size.height > 0 ? size.width / size.height : 0;
}

function sameShape(source: ScreenSource, display: DisplayShape): boolean {
	const wanted = aspect(display.bounds);
	const got = aspect(source.size);
	if (!(wanted > 0) || !(got > 0)) return false;
	return Math.abs(got - wanted) <= ASPECT_TOLERANCE * wanted;
}

/**
 * 在一堆屏幕画面里挑出目标显示器的那一张。
 *
 * 空列表返回 null——没有画面可挑，调用方该报「拿不到屏幕」而不是拿一张错的。
 */
export function pickDisplaySource(
	sources: readonly ScreenSource[],
	displays: readonly DisplayShape[],
	targetId: number,
): SourceChoice | null {
	if (sources.length === 0) return null;

	// 1. display_id 对上了。空串不算「对上」——那是「没填」，不是「不是这一块」。
	const byId = sources.findIndex((source) => source.display_id !== "" && source.display_id === String(targetId));
	if (byId >= 0) return { index: byId, how: "display-id" };

	// 2. 只有一张画面，那它就是全部。单屏机器走的是这条，一句话说完。
	if (sources.length === 1) return { index: 0, how: "only-one" };

	const target = displays.find((display) => display.id === targetId);
	const at = displays.findIndex((display) => display.id === targetId);
	const alignable = at >= 0 && sources.length === displays.length;

	// 3. 位次对上，并且那一位的画面形状也对得上。两个条件都要，因为位次本身是个约定而不是保证。
	if (alignable && target && sameShape(sources[at]!, target)) return { index: at, how: "index" };

	// 4. 只有一张画面是这个形状。分辨率不同的两块屏（很常见：笔记本 16:10 外接 16:9）走这条。
	if (target) {
		const shaped = sources.reduce<number[]>((found, source, index) => (sameShape(source, target) ? [...found, index] : found), []);
		if (shaped.length === 1) return { index: shaped[0]!, how: "shape" };
	}

	// 5. 位次对上、形状对不上：多半是画面被缩放到了请求的那个框里（`getSources` 的 thumbnailSize
	//    是所有源共用的），而不是顺序错了。仍然比「拿第一张」强——它至少问了「你要第几块」。
	if (alignable) return { index: at, how: "index-mismatched" };

	return { index: 0, how: "first" };
}

/**
 * canvas 认识的两个色彩空间，抓屏的那一帧属于哪个。
 *
 * 抓回来的是显示器帧缓冲里的原始数值，而那串数值属于**显示器的**色彩空间，不是 sRGB。一台
 * Display P3 的 Mac 上，屏幕上的纯红在帧里是 234,51,35——同一个红色，另一套坐标。把它当 sRGB
 * 画进 canvas，浏览器会再替我们做一次 sRGB→P3 的转换才送去显示，于是这个红被扩了一道：截出来
 * 比屏幕上更艳。这就是有人报的「截图有色差」，`e2e/capture-colour-probe.mjs` 把它量成了数字：
 * 六个彩色块全部落在 P3 数值上（偏差 0），三个灰阶块分毫不差——中性轴在两个空间里是重合的，
 * 所以「灰对了、彩色不对」正好说明问题出在色域而不是别处。
 *
 * Electron 的 `Display.colorSpace` 是一串描述，形如
 * `{primaries:P3, transfer:…, matrix:RGB, range:FULL}`。canvas 那边只有两个可选值，所以这里也
 * 只需要答出两个。BT.2020 归到 P3：canvas 给不了更宽的，而 P3 比 sRGB 离它近得多。
 *
 * 认不出来时答 sRGB。那是没有色彩管理的显示器的答案，也是这一整条链路在这次改动之前的行为——
 * 拿不准的时候，退回原样比赌一个更宽的色域安全。
 */
export function canvasColorSpace(colorSpace: string | undefined): "srgb" | "display-p3" {
	if (!colorSpace) return "srgb";
	const primaries = /primaries:\s*([A-Za-z0-9_.-]+)/.exec(colorSpace)?.[1] ?? "";
	if (/^P3/i.test(primaries) || /display[_-]?p3/i.test(primaries)) return "display-p3";
	if (/2020/.test(primaries)) return "display-p3";
	return "srgb";
}
