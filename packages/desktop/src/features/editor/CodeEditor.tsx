import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import {
	bracketMatching,
	foldGutter,
	foldKeymap,
	indentOnInput,
	syntaxHighlighting,
} from "@codemirror/language";
import { closeSearchPanel, highlightSelectionMatches, openSearchPanel, search, searchKeymap, searchPanelOpen } from "@codemirror/search";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import {
	EditorView,
	drawSelection,
	highlightActiveLine,
	highlightActiveLineGutter,
	keymap,
	lineNumbers,
	rectangularSelection,
} from "@codemirror/view";
import { useEffect, useRef, useState } from "react";

import { useApp } from "../../store/index.ts";
import { GRAMMARS, grammarKeyFor, highlightStyle } from "../../lib/code/highlight.ts";
import { editorTheme } from "./theme.ts";
import { applyFormat } from "./apply-format.ts";
import { FORMAT_DEFAULTS } from "./format.ts";
import { CHEVRON_DOWN, CHEVRON_RIGHT, OPTION_ICONS, SEARCH_ICONS, SEARCH_PHRASES, SEARCH_TIPS } from "./chrome.ts";
import { EditorMenu } from "./EditorMenu.tsx";
import { useContextMenu } from "../../ui/overlay/ContextMenu.tsx";
import { OverlayScrollbar } from "../../ui/scroll/OverlayScrollbar.tsx";

/**
 * Format the buffer and say what happened, in one line.
 *
 * Every outcome gets a word. A shortcut that silently does nothing cannot be told from a broken
 * one, and the three ways formatting legitimately does nothing — already tidy, no formatter for
 * this language, the tool is not installed — call for three different answers. Only the first is
 * routine, which is why `quiet` suppresses that one and nothing else: on 保存时格式化 it would fire
 * on every ⌘S of an already-formatted file, which is most of them.
 */
async function formatNow(view: EditorView, path: string, options?: { quiet?: boolean }): Promise<void> {
	const { notify, settings } = useApp.getState();
	const result = await applyFormat(view, path, { ...FORMAT_DEFAULTS, ...settings?.formatting });

	switch (result.kind) {
		case "formatted":
			// Named, because which engine ran is the thing people are unsure about — and when a
			// project config decided the style, that outranked the settings page and should say so.
			if (!options?.quiet) notify(result.config ? `已按 ${result.config} 格式化（${result.by}）` : `已用 ${result.by} 格式化`, "info");
			return;
		case "unchanged":
			if (!options?.quiet) notify("已经是格式化后的样子", "info");
			return;
		case "unsupported":
			if (!options?.quiet) notify("这种文件还没有对应的格式化工具", "info");
			return;
		case "missing":
			// Always shown, even on save: this is the one the user can act on.
			notify(`需要 ${result.tool} 才能格式化：${result.install}`, "error");
			return;
		case "failed":
			// Always shown. The message is the formatter's own and names the line that will not parse,
			// which is the most useful thing formatting does on a broken file.
			notify(`格式化失败：${result.message.split("\n")[0]}`, "error");
	}
}

/**
 * A real editor, not a `<pre>` with colours.
 *
 * CodeMirror rather than a highlighter: highlighting a string is the easy half, and the half
 * that stops mattering the moment you want to change a line. Selection, undo, bracket matching,
 * find, and an indent key that does the right thing are the difference between reading a file
 * here and copying it somewhere else to work on it.
 *
 * Languages load on demand. Bundling twenty grammars for the one file you opened would put
 * megabytes into the initial payload to support a panel that is usually closed.
 */
