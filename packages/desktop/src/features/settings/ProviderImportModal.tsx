/**
 * What a provider file would do, shown before it does it.
 *
 * Importing is not additive: a file exported from another machine usually carries the same provider
 * ids this one already has, so half the entries replace something rather than arrive beside it. The
 * two read identically in a JSON file and could not be more different afterwards, which is why this
 * is a list with a mark against each row instead of a yes/no on the whole file.
 *
 * The key column is the other half. A provider whose key did not travel — because someone stripped
 * the file before sending it — looks complete in every other respect and cannot reach its endpoint,
 * and that is worth knowing before the import rather than at the next message.
 */

import { Check, CheckSquare, KeyRound, Square, Upload, X } from "lucide-react";
import { useState } from "react";
import type { ProviderConfig } from "@lyra/core";
import { useI18n } from "../../i18n/index.ts";
import { Overlay } from "../../ui/overlay/Overlay.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { Badge, GhostButton } from "./controls.tsx";
import type { ImportEntry } from "./provider-transfer.ts";

export function ProviderImportModal({
	entries,
	dropped,
	onCancel,
	onImport,
}: {
	entries: ImportEntry[];
	/** Entries in the file this build could not read; zero for a file it wrote itself. */
	dropped: number;
	onCancel: () => void;
	onImport: (chosen: ProviderConfig[]) => void;
}) {
	const { t } = useI18n();
	const [selected, setSelected] = useState<Set<string>>(() => new Set(entries.map((entry) => entry.provider.id)));

	const chosen = entries.filter((entry) => selected.has(entry.provider.id));
	const allSelected = chosen.length === entries.length;

	function toggle(id: string) {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		setSelected(next);
	}

	return (
		<Overlay onClose={onCancel} width={560}>
			{(dismiss) => (
				<>
					<div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
						<h3 className="flex items-center gap-2.5 text-body font-semibold text-ink">
							<Upload size={18} className="text-accent" />
							{t("providerTransfer.importTitle")}
						</h3>
						<span className="rounded-full bg-card-hover px-2 py-0.5 text-micro font-medium text-ink-muted">
							{entries.length}
						</span>
						<div className="flex-1" />
						<button
							type="button"
							onClick={() => {
								setSelected(allSelected ? new Set() : new Set(entries.map((entry) => entry.provider.id)));
							}}
							className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-caption font-medium text-ink-muted transition-colors hover:bg-card-hover hover:text-ink"
						>
							{allSelected ? (
								<CheckSquare size={14} className="text-accent" strokeWidth={2} />
							) : (
								<Square size={14} className="text-ink-faint" strokeWidth={1.8} />
							)}
							{t(allSelected ? "common.deselectAll" : "common.selectAll")}
						</button>
					</div>

					<Scroller className="max-h-[56vh]" contentClassName="space-y-1.5 px-5 py-4">
						{entries.map((entry) => (
							<Row
								key={entry.provider.id}
								entry={entry}
								checked={selected.has(entry.provider.id)}
								onToggle={() => toggle(entry.provider.id)}
							/>
						))}
						{dropped > 0 && (
							<p className="pt-1 text-detail text-ink-faint">{t("providerTransfer.dropped", { n: dropped })}</p>
						)}
					</Scroller>

					<div className="flex items-center justify-between gap-3 border-t border-line px-5 py-3.5">
						{/* The consequence of the choice above, in the place a person looks before pressing. */}
						<span className="min-w-0 flex-1 truncate text-caption text-ink-muted">
							{t("providerTransfer.importPlan", {
								add: chosen.filter((entry) => entry.kind === "new").length,
								replace: chosen.filter((entry) => entry.kind === "replace").length,
							})}
						</span>
						<div className="flex shrink-0 items-center gap-2">
							<GhostButton onClick={() => dismiss()}>
								<X size={13} strokeWidth={2} />
								<span>{t("common.cancel")}</span>
							</GhostButton>
							<button
								type="button"
								disabled={chosen.length === 0}
								onClick={() => dismiss(() => onImport(chosen.map((entry) => entry.provider)))}
								className="flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3.5 text-caption font-medium text-shell transition-opacity hover:opacity-90 disabled:opacity-40"
							>
								<Check size={13} strokeWidth={2.2} />
								<span>{t("providerTransfer.importAction", { n: chosen.length })}</span>
							</button>
						</div>
					</div>
				</>
			)}
		</Overlay>
	);
}

function Row({ entry, checked, onToggle }: { entry: ImportEntry; checked: boolean; onToggle: () => void }) {
	const { t } = useI18n();
	const { provider } = entry;

	return (
		<label
			className={`flex cursor-pointer items-center gap-3 rounded-xl border p-2.5 transition-colors select-none ${
				checked ? "border-accent/40 bg-accent/[0.04]" : "border-line bg-card hover:bg-card-hover/40"
			}`}
		>
			<button type="button" onClick={onToggle} className="shrink-0 focus:outline-none">
				{checked ? (
					<CheckSquare size={16} className="text-accent" strokeWidth={2} />
				) : (
					<Square size={16} className="text-ink-faint hover:text-ink" strokeWidth={1.8} />
				)}
			</button>

			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="truncate text-label text-ink">{provider.name}</span>
					<Badge tone={entry.kind === "replace" ? "accent" : "muted"}>
						{t(entry.kind === "replace" ? "providerTransfer.willReplace" : "providerTransfer.willAdd")}
					</Badge>
				</div>
				<ScrollText text={provider.baseUrl} className="mt-0.5 font-mono text-detail text-ink-faint" />
			</div>

			<span className="shrink-0 rounded bg-card px-1.5 py-0.5 font-mono text-caption text-ink-faint">
				{t("providerTransfer.modelCount", { n: provider.models.length })}
			</span>
			<KeyMark entry={entry} />
		</label>
	);
}

/** Three states, because "no key in the file" means two different things. */
function KeyMark({ entry }: { entry: ImportEntry }) {
	const { t } = useI18n();
	const tone = entry.hasKey ? "text-ok" : entry.keepsLocalKey ? "text-ink-faint" : "text-danger";
	const label = entry.hasKey
		? t("providerTransfer.keyIncluded")
		: entry.keepsLocalKey
			? t("providerTransfer.keyKept")
			: t("providerTransfer.keyMissing");

	return (
		<span data-ly-tip={label} aria-label={label} className={`shrink-0 ${tone}`}>
			<KeyRound size={14} strokeWidth={1.8} />
		</span>
	);
}
