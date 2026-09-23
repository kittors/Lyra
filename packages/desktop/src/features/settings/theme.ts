/**
 * Runtime theming.
 *
 * Tailwind's `@theme` block emits the design tokens as CSS variables on `:root`. Overriding
 * those same variables at runtime is what makes the appearance page actually do something —
 * every surface in the app already reads from them.
 *
 * Only three colours are configurable (accent, background, foreground). The rest of the scale
 * is derived, so a user picking a background cannot end up with unreadable text or invisible
 * borders: surfaces step away from the background and text steps toward the foreground, both
 * scaled by the contrast slider.
 */

import type { AppearanceSettings } from "@lyra/core";
import { sharedHighlightStyle } from "../../lib/code/highlight.ts";
import { findCodeTheme } from "../../lib/code/themes.ts";
import { contentMeasure } from "../../lib/content-width.ts";
import { bridge } from "../../services/index.ts";
import { drawnUiFont } from "./appearance-defaults.ts";

interface Rgb {
	r: number;
	g: number;
	b: number;
}

export function applyAppearance(input: AppearanceSettings): void {
	/*
	 * The defaults are *not* merged in here, deliberately.
	 *
	 * That would mean importing a value from "@lyra/core", and the package root reaches `node:fs`
	 * — see the note in `ScheduledView.tsx`. The bundle would load and then throw on the first Node
	 * builtin, which is a worse failure than the one it set out to fix. Completeness is guaranteed
	 * at the two doors instead: `migrateAppearance` for settings read off disk, and `sync-rpc.ts`
	 * for settings arriving from a phone. What is left here is `parseHex` refusing to throw, so a
	 * field that slips through both is a wrong colour rather than a blank screen.
	 */
	const appearance = input;
	const root = document.documentElement;
	const dark = resolveDark(appearance.theme);

	const background = parseHex(dark ? appearance.darkBackground : appearance.lightBackground) ?? {
		r: 23,
		g: 23,
		b: 23,
	};
	const foreground = parseHex(dark ? appearance.darkForeground : appearance.lightForeground) ?? {
		r: 237,
		g: 237,
		b: 237,
	};
	const accent = appearance.accent;

	// 0–100 maps to a 0.5×–1.5× multiplier on every derived step.
	const strength = 0.5 + appearance.contrast / 100;

	/*
	 * Surfaces and rules are scaled apart, and only on a light theme.
	 *
	 * Both used to come off the same curve, which produced a scale where the rule (#ececed) was
	 * *paler* than the card it was meant to divide (#f0f0f0) — a border lighter than its own
	 * surface separates nothing, so every layer had to earn its separation by getting greyer
	 * instead. Stacked three deep that is where "the whole app looks grey" comes from.
	 *
	 * So on light: surfaces stay close to the page and the rules step well clear of it, which is
	 * how the apps this is measured against read as clean — white panels, visible hairlines.
	 * Dark themes already work the other way round: a surface lifts off the page by getting
	 * lighter, which is the same direction its text goes, and there the shared curve is correct.
	 */
	const SURFACE_ON_LIGHT = 0.45;
	const RULE_ON_LIGHT = 1.7;

	const surface = (step: number) =>
		toHex(mix(background, foreground, Math.min(0.9, step * strength * (dark ? 1 : SURFACE_ON_LIGHT))));
	const rule = (step: number) =>
		toHex(mix(background, foreground, Math.min(0.9, step * strength * (dark ? 1 : RULE_ON_LIGHT))));
	const text = (weight: number) => toHex(mix(background, foreground, Math.min(1, weight)));
	/** A wash of the foreground at a given opacity — reads against any backdrop, including none. */
	const veil = (alpha: number) => `color-mix(in srgb, ${toHex(foreground)} ${(alpha * 100).toFixed(1)}%, transparent)`;

	/**
	 * Fields read as paper: lighter than the page, never darker.
	 *
	 * Every other surface steps from the background toward the foreground, which is correct for
	 * cards and panels. Applied to an input on a light theme it goes the wrong way — the
	 * composer came out grey against a white page, when the thing you type into should be the
	 * brightest surface on screen. Dark themes step toward the foreground as usual; light ones
	 * step toward white, so a tinted background still yields a field that sits above it.
	 */
	const paper = dark ? surface(0.035) : toHex(mix(background, { r: 255, g: 255, b: 255 }, 0.65));

	/**
	 * Menus and popovers: the surface that floats above everything else.
	 *
	 * Same problem as `paper`, one step further. A menu derived by stepping toward the
	 * foreground came out darker than the page it floats over, and blurring a dark translucent
	 * panel over a light page just produces grey. Floating things are lighter than what they
	 * cover, in either theme.
	 */
	const float_ = dark ? surface(0.1) : toHex(mix(background, { r: 255, g: 255, b: 255 }, 0.8));

	const lightTheme = findCodeTheme(appearance.codeLightTheme, "light");
	const darkTheme = findCodeTheme(appearance.codeDarkTheme, "dark");
	/** Whichever of the two is in force right now, and the surface it resolves to. */
	const codeTheme = dark ? darkTheme : lightTheme;
	const codeSurface = codeTheme.inherit ? toHex(background) : codeTheme.background;
	const codeInk = codeTheme.inherit ? toHex(foreground) : codeTheme.foreground;

	/*
	 * 句子里那一小块代码，三种来源算成同两个值。
	 *
	 * 算在这里而不是写进 CSS，是因为三选一里只有一支是常量：`app` 要跟着对比度滑条走，`syntax`
	 * 要看当前是哪个语法主题、那个主题又是不是 `inherit`。CSS 表达不了「按 `inlineCode` 选一支」，
	 * 真写成三套选择器就是同一个决定散在两个文件里。
	 *
	 * `syntax` 这支不直接拿主题声明的 background：默认的 `lyra-light` / `lyra-dark` 是 `inherit`，
	 * 它的底色就是页面底色，照搬过来等于没有底——句子里那块代码会整个消失。所以统一往主题的字色
	 * 方向兑 8%：`inherit` 的主题得到一层淡灰，Solarized 那样自带底色的得到一块暖调，两种情况下
	 * 它都比它坐着的那张纸深一档。`--ly-code-bg-soft` 的 5% 是同一个思路，那是给整片区域用的，
	 * 这里是一小块，所以重一点。
	 */
	const inlineMode = appearance.inlineCode ?? "app";
	const inlineFg =
		inlineMode === "syntax"
			? codeInk
			: inlineMode === "custom"
				? ((dark ? appearance.inlineCodeDarkFg : appearance.inlineCodeLightFg) ?? toHex(foreground))
				: toHex(foreground);
	const inlineBg =
		inlineMode === "syntax"
			? `color-mix(in srgb, ${codeInk} 8%, ${codeSurface})`
			: inlineMode === "custom"
				? ((dark ? appearance.inlineCodeDarkBg : appearance.inlineCodeLightBg) ?? veil(dark ? 0.062 : 0.05))
				: veil(dark ? 0.062 : 0.05);

	const tokens: Record<string, string> = {
		"--color-shell": toHex(background),
		"--color-sidebar": surface(0.042),
		"--color-panel": surface(0.04),
		"--color-card": surface(0.06),
		"--color-card-hover": veil(dark ? 0.062 : 0.05),
		"--color-input": paper,
		"--color-elevated": veil(dark ? 0.1 : 0.085),
		"--color-float": float_,
		"--color-line": rule(0.075),
		"--color-line-soft": rule(0.05),
		/*
		 * The hairline for things that float: menus, popovers, anything over its own surface.
		 *
		 * `rule()` steps from the *page* background toward the foreground, which is right for a line
		 * drawn on the page and wrong for one drawn on a menu. A menu is `surface(0.1)` and the soft
		 * rule is `rule(0.05)` — so the separator was a step *darker* than the card it sat on, which
		 * in a dark theme is a line you cannot see at all. It was not a missing dark variant; it was
		 * the wrong frame of reference.
		 *
		 * A veil instead, like `--color-elevated` above: a wash of the foreground at a fixed opacity,
		 * which lands the same distance above whatever it is over. Slightly stronger than `elevated`
		 * because a hairline has one pixel to make its case.
		 */
		"--color-line-float": veil(dark ? 0.14 : 0.12),
		"--color-ink": toHex(foreground),
		"--color-ink-muted": text(0.62),
		"--color-ink-faint": text(0.4),
		"--color-accent": accent,
		"--color-info": accent,
		// The default widened with the faces Windows and Linux need for three weights; see `drawnUiFont`.
		"--ly-ui-font": drawnUiFont(appearance.uiFont),
		"--ly-code-font": appearance.codeFont,
		"--ly-ui-size": `${appearance.uiFontSize}px`,
		/*
		 * 界面的基准字重。层级比它重一档、两档，那几档在 `tokens.css` 里从这个数推出来。
		 *
		 * 和字号一样的回退理由：这一项是后加的，之前写下的设置文件里没有它，而那些界面一直是
		 * 400 画出来的。
		 */
		"--ly-ui-weight": String(appearance.uiFontWeight ?? 500),
		"--ly-code-size": `${appearance.codeFontSize}px`,
		/*
		 * The conversation's measure, read by every column that is part of it.
		 *
		 * One variable rather than one number per component: the transcript, the composer and the
		 * approval card have to agree, and they are three files that would otherwise be changed
		 * separately and eventually not.
		 */
		"--ly-content": contentMeasure(appearance.contentWidth),
		/*
		 * 空输入框的行数，读它的是输入框的 `min-height`。
		 *
		 * 走变量而不是走属性，是因为 `rows` 只有 textarea 有，而这条高度还要管到浮在它上面的
		 * 高亮镜像层；也因为改一次设置就该立刻看见，不必等下一次按键把高度重算一遍。
		 */
		"--ly-composer-lines": String(appearance.composerLines ?? 1),
		/*
		 * How code is set, beyond the family.
		 *
		 * Fallbacks rather than `??` on the settings object: these fields were added after the fact,
		 * and a settings file written before they existed has to keep rendering the way it did.
		 */
		"--ly-code-weight": String(appearance.codeFontWeight ?? 400),
		"--ly-code-line-height": String(appearance.codeLineHeight ?? 1.6),
		"--ly-code-tracking": `${appearance.codeLetterSpacing ?? 0}em`,
		/*
		 * The surface code is drawn on, which the theme has always declared and nothing ever read.
		 *
		 * `background` and `foreground` sat in `code-themes.ts` labelled "preview color" and were
		 * used by exactly one thing: the swatch on the settings page. So picking Solarized Light
		 * showed a warm yellow sample and left every real surface on the app's own white — the
		 * setting appeared to do nothing, because the most visible half of it did nothing.
		 *
		 * Every surface that draws code reads these: the editor and its gutter, fenced blocks in
		 * a reply, the diff viewer, and the terminal. That last one cannot use a variable — xterm
		 * paints to a canvas — so `TerminalPane` reads these two back out and pushes them in.
		 *
		 * `inherit` is what keeps 「Lyra 默认」 from repainting the window: it takes the app's own
		 * background, including a tinted one, so only the syntax colours come from the theme.
		 * Choosing Solarized Light is then an actual choice with an actual consequence, rather
		 * than something the app did to itself on first launch.
		 */
		"--ly-code-bg": codeSurface,
		"--ly-code-fg": codeInk,
		/*
		 * The gutter and the chrome around the code, one step off the code's own surface.
		 *
		 * Flat-on-flat loses the line numbers into the text when a theme's background is close to
		 * its foreground. Mixed rather than a second declared colour, so it follows any theme —
		 * including one added later — without needing a value per theme.
		 */
		"--ly-code-bg-soft": `color-mix(in srgb, ${codeInk} 5%, ${codeSurface})`,
		/*
		 * 行内代码那三个值，读它们的是 `markdown.css` 里的 `.prose-dw code`。
		 *
		 * 描边走 inset 阴影而不是 border：border 要占 1px，开关一次整段话的行距就跟着动一次。关掉
		 * 时给的是 `transparent` 而不是不给——不给的话 CSS 那边要写个 fallback，而 fallback 的值
		 * 迟早和这里算出来的不是一回事。
		 */
		"--ly-inline-code-bg": inlineBg,
		"--ly-inline-code-fg": inlineFg,
		"--ly-inline-code-ring": appearance.inlineCodeBorder
			? `color-mix(in srgb, ${inlineFg} 22%, transparent)`
			: "transparent",
		"--ly-diff-added-bg": dark ? darkTheme.addedBg : lightTheme.addedBg,
		"--ly-diff-removed-bg": dark ? darkTheme.removedBg : lightTheme.removedBg,
	};

	/*
	 * 关掉过渡，写变量，两帧后再放开——见 `motion.css` 里的 `data-theme-switching`。
	 *
	 * 不这样的话，一批变量瞬间写完，界面却分两拨响应：没有 transition 的地方立刻翻过去，带
	 * `transition-colors` 的控件用 150ms 慢慢爬。中间那段时间屏幕上同时有两个主题，这就是切换
	 * 深浅色时那股「卡卡的、不自然」。
	 *
	 * `beginRepaint` 里也顺手把窗口自己的底色一起换了，那同样是一处会晚到的颜色。
	 *
	 * **只在颜色真的变了的时候按。** 这个函数每一次外观设置改动都会跑——调字号、拖对话宽度、
	 * 改输入框行数，全都进来。而按住过渡的代价是 `transition: none !important` 落在每一个后代
	 * 上，两帧后才松开：拖一个滑条的时候新值一格接一格地来，它就一直挂着，整个界面在拖动期间
	 * 是没有过渡的。实测拖「输入框默认高度」，九十帧里有十帧被冻住，而那正是预览要长高的十帧。
	 *
	 * 名单是「会让屏幕上某处换颜色」的那几项，外加 `dark` 本身——跟随系统时它自己会翻。字号、
	 * 字体、宽度、行数不在其中：它们改的是尺寸，尺寸没有「两拨颜色分头到达」的问题。
	 */
	const palette = [
		dark,
		appearance.theme,
		appearance.accent,
		appearance.contrast,
		appearance.lightBackground,
		appearance.lightForeground,
		appearance.darkBackground,
		appearance.darkForeground,
		appearance.codeLightTheme,
		appearance.codeDarkTheme,
		/*
		 * 行内代码那几项也在名单里：它们换的是屏幕上一批小方块的底色和字色，正是「两拨颜色分头到
		 * 达」会被看出来的地方——一段回答里的行内代码往往有十几处，慢慢爬的那 150ms 里它们参差不齐。
		 *
		 * `uiFontWeight` 不在名单里，和字号、字体、宽度、行数一样：字重改的是字的形状，形状没有
		 * 过渡，按住它只会在改的那一下把整个界面的过渡一起冻掉。
		 */
		appearance.inlineCode,
		appearance.inlineCodeLightBg,
		appearance.inlineCodeLightFg,
		appearance.inlineCodeDarkBg,
		appearance.inlineCodeDarkFg,
		appearance.inlineCodeBorder,
	].join("|");
	if (palette !== lastPalette) {
		lastPalette = palette;
		beginRepaint(root);
	}

	for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);

	// Update shared highlight style in DOM
	sharedHighlightStyle(appearance.codeLightTheme, appearance.codeDarkTheme);

	/*
	 * The window itself has to know the theme, for two separate reasons.
	 *
	 * Windows and Linux draw their own controls into the title strip, which would otherwise
	 * stay dark over a light theme. And on every platform the window paints a backing colour
	 * that shows through whenever a resize outruns the renderer's reflow — dragging an edge
	 * quickly is exactly that, and a stale colour there is the black frame that flashes.
	 *
	 * 两件事两个颜色。那条 title strip 是 `.ly-window-header`，底色 `--color-sidebar`；窗口自己
	 * 那层底是 `--color-shell`。一个值服务两处的时候，Windows 的右上角就是一块比 header 浅一档的
	 * 补丁——取的是这里算好的那个 token，而不是再算一遍，公式只此一处。
	 */
	bridge.setWindowTheme?.({
		color: toHex(background),
		headerColor: tokens["--color-sidebar"],
		symbolColor: text(0.62),
	});

	root.classList.toggle("dark", dark);
	root.classList.toggle("light", !dark);
	/*
	 * Declared, not just implied by the class.
	 *
	 * The editor's syntax colours are written with `light-dark()`, which resolves against this
	 * property and nothing else — without it every token would take the light branch on a dark
	 * theme. It also gets form controls and scrollbars right for free.
	 */
	root.style.colorScheme = dark ? "dark" : "light";
	root.dataset.diffMarkers = appearance.diffMarkers;
	root.dataset.pointerCursor = String(appearance.pointerCursor);
	root.dataset.fontSmoothing = String(appearance.fontSmoothing);
	root.dataset.reduceMotion = appearance.reduceMotion;
}

