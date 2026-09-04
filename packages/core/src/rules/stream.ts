/**
 * Watching the model's output as it arrives, and catching a rule violation mid-sentence.
 *
 * A rule in the system prompt is read once, at the start, and competes for attention with
 * everything else there. A rule watched against the stream costs nothing until the moment it is
 * relevant — and at that moment it arrives with the violation still on screen, which is the only
 * time the model is certain to be thinking about it.
 *
 * Three things this must not do, in order of how badly they would hurt:
 *
 *   Slow the stream. Every delta passes through here. Rules that watch nothing pay nothing, the
 *   buffers are bounded, and a regex that takes too long is disabled rather than tolerated.
 *
 *   Fire forever. A rule that re-triggers on the correction it caused is an infinite loop with a
 *   token meter attached. Default is once per session, and there is a hard ceiling per turn on
 *   top of whatever the rule asked for.
 *
 *   Fire on thinking. Exploring a wrong idea is what thinking is for; correcting it there
 *   suppresses the exploration rather than the mistake. Thinking is opt-in per rule.
 */

import type { Rule, RuleScope } from "./types.ts";

/** One chunk of model output, tagged with where it came from. */
export interface StreamChunk {
	source: "text" | "thinking" | "tool";
	delta: string;
	/** Buffer identity: the source for prose, the tool-call id for arguments. */
	key: string;
	toolName?: string;
	/** File paths visible in the (possibly partial) arguments so far. */
	paths?: string[];
}

export interface RuleMatch {
	rule: Rule;
	/** The text that matched, for the UI to highlight. */
	excerpt: string;
	source: StreamChunk["source"];
	toolName?: string;
}

/** Beyond this a buffer drops its oldest bytes; a rule that needs more context than this is misjudged. */
const MAX_BUFFER = 64 * 1024;
/**
 * How much of a buffer one match sees.
 *
 * This is the real defence against a runaway pattern, and it has to be a *limit on the input*
 * rather than a timer. A JavaScript regex runs synchronously to completion: by the time you can
 * measure that it took too long, it has already taken too long — measured here at 56 seconds for
 * `(a+)+$` against 40 characters. Nothing can interrupt it, so the only lever is not handing it
 * enough material to explode on.
 *
 * 4 KiB is far more than any rule needs. Patterns are written about an identifier, a line, a call
 * — not about a relationship between two ends of a long reply.
 */
const MATCH_WINDOW = 4096;
/** Still measured, to disable a merely slow pattern before it is paid on every delta. */
const MATCH_BUDGET_MS = 5;
/** However `repeat` is configured, one rule fires at most this many times in a turn. */
const MAX_PER_TURN = 2;

export class StreamRuleMonitor {
	readonly #rules: Rule[];
	readonly #buffers = new Map<string, string>();
	/** Turn number at which each rule last fired. */
	readonly #lastFired = new Map<string, number>();
	readonly #firedThisTurn = new Map<string, number>();
	/** Rules disabled at runtime because their regex was too slow. */
	readonly #disabled = new Set<string>();
	#turn = 0;

	// Precomputed so the common case — no rule watches this source — costs one boolean.
	readonly #watchesText: boolean;
	readonly #watchesThinking: boolean;
	readonly #watchesTools: boolean;

	constructor(rules: Rule[]) {
		this.#rules = rules.filter((rule) => rule.conditions.length > 0);
		this.#watchesText = this.#rules.some((r) => r.scopes.some((s) => s.kind === "text"));
		this.#watchesThinking = this.#rules.some((r) => r.scopes.some((s) => s.kind === "thinking"));
		this.#watchesTools = this.#rules.some((r) => r.scopes.some((s) => s.kind === "tool"));
	}

	get active(): boolean {
		return this.#rules.length > 0;
	}

	/** Call at the start of each turn: buffers are per-turn, counters are per-session. */
	startTurn(): void {
		this.#turn += 1;
		this.#buffers.clear();
		this.#firedThisTurn.clear();
	}

