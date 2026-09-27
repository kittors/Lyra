/**
 * The files a phone is sending to the desktop, drawn in the composer they were dropped on.
 *
 * One card each, in the tray above the text: what it is, how far it has got, and a cross to stop it.
 * A card that failed says so and offers 重试 in place — the file is still in hand, so trying again is
 * one tap rather than finding it in the picker a second time. When it arrives the card goes and the
 * attachment takes its place, as its mark in the sentence. See `phone-upload.ts` for the lifecycle.
 *
 * Nothing on the desktop, where files are read straight off the disk and there is nothing to wait for.
 */

import { RotateCw, X } from "lucide-react";

import { useI18n } from "../../../i18n/index.ts";
import { FileKindIcon } from "./FileKindIcon.tsx";
import { usePendingUploads, type PendingUpload } from "./uploads.ts";

/** `3.2 MB`, `812 KB` — enough to see it moving without reading a number to the byte. */
function size(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
	const kb = bytes / 1024;
	if (kb < 1024) return `${Math.max(1, Math.round(kb))} KB`;
	const mb = kb / 1024;
	if (mb < 1024) return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
	return `${(mb / 1024).toFixed(1)} GB`;
}

export function PhoneUploads({ owner }: { owner: string }) {
	const { t } = useI18n();
	const rows = usePendingUploads(owner);
	if (rows.length === 0) return null;
	return (
		<div className="ly-phone-uploads" role="list" aria-label={t("phone.uploads")}>
			{rows.map((row) => (
				<UploadCard key={row.key} row={row} />
			))}
		</div>
	);
}

function UploadCard({ row }: { row: PendingUpload }) {
	const { t } = useI18n();
	const failed = row.state === "failed";
	const ratio = row.total > 0 ? Math.min(1, Math.max(0, row.done / row.total)) : 0;
	return (
		<div role="listitem" className="ly-phone-upload" data-state={row.state}>
			<span className="ly-phone-upload-icon" aria-hidden>
				<FileKindIcon kind={row.kind} size={18} />
			</span>
			<div className="ly-phone-upload-body">
				<span className="ly-phone-upload-name">{row.name}</span>
				{failed ? (
					<span className="ly-phone-upload-error" role="alert">
						{row.error ? t("phone.uploadFailedWhy", { reason: row.error }) : t("phone.uploadFailed")}
					</span>
				) : (
					<>
						<span
							className="ly-phone-upload-track"
							role="progressbar"
							aria-label={t("phone.uploading", { name: row.name })}
							aria-valuemin={0}
							aria-valuemax={100}
							aria-valuenow={Math.round(ratio * 100)}
						>
							<span className="ly-phone-upload-fill" style={{ transform: `scaleX(${ratio})` }} />
						</span>
						<span className="ly-phone-upload-meta">
							{size(row.done)} / {size(row.total)}
						</span>
					</>
				)}
			</div>
			{failed && row.retry && (
				<button type="button" onClick={row.retry} className="ly-phone-upload-retry ly-press">
					<RotateCw size={15} strokeWidth={2} aria-hidden />
					{t("common.retry")}
				</button>
			)}
			<button
				type="button"
				aria-label={t(failed ? "phone.uploadRemove" : "phone.uploadCancel", { name: row.name })}
				onClick={row.cancel}
				className="ly-phone-upload-cancel ly-press"
			>
				<X size={16} strokeWidth={2.2} aria-hidden />
			</button>
		</div>
	);
}
