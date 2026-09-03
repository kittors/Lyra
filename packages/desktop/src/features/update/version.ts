/**
 * Which of two versions is newer.
 *
 * Written out rather than pulled in, because the whole of what this app needs from semver is an
 * ordering, and the whole of what goes wrong with an ordering is invisible: an app that compares
 * versions as strings decides 0.10.0 is older than 0.9.0 and then never offers the update again.
 *
 * Pre-release suffixes sort *before* the release they lead to — 1.0.0-beta.2 is not 1.0.0 — which is
 * what stops someone running a beta from being told there is nothing newer.
 */

export interface Parsed {
	numbers: number[];
	/** The dotted identifiers after `-`, empty for a release. */
	pre: string[];
}

/** Tolerant of a leading `v` and of trailing build metadata, both of which appear in release tags. */
export function parseVersion(raw: string): Parsed | null {
	const cleaned = raw.trim().replace(/^v/i, "").split("+")[0] ?? "";
	const [core, ...rest] = cleaned.split("-");
	if (!core) return null;
	const numbers = core.split(".").map((part) => Number(part));
	if (numbers.length === 0 || numbers.some((n) => !Number.isInteger(n) || n < 0)) return null;
	const pre = rest.join("-");
	return { numbers, pre: pre ? pre.split(".") : [] };
}

/** −1, 0 or 1, the way a comparator is expected to answer. */
export function compareVersions(a: string, b: string): number {
	const left = parseVersion(a);
	const right = parseVersion(b);
	if (!left || !right) return 0;

	const length = Math.max(left.numbers.length, right.numbers.length);
	for (let i = 0; i < length; i++) {
		// A missing segment is zero: 1.2 and 1.2.0 are the same version.
		const diff = (left.numbers[i] ?? 0) - (right.numbers[i] ?? 0);
		if (diff !== 0) return diff > 0 ? 1 : -1;
	}

	// Having a pre-release makes it earlier than the same numbers without one.
	if (left.pre.length === 0 && right.pre.length > 0) return 1;
	if (left.pre.length > 0 && right.pre.length === 0) return -1;

	const parts = Math.max(left.pre.length, right.pre.length);
	for (let i = 0; i < parts; i++) {
		const x = left.pre[i];
		const y = right.pre[i];
		if (x === undefined) return -1;
		if (y === undefined) return 1;
		if (x === y) continue;
		// Numeric identifiers compare as numbers and rank below alphanumeric ones.
		const nx = /^\d+$/.test(x) ? Number(x) : null;
		const ny = /^\d+$/.test(y) ? Number(y) : null;
		if (nx !== null && ny !== null) return nx > ny ? 1 : -1;
		if (nx !== null) return -1;
		if (ny !== null) return 1;
		return x > y ? 1 : -1;
	}
	return 0;
}

/** Whether `latest` is worth telling someone about, given what they are running. */
export function isNewer(latest: string, current: string): boolean {
	return compareVersions(latest, current) > 0;
}
