/**
 * What this project taught us, kept where the project can be found again.
 *
 * The existing memory store is one flat global list, and the field that would have made it more
 * than that — `source: "auto"` — is written by nothing. There is no path that produces a memory.
 * So in practice it holds what a user typed into a settings box, which is a small fraction of what
 * is worth remembering.
 *
 * The layer that was missing is the project one, and it is the valuable one. "This repository uses
 * pnpm, not npm" is true here and false three directories over; filed globally it is a fact that
 * will be wrong for the next project and applied anyway.
 *
 * Two files rather than one, and the split is load-bearing:
 *
 *   `learned.md` holds what somebody wrote down on purpose — the `learn` tool, or a person editing
 *   the file. Consolidation never touches it.
 *
 *   `MEMORY.md` holds what a background pass concluded from reading sessions. It is rewritten
 *   wholesale, which is only safe because the deliberate half lives elsewhere.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { lyraHome, projectIdFor } from "../session/store.ts";

/** One remembered lesson. */
export interface Lesson {
	/** The lesson itself: one or two sentences, specific, actionable. */
	text: string;
	/** When it applies, if that is not obvious from the lesson. */
	context?: string;
	/** Epoch millis. Newest first is the storage order. */
	at: number;
}

/**
 * Limits, taken from omp because its numbers come from use rather than from taste.
 *
 * The cap matters more than it looks. Memory is injected into every prompt in this project, so an
 * unbounded file is an unbounded per-turn cost that grows quietly for months.
 */
export const MAX_LESSONS = 100;
export const MAX_LESSON_CHARS = 2000;
export const MAX_CONTEXT_CHARS = 400;

export function projectMemoryDir(cwd: string): string {
	return join(lyraHome(), "projects", projectIdFor(cwd), "memory");
}

/**
 * Published credential prefixes, the same shapes the built-in rule watches for.
 *
 * A lesson is written by a model that has just been looking at a config file, and "remember that
 * the API key is sk-proj-…" is a plausible thing for it to conclude. Memory is the worst place for
 * one to land: it is injected into every prompt in this project, forever, and nobody reads the
 * file it went into.
 */
const SECRET_PATTERNS: RegExp[] = [
	/\bsk-(?:[A-Za-z0-9]+-)*[A-Za-z0-9]{16,}/g,
	/\bghp_[A-Za-z0-9]{20,}/g,
	/\bgithub_pat_[A-Za-z0-9_]{20,}/g,
	/\bAKIA[A-Z0-9]{16}/g,
	/\bxox[baprs]-[A-Za-z0-9-]{10,}/g,
];

export function redactSecrets(text: string): string {
	let out = text;
	for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, "[已脱敏的凭证]");
	return out;
}

/**
 * Whether two lessons say the same thing.
 *
 * Token overlap rather than string equality, because the same lesson learned twice is worded
 * differently both times — "用 pnpm 不是 npm" and "这个仓库的包管理器是 pnpm" are one lesson, and
 * storing both spends context on the repetition and makes the cap arrive sooner.
 *
 * Deliberately crude. An embedding would be better at this and would mean a model call on a path
 * that has to work offline and instantly.
 */
