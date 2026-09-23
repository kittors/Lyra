/**
 * 外观页对「默认」的复述，两处：代码外观那一节的恢复默认，和整页的恢复默认。
 *
 * 复述而不是从 `@lyra/core` 导入，这是构建上的约束，不是偏好：从那个包里导入一个*值*会把整包
 * ——连同原生模块——拖进渲染进程的 bundle，构建直接失败。（类型是免费的，值要钱。）任务条的
 * `isResumable` 栽在同一条上。
 *
 * 抄一份只在有人盯着的时候才安全，盯着的是 `test/appearance-defaults.test.ts`。**这不是一句
 * 客套话：** `FACTORY_APPEARANCE` 以前写在组件里、没人比对，`theme` 就在那儿停在 `dark` 没跟上
 * ——core 那边早就改成跟随系统了。于是「恢复默认」把一台浅色系统上的机器按成深色，而设置页上那
 * 三张卡片里选中的也是深色，看上去就像这个应用压根没有「跟随系统」这回事。
 *
 * 所以它从组件里搬到了这里：组件导不进测试（会连整个 React 一起拖进来），模块可以。
 */

import type { AppearanceSettings as Appearance } from "@lyra/core";

/** 「代码外观」那一节按下恢复默认，放回来的东西。 */
export const CODE_DEFAULTS = {
	codeLightTheme: "lyra-light",
	codeDarkTheme: "lyra-dark",
	codeFont:
		'"JetBrains Mono Variable", ui-monospace, "SF Mono", SFMono-Regular, Menlo, "PingFang SC", monospace',
	codeFontSize: 12,
	codeFontWeight: 400,
	codeLineHeight: 1.6,
	codeLetterSpacing: 0,
	/*
	 * 行内代码也在这一节里，所以也归这颗按钮管。
	 *
	 * 配色调花了想回到原样，和字重调过头想回到原样是同一件事，不该是两颗按钮——尤其是自定义模式
	 * 下有四个颜色要一个个记。
	 */
	inlineCode: "app",
	inlineCodeLightBg: "#F4F4F5",
	inlineCodeLightFg: "#1C1C21",
	inlineCodeDarkBg: "#242424",
	inlineCodeDarkFg: "#EDEDED",
	inlineCodeBorder: false,
} as const;

/**
 * 整页恢复默认，也就是出厂时的外观。
 *
 * 和 `DEFAULT_APPEARANCE` 逐字段相等，测试是这么断言的——「恢复默认」的意思就是「变回没设置过
 * 的样子」，少一个字段就意味着某一项会留在它现在的值上，而按下这颗按钮的人以为自己清空了一切。
 */
export const FACTORY_APPEARANCE: Appearance = {
	// 跟着系统走。没表过态的人是什么主题，按下这颗按钮之后就该回到什么主题。
	theme: "system",
	accent: "#339CFF",
	lightBackground: "#FFFFFF",
	lightForeground: "#1A1C1F",
	darkBackground: "#171717",
	darkForeground: "#EDEDED",
	uiFont: '"PingFang SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
	uiFontSize: 14,
	uiFontWeight: 500,
	...CODE_DEFAULTS,
	contrast: 60,
	contentWidth: 640,
	composerLines: 1,
	pointerCursor: false,
	reduceMotion: "system",
	diffMarkers: "color",
	errorDetail: "compact",
	fontSmoothing: true,
};

/**
 * The default UI stack as drawn: the stored one, with the faces Windows and Linux need.
 *
 * The stored default is core's (`DEFAULT_APPEARANCE.uiFont`, mirrored above) — PingFang, then
 * YaHei. On Windows YaHei draws the Latin too, with only 300/400/700, so the three weights the UI
 * uses (base 500, 600, 700) collapse to two; Linux falls to DejaVu or Liberation, 400/700. Why these
 * faces and this order is written on `--font-sans` in `tokens.css`, which carries the same list.
 *
 * Widened here rather than by changing the stored default: that lives in core, and every install
 * has it written into its settings file, so a new default would reach nobody without a migration
 * there. Only the untouched default is widened. A stack somebody typed is theirs, as typed.
 */
export function drawnUiFont(stored: string): string {
	if (stored !== FACTORY_APPEARANCE.uiFont) return stored;
	return '"PingFang SC", "Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans", "Noto Sans CJK SC", sans-serif';
}
