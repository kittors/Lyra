/**
 * Running the old path and the new one side by side, and saying exactly how they differ.
 *
 * The migration this supports is deliberately not a switch-over. Five loaders are being replaced
 * by one, and the failure mode of getting that wrong is not a crash — it is a skill that quietly
 * stops being offered, or a rule that starts losing to a copy of itself from another tool. Both
 * look like nothing at all until someone notices the agent has forgotten something.
 *
 * So the comparison is by name and order, not by object identity, and the three kinds of
 * difference are not equally acceptable:
 *
 *   `missing` — the new path lost something. Never acceptable.
 *   `reorder` — precedence changed. Only acceptable with a written reason.
 *   `extra`   — the new path found something more. Acceptable, but it must be attributable to a
 *               provider that the old path had no equivalent of.
 */

import type { Sourced } from "./types.ts";

export interface Drift {
	kind: "missing" | "extra" | "reorder";
	name: string;
	detail: string;
}

export interface CompareOptions {
	/**
	 * Names whose new position is a deliberate correction rather than drift.
	 *
	 * There is one at the time of writing: a custom `general` agent now beats the built-in of the
	 * same name, which is the point of the change and would otherwise be reported forever.
	 */
	expectedReorder?: ReadonlySet<string>;
	/**
	 * Skip the ordering comparison.
	 *
	 * For lists whose two sides are ordered on different axes and where that is not a defect. Rules
	 * are the case: the old loader returns them grouped into buckets, so a flattened `[...always,
	 * ...book, ...stream]` is ordered by bucket, while the registry returns one list ordered by
	 * provider precedence. Comparing those positions reports a reordering for every rule whose
	 * bucket and priority disagree — which was the first thing this comparison found, and it was
	 * measuring the flattening rather than anything either path does.
	 *
	 * Set it only where the two orders genuinely answer different questions. Where they answer the
	 * same one, a difference is drift and needs reading.
	 */
	ignoreOrder?: boolean;
}

/**
 * Compare an old list against a registry result.
 *
 * `legacy` is whatever the old loader produced, in its own order. `next` is the registry's items.
 */
export function compareCapabilitySets<T extends { name: string }>(
	legacy: readonly T[],
	next: readonly Sourced<T>[],
	options: CompareOptions = {},
): Drift[] {
	const drift: Drift[] = [];
	const legacyNames = legacy.map((item) => item.name);
	const nextNames = next.map((item) => item.name);
	const nextByName = new Map(next.map((item) => [item.name, item]));

	for (const name of legacyNames) {
		if (!nextByName.has(name)) {
			drift.push({ kind: "missing", name, detail: "旧路径有，新路径没有" });
		}
	}

	const legacySet = new Set(legacyNames);
	for (const item of next) {
		if (!legacySet.has(item.name)) {
			drift.push({
				kind: "extra",
				name: item.name,
				detail: `新路径多出来的，来自 ${item.provenance.providerLabel}（${item.provenance.path}）`,
			});
		}
	}

	/*
	 * Order is compared only across the names both sides have. Comparing raw positions would report
	 * every name after an addition as reordered, which buries the one real reordering in noise.
	 */
	if (options.ignoreOrder) return drift;

	const common = legacyNames.filter((name) => nextByName.has(name));
	const commonInNext = nextNames.filter((name) => legacySet.has(name));
	for (let i = 0; i < common.length; i += 1) {
		if (common[i] === commonInNext[i]) continue;
		if (options.expectedReorder?.has(common[i])) continue;
		drift.push({
			kind: "reorder",
			name: common[i],
			detail: `旧路径在第 ${i + 1} 位，新路径这个位置是 ${commonInNext[i] ?? "(空)"}`,
		});
	}

	return drift;
}

/** A one-screen summary for the log. */
export function formatDrift(kind: string, drift: Drift[]): string {
	if (drift.length === 0) return `capability drift · ${kind}: 无差异`;
	const lines = drift.map((d) => `  ${d.kind.padEnd(8)} ${d.name} — ${d.detail}`);
	return [`capability drift · ${kind}: ${drift.length} 条`, ...lines].join("\n");
}

/** Whether the differences are the acceptable kind. `missing` and `reorder` never are. */
export function driftIsAcceptable(drift: Drift[]): boolean {
	return drift.every((d) => d.kind === "extra");
}
