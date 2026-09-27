/**
 * Which directories are open, and what is in them.
 *
 * Outside React because the tree is drawn in more than one place now: the file pane's own tree, and
 * the one that drops out of the open file's name in the editor's header. Those are two views of one
 * thing — opening `src/` in either has to open it in both, or the second is a tree that disagrees
 * with the tree beside it.
 *
 * It also has to outlive the pane. As component state, closing the file panel discarded every
 * folder you had opened on the way to what you were working on, and coming back gave you a project
 * collapsed to its root again. Nothing here is worth losing to a pane being put away.
 *
 * Lazily expanded, one directory at a time: a project with a `node_modules` has more paths than
 * anything would want to walk up front, and the only ones that matter are the ones actually opened.
 *
 * What is *not* here: the filter and the search scope. Those are a question being asked by one tree
 * at one moment — typing a name into the dropdown to find something has no business rewriting the
 * search field in the panel behind it. Every view keeps its own; see `useFileTree`.
 */

import { create } from "zustand";
import type { FileEntry } from "../../electron/ipc-types.ts";
import { isDescendantPath, joinPath, relativeTo } from "../lib/paths.ts";
import { bridge } from "../services/index.ts";

interface FileTreeState {
	/**
	 * Directory contents by path — the cache and the "has been opened" record in one.
	 *
	 * Every project a tree is showing, side by side. A split draws one conversation per screen and
	 * each screen's tree shows its own project; keyed by path, they cannot collide. This used to hold
	 * one project's folders for the window and throw every path away when a view named another, so
	 * two screens on two projects took turns: each tree emptied the other's, and the one without focus
	 * listed the focused project.
	 */
	children: Record<string, FileEntry[]>;
	expanded: Set<string>;

	/**
	 * Say which source folders a view is showing. Idempotent, because every view calls it.
	 *
	 * A list rather than one path, because a project may be several folders. Almost always one, and
	 * the one-folder case is deliberately indistinguishable from what this was before: the tree
	 * starts at that folder's contents rather than at a row naming the folder itself.
	 */
	show(roots: string[]): void;
	load(dir: string): Promise<FileEntry[]>;
	/** Re-read exactly these directories — what every operation does when it finishes. */
	refresh(dirs: Iterable<string>): Promise<void>;
	/** Re-read these source folders and everything open under them. */
	refreshOpen(roots: string[]): Promise<void>;
	toggle(path: string): void;
	expand(path: string): void;
	collapse(path: string): void;
	/** Shut everything open under these source folders — this tree's, not another screen's. */
	collapseAll(roots: string[]): void;
	/** Open every directory on the way to a path under these source folders, so a file can be revealed in the tree. */
	reveal(path: string, roots: string[]): Promise<void>;
}

/** Whether a directory belongs to a tree showing these source folders. */
const under = (roots: string[], dir: string) => roots.some((root) => dir === root || isDescendantPath(root, dir));

export const useFileTreeStore = create<FileTreeState>((set, get) => ({
	children: {},
	expanded: new Set(),

	show(roots) {
		const missing = roots.filter((root) => !(root in get().children));
		if (missing.length === 0) return;
		/*
		 * The main folder starts open, the others start shut — the first time the project is shown.
		 *
		 * On a one-folder project it is the only folder and nothing is drawn for it, so this is
		 * what has always happened. On a project with several, opening the pane onto a column of
		 * closed folders would make you click to see the thing you were already looking at; the
		 * others are additions and read better as additions.
		 */
		if (roots.length > 1 && missing.length === roots.length) set((current) => ({ expanded: new Set(current.expanded).add(roots[0]) }));
		for (const root of missing) void get().load(root);
	},

	async load(dir) {
		const entries = await bridge.files.list(dir);
		set((current) => ({ children: { ...current.children, [dir]: entries } }));
		return entries;
	},

	async refresh(dirs) {
		await Promise.all([...new Set(dirs)].map((dir) => get().load(dir)));
	},

	async refreshOpen(roots) {
		if (roots.length === 0) return;
		await get().refresh([...roots, ...[...get().expanded].filter((dir) => under(roots, dir))]);
	},

	expand(path) {
		const { expanded } = get();
		if (!expanded.has(path)) set({ expanded: new Set(expanded).add(path) });
		void get().load(path);
	},

	collapse(path) {
		const { expanded } = get();
		if (!expanded.has(path)) return;
		const next = new Set(expanded);
		next.delete(path);
		set({ expanded: next });
	},

	toggle(path) {
		const { expanded } = get();
		if (expanded.has(path)) get().collapse(path);
		else get().expand(path);
	},

	collapseAll: (roots) => set((current) => ({ expanded: new Set([...current.expanded].filter((dir) => !under(roots, dir))) })),

	async reveal(path, roots) {
		// Whichever source folder holds it. Deepest first, so a folder nested inside another one
		// opens the shorter branch rather than the whole way down from its parent.
		const root = [...roots]
			.sort((a, b) => b.length - a.length)
			.find((candidate) => isDescendantPath(candidate, path));
		if (!root) return;
		// Every segment but the last: the last one is the file itself, which has nothing to open.
		const segments = relativeTo(root, path).split(/[/\\]/).slice(0, -1);
		let dir = root;
		// The folder itself has to open too when it is one of several roots drawn as a row; on a
		// one-folder project it is not drawn, and opening it changes nothing.
		const opened: string[] = roots.length > 1 ? [root] : [];
		for (const segment of segments) {
			dir = joinPath(dir, segment);
			opened.push(dir);
			await get().load(dir);
		}
		if (opened.length > 0) set((current) => ({ expanded: new Set([...current.expanded, ...opened]) }));
	},
}));
