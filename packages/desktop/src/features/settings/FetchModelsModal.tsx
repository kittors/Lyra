/**
 * Modal to select and import discovered models from a provider's /v1/models endpoint.
 *
 * Mounted through `Overlay` like every other dialog in the app, and that is not a style preference.
 * This one used to draw its own `fixed inset-0` scrim in place, and the scrim stopped at the edge of
 * the settings content: the navigation column beside it stayed lit and clickable while the dialog
 * was open. `position: fixed` is only relative to the viewport when nothing above it has taken the
 * job of being the containing block — and a non-`none` `mask` takes it. Every `Scroller` in this
 * application carries one (`.ly-fade-y`), the settings page is two of them deep, so `inset-0`
 * resolved against the scroller rather than the window. `portal.ts` records the same trap from the
 * other direction, which is why the five floating surfaces all go to `document.body`.
 *
 * `Overlay` also brings what a hand-rolled scrim silently did without: Escape, a focus trap, focus
 * returned to where it came from, and an exit animation.
 */

import { translate } from "../../i18n/translate.ts";
import { Check, CheckSquare, Square, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ModelIcon } from "../models/index.ts";
import { Overlay } from "../../ui/overlay/Overlay.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { SearchField } from "../../ui/inputs/SearchField.tsx";
import { GhostButton } from "./controls.tsx";
import { defaultWindowLabel } from "./model-defaults.ts";
import { useI18n } from "../../i18n/index.ts";

