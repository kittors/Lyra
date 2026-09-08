import { translate } from "../../i18n/translate.ts";
import { macKeyboard, shortcutLabel } from "../../ui/keyboard.ts";
import type { FormattingSettings as Formatting } from "@lyra/core";
import { useApp } from "../../store/index.ts";
import { Card, Row, SectionTitle } from "./layout.tsx";
import { Segmented, Toggle, GhostButton } from "./controls.tsx";
import { NumberField } from "./pickers.tsx";
import { RotateCcw } from "lucide-react";
import { FormatPreview } from "./FormatPreview.tsx";
import { useI18n } from "../../i18n/index.ts";

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
	const { t } = useI18n();
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
					<SectionTitle>{t("common.preview")}</SectionTitle>
					<GhostButton onClick={() => patch(DEFAULTS)} icon={<RotateCcw size={13} strokeWidth={1.6} />}>
						{translate("common.restoreDefault")}
					</GhostButton>
				</div>
				<FormatPreview options={formatting} />
			</div>

			<div>
				<SectionTitle>{t("format.title")}</SectionTitle>
				<Card>
					<Row
						title={t("format.onSave")}
						detail={shortcutLabel(t("format.onSaveDetail", { shortcut: macKeyboard() ? "⇧⌘F" : "Shift+Alt+F" }))}
						control={<Toggle checked={formatting.onSave} onChange={(onSave) => patch({ onSave })} />}
					/>
					<Row
						title={t("format.indent")}
						detail={t("format.indentDetail")}
						control={
							<div className="flex items-center gap-2">
								<Segmented
									value={formatting.useTabs ? "tab" : "space"}
									onChange={(value) => patch({ useTabs: value === "tab" })}
									options={[
										{ value: "tab", label: t("format.tabs") },
										{ value: "space", label: t("format.spaces") },
									]}
								/>
								<NumberField
									value={formatting.tabWidth}
									min={1}
									max={8}
									label={t("format.indentWidth")}
									width={60}
									onChange={(tabWidth) => patch({ tabWidth })}
								/>
							</div>
						}
					/>
					<Row
						title={t("format.printWidth")}
						detail={t("format.printWidthDetail")}
						control={
							<NumberField
								value={formatting.printWidth}
								min={40}
								max={400}
								step={10}
								label={t("format.printWidth")}
								width={72}
								onChange={(printWidth) => patch({ printWidth })}
							/>
						}
					/>
					<Row
						title={t("format.semicolons")}
						detail={t("format.semicolonsDetail")}
						control={<Toggle checked={formatting.semi} onChange={(semi) => patch({ semi })} />}
					/>
					<Row
						title={t("format.quotes")}
						detail={t("format.quotesDetail")}
						control={
							<Segmented
								value={formatting.singleQuote ? "single" : "double"}
								onChange={(value) => patch({ singleQuote: value === "single" })}
								options={[
									{ value: "double", label: t("format.double") },
									{ value: "single", label: t("format.single") },
								]}
							/>
						}
					/>
					<Row
						title={t("format.trailingComma")}
						detail={t("format.trailingCommaDetail")}
						control={
							<Segmented
								value={formatting.trailingComma}
								onChange={(trailingComma) => patch({ trailingComma })}
								options={[
									{ value: "none", label: t("common.none") },
									{ value: "es5", label: "ES5" },
									{ value: "all", label: t("common.all") },
								]}
							/>
						}
					/>
					<Row
						title={t("format.bracketSpacing")}
						detail={t("format.bracketSpacingDetail")}
						control={
							<Toggle checked={formatting.bracketSpacing} onChange={(bracketSpacing) => patch({ bracketSpacing })} />
						}
					/>
					<Row
						title={t("format.arrowParens")}
						detail={t("format.arrowParensDetail")}
						control={
							<Segmented
								value={formatting.arrowParens}
								onChange={(arrowParens) => patch({ arrowParens })}
								options={[
									{ value: "always", label: t("common.always") },
									{ value: "avoid", label: t("format.omit") },
								]}
							/>
						}
					/>
				</Card>
			</div>

			<p className="px-1 text-detail text-ink-faint">
				{translate("formatting.projectWinsInline")}
				{translate("formatting.otherLanguages")}
			</p>
		</div>
	);
}