/**
 * 把界面按住，直到新主题整个画完。
 *
 * 属性写在 `:root` 上，CSS 那边一条 `transition: none !important` 覆盖全部后代，所以不管有多少
 * 元素在过渡中，它们都会在这一帧直接落到新颜色上。
 *
 * 两帧才摘：第一帧是变量生效的那一帧，第二帧确认它已经上屏。只等一帧的话，浏览器有时候会把摘除
 * 和上色并到同一帧里处理，过渡又跑起来了——那正是要避免的东西。
 *
 * 一直挂着不摘也不行：`transition: none` 会顺带干掉悬停、聚焦这些跟主题无关的过渡，整个界面从此
 * 硬邦邦的。它只该管切换的那一下。
 */
let releaseRepaint = 0;
/** 上一次按住过渡时屏幕上是哪套颜色。空串保证第一次上色照按不误。 */
let lastPalette = "";

function beginRepaint(root: HTMLElement): void {
	root.dataset.themeSwitching = "";
	cancelAnimationFrame(releaseRepaint);
	releaseRepaint = requestAnimationFrame(() => {
		releaseRepaint = requestAnimationFrame(() => {
			delete root.dataset.themeSwitching;
		});
	});
}

/** Re-apply on system scheme changes while the theme is set to follow the system. */
export function watchSystemTheme(getAppearance: () => AppearanceSettings): () => void {
	const query = window.matchMedia("(prefers-color-scheme: dark)");
	const onChange = () => {
		if (getAppearance().theme === "system") applyAppearance(getAppearance());
	};
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
}

