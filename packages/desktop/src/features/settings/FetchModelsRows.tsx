/**
 * The parts of the pull dialog's list: a titled group, a model row, the words beside a name, and the
 * row that turns a search into a model to add. The dialog itself — what is checked, what applying
 * does — is `FetchModelsModal`.
 */

import { Palette, Plus } from "lucide-react";
import { isImageModelId, isImageModel } from "@lyra/core/image-models";
import { useI18n } from "../../i18n/index.ts";
import { ChoiceMark } from "../../ui/primitives/ChoiceMark.tsx";
import { formatWindow, ModelIcon } from "../models/index.ts";
import { defaultWindowLabel } from "./model-defaults.ts";
import type { SyncRow } from "./model-sync.ts";

/**
 * A titled run of rows, with its own select-all.
 *
 * Per group, not one beside the search field as it was: the two groups mean opposite things when
 * unchecked — one removes what is configured, the other skips what was offered — and a single
 * 「取消全选」 that did both turned "I don't want the new ones" into "delete everything I have".
 * It keeps its words for the reason it got them: a bare checkbox with nothing to its left reads as
 * nothing at all.
 */
export function Group({
	label,
	rows,
	unchecked,
	onToggleAll,
	children,
	...rest
}: {
	label: string;
	rows: readonly SyncRow[];
	unchecked: ReadonlySet<string>;
	onToggleAll: (ids: readonly string[], checked: boolean) => void;
	children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
	const { t } = useI18n();
	const allChecked = rows.every((row) => !unchecked.has(row.modelId));
	return (
		<div role="group" aria-label={label} className="pt-1.5 first:pt-0" {...rest}>
			<div className="flex h-7 items-center justify-between px-2.5">
				<span className="text-caption font-medium text-ink-muted">
					{label}
					<span className="ml-1.5 font-normal text-ink-faint tabular-nums">{rows.length}</span>
				</span>
				{rows.length > 1 && (
					<button
						type="button"
						onClick={() => onToggleAll(rows.map((row) => row.modelId), !allChecked)}
						className="rounded-md px-1.5 py-0.5 text-caption text-ink-faint transition-colors hover:bg-card-hover hover:text-ink"
						data-ly-fetch-toggle-all=""
					>
						{allChecked ? t("common.deselectAll") : t("common.selectAll")}
					</button>
				)}
			</div>
			<div className="space-y-0.5">{children}</div>
		</div>
	);
}

/*
 * A row is a row, not a card.
 *
 * Each row used to carry its own border and fill, so thirty-three models were thirty-three stacked
 * cards, and with everything checked by default they all lit up blue at once — the names were what
 * mattered and the screen was talking about borders.
 *
 * Checking does not tint the row either. Every row opens checked; a state that covers the whole
 * screen distinguishes nothing. The checkbox column says it, and the fill is kept for the row under
 * the pointer — "this is the one you are looking at", true of one row at a time. What a row *will
 * do* when applied is said in words beside the name, and only when it is not the obvious thing:
 * a configured model about to be removed, a typed name, a configured model the endpoint no longer
 * lists.
 */
export function ModelRow({ row, checked, onToggle }: { row: SyncRow; checked: boolean; onToggle: (checked: boolean) => void }) {
	const { t } = useI18n();
	const image = row.existing ? isImageModel(row.existing) : isImageModelId(row.modelId);
	const removing = Boolean(row.existing) && !checked;
	// A configured model shows its own window; a new one, the default the import will write. A model
	// that draws has no window, and the column stays empty so the rest still line up.
	const contextWindow = image ? "" : row.existing ? formatWindow(row.existing.contextWindow) : defaultWindowLabel();
	return (
		<label
			className="group flex cursor-pointer items-center justify-between gap-3 rounded-lg px-2.5 py-2 transition-colors select-none hover:bg-card-hover"
			data-ly-fetch-row={row.modelId}
			data-ly-fetch-state={row.existing ? (checked ? "keep" : "remove") : checked ? "add" : "skip"}
		>
			<span className="flex min-w-0 items-center gap-3">
				<button
					type="button"
					role="checkbox"
					aria-checked={checked}
					aria-label={row.modelId}
					onClick={(event) => {
						event.stopPropagation();
						onToggle(!checked);
					}}
					className="shrink-0 cursor-pointer text-ink-muted focus:outline-none"
				>
					<ChoiceMark kind="checkbox" checked={checked} />
				</button>
				<ModelIcon model={row.modelId} name={row.existing?.name} size={16} />
				<span className={`truncate font-mono text-label transition-colors ${removing ? "text-ink-faint line-through decoration-ink-faint/60" : "text-ink"}`}>
					{row.modelId}
				</span>
				{image && (
					<span role="img" aria-label={t("modelEditor.imageOutput")} data-ly-tip={t("modelEditor.imageOutput")} className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-[5px] bg-accent/12 text-accent">
						<Palette size={10.5} strokeWidth={2} />
					</span>
				)}
				{removing ? (
					<Tag tone="danger">{t("fetchModels.willRemove")}</Tag>
				) : row.custom ? (
					<Tag tone="accent">{t("fetchModels.typed")}</Tag>
				) : row.existing && !row.listed ? (
					<Tag tone="muted" tip={t("fetchModels.unlistedDetail")}>{t("fetchModels.unlisted")}</Tag>
				) : null}
			</span>
			<span className="shrink-0 font-mono text-caption text-ink-faint">{contextWindow}</span>
		</label>
	);
}

function Tag({ tone, tip, children }: { tone: "danger" | "accent" | "muted"; tip?: string; children: React.ReactNode }) {
	const paint = tone === "danger" ? "bg-danger/10 text-danger" : tone === "accent" ? "bg-accent/10 text-accent" : "bg-ink-faint/10 text-ink-faint";
	return (
		<span data-ly-tip={tip} className={`shrink-0 rounded px-1.5 py-px text-micro ${paint}`}>
			{children}
		</span>
	);
}

/**
 * The search, turned into a name to add — for the model a relay serves without listing it.
 *
 * At the top rather than after the matches, because it is the answer to what was typed: the
 * matches below are suggestions, this is the thing itself. Enter does the same.
 */
export function AddRow({ name, onAdd }: { name: string; onAdd: () => void }) {
	const { t } = useI18n();
	return (
		<button
			type="button"
			onClick={onAdd}
			className="mb-1 flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-card-hover"
			data-ly-fetch-add=""
		>
			<span className="grid size-4 shrink-0 place-items-center text-accent">
				<Plus size={14} strokeWidth={2.2} />
			</span>
			<span className="min-w-0 truncate font-mono text-label text-ink">{name}</span>
			<span className="ml-auto flex shrink-0 items-center gap-1.5 text-caption text-ink-faint">
				{t("fetchModels.addTyped")}
				<kbd className="rounded border border-line-soft px-1 font-sans text-micro">↵</kbd>
			</span>
		</button>
	);
}