export function CodeEditor({
	path,
	text,
	readOnly,
	wrap,
	onChange,
	onSave,
}: {
	/** Identity of the document; changing it rebuilds the state, which resets undo history. */
	path: string;
	text: string;
	readOnly?: boolean;
	/** Soft-wrap long lines instead of scrolling sideways. */
	wrap?: boolean;
	onChange: (next: string) => void;
	onSave: () => void;
}) {
	const host = useRef<HTMLDivElement>(null);
	/*
	 * CodeMirror's scrolling element, which only exists once the view is built.
	 *
	 * State rather than a ref, because the thumbs have to render again once it appears — a ref
	 * assigned inside the mount effect would leave them measuring nothing on the first pass.
	 */
	const [scroller, setScroller] = useState<HTMLElement | null>(null);
	const scrollerRef = useRef<HTMLElement | null>(null);
	scrollerRef.current = scroller;
	const view = useRef<EditorView | null>(null);
	const language = useRef(new Compartment());
	/*
	 * Wrapping is reconfigured, not rebuilt.
	 *
	 * Putting `wrap` in the effect that builds the state would throw the document away and take
	 * the undo history, the selection and the scroll position with it — for a setting you toggle
	 * precisely to look at the line you are already on.
	 */
	const wrapping = useRef(new Compartment());
	/** Held in refs so the editor is never rebuilt just because a callback identity changed. */
	const onChangeRef = useRef(onChange);
	const onSaveRef = useRef(onSave);
	/*
	 * The path, in a ref, because the keymap closes over it once.
	 *
	 * The extension decides which formatter runs, so reading a stale one would format a `.go` file
	 * with the rules for whatever was open when the editor was built.
	 */
	const pathRef = useRef(path);
	pathRef.current = path;
	onChangeRef.current = onChange;
	onSaveRef.current = onSave;
	const menu = useContextMenu();
	/** Assigned below; held in a ref so the keymap built once can reach the current one. */
	const openFindRef = useRef<(withReplace: boolean) => void>(() => {});

	const appearance = useApp((s) => s.settings?.appearance);
	const codeLightTheme = appearance?.codeLightTheme;
	const codeDarkTheme = appearance?.codeDarkTheme;
	const highlightCompartment = useRef(new Compartment());

	useEffect(() => {
		const element = host.current;
		if (!element) return;

		const state = EditorState.create({
			doc: text,
			extensions: [
				lineNumbers(),
				highlightActiveLineGutter(),
				highlightActiveLine(),
				drawSelection(),
				rectangularSelection(),
				history(),
				foldGutter(),
				indentOnInput(),
				bracketMatching(),
				highlightSelectionMatches(),
				/*
				 * ⌘F opens it, and it opens at the top.
				 *
				 * `searchKeymap` alone was already bound, which is why the shortcut appeared to do
				 * nothing — the bindings need a panel to open, and without `search()` there was
				 * none. Top rather than bottom because the composer-shaped things in this app all
				 * sit at the bottom of their pane, and a find bar down there reads as one of them.
				 */
				search({ top: true }),
				/*
				 * The panel's own wording, in the app's language.
				 *
				 * CodeMirror builds these strings into the panel's DOM, so there is no way to
				 * translate it from the outside — `phrases` is the hook it provides for exactly
				 * this. Missing keys fall through to the English original rather than blanking.
				 */
				EditorState.phrases.of(SEARCH_PHRASES),
				highlightCompartment.current.of(syntaxHighlighting(highlightStyle(codeLightTheme, codeDarkTheme))),
				EditorState.readOnly.of(Boolean(readOnly)),
				wrapping.current.of(wrap ? EditorView.lineWrapping : []),
				language.current.of([]),
				keymap.of([
					/*
					 * ⌘F toggles rather than only opens.
					 *
					 * `searchKeymap` binds it to open, so pressing it again with the panel already
					 * up did nothing at all — and the way out was a key you had to know about.
					 * The shortcut that summons a thing should dismiss it.
					 */
					{
						key: "Mod-f",
						preventDefault: true,
						run: (view) => (searchPanelOpen(view.state) ? closeSearchPanel(view) : openSearchPanel(view)),
					},
					// The replace half, which is folded away until it is asked for — same as the
					// context menu's 替换 item, so the two cannot say different things.
					{
						key: "Mod-Alt-f",
						preventDefault: true,
						run: () => {
							openFindRef.current(true);
							return true;
						},
					},
					// Before the defaults, so ⌘S is ours rather than the browser's.
					{
						key: "Mod-s",
						preventDefault: true,
						run: (view) => {
							/*
							 * Tidy first, then write — when that has been asked for.
							 *
							 * Awaited rather than fired alongside, or the save races the format and which
							 * of the two versions reaches disk depends on how long Prettier took. Off by
							 * default: ⌘S should be the cheapest, most predictable key in the app.
							 */
							if (!useApp.getState().settings?.formatting?.onSave) {
								onSaveRef.current();
								return true;
							}
							void formatNow(view, pathRef.current, { quiet: true }).then(() => onSaveRef.current());
							return true;
						},
					},
				/*
					 * ⇧⌥F, the way every other editor spells it — except on macOS, where it cannot work.
					 *
					 * CodeMirror deliberately refuses to resolve a plain Alt combination there: on a Mac
					 * ⌥ composes characters, so ⌥F arrives as `ƒ` and ⇧⌥F as `Ï`, and treating those as
					 * the letter would break typing them. Its keymap skips the physical-key fallback for
					 * exactly this case (`!(browser.mac && event.altKey && ...)` in `runHandlers`), so
					 * the binding is unreachable rather than merely inconvenient — measured, not assumed:
					 * the keydown arrived at `.cm-content` with `keyCode: 70` and came back out with
					 * `defaultPrevented: false`.
					 *
					 * So ⌘⇧F there, which is free — the find bar is ⌘F and replace is ⌥⌘F.
					 */
					{
						key: "Shift-Alt-f",
						mac: "Mod-Shift-f",
						preventDefault: true,
						run: (view) => {
							void formatNow(view, pathRef.current);
							return true;
						},
					},
					indentWithTab,
					...defaultKeymap,
					...historyKeymap,
					...searchKeymap,
					...foldKeymap,
				]),
				editorTheme(),
				EditorView.updateListener.of((update) => {
					if (update.docChanged) onChangeRef.current(update.state.doc.toString());
				}),
			],
		});

		const instance = new EditorView({ state, parent: element });
		view.current = instance;

		/*
		 * Tooltips for the find bar, which is not ours to render.
		 *
		 * The buttons show a glyph now, so the words have to live somewhere — and `phrases` only
		 * controls the visible label. CodeMirror builds the panel on first open, so this watches
		 * for it rather than running once. The app's own tooltip is driven by an attribute
		 * precisely so a panel outside React's tree can still use it.
		 */
		const labelPanel = () => {
			/*
			 * Replace starts folded, behind a disclosure of its own.
			 *
			 * Eleven controls is more than a narrow pane can hold on one line, and unfolded they
			 * wrapped to three rows with the close button stranded on one by itself. Most finds
			 * never replace anything, so the second row is the part that should be asked for —
			 * which is what every editor with a find bar does.
			 */
			const panel = element.querySelector<HTMLElement>(".cm-panel.cm-search");
			// The app's floating surface, so the find card matches every menu and popover in it.
			panel?.classList.add("ly-glass", "ly-pop-in");
			if (panel && !panel.querySelector("[name=ly-replace-toggle]")) {
				const toggle = document.createElement("button");
				toggle.setAttribute("name", "ly-replace-toggle");
				toggle.setAttribute("type", "button");
				toggle.setAttribute("aria-label", "显示替换");
				toggle.dataset.dwTip = "显示替换";
				toggle.innerHTML = CHEVRON_RIGHT;
				toggle.addEventListener("click", () => {
					const open = panel.classList.toggle("ly-replace-open");
					toggle.setAttribute("aria-label", open ? "隐藏替换" : "显示替换");
					toggle.dataset.dwTip = open ? "隐藏替换" : "显示替换";
					toggle.innerHTML = open ? CHEVRON_DOWN : CHEVRON_RIGHT;
					if (open) panel.querySelector<HTMLInputElement>("input[name=replace]")?.focus();
				});
				panel.prepend(toggle);
			}

			for (const [name, hint] of Object.entries(SEARCH_TIPS)) {
				const button = element.querySelector<HTMLElement>(`.cm-search button[name=${name}]`);
				if (!button || button.querySelector("svg")) continue;
				// The icon replaces the word, so the word has to survive as the accessible name.
				button.setAttribute("aria-label", hint);
				button.dataset.dwTip = hint;
				button.innerHTML = SEARCH_ICONS[name] ?? "";
			}
			// The options are labels, and their text is hidden, so they need one too.
			const options = element.querySelectorAll<HTMLElement>(".cm-search label");
			for (const [i, hint] of ["区分大小写", "正则表达式", "全词匹配"].entries()) {
				const option = options[i];
				if (!option || option.querySelector("svg")) continue;
				option.setAttribute("aria-label", hint);
				option.dataset.dwTip = hint;
				// Appended, not assigned: the checkbox inside is what holds the option's state.
				option.insertAdjacentHTML("beforeend", OPTION_ICONS[i] ?? "");
			}
		};
		const panels = new MutationObserver(labelPanel);
		panels.observe(element, { childList: true, subtree: true });
		setScroller(instance.scrollDOM);

		let live = true;
		void languageFor(path)?.then((extension) => {
			// The file can be closed while its grammar is still being fetched.
			if (live && extension) instance.dispatch({ effects: language.current.reconfigure(extension) });
		});

		return () => {
			live = false;
			instance.destroy();
			view.current = null;
			setScroller(null);
		};
		// `text` is deliberately absent: it seeds the document, and re-seeding on every
		// keystroke would fight the editor for control of its own content. `wrap` likewise —
		// it seeds the compartment above and is reconfigured, never rebuilt.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [path, readOnly]);

	useEffect(() => {
		view.current?.dispatch({
			effects: wrapping.current.reconfigure(wrap ? EditorView.lineWrapping : []),
		});
	}, [wrap]);

	useEffect(() => {
		view.current?.dispatch({
			effects: highlightCompartment.current.reconfigure(
				syntaxHighlighting(highlightStyle(codeLightTheme, codeDarkTheme)),
			),
		});
	}, [codeLightTheme, codeDarkTheme]);

	/*
	 * Adopt an outside change without disturbing the caret.
	 *
	 * Only when the incoming text genuinely differs from what is on screen — otherwise this
	 * fires on every keystroke, since our own `onChange` is what produced the new value.
	 */
	useEffect(() => {
		const instance = view.current;
		if (!instance) return;
		const current = instance.state.doc.toString();
		if (current === text) return;
		instance.dispatch({ changes: { from: 0, to: current.length, insert: text } });
	}, [text]);

	/**
	 * Open the find bar, unfolding the replace half when that is what was asked for.
	 *
	 * The toggle is a button this component adds to CodeMirror's own panel (see `labelPanel`), so
	 * pressing it is how "replace" is reached from anywhere else. The panel is built on first open,
	 * hence the frame's wait: on the very first ⌥⌘F there is nothing to click yet.
	 */
	openFindRef.current = openFind;

	function openFind(withReplace: boolean) {
		const instance = view.current;
		if (!instance) return;
		if (!searchPanelOpen(instance.state)) openSearchPanel(instance);
		if (!withReplace) return;
		requestAnimationFrame(() => {
			const panel = host.current?.querySelector<HTMLElement>(".cm-panel.cm-search");
			if (panel && !panel.classList.contains("ly-replace-open")) {
				panel.querySelector<HTMLButtonElement>("[name=ly-replace-toggle]")?.click();
			}
		});
	}

	return (
		// `relative` so the thumbs can be positioned against the pane rather than the window.
		<div className="ly-scroll-host relative flex min-h-0 flex-1">
			{/* biome-ignore lint/a11y/noStaticElementInteractions: the menu is the editor's, not this box's. */}
			<div
				ref={host}
				onContextMenu={(event) => menu.show(event, undefined)}
				className="ly-cm min-h-0 min-w-0 flex-1 overflow-hidden"
			/>
			{scroller && (
				<>
					<OverlayScrollbar viewport={scrollerRef} orientation="vertical" />
					<OverlayScrollbar viewport={scrollerRef} orientation="horizontal" />
				</>
			)}
			{menu.open && (
				<EditorMenu
					anchor={menu.anchor}
					onClose={menu.close}
					view={view.current}
					path={path}
					readOnly={Boolean(readOnly)}
					onFind={openFind}
					onFormat={async () => {
						if (view.current) await formatNow(view.current, path);
					}}
				/>
			)}
		</div>
	);
}


/**
 * The grammar for a path, or null when nothing here can parse it.
 *
 * Name first, extension second — `grammarKeyFor` is where that rule lives, because the editor is
 * not the only thing that asks. `Dockerfile` and `Makefile` used to be checked here only to be
 * turned down; they have grammars now.
 */
function languageFor(path: string): Promise<Extension | null> | null {
	const key = grammarKeyFor(path);
	if (!key) return null;
	const load = GRAMMARS[key];
	return load ? load().catch(() => null) : null;
}
