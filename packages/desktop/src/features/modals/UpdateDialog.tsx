/**
 * What a new version is and what to do about it — a view of the download, not its owner.
 *
 * The chrome is `Dialog`: same 22px card, same padding, no hairline between the header and the
 * buttons. Progress sits in the body. Closing the dialog stops nothing, because it was never
 * holding anything.
 */

import { ExternalLink } from "lucide-react";

import { useApp } from "../../store/index.ts";
import type { Info } from "../update/index.ts";
import {
	confirmLabel,
	controlsFor,
	failureDetail,
	fractionOf,
	mb,
	notesForLocale,
	publishedOn,
	readyNote,
	type Phase,
} from "../update/index.ts";
import { useI18n } from "../../i18n/index.ts";
import { Dialog, DialogAction } from "../../ui/overlay/Dialog.tsx";
import { Markdown } from "../conversation/index.ts";
import { bridge } from "../../services/index.ts";

function metaLine(info: Info, locale: string, current: string): string {
	const bits = [info.latest, current];
	if (info.asset) bits.push(mb(info.asset.size));
	if (info.publishedAt) bits.push(publishedOn(info.publishedAt, locale));
	return bits.join(" · ");
}

function ProgressStatus({ phase, fraction }: { phase: Phase; fraction: number | null }) {
	const { t } = useI18n();
	if (phase.at === "ready") {
		return <p className="text-detail text-ok">{readyNote(phase.relaunch)}</p>;
	}
	if (phase.at !== "downloading" && phase.at !== "paused" && phase.at !== "preparing") return null;
	const percent = Math.round((fraction ?? 0) * 100);
	const bytes =
		phase.at === "downloading" || phase.at === "paused"
			? `${mb(phase.received)} / ${mb(phase.total)}`
			: null;
	return (
		<div data-ly-update-progress className="rounded-2xl bg-card px-4 py-3">
			<div className="flex items-baseline justify-between text-detail">
				<span className="text-ink-muted">
					{phase.at === "downloading" && t("updateDialog.downloading")}
					{phase.at === "paused" && t("updateDialog.paused")}
					{phase.at === "preparing" && t("updateDialog.preparing")}
				</span>
				<span className="tabular-nums text-ink-faint">
					<span className="text-ink">{percent}%</span>
					{bytes ? <span className="pl-2">{bytes}</span> : null}
				</span>
			</div>
			<div className="mt-2 h-1 overflow-hidden rounded-full bg-ink/10">
				<div
					className={`h-full rounded-full transition-[width,background-color] duration-[var(--ly-t-base)] ease-[var(--ly-e-out)] ${
						phase.at === "paused" ? "bg-ink-faint" : "bg-info"
					}`}
					style={{ width: `${Math.max(2, (fraction ?? 0) * 100)}%` }}
				/>
			</div>
		</div>
	);
}

export function UpdateDialog({
	info,
	phase,
	onClose,
}: {
	info: Info;
	phase: Phase;
	onClose: () => void;
}) {
	const { t, resolvedLocale } = useI18n();
	const fraction = fractionOf(phase);
	const controls = controlsFor(phase);
	const notes = info.notes ? notesForLocale(info.notes, resolvedLocale) : "";
	const pinned =
		phase.at === "downloading" ||
		phase.at === "paused" ||
		phase.at === "preparing" ||
		phase.at === "ready" ||
		phase.at === "failed";

	const confirm = async () => {
		if (controls.confirmPauses) {
			void bridge.updates.pause();
			return;
		}
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
		<Dialog
			onClose={onClose}
			width={480}
			height={480}
			data-ly-update-dialog
			title={t("updateDialog.available")}
			detail={metaLine(info, resolvedLocale, t("updateDialog.current", { version: info.current }))}
			status={
				pinned ? (
					phase.at === "failed" ? (
						<div className="rounded-2xl bg-card px-4 py-3">
							<p className="text-label font-medium text-ink">{t("updateDialog.failedTitle")}</p>
							<p className="mt-1 text-detail leading-relaxed text-ink-muted">{failureDetail(phase.error)}</p>
							{phase.received > 0 ? (
								<p className="mt-1 text-caption text-ink-faint tabular-nums">{t("updateDialog.downloadedSoFar", { size: mb(phase.received) })}</p>
							) : null}
						</div>
					) : (
						<ProgressStatus phase={phase} fraction={fraction} />
					)
				) : undefined
			}
			actions={(
				<>
					{controls.cancel ? (
						<DialogAction onClick={() => void bridge.updates.cancel()}>
							{t("updateDialog.cancel")}
						</DialogAction>
					) : null}
					<div className="flex-1" />
					<DialogAction onClick={onClose}>{t("common.close")}</DialogAction>
					{info.asset ? (
						<DialogAction tone="primary" disabled={controls.confirmDisabled} onClick={() => void confirm()}>
							{confirmLabel(phase)}
						</DialogAction>
					) : (
						<DialogAction
							tone="primary"
							onClick={() => {
								void bridge.updates.open(info.url);
								onClose();
							}}
						>
							<ExternalLink size={13} strokeWidth={2} aria-hidden />
							{t("updateDialog.releasePage")}
						</DialogAction>
					)}
				</>
			)}
		>
			{notes ? (
				<>
					<p className="mb-2 text-caption font-medium text-ink-faint">{t("updateDialog.whatsNew")}</p>
					<div className="text-label leading-relaxed text-ink/90">
						<Markdown text={notes} className="text-label" />
					</div>
				</>
			) : phase.at !== "failed" ? (
				<p className="text-detail text-ink-faint">{t("updateDialog.available")}</p>
			) : null}
		</Dialog>
	);
}
