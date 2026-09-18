/**
 * Screenshot settings shared by every desktop platform.
 *
 * Allows customizing screen capture shortcut, default save directory,
 * clipboard copy preference, and whether to open the annotator immediately.
 */

import { shortcutLabel } from "../../ui/keyboard.ts";
import { Camera, Eraser, FolderOpen, RotateCcw } from "lucide-react";
import { useApp } from "../../store/index.ts";
import { bridge } from "../../services/index.ts";
import {
	Card,
	Row,
	SectionTitle,
	ShortcutRecorder,
	Toggle,
} from "./controls.tsx";
import { DialogAction } from "../../ui/overlay/Dialog.tsx";
import { useI18n } from "../../i18n/index.ts";

export function ScreenshotSettings() {
	const { t } = useI18n();
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);

	if (!settings) return null;

	const config = settings.screenshot ?? {
		enabled: true,
		shortcut: "Alt+A",
		saveLocation: "",
		downloadLocation: "",
		showInComposer: false,
		copyToClipboard: true,
		insertIntoComposer: false,
		openEditor: true,
	};

	const patch = (patchObj: Partial<typeof config>) => {
		void saveSettings({
			...settings,
			screenshot: {
				...config,
				...patchObj,
			},
		});
	};

	/** The same picker for both destinations — which one it fills in is the caller's business. */
	const pickDirectory = async (into: "saveLocation" | "downloadLocation") => {
		const dir = await bridge.screenshot.pickDirectory();
		if (dir) patch({ [into]: dir });
	};

	return (
		<div className="pt-8">
			<h1 className="pb-7 text-display leading-tight font-semibold tracking-tight text-ink">
				{t("screenshot.title")}
			</h1>

			<SectionTitle>{t("shot.shortcutSection")}</SectionTitle>
			<Card className="mb-9">
				<Row
					title={t("shot.enable")}
					detail={t("shot.enableDetail")}
					control={<Toggle checked={config.enabled !== false} onChange={(enabled) => patch({ enabled })} />}
				/>
				<Row
					title={t("shot.shortcut")}
					detail={t("shot.shortcutDetail")}
					control={
						<div className="flex items-center gap-2">
							<ShortcutRecorder
								value={config.shortcut ?? "Alt+A"}
								onChange={(val) => patch({ shortcut: val })}
							/>
							{config.shortcut && (
								<DialogAction onClick={() => patch({ shortcut: "" })} label={t("common.clear")}>
									<Eraser size={13} strokeWidth={1.8} aria-hidden />
									{t("common.clear")}
								</DialogAction>
							)}
						</div>
					}
				/>
				<Row
					title={t("shot.composerButton")}
					detail={t("shot.composerButtonDetail")}
					control={
						<Toggle
							checked={config.showInComposer === true}
							onChange={(showInComposer) => patch({ showInComposer })}
						/>
					}
				/>
				<Row
					title={t("shot.test")}
					detail={t("shot.testDetail")}
					control={
						<DialogAction disabled={config.enabled === false} onClick={() => void bridge.screenshot.start().catch((error: unknown) => useApp.getState().notify(String(error), "error"))} label={t("screenshot.now")}>
							<Camera size={14} strokeWidth={2} aria-hidden />
							{t("screenshot.now")}
						</DialogAction>
					}
				/>
			</Card>

			<SectionTitle>{t("shot.saveSection")}</SectionTitle>
			<Card className="mb-9">
				<Row
					title={t("shot.saveLocation")}
					detail={
						config.saveLocation?.trim()
							? t("shot.savedTo", { path: config.saveLocation })
							: t("shot.noDirectory")
					}
					control={
						<div className="flex items-center gap-2">
							{config.saveLocation?.trim() && (
								<DialogAction onClick={() => patch({ saveLocation: "" })} label={t("common.clear")}>
									<Eraser size={13} strokeWidth={1.8} aria-hidden />
									{t("common.clear")}
								</DialogAction>
							)}
							<DialogAction onClick={() => void pickDirectory("saveLocation")} label={config.saveLocation?.trim() ? t("common.chooseDirectory") : t("shot.chooseSaveDirectory")}>
								<FolderOpen size={14} strokeWidth={2} aria-hidden />
								{config.saveLocation?.trim() ? t("common.chooseDirectory") : t("shot.chooseSaveDirectory")}
							</DialogAction>
						</div>
					}
				/>
				{/*
				 * Where 下载 puts things, which is a different question from the one above.
				 *
				 * 「截图保存位置」 is the automatic copy every finished capture leaves behind, and most
				 * people leave it empty on purpose. This is the toolbar's download button, where the
				 * file *is* the errand — so empty means the desktop rather than nothing, and the row
				 * says so instead of leaving the user to press it and go looking.
				 */}
				<Row
					title={t("shot.downloadLocation")}
					detail={
						config.downloadLocation?.trim()
							? t("shot.downloadTo", { path: config.downloadLocation })
							: t("shot.downloadToDesktop")
					}
					control={
						<div className="flex items-center gap-2">
							{config.downloadLocation?.trim() && (
								<DialogAction onClick={() => patch({ downloadLocation: "" })} label={t("common.restoreDefault")}>
									<RotateCcw size={13} strokeWidth={1.8} aria-hidden />
									{t("common.restoreDefault")}
								</DialogAction>
							)}
							<DialogAction onClick={() => void pickDirectory("downloadLocation")} label={config.downloadLocation?.trim() ? t("common.chooseDirectory") : t("shot.chooseDownloadDirectory")}>
								<FolderOpen size={14} strokeWidth={2} aria-hidden />
								{config.downloadLocation?.trim() ? t("common.chooseDirectory") : t("shot.chooseDownloadDirectory")}
							</DialogAction>
						</div>
					}
				/>
				<Row
					title={t("shot.annotate")}
					detail={t("shot.annotateDetail")}
					control={
						<Toggle
							checked={config.openEditor !== false}
							onChange={(openEditor) => patch({ openEditor })}
						/>
					}
				/>
				<Row
					title={t("shot.autoInsert")}
					detail={t("shot.autoInsertDetail")}
					control={
						<Toggle
							checked={config.insertIntoComposer === true}
							onChange={(insertIntoComposer) => patch({ insertIntoComposer })}
						/>
					}
				/>
				<Row
					title={t("shot.copyOnDone")}
					detail={shortcutLabel(t("shot.copyOnDoneDetail"))}
					control={
						<Toggle
							checked={config.copyToClipboard !== false}
							onChange={(copyToClipboard) => patch({ copyToClipboard })}
						/>
					}
				/>
			</Card>
		</div>
	);
}
