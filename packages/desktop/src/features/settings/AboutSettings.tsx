import { Scroller } from "../../ui/scroll/Scroller.tsx";
import {
	ArrowUpRight,
	DownloadCloud,
	Info,
	RefreshCw,
	Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../../store/index.ts";
import { check, useUpdate } from "../update/index.ts";
import { notesForLocale, versionNote } from "../update/index.ts";
import { useI18n } from "../../i18n/index.ts";
import { UpdateDialog } from "../modals/index.ts";
import { Markdown } from "../conversation/index.ts";
import { Card, GhostButton, InlineSelect, PrimaryButton, Row, SectionTitle } from "./controls.tsx";
import { bridge } from "../../services/index.ts";

export function AboutSettings() {
	const { t } = useI18n();
	const { info, phase, checking } = useUpdate();
	const [openDialog, setOpenDialog] = useState(false);
	const [platform, setPlatform] = useState("darwin");
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);
	/*
	 * 发版说明按读的人的语言挑一段——整份说明七种语言写在同一个 release 正文里，见 `notesForLocale`。
	 * 界面本来就跟着系统语言走，这一屏是它唯一还在讲中文的地方。
	 */
	const { resolvedLocale } = useI18n();
	const notes = info?.notes ? notesForLocale(info.notes, resolvedLocale) : "";

	useEffect(() => {
		void bridge.system.platform().then(setPlatform);
	}, []);

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
					查看当前应用版本、更新日志、手动检查与配置自动更新频率。
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
									发布于 {new Date(info.publishedAt).toLocaleDateString()}
								</span>
							)}
						</div>
					}
					control={
						<div className="flex items-center gap-2">
							<GhostButton
								onClick={() => void check(true)}
								disabled={checking}
								icon={<RefreshCw size={13} strokeWidth={2} className={checking ? "ly-spin" : ""} />}
							>
								{checking ? t("about.checking") : t("about.checkUpdate")}
							</GhostButton>
							{available && (
								<PrimaryButton onClick={() => setOpenDialog(true)}>
									<DownloadCloud size={13} className="mr-1.5 inline" />
									立即更新到 v{info?.latest}
								</PrimaryButton>
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
					{notes ? (
						<Scroller className="max-h-[380px]" contentClassName="pr-2">
							<div className="mb-3 flex items-center gap-2">
								<Sparkles size={16} className="text-accent" />
								<span className="font-medium text-ink">
									{info?.available ? t("about.updateDetails", { version: info.latest }) : t("about.releaseNotes", { version: info?.current ?? "" })}
								</span>
							</div>
							<Markdown text={notes} className="text-label" />
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
						<GhostButton
							onClick={() => void bridge.system.openExternal("https://github.com/kittors/Lyra")}
							icon={<ArrowUpRight size={13} />}
						>
							GitHub 仓库
						</GhostButton>
					}
				/>
				<Row
					title={t("about.changelog")}
					detail={t("about.changelogDetail")}
					control={
						<GhostButton
							onClick={() =>
								void bridge.system.openExternal(info?.url || "https://github.com/kittors/Lyra/releases")
							}
							icon={<ArrowUpRight size={13} />}
						>
							Releases 页面
						</GhostButton>
					}
				/>
			</Card>

			{openDialog && info && <UpdateDialog info={info} phase={phase} onClose={() => setOpenDialog(false)} />}
		</div>
	);
}