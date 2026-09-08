/**
 * Modal to select and import discovered models from a provider's /v1/models endpoint.
 */

import { translate } from "../../i18n/translate.ts";
import { Check, CheckSquare, Square, X } from "lucide-react";
import { useMemo, useState } from "react";
import { ModelIcon } from "../models/index.ts";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { SearchField } from "../../ui/inputs/SearchField.tsx";
import { GhostButton } from "./controls.tsx";
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
	const [selected, setSelected] = useState<Set<string>>(() => {
		// Default: select all non-existing models
		return new Set(models.filter((m) => !existingModelIds.has(m)));
	});

	// Filter by search term
	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return models;
		return models.filter((m) => m.toLowerCase().includes(q));
	}, [models, search]);

	if (!open) return null;

	const allSelected = filtered.length > 0 && filtered.every((m) => selected.has(m));
	const someSelected = filtered.some((m) => selected.has(m));

	function toggleAll() {
		if (allSelected) {
			const next = new Set(selected);
			for (const m of filtered) next.delete(m);
			setSelected(next);
		} else {
			const next = new Set(selected);
			for (const m of filtered) next.add(m);
			setSelected(next);
		}
	}

	function toggle(id: string) {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		setSelected(next);
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-[2px] p-4 ly-fade-in">
			<div className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-2xl ly-scale-in">
				{/* Header */}
				<div className="flex items-center justify-between px-5 pt-4 pb-2">
					<div className="flex items-center gap-2">
						<span className="text-body font-semibold text-ink">{t("fetchModels.title")}</span>
						<span className="rounded-full bg-card-hover px-2 py-0.5 text-micro font-medium text-ink-muted">
							{translate("fetchModels.totalCount", { n: models.length })}
						</span>
					</div>
					<button
						type="button"
						onClick={onClose}
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
									className={`flex items-center justify-between rounded-xl border p-2.5 transition-all cursor-pointer select-none ${
										checked
											? "border-accent/40 bg-accent/[0.04]"
											: "border-line bg-card hover:border-ink-faint/30 hover:bg-card-hover/40"
									}`}
								>
									<div className="flex items-center gap-3 min-w-0 pr-2">
										<button
											type="button"
											onClick={(e) => {
												e.stopPropagation();
												toggle(modelId);
											}}
											className="shrink-0 text-ink-muted focus:outline-none cursor-pointer"
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
									<span className="shrink-0 text-caption text-ink-faint font-mono">200K</span>
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
						<GhostButton onClick={onClose}>
							<X size={13} strokeWidth={2} />
							<span>{t("common.cancel")}</span>
						</GhostButton>
						<button
							type="button"
							disabled={selected.size === 0}
							onClick={() => onImport(Array.from(selected))}
							className="flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3.5 text-caption font-medium text-shell transition-opacity hover:opacity-90 disabled:opacity-40 cursor-pointer"
						>
							<Check size={13} strokeWidth={2.2} />
							<span>{translate("fetchModels.importSelected", { n: selected.size })}</span>
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
