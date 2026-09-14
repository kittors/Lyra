/**
 * What a new version is and what to do about it — a view of the download, not its owner.
 *
 * Every phase it draws comes from the main process, and every button it offers is a message sent
 * there. That is the whole design, and it is what makes the dialog closable while a download runs:
 * closing it stops nothing, because it was never holding anything. The previous version had the
 * download living inside this component's state, which forced two things that both read as bugs —
 * the second button disabled mid-download, and the close gesture ignored — because leaving would
 * have orphaned a fetch nobody could then find or stop.
 *
 * The three controls are deliberately not the same three in every phase. A dialog that shows
 * 暂停, 继续 and 取消 at once, greying out two of them, is a control panel for a state machine;
 * what belongs on screen is the one or two things that make sense to do right now.
 */

import { Download, ExternalLink, Pause, Play, RotateCcw, Sparkles, X } from "lucide-react";
import { ActionSpinner } from "../../ui/motion/loaders.tsx";

import { useApp } from "../../store/index.ts";
import type { Info } from "../update/index.ts";
import { confirmLabel, controlsFor, fractionOf, mb, notesForLocale, readyNote, type Phase } from "../update/index.ts";
import { useI18n } from "../../i18n/index.ts";
import { Overlay } from "../../ui/overlay/Overlay.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { Markdown } from "../conversation/index.ts";
import { bridge } from "../../services/index.ts";

/**
 * 主按钮在每个阶段的图标，和 `confirmLabel` 的每个分支一一对应。
 *
 * 分开写而不是合进 `view.ts`：那边是纯的，有自己的测试，返回一段 JSX 会把渲染拖进去。缺的那
 * 一档（还没开始下载）落到 `Download`，正好是默认分支的那个词。
 */
const CONFIRM_GLYPH: Partial<Record<Phase["at"], React.ReactNode>> = {
	downloading: <ActionSpinner size={13} onFill />,
	preparing: <ActionSpinner size={13} onFill />,
	paused: <Play size={13} strokeWidth={2.2} fill="currentColor" aria-hidden />,
	ready: <RotateCcw size={13} strokeWidth={2} aria-hidden />,
	failed: <RotateCcw size={13} strokeWidth={2} aria-hidden />,
};

