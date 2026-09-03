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
import { isDescendantPath, joinPath, relativeTo } from "../components/files/paths.ts";
import { bridge } from "../services/index.ts";

interface FileTreeState {
	/** The project these paths belong to, so a change of project can throw them away. */
	root: string | null;
	/** Directory contents by path — the cache and the "has been opened" record in one. */
	children: Record<string, FileEntry[]>;
	expanded: Set<string>;

	/**
	 * Point the tree at a project. Idempotent, because every view calls it.
	 *
	 * A different project starts from nothing: same tree, different paths, and a folder that was
	 * open in the last one means nothing here.
	 */
	setRoot(root: string | null): void;
	load(dir: string): Promise<FileEntry[]>;
	/** Re-read exactly these directories — what every operation does when it finishes. */
	refresh(dirs: Iterable<string>): Promise<void>;
	/** Re-read the root and everything currently open. */
	refreshOpen(): Promise<void>;
	toggle(path: string): void;
	expand(path: string): void;
	collapse(path: string): void;
	collapseAll(): void;
	/** Open every directory on the way to a path, so a file can be revealed in the tree. */
	reveal(path: string): Promise<void>;
}

export const useFileTreeStore = create<FileTreeState>((set, get) => ({
	root: null,
	children: {},
	expanded: new Set(),

	setRoot(root) {
		if (get().root === root) return;
		set({ root, children: {}, expanded: new Set() });
		if (root) void get().load(root);
	},

	async load(dir) {
		const entries = await bridge.files.list(dir);
		set((current) => ({ children: { ...current.children, [dir]: entries } }));
		return entries;
	},

	async refresh(dirs) {
		await Promise.all([...new Set(dirs)].map((dir) => get().load(dir)));
	},

	async refreshOpen() {
		const { root, expanded } = get();
		if (!root) return;
		await get().refresh([root, ...expanded]);
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

	collapseAll: () => set({ expanded: new Set() }),

	async reveal(path) {
		const root = get().root;
		if (!root || !isDescendantPath(root, path)) return;
		// Every segment but the last: the last one is the file itself, which has nothing to open.
		const segments = relativeTo(root, path).split(/[/\\]/).slice(0, -1);
		let dir = root;
		const opened: string[] = [];
		for (const segment of segments) {
			dir = joinPath(dir, segment);
			opened.push(dir);
			await get().load(dir);
		}
		if (opened.length > 0) set((current) => ({ expanded: new Set([...current.expanded, ...opened]) }));
	},
}));
