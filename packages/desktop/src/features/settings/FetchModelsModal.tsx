/**
 * The models an endpoint lists, beside the ones this provider already has — and the place to change both.
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
 *
 * What the rows mean is in `model-sync.ts`: a checkbox is "in the list after apply", so the dialog
 * removes as well as adds, and a name the endpoint does not list can be typed in.
 */

import type { ModelConfig } from "@lyra/core";
import { useMemo, useState } from "react";
import { useI18n } from "../../i18n/index.ts";
import { DialogAction, DialogFrame } from "../../ui/overlay/Dialog.tsx";
import { Overlay } from "../../ui/overlay/Overlay.tsx";
import { SearchField } from "../../ui/inputs/SearchField.tsx";
import { AddRow, Group, ModelRow } from "./FetchModelsRows.tsx";
import { changeOf, cleanModelIds, isNewModelName, rowMatches, syncRows, type ModelChange } from "./model-sync.ts";

export function FetchModelsModal({
	listed,
	models,
	onClose,
	onApply,
}: {
	/** What the endpoint returned. May be empty: a relay can serve models it does not list. */
	listed: readonly string[];
	/** The provider's configured models. */
	models: readonly ModelConfig[];
	onClose: () => void;
	onApply: (change: ModelChange) => void;
}) {
	const { t } = useI18n();
	const [search, setSearch] = useState("");
	const [custom, setCustom] = useState<string[]>([]);
	const [unchecked, setUnchecked] = useState<ReadonlySet<string>>(() => new Set());

	const rows = useMemo(() => syncRows(listed, models, custom), [listed, models, custom]);
	const query = search.trim();
	const configured = useMemo(() => rows.configured.filter((row) => rowMatches(row, query)), [rows, query]);
	const available = useMemo(() => rows.available.filter((row) => rowMatches(row, query)), [rows, query]);
	const change = useMemo(() => changeOf(rows, unchecked), [rows, unchecked]);
	const canAdd = isNewModelName(query, rows);
	const listedCount = useMemo(() => cleanModelIds(listed).length, [listed]);

	function setChecked(ids: readonly string[], checked: boolean) {
		setUnchecked((current) => {
			const next = new Set(current);
			for (const id of ids) {
				if (checked) next.delete(id);
				else next.add(id);
			}
			return next;
		});
	}

	function addTyped() {
		if (!canAdd) return;
		setCustom((current) => [...current, query]);
		// Typed again after being unchecked: the request is to add it, so it arrives checked.
		setChecked([query], true);
	}

	const edits = change.add.length + change.remove.length;
	const applyLabel =
		edits === 0
			? t("fetchModels.apply")
			: change.remove.length === 0
				? t("fetchModels.applyAdd", { n: change.add.length })
				: change.add.length === 0
					? t("fetchModels.applyRemove", { n: change.remove.length })
					: t("fetchModels.applyBoth", { n: edits });

	return (
		<Overlay onClose={onClose} width={540} label={t("fetchModels.title")}>
			{(dismiss) => (
				<DialogFrame
					title={(
						<span className="flex min-w-0 items-center gap-2">
							<span className="truncate">{t("fetchModels.title")}</span>
							<span className="shrink-0 rounded-full bg-card-hover px-2 py-0.5 text-micro font-medium text-ink-muted tabular-nums">
								{t("fetchModels.totalCount", { n: listedCount })}
							</span>
						</span>
					)}
					bodyClassName="min-h-[220px] max-h-[min(460px,52dvh)]"
					status={(
						<SearchField
							value={search}
							onChange={setSearch}
							onEnter={addTyped}
							placeholder={t("fetchModels.search")}
							size="comfortable"
							className="bg-input"
							/*
							 * Escape clears the search first and closes the dialog once it is empty.
							 *
							 * Handed over from here because the field stops that keydown from propagating, and
							 * `Overlay` listens on `window` — the event never reaches it. Focus opens in this field,
							 * so without this Escape would be a key that does nothing.
							 */
							onEscape={() => dismiss()}
						/>
					)}
					actions={(
						<>
							<span className="flex min-w-0 flex-1 items-center gap-2 truncate text-caption tabular-nums" data-ly-fetch-summary="">
								{edits === 0 ? (
									<span className="text-ink-faint">{t("fetchModels.noChanges")}</span>
								) : (
									<>
										{change.add.length > 0 && <span className="text-accent">{t("fetchModels.toAdd", { n: change.add.length })}</span>}
										{change.add.length > 0 && change.remove.length > 0 && <span className="text-ink-faint">·</span>}
										{change.remove.length > 0 && <span className="text-danger">{t("fetchModels.toRemove", { n: change.remove.length })}</span>}
									</>
								)}
							</span>
							<DialogAction onClick={() => dismiss()}>{t("common.cancel")}</DialogAction>
							<DialogAction
								tone={change.add.length === 0 && change.remove.length > 0 ? "danger" : "primary"}
								disabled={edits === 0}
								// Through `dismiss`, so the change is saved on the way out rather than under a dialog
								// that is still on screen — see the completion note in `Overlay`.
								onClick={() => dismiss(() => onApply(change))}
								className="tabular-nums"
								data-ly-fetch-apply=""
							>
								{applyLabel}
							</DialogAction>
						</>
					)}
				>
					{/* Row fills reach a little past the text; the text itself stays on the title's left edge. */}
					<div className="-mx-2.5 pb-1">
						{canAdd && <AddRow name={query} onAdd={addTyped} />}

						{configured.length > 0 && (
							<Group
								label={t("fetchModels.added")}
								rows={configured}
								unchecked={unchecked}
								onToggleAll={setChecked}
								data-ly-fetch-group="configured"
							>
								{configured.map((row) => (
									<ModelRow key={row.modelId} row={row} checked={!unchecked.has(row.modelId)} onToggle={(on) => setChecked([row.modelId], on)} />
								))}
							</Group>
						)}

						{available.length > 0 && (
							<Group
								label={t("fetchModels.available")}
								rows={available}
								unchecked={unchecked}
								onToggleAll={setChecked}
								data-ly-fetch-group="available"
							>
								{available.map((row) => (
									<ModelRow key={row.modelId} row={row} checked={!unchecked.has(row.modelId)} onToggle={(on) => setChecked([row.modelId], on)} />
								))}
							</Group>
						)}

						{/*
						 * Said once, under the list, only when there is nothing left to add: everything listed is
						 * already here (the dialog used to open to that with no way forward), or the endpoint listed
						 * nothing at all. Either way the next step is the field above.
						 */}
						{!query && rows.available.length === 0 && (
							<p className="px-2.5 pt-4 pb-2 text-caption text-ink-faint" data-ly-fetch-empty="">
								{listedCount === 0 ? t("fetchModels.noneListed") : t("fetchModels.nothingNew")}
							</p>
						)}
						{query && !canAdd && configured.length === 0 && available.length === 0 && (
							<p className="py-12 text-center text-caption text-ink-faint">{t("fetchModels.noMatch")}</p>
						)}
					</div>
				</DialogFrame>
			)}
		</Overlay>
	);
}
