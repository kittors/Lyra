/**
 * One `condition` pattern, compiled the way the loader compiles it — and refused the way the
 * loader refuses it.
 *
 * Split out of the loader so the settings page can run the same checks while a pattern is still
 * being typed. The loader's diagnostics arrive after the file is saved and the rules reloaded,
 * which is exactly too late for "did I write this too wide?" — the question the plan names as
 * this system's biggest source of frustration. Two implementations of "what counts as a bad
 * regex" would drift, and the page would then pass a pattern the loader later drops in silence.
 *
 * Node-free on purpose: nothing here but a regex, so the renderer can import it directly.
 */

export const MAX_CONDITION_LENGTH = 500;

export type CompiledCondition = { ok: true; regex: RegExp } | { ok: false; reason: string };

export function compileCondition(pattern: string): CompiledCondition {
	if (pattern.length > MAX_CONDITION_LENGTH) {
		return { ok: false, reason: `condition 超过 ${MAX_CONDITION_LENGTH} 字符，已忽略。` };
	}
	/*
	 * Refuse nested quantifiers outright.
	 *
	 * `(a+)+`, `(a*)*`, `(\w+\s?)+` and friends are the classic catastrophic-backtracking shapes,
	 * and they cannot be defended against after the fact — a JS regex runs to completion with
	 * nothing able to interrupt it. The matcher also caps how much text it sees, but refusing the
	 * pattern is the honest answer: a rule that cannot be evaluated safely should say so at load
	 * time, not stall a stream months later.
	 */
	if (/\([^)]*[+*]\s*\)\s*[+*]/.test(pattern)) {
		return {
			ok: false,
			reason: `condition 里有嵌套量词（形如 (a+)+），这类正则可能指数级回溯，已忽略：${pattern.slice(0, 60)}`,
		};
	}

	// `(?i)` and friends are how the pattern would be written in most other tools.
	let flags = "";
	let body = pattern;
	const inline = /^\(\?([ims]+)\)/.exec(body);
	if (inline) {
		flags = inline[1];
		body = body.slice(inline[0].length);
	}
	try {
		return { ok: true, regex: new RegExp(body, flags) };
	} catch (error) {
		return { ok: false, reason: `condition 不是合法正则，已忽略：${error instanceof Error ? error.message : String(error)}` };
	}
}

/**
 * A compiled condition, written back the way a file would spell it: inline flags first, no
 * slashes. The inverse of `compileCondition`, for the settings page — which shows a rule's
 * pattern and hands it to the try-panel, and needs it in a form the loader would accept again.
 * `String(regex)` gave `/todo/i`, which is a JavaScript literal, not a condition.
 *
 * `source` escapes a forward slash as `\/`; the loader reads that back as the same regex.
 */
export function conditionSource(regex: RegExp): string {
	return regex.flags ? `(?${regex.flags})${regex.source}` : regex.source;
}
