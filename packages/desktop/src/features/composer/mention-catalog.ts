import { translate } from "../../i18n/translate.ts";
import type { SessionMeta } from "@lyra/core";
import type { SkillEntry } from "../../../electron/ipc-types.ts";

export type MentionKind = "action" | "file" | "subagent" | "plugin" | "session";

export interface MentionItem {
	id: string;
	title: string;
	description?: string;
	kind: MentionKind;
	origin?: string;
	/** Extra data associated with the item, e.g. filePath, sessionId, subagent name */
	data?: {
		path?: string;
		sessionId?: string;
		subagentId?: string;
		pluginId?: string;
		skillId?: string;
	};
}

export interface MentionCompletion {
	term: string;
	start: number;
	end: number;
}

/**
 * A path offered by `@`, when what you insert is not what you read.
 *
 * Those two came apart when a project grew a second source folder. A name inside the working
 * directory resolves on its own and reads as what it is; one in another folder has to be inserted
 * absolute, because a relative path resolves against the working directory and would point at a
 * file that is not there — and an absolute path is also the worst possible thing to put in a list
 * you are scanning, since every row starts with the same forty characters.
 *
 * A plain string still works and means both at once, which is every path in a one-folder project.
 */
export interface MentionFile {
	/** What is inserted into the message. */
	path: string;
	/** What the row shows, and what typing is matched against. */
	label: string;
	/** Which source folder it came from. Only set when the project has more than one. */
	origin?: string;
}

/**
 * Detect mention trigger `@term` at the current caret.
 * Requires `@` to be at start of text or preceded by whitespace.
 */
export function parseMentionTrigger(text: string, start: number, end: number): MentionCompletion | null {
	if (start !== end) return null;
	const match = /(?:^|\s)@([^\s]*)$/.exec(text.slice(0, start));
	if (!match) return null;
	const term = match[1];
	// Position of '@' is at (start - term.length - 1)
	const triggerStart = start - term.length - 1;
	return {
		term,
		start: triggerStart,
		end,
	};
}

/**
 * Find all mentions currently present in composer text.
 * Matches `@token` patterns that are bounded by whitespace or start/end of line.
 */
export function findMentionRanges(text: string): Array<{ start: number; end: number; text: string; inner: string }> {
	const ranges: Array<{ start: number; end: number; text: string; inner: string }> = [];
	// Support both @"quoted title" / @'quoted title' and @unquoted_token
	const regex = /(?:^|\s)(@(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|[^\s]+))/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(text)) !== null) {
		const full = match[0];
		const token = match[1];
		const inner = match[2] !== undefined ? match[2].replace(/\\(["\\])/g, "$1") : match[3] ?? token.slice(1);
		const tokenStart = match.index + (full.length - token.length);
		ranges.push({
			start: tokenStart,
			end: tokenStart + token.length,
			text: token,
			inner,
		});
	}
	return ranges;
}

/** Quoting preserves spaces and quotes while keeping raw Windows paths readable. */
export function formatMention(path: string): string {
	return `@"${path.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/** Rank and filter mention candidates based on search term */
export function rankMentions(
	term: string,
	options: {
		files?: Array<string | MentionFile>;
		agents?: Array<{ id: string; name: string; description: string }>;
		sessions?: SessionMeta[];
		skills?: SkillEntry[];
		allowAction?: boolean;
	},
): MentionItem[] {
	const lower = term.toLowerCase().trim();
	const items: MentionItem[] = [];

	/*
	 * Matched against the words on screen, plus the English ones underneath.
	 *
	 * Typing 「文件」 should find 选择文件 while the window is in Chinese, and typing `file` should
	 * find "Pick a file" in English — but `file` should keep working either way, because the id and
	 * every piece of writing about this app call it that.
	 */
	const pickFile = translate("mention.pickFile");
	const pickFolder = translate("mention.pickFolder");
	const compact = translate("mention.compact");
	if (
		options.allowAction &&
		(!lower ||
			pickFile.toLowerCase().includes(lower) ||
			pickFolder.toLowerCase().includes(lower) ||
			"file".includes(lower) ||
			"folder".includes(lower))
	) {
		items.push({
			id: "action:pick-file",
			title: pickFile,
			kind: "action",
		});
		items.push({ id: "action:pick-directory", title: pickFolder, kind: "action" });
	}

	if (options.allowAction && (!lower || "compact".includes(lower) || compact.toLowerCase().includes(lower))) {
		items.push({ id: "action:compact", title: "compact", description: compact, kind: "action" });
	}

	// Subagents
	for (const sub of options.agents ?? []) {
		if (!lower || sub.name.toLowerCase().includes(lower) || sub.description.toLowerCase().includes(lower)) {
			items.push({
				id: `subagent:${sub.id}`,
				title: sub.name,
				description: sub.description,
				kind: "subagent",
				data: { subagentId: sub.id },
				origin: translate("mention.agents"),
			});
		}
	}

	// Plugins / Skills
	if (options.skills) {
		for (const skill of options.skills) {
			const fullName = skill.pluginId ? `${skill.pluginId}:${skill.name}` : skill.name;
			if (!lower || fullName.toLowerCase().includes(lower) || skill.description?.toLowerCase().includes(lower)) {
				items.push({
					id: `skill:${fullName}`,
					title: fullName,
					description: skill.description || translate("mention.pluginSkills"),
					kind: "plugin",
					data: { skillId: skill.name, pluginId: skill.pluginId },
					origin: skill.pluginId ?? translate(skill.source === "workspace" ? "sessionMenu.project" : "common.builtin"),
				});
			}
		}
	}

	// Sessions
	if (options.sessions) {
		for (const s of options.sessions) {
			const title = s.title || translate("mention.untitled");
			if (!lower || title.toLowerCase().includes(lower) || s.id.toLowerCase().includes(lower)) {
				items.push({
					id: `session:${s.id}`,
					title,
					description: [s.projectName, s.updatedAt ? new Date(s.updatedAt).toLocaleDateString("zh-CN") : ""].filter(Boolean).join(" · "),
					kind: "session",
					data: { sessionId: s.id },
					origin: translate("mention.pastSessions"),
				});
			}
		}
	}

	// Project files / directories
	if (options.files) {
		for (const file of options.files) {
			const entry = typeof file === "string" ? { path: file, label: file, origin: undefined } : file;
			if (!lower || entry.label.toLowerCase().includes(lower)) {
				items.push({
					id: `file:${entry.path}`,
					title: entry.label,
					description: translate("mention.projectPaths"),
					kind: "file",
					data: { path: entry.path },
					// The folder it is in, when that is a question worth answering — two source
					// folders can each have a `src/`, and without this they are two identical rows.
					origin: entry.origin ?? translate("common.workspace"),
				});
			}
		}
	}

	return items;
}
