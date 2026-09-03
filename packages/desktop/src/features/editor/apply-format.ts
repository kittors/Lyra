/**
 * Formatting the buffer in place, without throwing the cursor to the top of the file.
 *
 * The naive version — replace the whole document — works and is unusable: every mark into the
 * document is mapped through a change that covers all of it, so the cursor lands at the end, the
 * scroll position is lost, and the undo history records one enormous edit. On a file you were
 * halfway down, pressing format means finding your place again.
 *
 * So the change is narrowed to the part that actually differs. Formatting is nearly always local
 * — a few lines re-indented, a trailing comma added — and everything outside that span is
 * untouched, which means CodeMirror maps the cursor through unchanged and it stays exactly where
 * it was sitting.
 */

import type { EditorView } from "@codemirror/view";
import { formatFile } from "./format-file.ts";
import type { FormatOptions } from "./format.ts";

/** The span that differs between two strings: everything outside it is identical. */
export function changedRange(before: string, after: string): { from: number; to: number; insert: string } | null {
	if (before === after) return null;

	let start = 0;
	const shortest = Math.min(before.length, after.length);
	while (start < shortest && before[start] === after[start]) start++;

	/*
	 * The suffix walk stops at `start`, in both strings.
	 *
	 * Without that guard the two scans can cross on a repetitive document — think a file of
	 * identical lines gaining one — and produce a range whose end is before its beginning, which
	 * CodeMirror rejects outright.
	 */
	let endBefore = before.length;
	let endAfter = after.length;
	while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
		endBefore--;
		endAfter--;
	}

	return { from: start, to: endBefore, insert: after.slice(start, endAfter) };
}

export type ApplyResult =
	/** Formatted, and the document changed. */
	| { kind: "formatted"; by: string; config?: string }
	/** Formatted, and it was already correct — worth saying, since nothing visibly happened. */
	| { kind: "unchanged"; by: string }
	| { kind: "unsupported" }
	| { kind: "failed"; message: string }
	| { kind: "missing"; tool: string; install: string };

/**
 * Format what is in the view, and report what happened.
 *
 * The caller decides how to say it. Every outcome is worth a word — including "nothing changed",
 * because a shortcut that appears to do nothing is indistinguishable from one that is broken.
 */
export async function applyFormat(view: EditorView, path: string, options: FormatOptions): Promise<ApplyResult> {
	const before = view.state.doc.toString();
	const outcome = await formatFile(path, before, options);

	if (!outcome.ok) {
		if (outcome.kind === "missing") return { kind: "missing", tool: outcome.tool, install: outcome.install };
		if (outcome.kind === "failed") return { kind: "failed", message: outcome.message };
		return { kind: "unsupported" };
	}
	if (!outcome.changed) return { kind: "unchanged", by: outcome.by };

	/*
	 * Against the document as it is *now*, not as it was when formatting started.
	 *
	 * Prettier is asynchronous and a large TypeScript file takes a moment; anything typed in that
	 * window would be silently reverted by a change computed from the older text. Rare, and
	 * unpleasant enough to be worth the check — the format is simply dropped, and pressing it
	 * again after the typing stops does the right thing.
	 */
	if (view.state.doc.toString() !== before) return { kind: "unchanged", by: outcome.by };

	const change = changedRange(before, outcome.text);
	if (!change) return { kind: "unchanged", by: outcome.by };
	view.dispatch({ changes: change, scrollIntoView: false });
	return { kind: "formatted", by: outcome.by, config: outcome.config };
}