export function FetchModelsModal({
	open,
	models,
	existingModelIds,
	onClose,
	onImport,
}: {
	open: boolean;
	models: string[];
	existingModelIds: Set<string>;
	onClose: () => void;
	onImport: (selectedIds: string[]) => void;
}) {
	const { t } = useI18n();
	const [search, setSearch] = useState("");
	const [selected, setSelected] = useState<Set<string>>(() => new Set());

	/*
	 * Default: everything not already in the list.
	 *
	 * In an effect rather than a `useState` initialiser, because that runs once for the life of the
	 * component and this list arrives from the network. It happens to work today — the parent only
	 * mounts this once a fetch has landed — but "correct as long as nobody mounts it earlier" is not
	 * something the next reader can see from here.
	 */
	useEffect(() => {
		setSelected(new Set(models.filter((m) => !existingModelIds.has(m))));
	}, [models, existingModelIds]);

	// Filter by search term
	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return models;
		return models.filter((m) => m.toLowerCase().includes(q));
	}, [models, search]);

	/*
	 * Only rows that would actually be imported can be selected.
	 *
	 * An already-added model is dropped by `importDiscoveredModels`, so counting it here made the
	 * button promise a number it was not going to deliver — 「导入所选（33）」 adding nine.
	 */
	const selectable = useMemo(() => filtered.filter((m) => !existingModelIds.has(m)), [filtered, existingModelIds]);

	if (!open) return null;

	const allSelected = selectable.length > 0 && selectable.every((m) => selected.has(m));
	const someSelected = selectable.some((m) => selected.has(m));

	function toggleAll() {
		const next = new Set(selected);
		for (const m of selectable) {
			if (allSelected) next.delete(m);
			else next.add(m);
		}
		setSelected(next);
	}

	function toggle(id: string) {
		if (existingModelIds.has(id)) return;
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		setSelected(next);
	}

	return (
		<Overlay onClose={onClose} width={520} label={t("fetchModels.title")}>
			{(dismiss) => (
				<>
				{/* Header */}
				<div className="flex items-center justify-between px-5 pt-4 pb-2">
					<div className="flex items-center gap-2">
						<h3 className="text-body font-semibold text-ink">{t("fetchModels.title")}</h3>
						<span className="rounded-full bg-card-hover px-2 py-0.5 text-micro font-medium text-ink-muted">
							{translate("fetchModels.totalCount", { n: models.length })}
						</span>
					</div>
					<button
						type="button"
						aria-label={t("common.cancel")}
						onClick={() => dismiss()}
						className="flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-card-hover hover:text-ink cursor-pointer"
					>
						<X size={15} strokeWidth={2} />
					</button>
				</div>

				{/* Search & Actions Bar without harsh border lines */}
				<div className="flex items-center gap-2 px-5 py-2">
					<SearchField
						value={search}
						onChange={setSearch}
						placeholder={t("fetchModels.search")}
						size="comfortable"
						className="flex-1 bg-input"
					/>
					<button
						type="button"
						onClick={toggleAll}
						className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-card px-2.5 text-caption font-medium text-ink-muted transition-colors hover:bg-card-hover hover:text-ink cursor-pointer"
					>
						{allSelected ? (
							<CheckSquare size={14} className="text-accent" strokeWidth={2} />
						) : someSelected ? (
							<div className="flex h-3.5 w-3.5 items-center justify-center rounded border border-accent bg-accent/20">
								<div className="h-1.5 w-1.5 rounded-xs bg-accent" />
							</div>
						) : (
							<Square size={14} className="text-ink-faint" strokeWidth={1.8} />
						)}
						<span>{allSelected ? t("common.deselectAll") : t("common.selectAll")}</span>
					</button>
				</div>

				{/* List Scroller with top & bottom edge softening */}
				<Scroller
					top="fade"
					bottom="fade"
					className="min-h-[220px] max-h-[440px] flex-1"
					contentClassName="px-5 py-2 space-y-1.5"
				>
					{filtered.length === 0 ? (
						<div className="py-12 text-center text-caption text-ink-faint">{t("fetchModels.noMatch")}</div>
					) : (
						filtered.map((modelId) => {
							const checked = selected.has(modelId);
							const isExisting = existingModelIds.has(modelId);
							return (
								<label
									key={modelId}
									className={`flex items-center justify-between rounded-xl border p-2.5 transition-all select-none ${
										isExisting
											? "cursor-default border-line bg-card opacity-55"
											: checked
												? "cursor-pointer border-accent/40 bg-accent/[0.04]"
												: "cursor-pointer border-line bg-card hover:border-ink-faint/30 hover:bg-card-hover/40"
									}`}
								>
									<div className="flex items-center gap-3 min-w-0 pr-2">
										{/* An already-added model cannot be imported again, so it cannot be chosen either —
										    otherwise the count in the footer promises rows the import will drop. */}
										<button
											type="button"
											disabled={isExisting}
											aria-checked={checked}
											role="checkbox"
											onClick={(e) => {
												e.stopPropagation();
												toggle(modelId);
											}}
											className="shrink-0 text-ink-muted focus:outline-none cursor-pointer disabled:cursor-default"
										>
											{checked ? (
												<CheckSquare size={16} className="text-accent" strokeWidth={2} />
											) : (
												<Square size={16} className="text-ink-faint hover:text-ink" strokeWidth={1.8} />
											)}
										</button>
										<ModelIcon model={modelId} size={16} />
										<div className="min-w-0">
											<div className="flex items-center gap-1.5">
												<span className="font-mono text-label text-ink truncate">{modelId}</span>
												{isExisting && (
													<span className="shrink-0 rounded bg-ink-faint/10 px-1 py-0.2 text-micro text-ink-faint">
														{translate("fetchModels.added")}
													</span>
												)}
											</div>
										</div>
									</div>
									{/* What the import will actually write, from the same constant it writes it from.
									    This used to be the literal string "200K" on every row — see `model-defaults.ts`. */}
									<span className="shrink-0 text-caption text-ink-faint font-mono">{defaultWindowLabel()}</span>
								</label>
							);
						})
					)}
				</Scroller>

				{/* Footer */}
				<div className="flex items-center justify-between px-5 pt-3 pb-4">
					<span className="text-caption text-ink-muted">
						{t("fetchModels.selected", { n: selected.size })}
					</span>
					<div className="flex items-center gap-2">
						<GhostButton onClick={() => dismiss()}>
							<X size={13} strokeWidth={2} />
							<span>{t("common.cancel")}</span>
						</GhostButton>
						<button
							type="button"
							disabled={selected.size === 0}
							// Through `dismiss`, so the import runs on the way out rather than under a dialog
							// that is still on screen — see the completion note in `Overlay`.
							onClick={() => dismiss(() => onImport(Array.from(selected)))}
							className="flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3.5 text-caption font-medium text-shell transition-opacity hover:opacity-90 disabled:opacity-40 cursor-pointer"
						>
							<Check size={13} strokeWidth={2.2} />
							<span>{translate("fetchModels.importSelected", { n: selected.size })}</span>
						</button>
					</div>
				</div>
				</>
			)}
		</Overlay>
	);
}
