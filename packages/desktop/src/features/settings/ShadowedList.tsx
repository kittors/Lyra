/**
 * The same-name conflicts on a settings page, with the two things the list alone could not do.
 *
 * Listing who shadowed whom answers "why is the one I wrote not running". It does not answer the
 * question that follows — "which one should I keep?" — and that one needs the difference in
 * front of you and a way to act on it without opening either file. So each row can unfold into
 * a diff (winner first, so the pluses are what switching would add), and 「改用那个」 writes the
 * preference and then says where it wrote it: a change nobody can find later is a change they
 * cannot undo.
 *
 * Shared by rules and skills because the relation is the same; the callbacks come from the page,
 * which is also what lets this mount in a test with nothing behind it.
 */

import type { DiffHunk } from "@lyra/core";
import { Layers } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { Card } from "./controls.tsx";

export interface ShadowedEntry {
	name: string;
	/** The one that lost. */
	path: string;
	/** The one that won, and who supplied it. */
	by: string;
	byLabel: string;
}

export interface ShadowedDiff {
	hunks: DiffHunk[];
	added: number;
	removed: number;
}

export function ShadowedList({
	kind,
	entries,
	diff,
	prefer,
	onChanged,
	renderDiff,
}: {
	kind: "rule" | "skill";
	entries: ShadowedEntry[];
	/** Winner first, loser second. */
	diff: (winner: string, loser: string) => Promise<ShadowedDiff>;
	/** Make `path` win `name`; resolves with the file the preference was written to. */
	prefer: (name: string, path: string) => Promise<{ wroteTo: string }>;
	/** Reload the list — the roles have just swapped. */
	onChanged: () => void;
	/**
	 * How hunks are drawn — the page passes the git feature's `DiffView`. Injected rather than
	 * imported so this stays a row of text and two calls: the diff painter drags a barrel of
	 * images and grammars behind it, none of which is what a test of this row is about.
	 */
	renderDiff: (hunks: DiffHunk[], path: string) => ReactNode;
}) {
	/*
	 * Where the last switch went, by name — kept here, above the rows, because a switch swaps the
	 * rows: the file that was shadowed is now the winner and leaves this list, and the row that
	 * replaces it is the other file, freshly mounted. State on the row would vanish with it.
	 */
	const [wrote, setWrote] = useState<Record<string, { chosen: string; wroteTo: string }>>({});
	if (entries.length === 0) return null;
	const noun = kind === "rule" ? "条同名规则" : "个同名技能";
	return (
		<Card className="mb-6">
			<div className="px-4 py-3">
				{/*
				 * Not styled as a warning. Overriding is how this is supposed to work; a project
				 * file of the same name is more specific than yours, and colouring that like a
				 * fault would make a working feature look like a problem.
				 */}
				<div className="mb-2 flex items-center gap-1.5 text-label text-ink-muted">
					<Layers size={13} strokeWidth={1.9} />
					{entries.length} {noun}被覆盖
				</div>
				{entries.map((entry) => (
					<Row
						key={entry.path}
						entry={entry}
						diff={diff}
						wrote={wrote[entry.name]}
						prefer={async (name, path) => {
							const result = await prefer(name, path);
							setWrote((was) => ({ ...was, [name]: { chosen: path, wroteTo: result.wroteTo } }));
							onChanged();
						}}
						renderDiff={renderDiff}
					/>
				))}
			</div>
		</Card>
	);
}

function Row({
	entry,
	diff,
	prefer,
	wrote,
	renderDiff,
}: {
	entry: ShadowedEntry;
	diff: (winner: string, loser: string) => Promise<ShadowedDiff>;
	prefer: (name: string, path: string) => Promise<void>;
	/** The last switch for this name, if any — shown so it can be found again, and undone. */
	wrote?: { chosen: string; wroteTo: string };
	renderDiff: (hunks: DiffHunk[], path: string) => ReactNode;
}) {
	const [open, setOpen] = useState(false);
	const [shown, setShown] = useState<ShadowedDiff | null>(null);
	const [busy, setBusy] = useState(false);

	const toggle = async () => {
		const next = !open;
		setOpen(next);
		if (next && !shown) setShown(await diff(entry.by, entry.path));
	};

	const switchTo = async () => {
		setBusy(true);
		try {
			await prefer(entry.name, entry.path);
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="py-0.5 text-detail text-ink-faint" data-shadowed={entry.name}>
			<div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
				<span className="min-w-0">
					<span className="font-mono">{entry.path}</span> 被 {entry.byLabel} 的 <span className="font-mono">{entry.by}</span> 覆盖
				</span>
				<button type="button" data-shadowed-diff onClick={() => void toggle()} className={link}>
					{open ? "收起差异" : "看差异"}
				</button>
				{/* Still offered after a switch: by then this row is the other file, and this is the way back. */}
				<button type="button" data-shadowed-prefer disabled={busy} onClick={() => void switchTo()} className={link}>
					改用那个
				</button>
			</div>
			{/* Where it went, so it can be found again — and undone, which is the same button, now on this row. */}
			{wrote && (
				<p data-shadowed-wrote className="mt-0.5 text-caption text-ink-muted">
					已改用 <span className="font-mono">{wrote.chosen}</span>，偏好写在 <span className="font-mono">{wrote.wroteTo}</span>
				</p>
			)}
			{open && (
				<div className="mt-1.5 overflow-hidden rounded-lg border border-line-soft" data-shadowed-hunks>
					{shown === null ? (
						<p className="px-3 py-2 text-caption text-ink-faint">正在读两份文件…</p>
					) : shown.hunks.length === 0 ? (
						<p className="px-3 py-2 text-caption text-ink-faint">两份内容一模一样——改用哪个都没有区别。</p>
					) : (
						<>
							<p className="px-3 pt-2 text-caption text-ink-faint">
								「+」是改用那份会多出来的：+{shown.added} −{shown.removed}
							</p>
							{renderDiff(shown.hunks, entry.path)}
						</>
					)}
				</div>
			)}
		</div>
	);
}

const link = "shrink-0 text-caption text-ink-muted underline-offset-2 transition-colors duration-[var(--ly-t-quick)] hover:text-ink hover:underline disabled:opacity-50";