export function UpdateDialog({
	info,
	phase,
	onClose,
}: {
	info: Info;
	phase: Phase;
	onClose: () => void;
}) {
	const { t } = useI18n();
	const fraction = fractionOf(phase);
	// Which of the four controls belong in this phase — the rules, and their tests, are in `view.ts`.
	const controls = controlsFor(phase);
	// 跟「关于」页同一段说明、同一种挑法——见 `notesForLocale`。两处显示的是同一份东西。
	const { resolvedLocale } = useI18n();
	const notes = info.notes ? notesForLocale(info.notes, resolvedLocale) : "";

	/**
	 * The main button, in whichever phase it was pressed.
	 *
	 * The two `ready` branches both answer, which is the point of awaiting them. Each has a way of
	 * returning false — nothing staged, or an installer that has since been swept out of the temp
	 * directory — and both were previously fired and forgotten, so the failure mode of the last
	 * step in an update was a button that could be pressed all afternoon in silence. A relaunch
	 * that works does not come back from here at all; the app is already on its way out.
	 */
	const confirm = async () => {
		// Two endings behind one phase: macOS has the update unpacked and can restart into it,
		// while Windows and Linux have an installer open in a window this app does not own.
		if (phase.at === "ready") {
			const done = phase.relaunch
				? await bridge.updates.relaunch()
				: await bridge.updates.reopen();
			if (!done) {
				useApp
					.getState()
					.notify(t(phase.relaunch ? "updateDialog.notReady" : "updateDialog.installerMissing"), "warn");
			}
			return;
		}
		void bridge.updates.download(info.latest);
	};

	return (
		/*
		 * Closable in every phase, including mid-download.
		 *
		 * This is the change the whole rewrite was for. The download does not belong to this window,
		 * so leaving does not interrupt it — the badge keeps its ring going, and coming back finds it
		 * where it was.
		 */
		<Overlay onClose={onClose} width={500}>{(dismiss) => <>
			<div className="px-5 pt-5 pb-3">
				<div className="flex items-center gap-2">
					<div className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink/5 text-ink">
						<Sparkles size={16} strokeWidth={2} />
					</div>
					<h2 className="text-label font-semibold text-ink">{t("updateDialog.available")}</h2>
				</div>
				<p className="mt-2 text-detail text-ink-muted">
					<span className="font-medium text-ink-muted">v{info.current}</span> → <span className="font-semibold text-ink">v{info.latest}</span>
					{/* Only when the release said so — no date is better than a wrong one. */}
					{info.publishedAt && (
						<span className="pl-2 text-ink-faint">{new Date(info.publishedAt).toLocaleDateString("zh-CN")}</span>
					)}
					{info.asset && <span className="pl-2 text-ink-faint tabular-nums">（{mb(info.asset.size)}）</span>}
				</p>
			</div>

			{/*
			 * The release notes rendered with Markdown.
			 */}
			{notes && (
				<Scroller className="max-h-[260px] border-t border-line-soft bg-surface-alt/40" contentClassName="px-5 py-3.5">
					<div className="text-label leading-relaxed text-ink/90">
						<Markdown text={notes} />
					</div>
				</Scroller>
			)}

			<div className="border-t border-line px-5 py-3">
				{fraction !== null && phase.at !== "ready" && (
					<div className="mb-3">
						<div className="mb-1.5 flex items-baseline justify-between text-detail">
							<span className="text-ink-muted">
								{phase.at === "downloading" && t("updateDialog.downloading")}
								{phase.at === "paused" && t("updateDialog.paused")}
								{phase.at === "preparing" && t("updateDialog.preparing")}
							</span>
							{(phase.at === "downloading" || phase.at === "paused") && (
								<span className="tabular-nums text-ink-faint">
									<span className="text-ink">{Math.round(fraction * 100)}%</span>
									<span className="pl-2">
										{mb(phase.received)} / {mb(phase.total)}
									</span>
								</span>
							)}
						</div>
						<div className="h-1 overflow-hidden rounded-full bg-ink/10">
							<div
								/*
								 * Paused is drawn in a quieter colour rather than by stopping the bar, because a
								 * bar that merely stops moving is indistinguishable from a stalled download —
								 * which is the other thing it could be, and the one that needs a different
								 * response from the person watching.
								 */
								className={`h-full rounded-full transition-[width,background-color] duration-200 ease-out ${
									phase.at === "paused" ? "bg-ink-faint" : "bg-info"
								}`}
								style={{ width: `${Math.max(2, fraction * 100)}%` }}
							/>
						</div>
					</div>
				)}

				{phase.at === "ready" && <p className="mb-3 text-detail text-ok">{readyNote(phase.relaunch)}</p>}
				{phase.at === "failed" && (
					<p className="mb-3 text-detail text-danger">
						{phase.error}
						{/* Said out loud, because "retry" otherwise reads as "start the 130MB again". */}
						{phase.received > 0 && (
							<span className="pl-1 text-ink-faint tabular-nums">{t("updateDialog.downloadedSoFar", { size: mb(phase.received) })}</span>
						)}
					</p>
				)}

				<div className="flex items-center gap-2">
					{/*
					 * 取消 sits on the left, apart from the pair on the right, because it is the only one
					 * that destroys something — the partial file goes with it. Only offered when there is
					 * something to cancel; on an untouched update it would be a second 关闭.
					 */}
					{controls.cancel && (
						<button
							type="button"
							onClick={() => void bridge.updates.cancel()}
							className="grid place-items-center h-[32px] rounded-lg text-label text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink w-[32px]"
			data-ly-tip={t("updateDialog.cancel")}
			aria-label={t("updateDialog.cancel")}
		><X size={13} strokeWidth={2} /></button>
					)}

					<div className="flex-1" />

					{controls.pause ? (
						<button
							type="button"
							data-ly-tip={t("updateDialog.pause")}
							aria-label={t("updateDialog.pause")}
							onClick={() => void bridge.updates.pause()}
							className="grid h-[32px] w-[32px] place-items-center rounded-lg border border-line text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:border-ink-faint hover:text-ink"
						>
							<Pause size={12} strokeWidth={2.2} fill="currentColor" aria-hidden />
						</button>
					) : (
						<button
							type="button"
							data-ly-tip={t("common.close")}
							aria-label={t("common.close")}
							onClick={() => dismiss()}
							className="grid h-[32px] w-[32px] place-items-center rounded-lg border border-line text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:border-ink-faint hover:text-ink"
						>
							<X size={14} strokeWidth={2} aria-hidden />
						</button>
					)}

					{/*
					 * Falls back to the release page only when this platform has no installer in the
					 * release — better to hand over a link than to offer a button that cannot work.
					 */}
					{info.asset ? (
						<button
							type="button"
							data-ly-tip={confirmLabel(phase)}
							aria-label={confirmLabel(phase)}
							// Only while it is genuinely working. Paused and failed are both actionable, and
							// disabling them was the old dialog's way of saying "wait", which it then never
							// stopped saying if the download had quietly died.
							disabled={controls.confirmDisabled}
							onClick={() => void confirm()}
							className="grid h-[32px] w-[32px] place-items-center rounded-lg bg-ink text-shell transition-opacity duration-[var(--ly-t-quick)] hover:opacity-90 disabled:opacity-50"
						>
							{CONFIRM_GLYPH[phase.at] ?? <Download size={13} strokeWidth={2} aria-hidden />}
						</button>
					) : (
						<button
							type="button"
							data-ly-tip={t("updateDialog.releasePage")}
							aria-label={t("updateDialog.releasePage")}
							onClick={() => {
								void bridge.updates.open(info.url);
								dismiss();
							}}
							className="grid h-[32px] w-[32px] place-items-center rounded-lg bg-ink text-shell transition-opacity duration-[var(--ly-t-quick)] hover:opacity-90"
						>
							<ExternalLink size={13} strokeWidth={2} aria-hidden />
						</button>
					)}
				</div>
			</div>
		</>}</Overlay>
	);
}
