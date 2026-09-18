/**
 * What a typed number may look like before it is committed.
 *
 * Clamping on every keystroke makes a field with min 11 refuse "1" on the way to "16".
 * The box keeps a draft instead: characters that can never become a value in range do
 * not enter, and plus/minus stay inside the same bounds. Nothing is announced.
 */

export type NumberBounds = {
	min: number;
	max: number;
	step?: number;
};

export function decimalsOf(step: number): number {
	const text = String(step);
	if (!/[eE]/.test(text)) return (text.split(".")[1] ?? "").length;
	const fixed = step.toFixed(12).replace(/0+$/, "");
	return (fixed.split(".")[1] ?? "").length;
}

export function roundTo(value: number, decimals: number): number {
	return decimals === 0 ? Math.trunc(value) : Number(value.toFixed(decimals));
}

function clampNumber(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

export function formatNumber(value: number, decimals: number): string {
	if (!Number.isFinite(value)) return "";
	return String(decimals === 0 ? Math.trunc(value) : roundTo(value, decimals));
}

export function stepNumber(value: number, delta: number, bounds: NumberBounds): number {
	const step = bounds.step ?? 1;
	const decimals = decimalsOf(step);
	return clampNumber(roundTo(value + delta, decimals), bounds.min, bounds.max);
}

/** Incomplete drafts stay; a real number is rounded and clamped. */
export function commitDraft(text: string, bounds: NumberBounds): number | null {
	const decimals = decimalsOf(bounds.step ?? 1);
	const raw = text.trim();
	if (raw === "" || raw === "-" || raw === "." || raw === "-.") return null;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed)) return null;
	return clampNumber(roundTo(parsed, decimals), bounds.min, bounds.max);
}

/**
 * Whether this string may sit in the box.
 *
 * Empty is allowed so select-all can be replaced. A minus is allowed only when the
 * floor is below zero. A complete number above max is refused; one below min is
 * kept only when appending digits (or a fraction) can still land inside the range.
 */
export function isLegalDraft(text: string, bounds: NumberBounds): boolean {
	if (text === "") return true;
	if (text.includes(" ") || text.includes("+") || /[eE]/.test(text)) return false;

	const decimals = decimalsOf(bounds.step ?? 1);
	const { min, max } = bounds;
	if (text.includes("-") && min >= 0) return false;
	if (text.includes(".") && decimals === 0) return false;
	if (text === "-") return min < 0;
	if (text === "." || text === "-.") return decimals > 0;
	if (!/^-?\d*\.?\d*$/.test(text)) return false;
	if ((text.match(/\./g) ?? []).length > 1) return false;

	const body = text.startsWith("-") ? text.slice(1) : text;
	const dot = body.indexOf(".");
	const intPart = dot === -1 ? body : body.slice(0, dot);
	const fracPart = dot === -1 ? null : body.slice(dot + 1);
	if (fracPart !== null && fracPart.length > decimals) return false;
	if (intPart.length > 1 && intPart.startsWith("0")) return false;

	const parsed = Number(text);
	if (Number.isFinite(parsed) && !text.endsWith(".") && parsed > max) return false;
	if (Number.isFinite(parsed) && !text.endsWith(".") && parsed >= min && parsed <= max) return true;
	return canReach(text, min, max, decimals);
}

function overlaps(left0: number, left1: number, right0: number, right1: number): boolean {
	return left0 <= right1 && right0 <= left1;
}

function canReach(text: string, min: number, max: number, decimals: number): boolean {
	const negative = text.startsWith("-");
	const body = negative ? text.slice(1) : text;
	const hasDot = body.includes(".");
	const [intRaw, fracRaw] = body.split(".");
	const intPart = intRaw ?? "";
	const frac = fracRaw ?? "";

	if (hasDot) {
		if (frac.length >= decimals) {
			const parsed = Number(text);
			return Number.isFinite(parsed) && parsed >= min && parsed <= max;
		}
		const base = Number(`${negative ? "-" : ""}${intPart || "0"}.${frac}`);
		if (!Number.isFinite(base)) return false;
		const span = 10 ** -frac.length - 10 ** -decimals;
		return negative ? overlaps(base - span, base, min, max) : overlaps(base, base + span, min, max);
	}

	if (intPart === "0" || intPart === "") {
		if (0 >= min && 0 <= max) return true;
		if (decimals === 0) return false;
		const span = 1 - 10 ** -decimals;
		return negative ? overlaps(-span, 0, min, max) : overlaps(0, span, min, max);
	}

	const parsed = Number(`${negative ? "-" : ""}${intPart}`);
	if (!Number.isFinite(parsed)) return false;

	if (!negative) {
		for (let places = 0; places <= 12; places++) {
			const factor = 10 ** places;
			const low = parsed * factor;
			if (overlaps(low, low + factor - 1, min, max)) return true;
			if (low > max) break;
		}
		if (decimals > 0 && overlaps(parsed, parsed + (1 - 10 ** -decimals), min, max)) return true;
		return false;
	}

	for (let places = 0; places <= 12; places++) {
		const factor = 10 ** places;
		const high = parsed * factor;
		if (overlaps(high - (factor - 1), high, min, max)) return true;
		if (high < min) break;
	}
	return decimals > 0 && overlaps(parsed - (1 - 10 ** -decimals), parsed, min, max);
}
