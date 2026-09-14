import type { ImportedFont, ImportedFontData } from "../../../shared/custom-fonts.ts";
import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import { useApp } from "../../store/index.ts";
import { available, bridge, onPhone } from "../../services/index.ts";
import { Card, EmptyHint, GhostButton, PrimaryButton, SectionTitle } from "./controls.tsx";
import { CODE_DEFAULTS } from "./code-defaults.ts";
import {
	DEFAULT_UI_FONT_STACK,
	importedFontId,
	importedUiFontStack,
	loadImportedFont,
	syncImportedUiFont,
} from "./imported-fonts.ts";

function formatSize(size: number): string {
	return size < 1024 * 1024 ? `${Math.ceil(size / 1024)} KB` : `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function codeFontStack(family: string): string {
	return `"${family}", ${CODE_DEFAULTS.codeFont}`;
}

export function ImportedFontsSettings() {
	const settings = useApp((state) => state.settings);
	const saveSettings = useApp((state) => state.saveSettings);
	const [fonts, setFonts] = useState<ImportedFont[]>([]);
	const [previewFont, setPreviewFont] = useState<ImportedFont | null>(null);
	const [previewData, setPreviewData] = useState<ImportedFontData | null>(null);
	const [busy, setBusy] = useState<"list" | "import" | "select" | "ui" | "code" | "reset" | null>(null);
	const [error, setError] = useState<string | null>(null);
	const phone = onPhone();
	const fontsAvailable =
		!phone && available("fonts", "list") && available("fonts", "import") && available("fonts", "read");
	/*
	 * The two stacks, not the settings object they came out of.
	 *
	 * Every save replaces `settings`, so an effect that depends on it re-reads the store each time
	 * the accent or the theme moves. These two strings are the only thing the listing cares about,
	 * and naming them here is also what lets the dependency array say what the body actually uses.
	 */
	const uiFont = settings?.appearance.uiFont;
	const codeFont = settings?.appearance.codeFont;

	useEffect(() => {
		if (!fontsAvailable || uiFont === undefined || codeFont === undefined) return;
		let current = true;
		setBusy("list");
		void bridge.fonts
			.list()
			.then((items) => {
				if (!current) return;
				setFonts(items);
				const selectedId = importedFontId(uiFont) ?? importedFontId(codeFont);
				setPreviewFont(items.find((font) => font.id === selectedId) ?? null);
			})
			.catch((cause: unknown) => {
				if (!current) return;
				const detail = cause instanceof Error ? cause.message : String(cause);
				setError(`读取导入字体失败：${detail}`);
				useApp.getState().notify(`读取导入字体失败：${detail}`, "error");
			})
			.finally(() => {
				if (current) setBusy(null);
			});
		return () => {
			current = false;
		};
	}, [fontsAvailable, uiFont, codeFont]);

	if (phone || !settings) return null;
	const appearance = settings.appearance;

	const showError = (label: string, cause: unknown) => {
		const detail = cause instanceof Error ? cause.message : String(cause);
		const message = `${label}：${detail}`;
		setError(message);
		useApp.getState().notify(message, "error");
	};

	const readForPreview = async (font: ImportedFont): Promise<ImportedFontData> => {
		if (previewData?.id === font.id) return previewData;
		const data = await bridge.fonts.read(font.id);
		await loadImportedFont(data);
		setPreviewData(data);
		return data;
	};

	const selectFont = async (font: ImportedFont) => {
		setBusy("select");
		setError(null);
		try {
			await readForPreview(font);
			setPreviewFont(font);
		} catch (cause) {
			showError("字体预览加载失败", cause);
		} finally {
			setBusy(null);
		}
	};

	const importFont = async () => {
		setBusy("import");
		setError(null);
		try {
			const data = await bridge.fonts.import();
			if (!data) return;
			await loadImportedFont(data);
			setFonts((current) => [data, ...current.filter((font) => font.id !== data.id)]);
			setPreviewData(data);
			setPreviewFont(data);
		} catch (cause) {
			showError("字体导入失败", cause);
		} finally {
			setBusy(null);
		}
	};

	const applyFont = async (target: "ui" | "code") => {
		if (!previewFont) return;
		setBusy(target);
		setError(null);
		try {
			const font = await readForPreview(previewFont);
			const stack = target === "ui" ? importedUiFontStack(font.family) : codeFontStack(font.family);
			await saveSettings({
				...settings,
				appearance: { ...appearance, [target === "ui" ? "uiFont" : "codeFont"]: stack },
			});
			if (target === "ui") syncImportedUiFont(stack);
		} catch (cause) {
			showError(target === "ui" ? "应用 UI 字体失败" : "应用代码字体失败", cause);
		} finally {
			setBusy(null);
		}
	};

	const resetFonts = async () => {
		setBusy("reset");
		setError(null);
		try {
			await saveSettings({
				...settings,
				appearance: {
					...appearance,
					uiFont: DEFAULT_UI_FONT_STACK,
					codeFont: CODE_DEFAULTS.codeFont,
				},
			});
			syncImportedUiFont(DEFAULT_UI_FONT_STACK);
		} catch (cause) {
			showError("恢复默认字体失败", cause);
		} finally {
			setBusy(null);
		}
	};

	return (
		<>
			<div className="flex items-baseline justify-between">
				<SectionTitle>导入字体</SectionTitle>
				<GhostButton onClick={() => void resetFonts()} disabled={busy !== null}>只恢复默认字体</GhostButton>
			</div>
			<Card className="mb-8" data-imported-fonts>
				<div className="flex items-center justify-between gap-4 border-b border-line-soft px-4 py-3">
					<div className="min-w-0">
						<p className="text-label font-medium text-ink">本机字体文件</p>
						<p className="mt-0.5 text-caption text-ink-muted">TTF、OTF、WOFF 或 WOFF2，仅保存在这台电脑</p>
					</div>
					<PrimaryButton onClick={() => void importFont()} disabled={!fontsAvailable || busy !== null}>
						<span className="flex items-center gap-1.5"><Download size={13} />{busy === "import" ? "导入中…" : "导入字体"}</span>
					</PrimaryButton>
				</div>

				{!fontsAvailable ? (
					<EmptyHint>当前桌面环境没有提供本机字体导入能力。</EmptyHint>
				) : fonts.length === 0 ? (
					<EmptyHint>{busy === "list" ? "正在读取已导入字体…" : "还没有导入字体。"}</EmptyHint>
				) : (
					<div className="border-b border-line-soft p-2">
						{fonts.map((font) => (
							<button
								key={font.id}
								type="button"
								aria-pressed={previewFont?.id === font.id}
								data-imported-font-id={font.id}
								onClick={() => void selectFont(font)}
								disabled={busy !== null}
								className={`flex w-full items-center justify-between gap-3 rounded-[8px] px-3 py-2 text-left transition-colors ${
									previewFont?.id === font.id ? "bg-accent-soft text-ink" : "text-ink-muted hover:bg-hover hover:text-ink"
								}`}
							>
								<span className="min-w-0 truncate text-label font-medium">{font.name}</span>
								<span className="shrink-0 text-caption uppercase text-ink-faint">{font.format} · {formatSize(font.size)}</span>
							</button>
						))}
					</div>
				)}

				<div className="px-4 py-4">
					<p className="mb-2 text-caption text-ink-muted">中文标点与中英混排预览</p>
					<p
						lang="zh-CN"
						data-imported-font-preview
						className="rounded-[8px] border border-line-soft bg-surface px-4 py-4 text-[17px] leading-relaxed text-ink"
						style={{ fontFamily: previewFont ? importedUiFontStack(previewFont.family) : appearance.uiFont }}
					>
						“你好，Lyra！”——中文标点 AaBb 123，中英 Mixed 排版。
					</p>
					<div className="mt-3 flex flex-wrap items-center gap-2">
						<PrimaryButton onClick={() => void applyFont("ui")} disabled={!previewFont || busy !== null}>应用为 UI 字体</PrimaryButton>
						<GhostButton onClick={() => void applyFont("code")} disabled={!previewFont || busy !== null}>应用为代码字体</GhostButton>
						{previewFont && <span className="text-caption text-ink-faint">当前预览：{previewFont.name}</span>}
					</div>
					{error && <p role="alert" className="mt-3 text-caption text-danger">{error}</p>}
				</div>
			</Card>
		</>
	);
}
