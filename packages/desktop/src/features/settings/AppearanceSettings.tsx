import { translate } from "../../i18n/translate.ts";
import type { AppearanceSettings as Appearance } from "@lyra/core";
import { useState } from "react";
import { useApp } from "../../store/index.ts";
import { Card, GhostButton, InlineSelect, Row, SectionTitle, Segmented, TextInput, Toggle } from "./controls.tsx";
import { findCodeTheme, LIGHT_CODE_THEMES, DARK_CODE_THEMES } from "../../lib/code/themes.ts";
import { CodeAppearancePreview } from "./CodeAppearancePreview.tsx";
import { CODE_DEFAULTS } from "./code-defaults.ts";
import { CODE_FONTS, fontAvailable, matchCodeFont } from "./code-fonts.ts";
import { ImportedFontsSettings } from "./ImportedFontsSettings.tsx";
import {
	CONTENT_DEFAULT,
	CONTENT_FILL,
	CONTENT_MAX,
	CONTENT_MIN,
	contentPreset,
} from "../../lib/content-width.ts";

/** The sentinel the font menu uses for 「自定义…」; never stored as a font stack. */
const CUSTOM_FONT = "__custom__";


/**
 * Mirrors `DEFAULT_APPEARANCE` in @lyra/core.
 *
 * It is duplicated rather than imported because a value import from the core package would
 * pull its `node:` modules into the renderer bundle; only types may cross that boundary.
 */
const FACTORY_APPEARANCE: Appearance = {
	theme: "dark",
	accent: "#339CFF",
	lightBackground: "#FFFFFF",
	lightForeground: "#1A1C1F",
	darkBackground: "#171717",
	darkForeground: "#EDEDED",
	uiFont: '"Inter Variable", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
	codeFont: '"JetBrains Mono Variable", ui-monospace, "SF Mono", SFMono-Regular, Menlo, "PingFang SC", monospace',
	codeLightTheme: "lyra-light",
	codeDarkTheme: "lyra-dark",
	uiFontSize: 13,
	codeFontSize: 12,
	contrast: 60,
	contentWidth: 640,
	composerLines: 1,
	pointerCursor: false,
	reduceMotion: "system",
	diffMarkers: "color",
	fontSmoothing: true,
};

const PRESETS: { id: string; label: string; patch: Partial<Appearance> }[] = [
	{ id: "lyra", label: "Lyra", patch: { accent: "#339CFF", darkBackground: "#171717", darkForeground: "#EDEDED" } },
	{ id: "graphite", label: "Graphite", patch: { accent: "#8E8E93", darkBackground: "#1C1C1E", darkForeground: "#F2F2F7" } },
	{ id: "moss", label: "Moss", patch: { accent: "#3ECF8E", darkBackground: "#121614", darkForeground: "#E6F2EC" } },
	{ id: "ember", label: "Ember", patch: { accent: "#FF8B3D", darkBackground: "#1A1412", darkForeground: "#F5E9E2" } },
];

import { ColorRow, PixelField, ThemePreview } from "./appearance-controls.tsx";
import { ComposerHeightPreview } from "./ComposerHeightPreview.tsx";
import { NumberField } from "./pickers.tsx";
import { Slider } from "./pickers.tsx";
import { useI18n } from "../../i18n/index.ts";

/** 输入框默认高度的两头。1 行是它一直以来的样子；10 行已经占掉一个矮窗口的三分之一。 */
const COMPOSER_LINES_MIN = 1;
const COMPOSER_LINES_MAX = 10;