function resolveDark(theme: AppearanceSettings["theme"]): boolean {
	if (theme === "dark") return true;
	if (theme === "light") return false;
	return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function parseHex(hex: string | undefined | null): Rgb | null {
	// Null rather than a throw for anything that is not a colour, including nothing at all: every
	// caller already has a fallback for an unparseable one, and none of them expect an exception.
	if (typeof hex !== "string") return null;
	const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
	if (!match) return null;
	let value = match[1];
	if (value.length === 3) value = value.split("").map((c) => c + c).join("");
	return {
		r: Number.parseInt(value.slice(0, 2), 16),
		g: Number.parseInt(value.slice(2, 4), 16),
		b: Number.parseInt(value.slice(4, 6), 16),
	};
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
	const t = Math.max(0, Math.min(1, amount));
	return {
		r: Math.round(from.r + (to.r - from.r) * t),
		g: Math.round(from.g + (to.g - from.g) * t),
		b: Math.round(from.b + (to.b - from.b) * t),
	};
}

function toHex({ r, g, b }: Rgb): string {
	return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`;
}

/** Readable text colour for a swatch, so a hex chip stays legible on any background. */
export function contrastingInk(hex: string): string {
	const rgb = parseHex(hex);
	if (!rgb) return "#ffffff";
	// Relative luminance, sRGB coefficients.
	const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
	return luminance > 0.6 ? "#1a1c1f" : "#ffffff";
}

/**
 * 在给定底色上读得清、而且看着还是一家人的字色。
 *
 * 和上面那个 `contrastingInk` 的区别是它只答两个值——纯黑或纯白，够一枚色块用，不够一段文字用。
 * 把一块浅橙底配上纯黑，读是读得清，但那是两个不相干的颜色凑在一起；而行内代码是嵌在句子里的，
 * 一眼看过去先看到的是「协不协调」。
 *
 * 所以走 HSL，只动亮度和饱和度，色相原样留着：浅橙底配深橙字，淡蓝底配深蓝字。
 *
 * 饱和度两头不一样，因为人眼对它的反应两头也不一样：
 *
 *   浅底配深字   往上提。深色本来就吃饱和度，照搬底色那点淡淡的橙，出来是一团看不出颜色的深灰
 *   深底配浅字   往下压。亮色配高饱和是荧光笔，盯着一段话里十几处那样的东西是折磨
 *
 * 亮度从两头起步（0.12 / 0.93），不跟着底色浮动：跟着浮动的那一版在中间调的底色上会挑出一个
 * 只差两三档的字色，算出来对比度是够的，画在屏幕上是一块糊的。
 *
 * **深浅两头都算一遍，取读得更清的那个，而不是按底色的亮度挑一头。** 按 HSL 的 `l` 挑会挑错边，
 * 这是量出来的：一个饱和的黄 `#D6C300` 在 HSL 里 `l` 只有 0.42，判作深底、配上浅字，而它看上去
 * 比白纸还扎眼——全色域扫一遍，照 `l` 判有 1476 个底色配出低于 4.5:1 的字，最低到 1.07，也就是
 * 一整片认不出字来。HSL 的亮度和眼睛看到的亮度是两回事，而这个函数要答的是后者。
 *
 * 选定方向之后还要往极端推：`#B34700` 那样的深橙配 0.93 的浅字只有 4.7:1，刚擦着 AA 过去，再深
 * 一点的底就过不去了。中性灰那一带两头都够不到 4.5，那是物理，推到头取最好的那个。
 */
export function readableInk(background: string): string {
	const rgb = parseHex(background);
	if (!rgb) return "#1a1c1f";
	const { h, s } = toHsl(rgb);
	/*
	 * 两头各自推到底，然后比终点——不是比起点。
	 *
	 * 比起点的那一版栽在橄榄绿 `#828C0A` 上：深字起点 3.30、浅字起点 3.26，几乎打平，于是挑了
	 * 浅的那头；而这两头能走到的地方差得远，深的一路推到纯黑有 5.70，浅的推到纯白只有 3.68。
	 * 起点接近不代表终点接近，中间调的饱和色恰恰是两者最不相干的地方。
	 */
	const deep = settle(rgb, { h, s: Math.min(s * 1.6, 0.85), l: 0.12 }, -0.03);
	const pale = settle(rgb, { h, s: Math.min(s * 0.9, 0.35), l: 0.93 }, 0.03);
	return toHex(contrast(rgb, deep) >= contrast(rgb, pale) ? deep : pale);
}

/**
 * 从起点往一头推，过了线就停。
 *
 * AA 的正文线是 4.5:1，行内代码的字号比正文还小一档，所以这是下限不是目标——够了就不再推，
 * 免得把一块本来协调的深橙硬推成纯黑。推到头还不够的那一带（中性灰、中间调的饱和色）是物理，
 * 调用方拿两头里好的那个。
 */
function settle(background: Rgb, from: Hsl, step: number): Rgb {
	let ink = fromHsl(from);
	for (let l = from.l; contrast(background, ink) < 4.5 && l > 0 && l < 1; ) {
		l = Math.max(0, Math.min(1, l + step));
		ink = fromHsl({ ...from, l });
	}
	return ink;
}

/** WCAG 对比度，1 到 21。 */
function contrast(a: Rgb, b: Rgb): number {
	const [bright, dim] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
	return (bright + 0.05) / (dim + 0.05);
}

function relativeLuminance({ r, g, b }: Rgb): number {
	// sRGB 要先解伽马再加权，直接拿 0.2126R+0.7152G+0.0722B 算的是另一回事（见 `contrastingInk`，
	// 那里只需要分个明暗，够用）。
	const channel = (value: number) => {
		const v = value / 255;
		return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

interface Hsl {
	/** 0–360 */
	h: number;
	/** 0–1 */
	s: number;
	/** 0–1 */
	l: number;
}

function toHsl({ r, g, b }: Rgb): Hsl {
	const red = r / 255;
	const green = g / 255;
	const blue = b / 255;
	const max = Math.max(red, green, blue);
	const min = Math.min(red, green, blue);
	const l = (max + min) / 2;
	const delta = max - min;
	// 灰色没有色相可言，问它是多少只会拿到除零的结果。
	if (delta === 0) return { h: 0, s: 0, l };
	const s = delta / (1 - Math.abs(2 * l - 1));
	const h =
		max === red
			? 60 * (((green - blue) / delta) % 6)
			: max === green
				? 60 * ((blue - red) / delta + 2)
				: 60 * ((red - green) / delta + 4);
	return { h: (h + 360) % 360, s, l };
}

function fromHsl({ h, s, l }: Hsl): Rgb {
	const c = (1 - Math.abs(2 * l - 1)) * s;
	const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
	const m = l - c / 2;
	const [r, g, b] =
		h < 60
			? [c, x, 0]
			: h < 120
				? [x, c, 0]
				: h < 180
					? [0, c, x]
					: h < 240
						? [0, x, c]
						: h < 300
							? [x, 0, c]
							: [c, 0, x];
	return { r: Math.round((r + m) * 255), g: Math.round((g + m) * 255), b: Math.round((b + m) * 255) };
}
