/**
 * Addressable windows for lines that do not fit in the cap.
 *
 * A 2 000-character ceiling is the cost gate. The bug was treating "the first
 * 2 000 characters" as the line: a match at character 80 000 of a one-line
 * catalog was reported as a hit and then hidden. The cap stays; every omitted
 * span keeps an address (`char_offset`) so the next call can open it.
 */

export const MAX_LINE_CHARS = 2000;

export interface CharWindow {
	/** 0-based inclusive start in the source string. */
	start: number;
	/** 0-based exclusive end. */
	end: number;
	text: string;
}

export interface MatchOptions {
	literal?: boolean;
	ignoreCase?: boolean;
}

/** Surrogate-safe slice of at most `max` UTF-16 units starting at `start`. */
export function charWindow(text: string, start = 0, max = MAX_LINE_CHARS): CharWindow {
	let from = Math.max(0, Math.min(start, text.length));
	let to = Math.min(text.length, from + max);
	let slice = text.slice(from, to);
	if (from > 0 && /^[\uDC00-\uDFFF]/.test(slice)) {
		slice = slice.slice(1);
		from += 1;
	}
	if (/[\uD800-\uDBFF]$/.test(slice)) {
		slice = slice.slice(0, -1);
		to -= 1;
	}
	return { start: from, end: to, text: slice };
}

/**
 * Window around a match, not the line head.
 *
 * A third of the budget sits before the hit so the model sees a little left
 * context (the id next to a name) without spending the whole cap there.
 */
function matchWindowAt(text: string, matchAt: number, max = MAX_LINE_CHARS): CharWindow {
	let start = 0;
	if (matchAt > 0) start = matchAt - Math.min(matchAt, Math.floor(max / 3));
	if (start + max > text.length) start = Math.max(0, text.length - max);
	return charWindow(text, start, max);
}

export function matchWindow(text: string, pattern?: string, options?: MatchOptions, max = MAX_LINE_CHARS): CharWindow {
	return matchWindowAt(text, matchIndex(text, pattern, options), max);
}

function formatWindow(window: CharWindow, length: number): string {
	const head = window.start > 0 ? `… [${window.start} characters omitted] ` : "";
	const tail = window.end < length
		? ` … [${length - window.end} characters omitted; continue with char_offset=${window.end + 1}]`
		: "";
	return `${head}${window.text}${tail}`;
}

export function formatCharWindow(text: string, start = 0, max = MAX_LINE_CHARS): string {
	if (text.length <= max && start <= 0) return text;
	return formatWindow(charWindow(text, start, max), text.length);
}

export function formatMatchWindowAt(text: string, matchAt: number, max = MAX_LINE_CHARS): string {
	if (text.length <= max) return text;
	return formatWindow(matchWindowAt(text, matchAt, max), text.length);
}

export function formatMatchWindow(text: string, pattern?: string, options?: MatchOptions, max = MAX_LINE_CHARS): string {
	if (text.length <= max) return text;
	return formatWindow(matchWindow(text, pattern, options, max), text.length);
}

/** Convert a UTF-8 byte offset in `text` to a JS string index. */
export function utf8ByteOffsetToIndex(text: string, bytes: number): number {
	if (bytes <= 0) return 0;
	const buf = Buffer.from(text, "utf8");
	if (bytes >= buf.length) return text.length;
	return buf.subarray(0, bytes).toString("utf8").length;
}

/**
 * Bash preview: persist the raw file elsewhere, show a short window here.
 *
 * A one-line dump used to spend the whole 60k budget on the head, so the last
 * tokens (the thing `echo` finished with) never reached the model. Each long
 * line keeps a head and a tail; the file still has the middle, addressed by
 * `char_offset`. Then a total-size clip, still head-and-tail.
 */
const ERROR_LINE = /✖|✗|× failing|FAIL(?:ING|ED)?\b|AssertionError|Error:|error TS\d+|ELIFECYCLE|oxlint|not ok\b|failed\b/i;

