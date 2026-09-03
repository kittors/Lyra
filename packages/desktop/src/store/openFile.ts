/**
 * Which file is open, and what has been typed into it.
 *
 * Its own store because the file and the tree are two panes now, and a pane cannot hold state its
 * sibling needs. It used to live inside the file browser, which was the right place while the
 * browser *was* both halves — the tree on the left, the file on the right, one component owning
 * the pair. Splitting them into panes that can be moved, resized and closed independently means
 * the thing they share has to sit outside both.
 *
 * Memory only, like the terminal's scrollback. Restoring an editor full of unsaved edits from a
 * previous launch is a promise this cannot keep — the file may have changed underneath it — so the
 * dock remembers that the pane was open and the pane comes back empty.
 */

import { create } from "zustand";
import type { FileContents, FileEntry } from "../../electron/ipc-types.ts";
import { isDescendantPath } from "../lib/paths.ts";
import { bridge } from "../services/index.ts";

/** One file the pane has had open, as its tab strip lists it. */
export interface OpenFileTab {
	path: string;
	name: string;
}

/**
 * How many files the tab strip remembers.
 *
 * Enough to hold an afternoon's worth of jumping between the same handful of files, and small
 * enough that the strip stays a row you read rather than one you scroll. Reaching it retires the
 * one used longest ago — never the one on screen, and never one holding unsaved edits, since
 * dropping either would be losing work to make room for a tab.
 */
const MAX_TABS = 12;

interface OpenFileState {
	path: string | null;
	/** The file's own name, so the pane can be titled before its contents arrive. */
	name: string | null;
	contents: FileContents | null;
	/**
	 * A file whose read is in flight, which is not the same as the file on screen.
	 *
	 * The two used to be one field, and switching tabs flickered because of it: `path` moved to the
	 * new file immediately while `contents` still held the old one, and the panel — seeing
	 * `loading` — threw the whole viewer away for a centred 「读取中…」 on a plain white page. A
	 * local file reads in a few milliseconds, so what that produced was one frame of white between
	 * two themed ones.
	 *
	 * Kept apart so the tab strip can highlight the click instantly while the content area holds
	 * what it has until the replacement is ready. `path` and `contents` now change together, and
	 * there is no moment when they describe different files.
	 */
	opening: string | null;
	loading: boolean;
	/**
	 * Unsaved edits, by path.
	 *
	 * Kept for every file touched, not just the open one: the editor is remounted whenever a
	 * different file is opened, so anything held inside it would be silently discarded on every
	 * click through the tree.
	 */
	drafts: Record<string, string>;
	/**
	 * Every file opened in this pane, oldest first — the tab strip.
	 *
	 * The pane used to hold exactly one file and forget it the moment you clicked another, so
	 * moving between two files meant finding the second one in the tree every time. Kept here
	 * rather than in the strip because the strip is drawn in the pane's header, and what is open is
	 * not the header's to own.
	 */
	tabs: OpenFileTab[];
	/**
	 * Wrap long lines, and show Markdown source rather than the rendered page.
	 *
	 * Up here because the controls for them are in the pane's header now, which is outside the
	 * viewer they act on. Not per file: they are how *you* want to read, not properties of what is
	 * being read, and having to re-set them on every file would be the setting asking permission to
	 * work each time.
	 */
	wrap: boolean;
	showSource: boolean;
	setWrap(wrap: boolean): void;
	setShowSource(showSource: boolean): void;

	open(entry: FileEntry): Promise<void>;
	/** Close one tab. The pane moves to a neighbour, the way a terminal's strip does. */
	closeTab(path: string): void;
	/**
	 * Close several at once — 关闭其他, 关闭右侧, 全部关闭.
	 *
	 * Unlike `closeTab`, a tab holding unsaved edits is kept rather than closed, and the count of
	 * those is returned so the caller can say so. Closing one tab is aimed at that tab; closing
	 * "the others" is aimed at a set nobody looked through, and silently dropping an edit somewhere
	 * inside it is the one outcome that cannot be undone. Reopening a tab costs a click.
	 */
	closeTabs(paths: string[]): number;
	/**
	 * Write the open file back, and clear its draft.
	 *
	 * Here rather than in the viewer because more than one thing saves now: ⌘S in the editor, and
	 * the button in the pane header. Returns the error so whichever one asked can say what happened.
	 */
	save(): Promise<string | null>;
	/** Re-read after a save, so the editor's "saved" baseline matches what is on disk. */
	reread(path: string): Promise<void>;
	setDraft(path: string, text: string | undefined): void;
	/**
	 * A rename or a move the open file has to survive.
	 *
	 * By path, and silently wrong if ignored: the pane would go on showing a file at an address
	 * that no longer exists, and saving it would recreate the old one. Folders count too —
	 * renaming `src` moves everything under it, including whatever is open.
	 */
	moved(from: string, to: string): void;
	removed(paths: string[]): void;
	/** Let go of everything. Used when the project changes: the paths belong to the old one. */
	clear(): void;
}

const EMPTY = { path: null, name: null, contents: null, loading: false, opening: null } as const;

