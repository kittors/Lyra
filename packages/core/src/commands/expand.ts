/**
 * Turning `/review src/foo.ts` into the prompt it stands for.
 *
 * The template decides where the arguments go. `$1` and `$2` take them one at a time, `$ARGUMENTS`
 * takes the lot; a template that mentions neither gets them appended, because the alternative is a
 * command that silently ignores what you typed after it — which reads as the command being broken
 * rather than as the template being incomplete.
 */

import type { SlashCommand } from "./loader.ts";

/** What a line of composer text means, once the leading slash has been read. */
export interface Invocation {
	name: string;
	/** Everything after the name, untouched. */
	rest: string;
}

/**
 * Read `/name rest` out of composer text, or `null` if this is not a command line.
 *
 * Only at the very start, and only on the first line. A slash anywhere else is a path, a fraction
 * or a regex — treating those as commands would make the composer hostile to ordinary typing,
 * which is most of what it is for.
 */
export function parseInvocation(text: string): Invocation | null {
	if (!text.startsWith("/")) return null;
	const line = text.slice(1);
	const match = /^([a-z0-9:-]+)(?:\s+([\s\S]*))?$/i.exec(line);
	if (!match) return null;
	return { name: match[1].toLowerCase(), rest: (match[2] ?? "").trim() };
}

/**
 * Split arguments the way a shell would, minus the parts nobody uses here.
 *
 * Quotes group words that belong together; everything else splits on whitespace. Backslash
 * escaping is deliberately absent — these are paths and phrases typed into a chat box, and a
 * `C:\Users\x` that silently lost its separators would be a worse failure than a quote that has
 * to be typed twice.
 */
export function splitArguments(rest: string): string[] {
	const out: string[] = [];
	let current = "";
	let quote: '"' | "'" | null = null;
	let started = false;

	for (const character of rest) {
		if (quote) {
			if (character === quote) quote = null;
			else current += character;
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
			started = true;
			continue;
		}
		if (/\s/.test(character)) {
			if (started || current) out.push(current);
			current = "";
			started = false;
			continue;
		}
		current += character;
	}
	if (started || current) out.push(current);
	return out;
}

/** `$ARGUMENTS`, `$@`, `$1`… — the placeholders a template may use. */
const PLACEHOLDER = /\$(ARGUMENTS\b|@|\d+)/g;

/**
 * The prompt a command expands to.
 *
 * Substitution happens in one pass rather than by repeated replacement: a positional argument that
 * itself contains `$2` must be inserted, not re-scanned. Doing it in several passes is how an
 * argument someone pasted from a shell script starts rewriting the rest of the template.
 */
export function expandCommand(command: SlashCommand, rest: string): string {
	const args = splitArguments(rest);
	let used = false;

	const body = command.content.replace(PLACEHOLDER, (_match, token: string) => {
		used = true;
		if (token === "@" || token.startsWith("ARGUMENTS")) return rest;
		const index = Number.parseInt(token, 10);
		return args[index - 1] ?? "";
	});

	/*
	 * Nothing was asked for, but something was given.
	 *
	 * Appending is the reading that cannot lose information. The template is a standing
	 * instruction and the typed text is this run's specifics, so they stack — and a template
	 * written before anyone thought to pass it an argument keeps working the day someone does.
	 */
	if (!used && rest) return `${body.trim()}\n\n${rest}`;
	return body.trim();
}

/**
 * Rank commands against what has been typed so far.
 *
 * Substring rather than prefix, because the useful match is often in the middle: `com` should
 * reach `autocompact`, and a namespaced `git:commit` should be reachable by typing `commit`. The
 * ordering is what keeps that from being noise — an exact name first, then commands that start
 * with the term, then the rest, and alphabetical within each band so the list does not reshuffle
 * for reasons the eye cannot follow.
 *
 * Description text matches too, and always ranks last: it is how you find a command you cannot
 * name, without letting a common word in a description outrank a name that actually matches.
 */
export function rankCommands<T extends { name: string; description: string }>(commands: T[], term: string): T[] {
	const needle = term.trim().toLowerCase();
	if (!needle) return commands;

	const scored: { command: T; rank: number }[] = [];
	for (const command of commands) {
		const name = command.name.toLowerCase();
		const rank =
			name === needle
				? 0
				: name.startsWith(needle)
					? 1
					: // The segment after a namespace counts as a start of its own: `commit` finds `git:commit`.
						name.split(":").some((segment) => segment.startsWith(needle))
						? 2
						: name.includes(needle)
							? 3
							: command.description.toLowerCase().includes(needle)
								? 4
								: -1;
		if (rank >= 0) scored.push({ command, rank });
	}

	return scored
		.sort((a, b) => a.rank - b.rank || a.command.name.localeCompare(b.command.name))
		.map((entry) => entry.command);
}

/**
 * 按名字找命令：精确命中优先，否则**唯一**的末段匹配。
 *
 * `git/commit.md` 的名字是 `git:commit`，而人打的是 `/commit`。菜单那边 `rankCommands` 早就
 * 让末段能匹配到——于是列表里看得见 `git:commit`，回车却找不到：分派用的是精确匹配。
 * 「菜单里有、按下去没反应」是这个项目里反复出现的一种断线。
 *
 * 唯一才算。`git:commit` 和 `svn:commit` 同时在，`/commit` 不该悄悄选一个——它原样发给
 * 模型，跟任何不认识的 `/xxx` 一样。歧义时不猜，是这里唯一的规则。
 */
export function resolveCommand<T extends { name: string }>(commands: T[], name: string): T | undefined {
	const wanted = name.toLowerCase();
	const exact = commands.find((c) => c.name.toLowerCase() === wanted);
	if (exact) return exact;
	if (wanted.includes(":")) return undefined;

	const byTail = commands.filter((c) => {
		const segments = c.name.toLowerCase().split(":");
		return segments.length > 1 && segments[segments.length - 1] === wanted;
	});
	return byTail.length === 1 ? byTail[0] : undefined;
}
