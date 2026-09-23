import { activeLocale } from "../../i18n/translate.ts";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import {
	ArrowUpRight,
	DownloadCloud,
	Info,
	RefreshCw,
	Sparkles,
} from "lucide-react";
import { ActionSpinner } from "../../ui/motion/loaders.tsx";
import { useState } from "react";
import { useApp } from "../../store/index.ts";
import { check, useUpdate } from "../update/index.ts";
import { notesForLocale, versionNote } from "../update/index.ts";
import { useI18n } from "../../i18n/index.ts";
import { UpdateDialog } from "../modals/index.ts";
import { Markdown } from "../conversation/index.ts";
import { Card, InlineSelect, Row, SectionTitle } from "./controls.tsx";
import { DialogAction } from "../../ui/overlay/Dialog.tsx";
import { bridge } from "../../services/index.ts";

export function AboutSettings() {
	const { t, resolvedLocale } = useI18n();
	const { info, phase, checking } = useUpdate();
	const [openDialog, setOpenDialog] = useState(false);
	// Synchronous, from the preload: the IPC answer used to arrive a frame after "darwin" was drawn.
	const platform = bridge.platform ?? "darwin";
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);
	/*
	 * 「当前版本更新内容」跟着界面语言走：英文只出英文，中文只出中文，没写过的语言出英文。
	 * 正文在 GitHub 上可以七种语言写在一起，这一屏不能一股脑铺开，见 `notesForLocale`。
	 */
	const notes = info?.notes ? notesForLocale(info.notes, resolvedLocale) : "";

	const available = Boolean(info?.available);
	const interval = settings?.updateCheckIntervalHours ?? 6;

	const setIntervalHours = (hours: number) => {
		if (!settings) return;
		void saveSettings({
			...settings,
			updateCheckIntervalHours: hours,
		});
		import("../update/index.ts").then(({ restartCheckTimer }) => {
			restartCheckTimer(hours);
		}).catch(() => {});
	};

	return (
		<div className="space-y-6">
			<div>
				<h2 className="text-title font-semibold text-ink">{t("about.title")}</h2>
				<p className="mt-1 text-label text-ink-muted">
					{t("about.intro")}
				</p>
			</div>

			<SectionTitle>{t("about.versionSection")}</SectionTitle>
			<Card className="mb-6">
				<Row
					title={t("about.currentVersion")}
					detail={
						<div className="flex flex-col gap-1">
							<span>{versionNote(info, phase)}</span>
							{info?.publishedAt && (
								<span className="text-caption text-ink-faint">
									{t("about.publishedOn", { date: new Date(info.publishedAt).toLocaleDateString(activeLocale()) })}
								</span>
							)}
						</div>
					}
					control={
						<div className="flex flex-wrap items-center justify-end gap-2">
							<DialogAction
								onClick={() => void check(true)}
								disabled={checking}
								label={checking ? t("about.checking") : t("about.checkUpdate")}
								data-ly-check-update=""
							>
								{checking ? <ActionSpinner size={13} /> : <RefreshCw size={13} strokeWidth={2} aria-hidden />}
								{checking ? t("about.checking") : t("about.checkUpdate")}
							</DialogAction>
							{available && (
								<DialogAction
									tone="primary"
									onClick={() => setOpenDialog(true)}
									label={t("about.updateNow", { version: info?.latest ?? "" })}
									data-ly-update-now=""
								>
									<DownloadCloud size={13} strokeWidth={2} aria-hidden />
									{t("about.updateNow", { version: info?.latest ?? "" })}
								</DialogAction>
							)}
						</div>
					}
				/>

				<Row
					title={t("about.checkInterval")}
					detail={t("about.checkIntervalDetail")}
					control={
						<InlineSelect
							value={String(interval)}
							onChange={(v) => setIntervalHours(Number(v))}
							options={[
								{ value: "1", label: t("about.every1h") },
								{ value: "4", label: t("about.every4h") },
								{ value: "6", label: t("about.every6h") },
								{ value: "8", label: t("about.every8h") },
								{ value: "12", label: t("about.every12h") },
								{ value: "24", label: t("about.every24h") },
							]}
						/>
					}
				/>

				<Row
					title={t("about.environment")}
					detail={t("about.environmentDetail", { platform })}
					control={<span className="font-mono text-label text-ink-faint">{platform}</span>}
				/>
			</Card>

			{/* Release notes section */}
			<SectionTitle>{t("about.whatsNew")}</SectionTitle>
			<Card className="mb-6">
				<div className="p-4">
					{/*
					 * `overscroll="auto"`：这一块是嵌在设置页正文里的内容，不是一块独立的面。
					 *
					 * 发版说明长过 380px 时它自己会滚，而读到底还想接着往下看页面是很自然的一件事——默认的
					 * `contain` 会把那一下拦住。`Scroller` 那边另外管了「内容没撑满时不拦滚轮」的情况，两
					 * 处合起来才完整：撑不满时鼠标停上去也滚得动页面，撑满了读到底也接得下去。
					 */}
					{notes ? (
						<Scroller className="max-h-[380px]" contentClassName="pr-2" overscroll="auto">
							<div className="mb-3 flex items-center gap-2">
								<Sparkles size={16} className="text-accent" />
								<span className="font-medium text-ink">
									{info?.available ? t("about.updateDetails", { version: info.latest }) : t("about.releaseNotes", { version: info?.current ?? "" })}
								</span>
							</div>
							<Markdown key={resolvedLocale} text={notes} className="text-label" />
						</Scroller>
					) : (
						<div className="flex flex-col items-center justify-center py-6 text-center text-ink-faint">
							<Info size={20} className="mb-2 opacity-60" />
							<div className="text-label">{t("about.checkPrompt")}</div>
						</div>
					)}
				</div>
			</Card>

			<SectionTitle>{t("about.projectSection")}</SectionTitle>
			<Card>
				<Row
					title={t("about.repository")}
					detail={t("about.repositoryDetail")}
					control={
						<DialogAction
							onClick={() => void bridge.system.openExternal("https://github.com/kittors/Lyra")}
							label={t("about.repo")}
							data-ly-open-repo=""
						>
							<ArrowUpRight size={13} strokeWidth={2} aria-hidden />
							{t("about.repo")}
						</DialogAction>
					}
				/>
				<Row
					title={t("about.changelog")}
					detail={t("about.changelogDetail")}
					control={
						<DialogAction
							onClick={() =>
								void bridge.system.openExternal(info?.url || "https://github.com/kittors/Lyra/releases")
							}
							label={t("about.releases")}
							data-ly-open-releases=""
						>
							<ArrowUpRight size={13} strokeWidth={2} aria-hidden />
							{t("about.releases")}
						</DialogAction>
					}
				/>
			</Card>

			{openDialog && info && <UpdateDialog info={info} phase={phase} onClose={() => setOpenDialog(false)} />}
		</div>
	);
}