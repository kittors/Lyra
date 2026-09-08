import { translate } from "../../i18n/translate.ts";
import { useEffect, useId, useMemo, useState } from "react";
import { rankCommands, resolveCommand } from "@lyra/core/commands-view";
import { bridge } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";
import { commandCompletion, commandDecoration, commandEntries, type CommandEntry } from "./command-catalog.ts";

export function useCommands(text: string, cwd: string, field: React.RefObject<HTMLTextAreaElement | null>, setText: (text: string) => void) {
	const nonce = useApp((state) => state.extensionsNonce);
	const [catalog, setCatalog] = useState<{ cwd: string; entries: CommandEntry[] } | null>(null);
	const [active, setActive] = useState(0);
	const [keyboardSelection, setKeyboardSelection] = useState(true);
	const [dismissed, setDismissed] = useState(false);
	const [selection, setSelection] = useState({ text, start: text.length, end: text.length });
	const [focused, setFocused] = useState(false);
	const id = useId();
	const completion = commandCompletion(text, selection.text === text ? selection.start : text.length, selection.text === text ? selection.end : text.length);
	const commandMode = completion !== null;
	useEffect(() => {
		let alive = true;
		void bridge.commands.list(cwd).then((result) => {
			if (alive) setCatalog({ cwd, entries: commandEntries(result.commands, result.skills ?? []) });
		}).catch((cause) => {
			if (alive) useApp.getState().notify(translate("commands.readFailed", { reason: cause instanceof Error ? cause.message : String(cause) }), "error");
		});
		return () => { alive = false; };
	}, [cwd, nonce, commandMode]);
	const entries = useMemo(() => catalog?.cwd === cwd ? catalog.entries : commandEntries([], []), [catalog, cwd]);
	const term = completion?.term ?? null;
	const matches = useMemo(() => term === null || dismissed || !focused ? [] : rankCommands(entries, term), [entries, term, dismissed, focused]);
	useEffect(() => { setActive(0); setKeyboardSelection(true); }, [term, cwd]);
	const current = Math.min(active, Math.max(0, matches.length - 1));
	function select() {
		const el = field.current;
		if (el) setSelection({ text: el.value, start: el.selectionStart, end: el.selectionEnd });
	}
	function pick(command: CommandEntry) {
		const el = field.current;
		if (!completion || !el) return;
		el.focus();
		el.setSelectionRange(completion.start, completion.end);
		// Native insertion participates in Undo and preserves everything after the caret.
		document.execCommand("insertText", false, `/${command.name}${/\s/.test(text[completion.end] ?? "") ? "" : " "}`);
		setText(el.value);
		select();
		setDismissed(true);
	}
	return {
		id, matches, term: term ?? "", active: current, keyboardSelection, pick,
		hover(index: number) { setKeyboardSelection(false); setActive(index); },
		decoration: commandDecoration(text, entries),
		change(next: string) { setText(next); setDismissed(false); },
		select,
		focus() { setFocused(true); select(); },
		blur() { setFocused(false); },
		keyDown(event: React.KeyboardEvent<HTMLTextAreaElement>, submit: () => void) {
			if (!matches.length || event.nativeEvent.isComposing || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
			if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault(); setKeyboardSelection(true); setActive((current + (event.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
			} else if (event.key === "Enter" || event.key === "Tab") {
				event.preventDefault();
				const chosen = matches[current];
				if (event.key === "Enter" && resolveCommand(entries, term ?? "")?.name === chosen.name) submit(); else pick(chosen);
			} else if (event.key === "Escape") { event.preventDefault(); setDismissed(true); }
		},
	};
}