export function similar(a: string, b: string, threshold = 0.6): boolean {
	const tokens = (text: string) =>
		new Set(
			text
				.toLowerCase()
				.replace(/[`*_#>[\]()|]/g, " ")
				// Split on anything that is not a letter, digit or CJK character.
				.split(/[^\p{L}\p{N}]+/u)
				.filter((t) => t.length > 1),
		);
	const left = tokens(a);
	const right = tokens(b);
	if (left.size === 0 || right.size === 0) return false;
	let shared = 0;
	for (const token of left) if (right.has(token)) shared += 1;
	return shared / Math.min(left.size, right.size) >= threshold;
}

export async function readLessons(cwd: string): Promise<Lesson[]> {
	const raw = await readFile(join(projectMemoryDir(cwd), "learned.md"), "utf8").catch(() => null);
	return raw === null ? [] : parseLessons(raw);
}

/**
 * Add a lesson, or fold it into the one it repeats.
 *
 * Returns what happened, because the tool result should say which — "recorded" and "you already
 * knew that" are different answers, and a model told the first when the second is true will keep
 * writing variations of the same sentence.
 */
export async function recordLesson(cwd: string, lesson: Omit<Lesson, "at">): Promise<{ action: "added" | "merged"; total: number }> {
	const text = redactSecrets(lesson.text.trim()).slice(0, MAX_LESSON_CHARS);
	const context = lesson.context ? redactSecrets(lesson.context.trim()).slice(0, MAX_CONTEXT_CHARS) : undefined;

	const existing = await readLessons(cwd);
	const duplicate = existing.findIndex((entry) => similar(entry.text, text));

	let next: Lesson[];
	let action: "added" | "merged";
	if (duplicate >= 0) {
		/*
		 * A repeat moves to the front and takes the newer wording rather than being dropped. Being
		 * told the same thing twice is evidence it matters, and the second phrasing is usually the
		 * one that came out of an actual correction.
		 */
		next = [{ text, context: context ?? existing[duplicate].context, at: Date.now() }, ...existing.filter((_, i) => i !== duplicate)];
		action = "merged";
	} else {
		next = [{ text, context, at: Date.now() }, ...existing];
		action = "added";
	}

	const capped = next.slice(0, MAX_LESSONS);
	await writeLessons(cwd, capped);
	return { action, total: capped.length };
}

export async function writeLessons(cwd: string, lessons: Lesson[]): Promise<void> {
	const dir = projectMemoryDir(cwd);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "learned.md"), renderLessons(lessons), "utf8");
}

/**
 * Markdown rather than JSON, because a person is expected to open this and fix it.
 *
 * Memory that cannot be corrected by hand is memory that stays wrong. A stale fact in here is
 * worse than a missing one — the model acts on it — so editing has to be as easy as deleting a
 * bullet.
 */
function renderLessons(lessons: Lesson[]): string {
	const lines = [
		"# 这个项目学到的",
		"",
		"由 `learn` 工具写入，也可以手改。自动巩固不会覆盖这个文件。",
		"过时的条目请直接删掉——记忆库里一条过时的事实比没有这条更糟，模型会照着它做决定。",
		"",
	];
	for (const lesson of lessons) {
		lines.push(`- ${lesson.text}`);
		if (lesson.context) lines.push(`  - 适用于：${lesson.context}`);
		lines.push(`  <!-- at:${lesson.at} -->`);
	}
	return `${lines.join("\n")}\n`;
}

/** Read back what `renderLessons` wrote, tolerating hand edits that dropped the timestamps. */
export function parseLessons(raw: string): Lesson[] {
	const lessons: Lesson[] = [];
	let current: Lesson | null = null;

	for (const line of raw.split("\n")) {
		const bullet = /^-\s+(.*)$/.exec(line);
		if (bullet) {
			if (current) lessons.push(current);
			current = { text: bullet[1].trim(), at: Date.now() };
			continue;
		}
		if (!current) continue;
		const context = /^\s+-\s+适用于：(.*)$/.exec(line);
		if (context) {
			current.context = context[1].trim();
			continue;
		}
		const at = /<!--\s*at:(\d+)\s*-->/.exec(line);
		if (at) current.at = Number(at[1]);
	}
	if (current) lessons.push(current);
	return lessons.filter((lesson) => lesson.text.length > 0);
}

/**
 * The block injected into the system prompt.
 *
 * Empty when there is nothing, because an empty `<project_memory>` is a few tokens of noise plus
 * an invitation to wonder what happened to the memory.
 */
export function formatProjectMemory(lessons: Lesson[]): string {
	if (lessons.length === 0) return "";
	const lines = lessons.map((lesson) => (lesson.context ? `- ${lesson.text}（${lesson.context}）` : `- ${lesson.text}`));
	return [
		"",
		"",
		"<project_memory>",
		"以前在这个项目里学到的，按新旧排。如果其中一条和你现在看到的代码矛盾，以代码为准，并考虑用 `learn` 更新它。",
		...lines,
		"</project_memory>",
	].join("\n");
}
