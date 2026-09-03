import type { AppearanceSettings as Appearance } from "@lyra/core";
import { useState } from "react";
import { useApp } from "../../store/index.ts";
import { Card, GhostButton, InlineSelect, Row, SectionTitle, Segmented, TextInput, Toggle } from "./controls.tsx";
import { findCodeTheme, LIGHT_CODE_THEMES, DARK_CODE_THEMES } from "../../lib/code/themes.ts";
import { CodeAppearancePreview } from "./CodeAppearancePreview.tsx";
import { CODE_DEFAULTS } from "./code-defaults.ts";
import { CODE_FONTS, fontAvailable, matchCodeFont } from "./code-fonts.ts";
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
import { NumberField } from "./pickers.tsx";
import { Slider } from "./pickers.tsx";

export function AppearanceSettings() {
	/*
	 * Whether the custom stack field is open.
	 *
	 * Kept in the component rather than in settings: it is about what is on screen, not about how
	 * code is rendered. A stack that matches no preset opens it on its own, so a hand-written value
	 * from before this menu existed is still editable without picking 自定义 first.
	 */
	const [customFont, setCustomFont] = useState(false);
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);
	if (!settings) return null;

	const appearance = settings.appearance;
	// One theme field now; this used to mirror it into a second, top-level one that nothing read.
	const patch = (next: Partial<Appearance>) =>
		void saveSettings({ ...settings, appearance: { ...appearance, ...next } });
	const isDark = appearance.theme === "dark" || (appearance.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);

	return (
		<div className="pt-8">
			<h1 className="pb-6 text-display leading-tight font-semibold tracking-tight text-ink">外观</h1>

			<SectionTitle>主题</SectionTitle>
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
							{{ system: "系统", light: "浅色", dark: "深色" }[theme]}
						</span>
					</button>
				))}
			</div>

			<SectionTitle>{isDark ? "深色主题" : "浅色主题"}</SectionTitle>
			<Card className="mb-8">
				<div className="flex items-center justify-between border-b border-line-soft px-4 py-2.5">
					<span className="text-label text-ink-muted">预设</span>
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

				<ColorRow label="强调色" value={appearance.accent} onChange={(accent) => patch({ accent })} />
				<ColorRow
					label="背景"
					value={isDark ? appearance.darkBackground : appearance.lightBackground}
					onChange={(value) => patch(isDark ? { darkBackground: value } : { lightBackground: value })}
				/>
				<ColorRow
					label="前景"
					value={isDark ? appearance.darkForeground : appearance.lightForeground}
					onChange={(value) => patch(isDark ? { darkForeground: value } : { lightForeground: value })}
				/>

				<Row
					title="UI 字体"
					control={
						<TextInput
							value={appearance.uiFont}
							onChange={(uiFont) => patch({ uiFont })}
							className="w-[220px]"
						/>
					}
				/>
				<Row
					title="对比度"
					control={
						<div className="flex items-center gap-3">
							<Slider
								value={appearance.contrast}
								onChange={(contrast) => patch({ contrast })}
								min={0}
								max={100}
								label="对比度"
							/>
							<span className="w-6 text-right font-mono text-label text-ink">{appearance.contrast}</span>
						</div>
					}
				/>
			</Card>

			{/*
			 * The heading, with a way back to where it started.
			 *
			 * Seven controls here compound — a weight, a leading and a tracking that each looked fine
			 * on their own can add up to something unreadable, and working back to the defaults one
			 * control at a time means remembering seven numbers. Only these seven are reset; the
			 * theme, the accent and the fonts above are a separate decision.
			 */}
			<div className="flex items-baseline justify-between">
				<SectionTitle>代码外观 (Code appearance)</SectionTitle>
				<GhostButton
					onClick={() =>
						patch({ ...CODE_DEFAULTS })
					}
				>
					恢复默认
				</GhostButton>
			</div>
			<Card className="mb-8 p-4 space-y-4">
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="flex-1 min-w-0">
						<span className="block text-label font-medium text-ink">浅色代码高亮</span>
						<span className="block text-caption text-ink-muted">浅色模式下文件预览与代码块的高亮主题</span>
					</div>
					<InlineSelect
						value={appearance.codeLightTheme ?? CODE_DEFAULTS.codeLightTheme}
						onChange={(codeLightTheme) => patch({ codeLightTheme })}
						options={LIGHT_CODE_THEMES.map((t) => ({ value: t.id, label: t.label }))}
					/>
				</div>

				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-line-soft pt-3">
					<div className="flex-1 min-w-0">
						<span className="block text-label font-medium text-ink">深色代码高亮</span>
						<span className="block text-caption text-ink-muted">深色模式下文件预览与代码块的高亮主题</span>
					</div>
					<InlineSelect
						value={appearance.codeDarkTheme ?? CODE_DEFAULTS.codeDarkTheme}
						onChange={(codeDarkTheme) => patch({ codeDarkTheme })}
						options={DARK_CODE_THEMES.map((t) => ({ value: t.id, label: t.label }))}
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
						<span className="block text-label font-medium text-ink">代码字体 (Code font)</span>
						<span className="block text-caption text-ink-muted">用于文件预览、代码编辑器与终端的等宽字体</span>
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
							...CODE_FONTS.map((font) => ({
								value: font.stack,
								label: fontAvailable(font) ? font.label : `${font.label}（未安装）`,
							})),
							{ value: CUSTOM_FONT, label: "自定义…" },
						]}
					/>
				</div>

				{(customFont || !matchCodeFont(appearance.codeFont)) && (
					<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-line-soft pt-3">
						<div className="flex-1 min-w-0">
							<span className="block text-label font-medium text-ink">自定义字体栈</span>
							<span className="block text-caption text-ink-muted">
								按 CSS 写法，逗号分隔，带空格的名字要加引号；靠后的是装不上时的退路
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
						<span className="block text-label font-medium text-ink">字重 (Weight)</span>
						<span className="block text-caption text-ink-muted">深色主题下细字容易发虚，可以调粗一档</span>
					</div>
					{/* Presets for the common answers, a field for the one you actually want. The two
					    stay in step: typing 550 leaves every preset unselected, which is honest. */}
					<div className="flex items-center gap-2">
						<Segmented
							value={String(appearance.codeFontWeight ?? 400)}
							onChange={(weight) => patch({ codeFontWeight: Number(weight) })}
							options={[
								{ value: "300", label: "细" },
								{ value: "400", label: "常规" },
								{ value: "500", label: "中" },
								{ value: "600", label: "粗" },
							]}
						/>
						<NumberField
							value={appearance.codeFontWeight ?? 400}
							min={100}
							max={900}
							step={50}
							width={72}
							label="字重"
							onChange={(codeFontWeight) => patch({ codeFontWeight })}
						/>
					</div>
				</div>

				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-line-soft pt-3">
					<div className="flex-1 min-w-0">
						<span className="block text-label font-medium text-ink">行高 (Line height)</span>
						<span className="block text-caption text-ink-muted">倍数，不是像素——换字号时不用重调</span>
					</div>
					<div className="flex items-center gap-2">
						<Segmented
							value={String(appearance.codeLineHeight ?? 1.6)}
							onChange={(height) => patch({ codeLineHeight: Number(height) })}
							options={[
								{ value: "1.4", label: "紧凑" },
								{ value: "1.6", label: "标准" },
								{ value: "1.8", label: "宽松" },
								{ value: "2", label: "最宽" },
							]}
						/>
						<NumberField
							value={appearance.codeLineHeight ?? 1.6}
							min={1}
							max={3}
							step={0.05}
							width={72}
							label="行高"
							onChange={(codeLineHeight) => patch({ codeLineHeight })}
						/>
					</div>
				</div>

				<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-t border-line-soft pt-3">
					<div className="flex-1 min-w-0">
						<span className="block text-label font-medium text-ink">字距 (Tracking)</span>
						<span className="block text-caption text-ink-muted">以 em 为单位，跟着字号缩放</span>
					</div>
					<div className="flex items-center gap-2">
						<Segmented
							value={String(appearance.codeLetterSpacing ?? 0)}
							onChange={(spacing) => patch({ codeLetterSpacing: Number(spacing) })}
							options={[
								{ value: "-0.02", label: "收紧" },
								{ value: "0", label: "默认" },
								{ value: "0.02", label: "放宽" },
								{ value: "0.04", label: "更宽" },
							]}
						/>
						<NumberField
							value={appearance.codeLetterSpacing ?? 0}
							min={-0.1}
							max={0.2}
							step={0.01}
							width={72}
							label="字距"
							onChange={(codeLetterSpacing) => patch({ codeLetterSpacing })}
						/>
					</div>
				</div>
			</Card>

			<SectionTitle>偏好设置</SectionTitle>
			<Card>
				<Row
					title="使用指针光标"
					detail="悬停交互元素时切换为指针光标"
					control={
						<Toggle checked={appearance.pointerCursor} onChange={(pointerCursor) => patch({ pointerCursor })} />
					}
				/>
				<Row
					title="减少动态效果"
					detail="减少动画效果或匹配系统设置"
					control={
						<Segmented
							value={appearance.reduceMotion}
							onChange={(reduceMotion) => patch({ reduceMotion })}
							options={[
								{ value: "system", label: "系统" },
								{ value: "on", label: "开启" },
								{ value: "off", label: "关闭" },
							]}
						/>
					}
				/>
				<Row
					title="UI 字号"
					detail="调整 Lyra 界面使用的基准字号"
					control={
						<PixelField
							value={appearance.uiFontSize}
							min={11}
							max={20}
							onChange={(uiFontSize) => patch({ uiFontSize })}
							label="UI 字号"
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
					title="对话宽度"
					detail="正文和输入框的最大宽度。窗口很宽时，加宽可以少一些两侧留白"
					control={
						<div className="flex items-center gap-2">
							<Segmented
								value={contentPreset(appearance.contentWidth)}
								onChange={(choice) => patch({ contentWidth: Number(choice) })}
								options={[
									{ value: String(CONTENT_DEFAULT), label: "标准" },
									{ value: "800", label: "宽" },
									{ value: "960", label: "超宽" },
									{ value: String(CONTENT_FILL), label: "铺满" },
								]}
							/>
							{appearance.contentWidth !== CONTENT_FILL && (
								<PixelField
									value={appearance.contentWidth ?? CONTENT_DEFAULT}
									min={CONTENT_MIN}
									max={CONTENT_MAX}
									onChange={(contentWidth) => patch({ contentWidth })}
									label="对话宽度"
								/>
							)}
						</div>
					}
				/>
				<Row
					title="代码字体大小"
					detail="调整聊天和差异视图中代码使用的基础字号"
					control={
						<PixelField
							value={appearance.codeFontSize}
							min={10}
							max={20}
							onChange={(codeFontSize) => patch({ codeFontSize })}
							label="代码字体大小"
						/>
					}
				/>
				<Row
					title="差异标记"
					detail="使用颜色或 +/− 标记显示更改"
					control={
						<Segmented
							value={appearance.diffMarkers}
							onChange={(diffMarkers) => patch({ diffMarkers })}
							options={[
								{ value: "color", label: "颜色" },
								{ value: "symbols", label: "+/-" },
							]}
						/>
					}
				/>
				<Row
					title="出错时显示"
					detail="一轮出错后，在对话里说多少。常见的失败是网络抖动，措辞是一串 JSON"
					control={
						<Segmented
							value={appearance.errorDetail ?? "compact"}
							onChange={(errorDetail) => patch({ errorDetail })}
							options={[
								{ value: "compact", label: "一行" },
								{ value: "full", label: "完整" },
							]}
						/>
					}
				/>
				<Row
					title="字体平滑"
					detail="使用 macOS 原生字体抗锯齿"
					control={<Toggle checked={appearance.fontSmoothing} onChange={(fontSmoothing) => patch({ fontSmoothing })} />}
				/>
				<Row
					title="恢复默认"
					detail="把外观设置还原为出厂配置"
					control={
						<GhostButton onClick={() => patch(FACTORY_APPEARANCE)}>恢复</GhostButton>
					}
				/>
			</Card>
		</div>
	);
}