export const useOpenFile = create<OpenFileState>((set, get) => ({
	...EMPTY,
	drafts: {},
	tabs: [],
	wrap: false,
	showSource: false,

	setWrap: (wrap) => set({ wrap }),
	setShowSource: (showSource) => set({ showSource }),

	async open(entry) {
		/*
		 * The strip updates now; the content area updates when there is something to put in it.
		 *
		 * Swapping `path` here as well would leave the viewer rendering the previous file's text
		 * under the new file's name until the read landed — and the panel, told it was loading,
		 * would instead unmount the viewer entirely and flash a white 「读取中…」 between two
		 * themed frames. That is the flicker.
		 */
		set({ opening: entry.path, loading: true, tabs: withTab(get(), entry) });
		try {
			const read = await bridge.files.read(entry.path);
			// A second click while this was in flight wins.
			if (get().opening !== entry.path) return;
			// Together, so the pane never shows one file's name over another file's contents.
			set({ path: entry.path, name: entry.name, contents: read, showSource: false });
		} finally {
			if (get().opening === entry.path) set({ loading: false, opening: null });
		}
	},

	async reread(path) {
		const read = await bridge.files.read(path);
		if (read && get().path === path) set({ contents: read });
	},

	setDraft(path, text) {
		const drafts = get().drafts;
		if (text === undefined) {
			if (!(path in drafts)) return;
			const { [path]: _gone, ...rest } = drafts;
			set({ drafts: rest });
			return;
		}
		set({ drafts: { ...drafts, [path]: text } });
	},

	moved(from, to) {
		const follow = (path: string) =>
			path === from ? to : isDescendantPath(from, path) ? to + path.slice(from.length) : path;

		const { path, drafts, tabs } = get();
		if (path) {
			const next = follow(path);
			if (next !== path) set({ path: next, name: next.slice(next.lastIndexOf("/") + 1) });
		}
		set({
			drafts: Object.fromEntries(Object.entries(drafts).map(([at, text]) => [follow(at), text])),
			// Renaming a file renames its tab; renaming a folder moves every tab beneath it.
			tabs: tabs.map((tab) => {
				const next = follow(tab.path);
				return next === tab.path ? tab : { path: next, name: next.slice(next.lastIndexOf("/") + 1) };
			}),
		});
	},

	removed(paths) {
		const gone = (path: string) => paths.some((each) => path === each || isDescendantPath(each, path));
		const { path, drafts, tabs } = get();
		if (path && gone(path)) set({ ...EMPTY });
		set({
			drafts: Object.fromEntries(Object.entries(drafts).filter(([at]) => !gone(at))),
			// A tab for a file that no longer exists is a tab that opens onto an error.
			tabs: tabs.filter((tab) => !gone(tab.path)),
		});
	},

	closeTab(path) {
		const { tabs, path: open } = get();
		const at = tabs.findIndex((tab) => tab.path === path);
		if (at === -1) return;
		const rest = tabs.filter((tab) => tab.path !== path);
		// The draft goes with the tab: keeping it would hold an edit for a file with no way back to it.
		const { [path]: _gone, ...drafts } = get().drafts;
		set({ tabs: rest, drafts });
		if (open !== path) return;
		/*
		 * Closing the file you are looking at moves to a neighbour, not to nothing.
		 *
		 * The one to the right, or the last one when there is nothing to the right — which is what
		 * every tab strip does, and the only choice that does not feel like the pane lost its place.
		 */
		const next = rest[at] ?? rest[rest.length - 1];
		if (next) void get().open({ name: next.name, path: next.path, isDirectory: false, size: 0 });
		else set({ ...EMPTY });
	},

	closeTabs(paths) {
		const { tabs, path: open, drafts } = get();
		const asked = new Set(paths);
		const kept = tabs.filter((tab) => asked.has(tab.path) && tab.path in drafts).length;
		const gone = new Set(
			tabs.filter((tab) => asked.has(tab.path) && !(tab.path in drafts)).map((tab) => tab.path),
		);
		if (gone.size === 0) return kept;

		const openAt = tabs.findIndex((tab) => tab.path === open);
		const rest = tabs.filter((tab) => !gone.has(tab.path));
		set({ tabs: rest });
		if (open === null || !gone.has(open)) return kept;

		/*
		 * The same landing rule as `closeTab`, applied to whatever survived.
		 *
		 * Measured from where the open file was, not from where the first casualty was: 关闭其他
		 * removes tabs on both sides of it, and taking the first index would land the pane on
		 * whatever happens to sit at that position afterwards rather than on the nearest file
		 * still open to the right.
		 */
		const next = tabs.slice(openAt + 1).find((tab) => !gone.has(tab.path)) ?? rest[rest.length - 1];
		if (next) void get().open({ name: next.name, path: next.path, isDirectory: false, size: 0 });
		else set({ ...EMPTY });
		return kept;
	},

	async save() {
		const { path, contents, drafts } = get();
		if (!path || !contents) return null;
		const text = drafts[path];
		if (text === undefined || text === contents.text) return null;
		// Truncated files must not be saved: writing back the head would delete the rest.
		if (contents.truncated) return "文件过大，只读";
		const result = await bridge.files.write(path, text);
		if (!result.ok) return result.error ?? "写入失败";
		get().setDraft(path, undefined);
		await get().reread(path);
		return null;
	},

	clear: () => set({ ...EMPTY, drafts: {}, tabs: [] }),
}));

/**
 * The tab strip after opening this file: the one already there, or a new one at the end.
 *
 * Retiring, when the strip is full, is deliberately fussy about what it will take: never the file
 * being opened, and never one with unsaved edits. A tab is cheap to lose and an edit is not.
 */
function withTab(state: OpenFileState, entry: FileEntry): OpenFileTab[] {
	const tabs = state.tabs;
	if (tabs.some((tab) => tab.path === entry.path)) return tabs;
	const next = [...tabs, { path: entry.path, name: entry.name }];
	if (next.length <= MAX_TABS) return next;
	const spare = next.findIndex((tab) => tab.path !== entry.path && !(tab.path in state.drafts));
	return spare === -1 ? next : next.filter((_, at) => at !== spare);
}