export function AppearanceSettings() {
	/*
	 * Whether the custom stack field is open.
	 *
	 * Kept in the component rather than in settings: it is about what is on screen, not about how
	 * code is rendered. A stack that matches no preset opens it on its own, so a hand-written value
	 * from before this menu existed is still editable without picking 自定义 first.
	 */
	const [customFont, setCustomFont] = useState(false);
	/*
	 * 拖动中的行数，还没存进设置里的那个。
	 *
	 * 预览和读数要立刻跟着手走，而每存一次设置是一趟主进程：两次原子写盘、重建菜单、重注册全局
	 * 快捷键、再广播回来重渲一遍。一格一趟，从 1 拖到 10 就是这套东西跑九遍，卡的就是这个。
	 * 所以拖动期间只动这个草稿，松手时才存——中途那些格子是路过，不是选择。
	 */
	const { t } = useI18n();
	const [linesDraft, setLinesDraft] = useState<number | null>(null);
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);
	if (!settings) return null;

	const appearance = settings.appearance;
	// One theme field now; this used to mirror it into a second, top-level one that nothing read.
	const patch = (next: Partial<Appearance>) =>
		void saveSettings({ ...settings, appearance: { ...appearance, ...next } });
	const isDark = appearance.theme === "dark" || (appearance.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);

	/* 设置追上草稿了就把控制权交还——松手之后这两个数必然汇合，不需要另一个作废的时机。 */
	const savedLines = appearance.composerLines ?? COMPOSER_LINES_MIN;
	if (linesDraft !== null && linesDraft === savedLines) setLinesDraft(null);
	const composerLines = linesDraft ?? savedLines;

	return (
		<div className="pt-8">
			<h1 className="pb-6 text-display leading-tight font-semibold tracking-tight text-ink">{t("appearance.title")}</h1>

			<SectionTitle>{t("appearance.theme")}</SectionTitle>
			<div className="mb-8 grid grid-cols-3 gap-3">
				{(["system", "light", "dark"] as const).map((theme) => (
					<button
						key={theme}
						type="button"
						onClick={() => patch({ theme })}
						className={`rounded-[12px] border p-1.5 text-center transition-all duration-[var(--ly-t-base)] ${
							appearance.theme === theme
								? "border-ink ring-1 ring-ink"
								: "border-line hover:border-ink-faint"
						}`}
					>
						<ThemePreview variant={theme} accent={appearance.accent} />
						<span className="mt-2 mb-1 block text-label text-ink">
							{{ system: t("common.system"), light: t("appearance.light"), dark: t("appearance.dark") }[theme]}
						</span>
					</button>
				))}
			</div>

			<SectionTitle>{isDark ? t("appearance.darkTheme") : t("appearance.lightTheme")}</SectionTitle>
			<Card className="mb-8">
				<div className="flex items-center justify-between border-b border-line-soft px-4 py-2.5">
					<span className="text-label text-ink-muted">{t("appearance.preset")}</span>
					<div className="flex gap-1.5">
						{PRESETS.map((preset) => (
							<button
								key={preset.id}
								type="button"
								data-ly-tip={preset.label}
								onClick={() => patch(preset.patch)}
								className="h-6 w-6 rounded-full border border-line transition-transform duration-[var(--ly-t-quick)] hover:scale-110"
								style={{ background: preset.patch.accent }}
							/>
						))}
					</div>
				</div>

				<ColorRow label={t("appearance.accent")} value={appearance.accent} onChange={(accent) => patch({ accent })} />
				<ColorRow
					label={t("appearance.background")}
					value={isDark ? appearance.darkBackground : appearance.lightBackground}
					onChange={(value) => patch(isDark ? { darkBackground: value } : { lightBackground: value })}
				/>
				<ColorRow
					label={t("appearance.foreground")}
					value={isDark ? appearance.darkForeground : appearance.lightForeground}
					onChange={(value) => patch(isDark ? { darkForeground: value } : { lightForeground: value })}
				/>

				<Row
					title={t("appearance.uiFont")}
					control={
						<TextInput
							value={appearance.uiFont}
							onChange={(uiFont) => patch({ uiFont })}
							className="w-[220px]"
						/>
					}
				/>
				<Row
					title={t("appearance.contrast")}
					control={
						<div className="flex items-center gap-3">
							<Slider
								value={appearance.contrast}
								onChange={(contrast) => patch({ contrast })}
								min={0}
								max={100}
								label={t("appearance.contrast")}
							/>
							{/* 同样按字号算：24px 只够三位数在 13px 下勉强站住，字号一调大就得断行。 */}
							<span className="min-w-[2.2em] shrink-0 text-right font-mono text-label whitespace-nowrap text-ink tabular-nums">{appearance.contrast}</span>
						</div>
					}
				/>
			</Card>

			<ImportedFontsSettings />

			{/*
			 * The heading, with a way back to where it started.
			 *
			 * Seven controls here compound — a weight, a leading and a tracking that each looked fine
			 * on their own can add up to something unreadable, and working back to the defaults one
			 * control at a time means remembering seven numbers. Only these seven are reset; the
			 * theme, the accent and the fonts above are a separate decision.
			 */}
			<div className="flex items-baseline justify-between">
				<SectionTitle>{t("appearance.codeSection")}</SectionTitle>
				<GhostButton
					onClick={() =>
						patch({ ...CODE_DEFAULTS })
					}
				>
					{t("appearance.resetDefaults")}
				</GhostButton>
			</div>
			<Card className="mb-8 p-4 space-y-4">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="flex-1 min-w-0">
						<span className="block text-label font-medium text-ink">{t("appearance.lightSyntax")}</span>
						<span className="block text-caption text-ink-muted">{t("appearance.lightSyntaxDetail")}</span>
					</div>
					<InlineSelect
						value={appearance.codeLightTheme ?? CODE_DEFAULTS.codeLightTheme}
						onChange={(codeLightTheme) => patch({ codeLightTheme })}
						options={LIGHT_CODE_THEMES.map((theme) => ({ value: theme.id, label: theme.labelKey ? t(theme.labelKey) : theme.label }))}
					/>
				</div>

				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-line-soft pt-3">
					<div className="flex-1 min-w-0">
						<span className="block text-label font-medium text-ink">{t("appearance.darkSyntax")}</span>
						<span className="block text-caption text-ink-muted">{t("appearance.darkSyntaxDetail")}</span>
					</div>
					<InlineSelect
						value={appearance.codeDarkTheme ?? CODE_DEFAULTS.codeDarkTheme}
						onChange={(codeDarkTheme) => patch({ codeDarkTheme })}
						options={DARK_CODE_THEMES.map((theme) => ({ value: theme.id, label: theme.labelKey ? t(theme.labelKey) : theme.label }))}
					/>
				</div>

				<div className="pt-2">
					{/* Everything below feeds this: change a weight or a line height and both specimens
					    redraw on the keystroke. */}
					<CodeAppearancePreview
						lightTheme={findCodeTheme(appearance.codeLightTheme, "light")}
						darkTheme={findCodeTheme(appearance.codeDarkTheme, "dark")}
						type={{
							fontFamily: appearance.codeFont,
							fontSize: appearance.codeFontSize,
							fontWeight: appearance.codeFontWeight,
							lineHeight: appearance.codeLineHeight,
							letterSpacing: appearance.codeLetterSpacing,
						}}
					/>
				</div>

				{/*
				 * Pick a face by name; type a stack only if you want to.
				 *
				 * The stored value is a CSS font stack either way — it has to be, because the first
				 * choice may not be installed and something must catch that. What the menu removes is
				 * having to write one by hand, quotes and fallbacks included, in order to change a
				 * font. Faces that are not installed are marked rather than hidden, so the menu never
				 * claims you are looking at something you are not.
				 */}
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-line-soft pt-3">
					<div className="flex-1 min-w-0">
						<span className="block text-label font-medium text-ink">{t("appearance.codeFont")}</span>
						<span className="block text-caption text-ink-muted">{t("appearance.codeFontDetail")}</span>
					</div>
					<InlineSelect
						value={matchCodeFont(appearance.codeFont)?.stack ?? CUSTOM_FONT}
						onChange={(next) => {
							if (next === CUSTOM_FONT) {
								setCustomFont(true);
								return;
							}
							setCustomFont(false);
							patch({ codeFont: next });
						}}
						options={[
							...CODE_FONTS.map((font) => {
								const name = font.labelKey ? t(font.labelKey) : font.label;
								return { value: font.stack, label: fontAvailable(font) ? name : t("appearance.fontNotInstalled", { name }) };
							}),
							{ value: CUSTOM_FONT, label: t("appearance.custom") },
						]}
					/>
				</div>

				{(customFont || !matchCodeFont(appearance.codeFont)) && (
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-line-soft pt-3">
						<div className="flex-1 min-w-0">
							<span className="block text-label font-medium text-ink">{t("appearance.customStack")}</span>
							<span className="block text-caption text-ink-muted">
								{translate("appearance.fontStack")}
							</span>
						</div>
						<TextInput
							value={appearance.codeFont}
							onChange={(codeFont) => patch({ codeFont })}
							mono
							placeholder='"Fira Code", ui-monospace, Menlo, monospace'
							className="w-full sm:w-[260px]"
						/>
					</div>
				)}

				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-line-soft pt-3">
					<div className="flex-1 min-w-0">
						<span className="block text-label font-medium text-ink">{t("appearance.weightSection")}</span>
						<span className="block text-caption text-ink-muted">{t("appearance.weightDetail")}</span>
					</div>
					{/* Presets for the common answers, a field for the one you actually want. The two
					    stay in step: typing 550 leaves every preset unselected, which is honest. */}
					<div className="flex items-center gap-2">
						<Segmented
							value={String(appearance.codeFontWeight ?? 400)}
							onChange={(weight) => patch({ codeFontWeight: Number(weight) })}
							options={[
								{ value: "300", label: t("appearance.thin") },
								{ value: "400", label: t("appearance.regular") },
								{ value: "500", label: t("appearance.medium") },
								{ value: "600", label: t("appearance.bold") },
							]}
						/>
						<NumberField
							value={appearance.codeFontWeight ?? 400}
							min={100}
							max={900}
							step={50}
							width={72}
							label={t("appearance.weight")}
							onChange={(codeFontWeight) => patch({ codeFontWeight })}
						/>
					</div>
				</div>

				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-line-soft pt-3">
					<div className="flex-1 min-w-0">
						<span className="block text-label font-medium text-ink">{t("appearance.lineHeightSection")}</span>
						<span className="block text-caption text-ink-muted">{t("appearance.lineHeightDetail")}</span>
					</div>
					<div className="flex items-center gap-2">
						<Segmented
							value={String(appearance.codeLineHeight ?? 1.6)}
							onChange={(height) => patch({ codeLineHeight: Number(height) })}
							options={[
								{ value: "1.4", label: t("appearance.compact") },
								{ value: "1.6", label: t("common.standard") },
								{ value: "1.8", label: t("appearance.relaxed") },
								{ value: "2", label: t("appearance.widest") },
							]}
						/>
						<NumberField
							value={appearance.codeLineHeight ?? 1.6}
							min={1}
							max={3}
							step={0.05}
							width={72}
							label={t("appearance.lineHeight")}
							onChange={(codeLineHeight) => patch({ codeLineHeight })}
						/>
					</div>
				</div>

				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-line-soft pt-3">
					<div className="flex-1 min-w-0">
						<span className="block text-label font-medium text-ink">{t("appearance.trackingSection")}</span>
						<span className="block text-caption text-ink-muted">{t("appearance.trackingDetail")}</span>
					</div>
					<div className="flex items-center gap-2">
						<Segmented
							value={String(appearance.codeLetterSpacing ?? 0)}
							onChange={(spacing) => patch({ codeLetterSpacing: Number(spacing) })}
							options={[
								{ value: "-0.02", label: t("appearance.tighten") },
								{ value: "0", label: t("common.default") },
								{ value: "0.02", label: t("appearance.loosen") },
								{ value: "0.04", label: t("appearance.wider") },
							]}
						/>
						<NumberField
							value={appearance.codeLetterSpacing ?? 0}
							min={-0.1}
							max={0.2}
							step={0.01}
							width={72}
							label={t("appearance.tracking")}
							onChange={(codeLetterSpacing) => patch({ codeLetterSpacing })}
						/>
					</div>
				</div>
			</Card>

			<SectionTitle>{t("appearance.preferences")}</SectionTitle>
			<Card>
				<Row
					title={t("appearance.pointerCursor")}
					detail={t("appearance.pointerCursorDetail")}
					control={
						<Toggle checked={appearance.pointerCursor} onChange={(pointerCursor) => patch({ pointerCursor })} />
					}
				/>
				<Row
					title={t("appearance.reduceMotion")}
					detail={t("appearance.reduceMotionDetail")}
					control={
						<Segmented
							value={appearance.reduceMotion}
							onChange={(reduceMotion) => patch({ reduceMotion })}
							options={[
								{ value: "system", label: t("common.system") },
								{ value: "on", label: t("common.on") },
								{ value: "off", label: t("common.off") },
							]}
						/>
					}
				/>
				<Row
					title={t("appearance.uiScale")}
					detail={t("appearance.uiScaleDetail")}
					control={
						<PixelField
							value={appearance.uiFontSize}
							min={11}
							max={20}
							onChange={(uiFontSize) => patch({ uiFontSize })}
							label={t("appearance.uiScale")}
						/>
					}
				/>
				{/*
				 * The measure, as four choices and a number.
				 *
				 * Presets first because almost nobody wants a specific pixel count — they want
				 * "wider than this". The field is for the person who does, and it is hidden under
				 * 铺满 rather than disabled: a number that has no effect is worse than one that is
				 * not offered.
				 */}
				<Row
					title={t("appearance.chatWidth")}
					detail={t("appearance.chatWidthDetail")}
					control={
						<div className="flex items-center gap-2">
							<Segmented
								value={contentPreset(appearance.contentWidth)}
								onChange={(choice) => patch({ contentWidth: Number(choice) })}
								options={[
									{ value: String(CONTENT_DEFAULT), label: t("common.standard") },
									{ value: "800", label: t("appearance.wide") },
									{ value: "960", label: t("appearance.extraWide") },
									{ value: String(CONTENT_FILL), label: t("appearance.full") },
								]}
							/>
							{appearance.contentWidth !== CONTENT_FILL && (
								<PixelField
									value={appearance.contentWidth ?? CONTENT_DEFAULT}
									min={CONTENT_MIN}
									max={CONTENT_MAX}
									onChange={(contentWidth) => patch({ contentWidth })}
									label={t("appearance.chatWidth")}
								/>
							)}
						</div>
					}
				/>
				{/*
				 * 带预览，因为「4 行」这个数没法在脑子里换算成一个框。
				 *
				 * 跟这一页上代码外观的那两块specimen是同一个道理：字重和行高也是没人能凭数字想象的
				 * 东西。滑一格看一眼，比反复退出设置去试要短得多。
				 */}
				<Row
					title={t("appearance.composerLines")}
					detail={t("appearance.composerLinesDetail")}
					control={
						<div className="flex items-center gap-3">
							<Slider
								value={composerLines}
								onChange={setLinesDraft}
								/*
								 * 不走 `patch`，为的是那个 `catch`。
								 *
								 * 存不下去的时候草稿得作废，否则屏幕上留着一个磁盘上并不存在的行数——只
								 * 有它自己知道那次保存没成。以前不会这样：值一直来自设置，存不下去就自己
								 * 弹回去了；把画面交给草稿之后，这条退路得自己铺。
								 */
								onCommit={(lines) => {
									void saveSettings({ ...settings, appearance: { ...appearance, composerLines: lines } })
										.catch(() => setLinesDraft(null));
								}}
								min={COMPOSER_LINES_MIN}
								max={COMPOSER_LINES_MAX}
								label={t("appearance.composerLines")}
							/>
							{/*
							 * 宽度按字号算，不按像素算。
							 *
							 * 这里原来是 36px，正好够「1 行」，差 0.4px 就装不下「10 行」——于是滑到两位数
							 * 那一格，数字和「行」被拆到上下两行。写成 em 之后它跟着 UI 字号一起缩放，字号
							 * 调大也不会重演；`nowrap` 是最后一道，宁可挤出去也不断开。
							 */}
							<span className="min-w-[3.6em] shrink-0 text-right font-mono text-label whitespace-nowrap text-ink tabular-nums">
								{composerLines} {translate("appearance.linesUnit")}
							</span>
						</div>
					}
				>
					<ComposerHeightPreview lines={composerLines} />
				</Row>
				<Row
					title={t("appearance.codeFontSize")}
					detail={t("appearance.codeFontSizeDetail")}
					control={
						<PixelField
							value={appearance.codeFontSize}
							min={10}
							max={20}
							onChange={(codeFontSize) => patch({ codeFontSize })}
							label={t("appearance.codeFontSize")}
						/>
					}
				/>
				<Row
					title={t("appearance.diffMarks")}
					detail={t("appearance.diffMarksDetail")}
					control={
						<Segmented
							value={appearance.diffMarkers}
							onChange={(diffMarkers) => patch({ diffMarkers })}
							options={[
								{ value: "color", label: t("appearance.colour") },
								{ value: "symbols", label: "+/-" },
							]}
						/>
					}
				/>
				<Row
					title={t("appearance.errorDisplay")}
					detail={t("appearance.errorDisplayDetail")}
					control={
						<Segmented
							value={appearance.errorDetail ?? "compact"}
							onChange={(errorDetail) => patch({ errorDetail })}
							options={[
								{ value: "compact", label: t("appearance.oneLine") },
								{ value: "full", label: t("appearance.complete") },
							]}
						/>
					}
				/>
				<Row
					title={t("appearance.fontSmoothing")}
					detail={t("appearance.fontSmoothingDetail")}
					control={<Toggle checked={appearance.fontSmoothing} onChange={(fontSmoothing) => patch({ fontSmoothing })} />}
				/>
				<Row
					title={t("appearance.resetDefaults")}
					detail={t("appearance.resetDefaultsDetail")}
					control={
						<GhostButton onClick={() => patch(FACTORY_APPEARANCE)}>{t("common.restore")}</GhostButton>
					}
				/>
			</Card>
		</div>
	);
}