export function clipOutput(text: string, maxTotal: number): string {
	const capped = text.split("\n").map((line) => formatLineHeadTail(line)).join("\n");
	if (capped.length <= maxTotal) return capped;
	const errors = collectErrorSlices(capped, Math.min(24_000, Math.floor(maxTotal * 0.45)));
	const marker = errors
		? `\n\n… [error excerpt] …\n\n${errors}\n\n`
		: `\n\n… [${capped.length - maxTotal} characters omitted] …\n\n`;
	const leftover = maxTotal - marker.length;
	if (leftover < 200) return (errors || capped).slice(0, maxTotal);
	const half = Math.floor(leftover / 2);
	return `${capped.slice(0, half)}${marker}${capped.slice(-half)}`;
}

/** Keep the failing assertion, not only the command's head and tail. */
function collectErrorSlices(text: string, budget: number): string {
	const lines = text.split("\n");
	const hits: number[] = [];
	for (let i = 0; i < lines.length; i++) {
		if (ERROR_LINE.test(lines[i])) hits.push(i);
	}
	if (hits.length === 0) return "";
	const context = 8;
	const ranges: [number, number][] = [];
	for (const i of hits) {
		const start = Math.max(0, i - context);
		const end = Math.min(lines.length - 1, i + context);
		const last = ranges[ranges.length - 1];
		if (last && start <= last[1] + 1) last[1] = Math.max(last[1], end);
		else ranges.push([start, end]);
	}
	const chunks: string[] = [];
	let used = 0;
	for (const [start, end] of ranges) {
		const chunk = lines.slice(start, end + 1).join("\n");
		if (used + chunk.length + 8 > budget) {
			const room = budget - used - 8;
			if (room > 80) chunks.push(chunk.slice(0, room));
			break;
		}
		chunks.push(chunk);
		used += chunk.length + 8;
	}
	return chunks.join("\n\n…\n\n");
}

function formatLineHeadTail(line: string, max = MAX_LINE_CHARS): string {
	if (line.length <= max) return line;
	const tail = Math.max(1, Math.floor(max / 3));
	const head = max - tail;
	const omitted = line.length - max;
	return `${line.slice(0, head)} … [${omitted} characters omitted; continue with char_offset=${head + 1}] … ${line.slice(-tail)}`;
}

function matchIndex(text: string, pattern: string | undefined, options?: MatchOptions): number {
	if (!pattern) return 0;
	if (options?.literal) {
		const at = options.ignoreCase ? text.toLowerCase().indexOf(pattern.toLowerCase()) : text.indexOf(pattern);
		return at >= 0 ? at : 0;
	}
	try {
		const found = new RegExp(pattern, options?.ignoreCase ? "i" : "").exec(text);
		return found ? found.index : 0;
	} catch {
		const at = text.indexOf(pattern);
		return at >= 0 ? at : 0;
	}
}

/** 1-indexed line and column of a UTF-16 offset in `text`. */
export function indexToLineCol(text: string, index: number): { line: number; col: number } {
	let line = 1;
	let start = 0;
	for (let i = 0; i < index && i < text.length; i++) {
		if (text[i] === "\n") {
			line += 1;
			start = i + 1;
		}
	}
	return { line, col: index - start + 1 };
}

export function coversChars(ranges: [number, number][], from: number, to: number): boolean {
	for (let pos = from; pos <= to; pos++) {
		if (!ranges.some(([a, b]) => pos >= a && pos <= b)) return false;
	}
	return true;
}

export function mergeCharRanges(ranges: [number, number][]): [number, number][] {
	if (ranges.length <= 1) return ranges;
	const sorted = [...ranges].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
	const merged: [number, number][] = [sorted[0]];
	for (let i = 1; i < sorted.length; i++) {
		const last = merged[merged.length - 1];
		const next = sorted[i];
		if (next[0] <= last[1] + 1) last[1] = Math.max(last[1], next[1]);
		else merged.push([next[0], next[1]]);
	}
	return merged;
}

export function longLineFooter(entries: { line: number; length: number; shownFrom: number; shownTo: number }[]): string {
	if (entries.length === 0) return "";
	if (entries.length === 1) {
		const entry = entries[0];
		const next = entry.shownTo < entry.length ? `; call read again with char_offset=${entry.shownTo + 1} for more` : "";
		return `\n\n[line ${entry.line} is ${entry.length} characters; showing ${entry.shownFrom}-${entry.shownTo}${next}]`;
	}
	return `\n\n[${entries.length} lines exceed ${MAX_LINE_CHARS} characters; showing a ${MAX_LINE_CHARS}-character window. Continue a line with char_offset]`;
}
