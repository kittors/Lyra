import type { FormattingSettings as Formatting } from "@lyra/core";
import { useApp } from "../../store/index.ts";
import { Card, Row, SectionTitle } from "./layout.tsx";
import { Segmented, Toggle, GhostButton } from "./controls.tsx";
import { NumberField } from "./pickers.tsx";
import { RotateCcw } from "lucide-react";
import { FormatPreview } from "./FormatPreview.tsx";

/**
 * 代码格式化 — the settings that change the bytes, kept apart from the ones that change the pixels.
 *
 * The preview is the point of this page, which is why it leads it. Every option here is a rule
 * about output nobody can picture from its name — 「尾随逗号」 has three values and two of them
 * look identical until you see a multi-line call — so the sample is formatted live, by the real
 * Prettier, with the current values. What is on screen is what the shortcut would produce.
 *
 * It is also where the page admits its own limits. Most languages are not Prettier's: Go is
 * `gofmt` or it is wrong. Picking one in the preview says which engine owns it, so nobody spends
 * an afternoon tuning options that were never going to apply. See `FormatPreview`.
 */

/** What 恢复默认 puts back. Restated rather than imported — see `code-defaults.ts` for why. */
const DEFAULTS: Formatting = {
	onSave: false,
	tabWidth: 2,
	useTabs: true,
	printWidth: 120,
	semi: true,
	singleQuote: false,
	trailingComma: "all",
	bracketSpacing: true,
	arrowParens: "always",
};

export function FormattingSettings() {
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);
	const formatting = { ...DEFAULTS, ...settings?.formatting };

	const patch = (next: Partial<Formatting>) => {
		if (!settings) return;
		void saveSettings({ ...settings, formatting: { ...formatting, ...next } });
	};

	return (
		<div className="flex flex-col gap-5">
			{/*
			 * The preview leads the page.
			 *
			 * Every control below it changes something nobody can picture from its name, so the
			 * answer has to be on screen before the question — at the bottom it was off-screen at
			 * exactly the moment anyone was using the control it described.
			 */}
			<div>
				<div className="mb-2 flex items-center justify-between px-1">
					<SectionTitle>预览</SectionTitle>
					<GhostButton onClick={() => patch(DEFAULTS)} icon={<RotateCcw size={13} strokeWidth={1.6} />}>
						恢复默认
					</GhostButton>
				</div>
				<FormatPreview options={formatting} />
			</div>

			<div>
				<SectionTitle>代码格式化</SectionTitle>
				<Card>
					<Row
						title="保存时格式化"
						detail="按 ⌘S 时先整理再写入。关闭时仍可随时按 ⇧⌥F 手动格式化。"
						control={<Toggle checked={formatting.onSave} onChange={(onSave) => patch({ onSave })} />}
					/>
					<Row
						title="缩进"
						detail="制表符还是空格，以及一级缩进有多宽。"
						control={
							<div className="flex items-center gap-2">
								<Segmented
									value={formatting.useTabs ? "tab" : "space"}
									onChange={(value) => patch({ useTabs: value === "tab" })}
									options={[
										{ value: "tab", label: "制表符" },
										{ value: "space", label: "空格" },
									]}
								/>
								<NumberField
									value={formatting.tabWidth}
									min={1}
									max={8}
									label="缩进宽度"
									width={60}
									onChange={(tabWidth) => patch({ tabWidth })}
								/>
							</div>
						}
					/>
					<Row
						title="每行最大宽度"
						detail="超过这个字符数就换行。不是硬性上限——一个不能拆的长字符串仍会超出。"
						control={
							<NumberField
								value={formatting.printWidth}
								min={40}
								max={400}
								step={10}
								label="每行最大宽度"
								width={72}
								onChange={(printWidth) => patch({ printWidth })}
							/>
						}
					/>
					<Row
						title="分号"
						detail="在语句末尾加上分号。"
						control={<Toggle checked={formatting.semi} onChange={(semi) => patch({ semi })} />}
					/>
					<Row
						title="引号"
						detail="字符串用哪种引号。含有该引号的字符串会自动改用另一种，不会转义。"
						control={
							<Segmented
								value={formatting.singleQuote ? "single" : "double"}
								onChange={(value) => patch({ singleQuote: value === "single" })}
								options={[
									{ value: "double", label: "双引号" },
									{ value: "single", label: "单引号" },
								]}
							/>
						}
					/>
					<Row
						title="尾随逗号"
						detail="多行的数组、对象和参数列表末尾是否留一个逗号。留着的好处是新增一行时 diff 只有一行。"
						control={
							<Segmented
								value={formatting.trailingComma}
								onChange={(trailingComma) => patch({ trailingComma })}
								options={[
									{ value: "none", label: "不加" },
									{ value: "es5", label: "ES5" },
									{ value: "all", label: "全部" },
								]}
							/>
						}
					/>
					<Row
						title="花括号内侧空格"
						detail="写成 { a: 1 } 还是 {a: 1}。"
						control={
							<Toggle checked={formatting.bracketSpacing} onChange={(bracketSpacing) => patch({ bracketSpacing })} />
						}
					/>
					<Row
						title="箭头函数的括号"
						detail="只有一个参数时是否保留括号。保留的好处是加类型标注或第二个参数时不用先补括号。"
						control={
							<Segmented
								value={formatting.arrowParens}
								onChange={(arrowParens) => patch({ arrowParens })}
								options={[
									{ value: "always", label: "总是" },
									{ value: "avoid", label: "省略" },
								]}
							/>
						}
					/>
				</Card>
			</div>

			<p className="px-1 text-detail text-ink-faint">
				项目自带的 .prettierrc、.editorconfig 或 package.json 里的 prettier 字段优先于以上设置——
				仓库已经定好的风格不会被这里覆盖。Go、Rust、Python 等语言交给它们各自的官方工具（gofmt、rustfmt、ruff/black），
				这些设置对它们不起作用。
			</p>
		</div>
	);
}