	/**
	 * Feed one chunk. Returns the rules that just became eligible.
	 *
	 * Matching runs against the accumulated buffer rather than the delta, because a pattern
	 * almost never lands inside one token.
	 */
	feed(chunk: StreamChunk): RuleMatch[] {
		if (this.#rules.length === 0) return [];
		if (chunk.source === "text" && !this.#watchesText) return [];
		if (chunk.source === "thinking" && !this.#watchesThinking) return [];
		if (chunk.source === "tool" && !this.#watchesTools) return [];

		const buffer = (this.#buffers.get(chunk.key) ?? "") + chunk.delta;
		const bounded = buffer.length > MAX_BUFFER ? buffer.slice(-MAX_BUFFER) : buffer;
		this.#buffers.set(chunk.key, bounded);

		const matches: RuleMatch[] = [];
		for (const rule of this.#rules) {
			if (this.#disabled.has(rule.name)) continue;
			if (!scopeAllows(rule.scopes, chunk)) continue;
			if (!this.#globAllows(rule, chunk)) continue;
			if (!this.#eligible(rule)) continue;

			const excerpt = this.#firstMatch(rule, bounded);
			if (excerpt === null) continue;
			matches.push({ rule, excerpt, source: chunk.source, toolName: chunk.toolName });
		}
		return matches;
	}

	/** Record that a rule's correction was delivered, so repeat policy can hold it back. */
	markFired(rule: Rule): void {
		this.#lastFired.set(rule.name, this.#turn);
		this.#firedThisTurn.set(rule.name, (this.#firedThisTurn.get(rule.name) ?? 0) + 1);
	}

	/** Restore suppression state when a session is resumed. */
	restoreFired(names: string[]): void {
		for (const name of names) this.#lastFired.set(name, 0);
	}

	/** Names of rules that have fired, for persistence. */
	firedRules(): string[] {
		return [...this.#lastFired.keys()];
	}

	#eligible(rule: Rule): boolean {
		// The per-turn ceiling applies whatever the rule asked for: a rule that keeps matching the
		// correction it produced would otherwise spin.
		if ((this.#firedThisTurn.get(rule.name) ?? 0) >= MAX_PER_TURN) return false;

		const last = this.#lastFired.get(rule.name);
		if (last === undefined) return true;
		if (rule.repeat === "once") return false;
		if (rule.repeat === "always") return true;
		return this.#turn - last >= rule.repeat.afterTurns;
	}

	/** A rule with `globs` only applies where the stream names a matching file. */
	#globAllows(rule: Rule, chunk: StreamChunk): boolean {
		if (!rule.globs || rule.globs.length === 0) return true;
		const paths = chunk.paths ?? [];
		if (paths.length === 0) return false;
		return paths.some((path) => rule.globs!.some((glob) => matchGlob(glob, path)));
	}

	/**
	 * Run the rule's patterns, with a time budget.
	 *
	 * A pattern that blows the budget is disabled for the rest of the session rather than
	 * retried on every chunk: catastrophic backtracking does not get better with more input, and
	 * paying it per delta would make the whole turn crawl.
	 */
	#firstMatch(rule: Rule, buffer: string): string | null {
		// Only the tail is matched: see MATCH_WINDOW. A pattern that needed more than this was
		// never going to be a reliable trigger anyway.
		const window = buffer.length > MATCH_WINDOW ? buffer.slice(-MATCH_WINDOW) : buffer;
		for (const condition of rule.conditions) {
			const started = performance.now();
			let found: RegExpExecArray | null = null;
			try {
				condition.lastIndex = 0;
				found = condition.exec(window);
			} catch {
				this.#disabled.add(rule.name);
				return null;
			}
			const elapsed = performance.now() - started;
			if (elapsed > MATCH_BUDGET_MS) {
				this.#disabled.add(rule.name);
				return null;
			}
			if (found) return found[0].slice(0, 200);
		}
		return null;
	}

	/** Rules disabled at runtime, so the UI can say why one stopped working. */
	get disabledRules(): string[] {
		return [...this.#disabled];
	}
}

function scopeAllows(scopes: RuleScope[], chunk: StreamChunk): boolean {
	for (const scope of scopes) {
		if (scope.kind === "text" && chunk.source === "text") return true;
		if (scope.kind === "thinking" && chunk.source === "thinking") return true;
		if (scope.kind === "tool" && chunk.source === "tool") {
			if (!("tool" in scope) || scope.tool === undefined) return true;
			if (scope.tool !== chunk.toolName) continue;
			if (!scope.glob) return true;
			if ((chunk.paths ?? []).some((path) => matchGlob(scope.glob!, path))) return true;
		}
	}
	return false;
}

/**
 * Glob matching, the subset that appears in rule files.
 *
 * `**` crosses separators, `*` does not, `?` is one character. Anything more elaborate belongs in
 * a dependency, and this has not needed one.
 */
export function matchGlob(glob: string, path: string): boolean {
	const normalized = path.replaceAll("\\", "/");

	/*
	 * Wildcards are parked on sentinels before escaping, then restored.
	 *
	 * Doing it as one chain of replaces is how `*` ends up expanding inside the regex a previous
	 * replace just produced. The sentinels are control characters, which cannot occur in a path.
	 */
	const DOUBLE = "\u0000";
	const SINGLE = "\u0001";
	const ONE = "\u0002";

	let pattern = glob.replaceAll("\\", "/").replaceAll("**", DOUBLE).replaceAll("*", SINGLE).replaceAll("?", ONE);
	pattern = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
	pattern = pattern.replaceAll(DOUBLE, ".*").replaceAll(SINGLE, "[^/]*").replaceAll(ONE, "[^/]");

	try {
		if (new RegExp(`^${pattern}$`).test(normalized)) return true;
		// `*.ts` should also match `src/a.ts` — rules are written about kinds of file, not full paths.
		return new RegExp(`(?:^|/)${pattern}$`).test(normalized);
	} catch {
		return false;
	}
}

/**
 * Pull file paths out of partially-streamed tool arguments.
 *
 * The JSON is usually incomplete when a rule matches — that is the point of watching the stream —
 * so this reads shapes rather than parsing.
 *
 * Only closed strings count. A half-arrived `"src/partia` cannot be glob-matched honestly: it
 * fails `**\/*.ts` and would pass `src/*`, so either answer is a guess about a filename that has
 * not been written yet. Waiting costs nothing in practice, because `path` is almost always the
 * first argument a tool streams — by the time the interesting part of the payload arrives, the
 * path is complete.
 */
export function extractPaths(partialJson: string): string[] {
	const paths: string[] = [];
	for (const match of partialJson.matchAll(/"(?:path|file_path|filePath|file)"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
		const value = match[1].replaceAll('\\"', '"').replaceAll("\\\\", "\\");
		if (value) paths.push(value);
	}
	return paths;
}
