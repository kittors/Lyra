import { useEffect, useId, useMemo, useState } from "react";
import type { SessionMeta } from "@lyra/core";
import type { SkillEntry } from "../../../electron/ipc-types.ts";
import { bridge } from "../../services/index.ts";
import { baseName } from "../../lib/paths.ts";
import { useApp } from "../../store/index.ts";
import { useProjectFolders } from "../../store/project-folders.ts";
import {
	findMentionRanges,
	formatMention,
	parseMentionTrigger,
	rankMentions,
	type MentionFile,
	type MentionItem,
} from "./mention-catalog.ts";

export function useMention(
	text: string,
	cwd: string,
	field: React.RefObject<HTMLTextAreaElement | null>,
	setText: (text: string) => void,
	onPickAction?: (actionId: string) => Promise<string | null>,
	onPickSession?: (session: { id: string; title: string }) => void,
) {
	const [active, setActive] = useState(0);
	const [keyboardSelection, setKeyboardSelection] = useState(true);
	const [dismissed, setDismissed] = useState(false);
	const [selection, setSelection] = useState({ text, start: text.length, end: text.length });
	const [focused, setFocused] = useState(false);
	const id = useId();

	const [agents, setAgents] = useState<Array<{ id: string; name: string; description: string }>>([]);
	const [skills, setSkills] = useState<SkillEntry[]>([]);
	const [sessions, setSessions] = useState<SessionMeta[]>([]);
	const [workspaceFiles, setWorkspaceFiles] = useState<MentionFile[]>([]);
	// Every folder the project is made of; usually just the working directory.
	const folders = useProjectFolders();
	const folderKey = folders.join("\0");

	const nonce = useApp((state) => state.extensionsNonce);

	// Detect @ completion trigger
	const completion = parseMentionTrigger(
		text,
		selection.text === text ? selection.start : text.length,
		selection.text === text ? selection.end : text.length,
	);
	const mentionMode = completion !== null;

	// Load candidates (skills, sessions, workspace files)
	useEffect(() => {
		if (!mentionMode) return;
		let alive = true;
		setSkills([]);
		setAgents([]);
		setWorkspaceFiles([]);

		// Fetch skills & plugins
		void bridge.commands.list(cwd).then((result) => {
			if (alive) { setSkills(result.skills); setAgents(result.agents ?? []); }
		}).catch(() => {});

		// Fetch sessions
		void bridge.sessions.list().then((list) => {
			if (alive) setSessions(list);
		}).catch(() => {});

		/*
		 * The top level of every source folder the project has.
		 *
		 * The working directory's entries stay relative, exactly as they were — `src/` is what you
		 * read and what gets inserted, and it resolves on its own. A second source folder cannot
		 * work that way: `src/` there would resolve against the working directory and name a file
		 * that does not exist, so those go in absolute and carry the folder's name as their origin
		 * so two `src/` rows are telling you apart.
		 */
		// Rebuilt from the key rather than closed over: `folders` is a fresh array on every render
		// of the composer, and depending on it would re-list every folder on each keystroke.
		const sources = folderKey ? folderKey.split("\0") : [];
		if (sources.length > 0) {
			void Promise.all(
				sources.map(async (folder, index) => {
					const entries = await bridge.files.list(folder).catch(() => []);
					const many = sources.length > 1;
					return entries.map((entry) => {
						const label = entry.isDirectory ? `${entry.name}/` : entry.name;
						return {
							path: index === 0 ? label : entry.isDirectory ? `${entry.path}/` : entry.path,
							label,
							origin: many ? baseName(folder) : undefined,
						};
					});
				}),
			)
				.then((lists) => {
					if (alive) setWorkspaceFiles(lists.flat());
				})
				.catch(() => {});
		}

		return () => {
			alive = false;
		};
	}, [cwd, folderKey, nonce, mentionMode]);

	const term = completion?.term ?? null;

	const matches = useMemo(() => {
		if (term === null || dismissed || !focused) return [];
		return rankMentions(term, {
			files: workspaceFiles,
			agents,
			sessions,
			skills,
			allowAction: true,
		});
	}, [term, dismissed, focused, workspaceFiles, sessions, skills, agents]);

	useEffect(() => {
		setActive(0);
		setKeyboardSelection(true);
	}, [term, cwd]);

	const current = Math.min(active, Math.max(0, matches.length - 1));

	function select() {
		const el = field.current;
		if (el) setSelection({ text: el.value, start: el.selectionStart, end: el.selectionEnd });
	}

	function insertMentionText(tokenText: string) {
		const el = field.current;
		if (!completion || !el || el.value !== text) return;
		el.focus();
		el.setSelectionRange(completion.start, completion.end);
		const trailingSpace = !tokenText || /\s/.test(text[completion.end] ?? "") ? "" : " ";
		document.execCommand("insertText", false, `${tokenText}${trailingSpace}`);
		setText(el.value);
		select();
		setDismissed(true);
	}

	async function pick(item: MentionItem) {
		if (!completion) return;

		if (item.id === "action:compact") { insertMentionText("@compact"); return; }
		if (item.kind === "action") {
			setDismissed(true);
			const token = await onPickAction?.(item.id);
			if (token) insertMentionText(token);
			return;
		}

		let token = "";
		if (item.kind === "plugin") {
			token = `/skill:${item.title}`;
		} else if (item.kind === "subagent") {
			token = `@${item.title}`;
		} else if (item.kind === "session") {
			if (item.data?.sessionId) onPickSession?.({ id: item.data.sessionId, title: item.title });
			insertMentionText("");
			return;
		} else if (item.kind === "file") {
			token = formatMention(item.data?.path ?? item.title);
		} else {
			token = `@${item.title}`;
		}

		insertMentionText(token);
	}

	// Decoration ranges for all mentions in the text
	const mentionDecorations = useMemo(() => {
		return findMentionRanges(text).map((r) => ({
			start: r.start,
			end: r.end,
		}));
	}, [text]);

	return {
		id,
		matches,
		term: term ?? "",
		active: current,
		keyboardSelection,
		hover(index: number) { setKeyboardSelection(false); setActive(index); },
		pick,
		insertMentionText,
		mentionDecorations,
		completion,
		sessions,
		change(next: string) {
			setText(next);
			setDismissed(false);
		},
		select,
		focus() {
			setFocused(true);
			select();
		},
		blur() {
			setFocused(false);
		},
		keyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
			if (!matches.length || event.nativeEvent.isComposing || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) {
				return false;
			}
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				setKeyboardSelection(true);
				setActive((current + (event.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
				return true;
			}
			if (event.key === "Enter" || event.key === "Tab") {
				event.preventDefault();
				const chosen = matches[current];
				if (chosen) pick(chosen);
				return true;
			}
			if (event.key === "Escape") {
				event.preventDefault();
				setDismissed(true);
				return true;
			}
			return false;
		},
	};
}
