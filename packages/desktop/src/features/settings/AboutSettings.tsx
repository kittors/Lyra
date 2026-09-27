import { CircleCheck, DownloadCloud, Globe, MessageCircle, RefreshCw, Tag, WifiOff } from "lucide-react";
import { useState } from "react";

import icon from "../../assets/app-icon.png?inline";
import { activeLocale } from "../../i18n/translate.ts";
import { useI18n } from "../../i18n/index.ts";
import { bridge } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";
import { ActionSpinner } from "../../ui/motion/loaders.tsx";
import { Button } from "../../ui/primitives/Button.tsx";
import { GitHubMark } from "../../ui/primitives/GitHubMark.tsx";
import { Markdown } from "../conversation/index.ts";
import { UpdateDialog } from "../modals/index.ts";
import { check, labelFor, notesForLocale, useUpdate } from "../update/index.ts";
import { Card, InlineSelect, Row, SectionTitle } from "./controls.tsx";

const REPO = "https://github.com/kittors/Lyra";
/** The website — downloads with a mirror for mainland China, and the documentation. */
const WEBSITE = "https://lyra.07230805.xyz";

/**
 * 关于 Lyra.
 *
 * What someone opens this page for is three things: which version this is and whether it is the
 * newest, what changed in it, and where the project lives. So the top of the page answers the
 * first and the last together — the app's mark, its name, the version, a word on whether there is
 * anything newer, and the repository one click away under GitHub's own mark — and the release notes
 * follow, rendered in full and read at the page's own width instead of inside a 380px box of their
 * own that scrolled separately from everything around it.
 *
 * Everything that used to explain itself under a title — "查看当前应用版本、更新日志、手动检查与配置
 * 自动更新频率", "访问 Lyra 的 GitHub 仓库提交反馈或贡献代码" — is gone: the controls say it.
 */
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
		void saveSettings({ ...settings, updateCheckIntervalHours: hours });
		import("../update/index.ts")
			.then(({ restartCheckTimer }) => restartCheckTimer(hours))
			.catch(() => {});
	};

	const status = !info
		? { tone: "text-ink-faint", icon: <ActionSpinner size={12} />, text: t("update.reading") }
		: available
			? { tone: "text-accent", icon: <DownloadCloud size={13} strokeWidth={2} aria-hidden />, text: labelFor(phase, info.latest) }
			: info.checked
				? { tone: "text-ok", icon: <CircleCheck size={13} strokeWidth={2} aria-hidden />, text: t("about.latest") }
				: { tone: "text-ink-faint", icon: <WifiOff size={13} strokeWidth={2} aria-hidden />, text: t("about.offline") };

	return (
		<div className="space-y-8">
			<section className="ly-about-hero ly-swap-in relative overflow-hidden rounded-[12px] px-6 pt-6 pb-5" data-ly-about="">
				<div className="flex flex-wrap items-center gap-5">
					<img src={icon} alt="" width={68} height={68} draggable={false} className="ly-about-icon shrink-0 rounded-[18px]" />
					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
							<h2 className="text-display leading-tight font-semibold tracking-tight text-ink">Lyra</h2>
							{info?.current && <span className="font-mono text-label text-ink-muted tabular-nums">v{info.current}</span>}
						</div>
						<p className="mt-1 text-label text-ink-muted">{t("about.tagline")}</p>
						<p className={`mt-2 flex flex-wrap items-center gap-1.5 text-detail ${status.tone}`} data-ly-version-status="">
							{status.icon}
							{status.text}
							{info?.publishedAt && (
								<span className="text-ink-faint">
									· {t("about.publishedOn", { date: new Date(info.publishedAt).toLocaleDateString(activeLocale()) })}
								</span>
							)}
						</p>
					</div>
					<div className="flex shrink-0 flex-wrap items-center gap-2">
						<Button
							variant="subtle"
							onClick={() => void check(true)}
							disabled={checking}
							icon={checking ? <ActionSpinner size={13} /> : <RefreshCw size={13} strokeWidth={2} aria-hidden />}
						>
							{checking ? t("about.checking") : t("about.checkUpdate")}
						</Button>
						{available && (
							<Button variant="primary" onClick={() => setOpenDialog(true)} icon={<DownloadCloud size={13} strokeWidth={2} aria-hidden />}>
								{t("about.updateNow", { version: info?.latest ?? "" })}
							</Button>
						)}
					</div>
				</div>

				<div className="mt-5 flex flex-wrap items-center gap-2">
					<LinkChip icon={<Globe size={13} strokeWidth={2} aria-hidden />} label={t("about.website")} onClick={() => void bridge.system.openExternal(WEBSITE)} data-ly-open-website="" />
					<LinkChip icon={<GitHubMark size={14} />} label="kittors/Lyra" tip={t("about.repo")} onClick={() => void bridge.system.openExternal(REPO)} data-ly-open-repo="" />
					<LinkChip
						icon={<Tag size={13} strokeWidth={2} aria-hidden />}
						label={t("about.releases")}
						onClick={() => void bridge.system.openExternal(info?.url || `${REPO}/releases`)}
						data-ly-open-releases=""
					/>
					<LinkChip icon={<MessageCircle size={13} strokeWidth={2} aria-hidden />} label={t("about.issues")} onClick={() => void bridge.system.openExternal(`${REPO}/issues`)} />
				</div>
			</section>

			<Card>
				<Row
					title={t("about.checkInterval")}
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
				<Row title={t("about.environment")} control={<span className="font-mono text-label text-ink-muted">{platform}</span>} />
			</Card>

			{notes ? (
				<section>
					<SectionTitle>{available ? t("about.updateDetails", { version: info?.latest ?? "" }) : t("about.releaseNotes", { version: info?.current ?? "" })}</SectionTitle>
					<Card>
						<div className="px-5 py-4">
							<Markdown key={resolvedLocale} text={notes} className="text-label" />
						</div>
					</Card>
				</section>
			) : (
				info?.checked === false && <p className="text-center text-detail text-ink-faint">{t("about.checkPrompt")}</p>
			)}

			{openDialog && info && <UpdateDialog info={info} phase={phase} onClose={() => setOpenDialog(false)} />}
		</div>
	);
}

/** A way out of the app, drawn as what it is: a mark and a word. The tooltip says where it goes. */
function LinkChip({ icon, label, tip, onClick, ...rest }: { icon: React.ReactNode; label: string; tip?: string; onClick: () => void } & Record<`data-${string}`, string>) {
	return (
		<button
			type="button"
			onClick={onClick}
			data-ly-tip={tip}
			aria-label={tip}
			className="flex h-[30px] items-center gap-1.5 rounded-full bg-card/80 px-3 text-detail text-ink-muted transition-[background-color,color,transform] duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink active:scale-[0.97]"
			{...rest}
		>
			{icon}
			{label}
		</button>
	);
}
