/**
 * One view of the tree: what is open (shared), what is being searched for (not), and the rows those
 * two add up to.
 *
 * The tree is drawn in two places — the file pane, and the dropdown under the open file's name — and
 * the split here is what makes those two the same tree rather than two trees that resemble each
 * other. Which directories are open lives in `store/fileTree.ts`, so opening `src/` in one opens it
 * in the other and neither loses it when its pane is closed.
 *
 * The filter and the search scope stay here, per view. They are a question being asked right now by
 * whoever is looking: typing a name into the dropdown to find something should not rewrite the
 * search field in the panel behind it, and closing the dropdown should not leave a filter applied
 * to a tree nobody typed into.
 */

import { useEffect, useMemo, useRef, useState } from "react";

import type { FileEntry } from "../../../electron/ipc-types.ts";
import { useApp } from "../../store/index.ts";
import { useFileTreeStore } from "../../store/fileTree.ts";

export interface TreeNode {
	entry: FileEntry;
	depth: number;
}

export interface FileTree {
	/** Directory contents by path — the cache and the "has been opened" record in one. */
	children: Record<string, FileEntry[]>;
	expanded: Set<string>;
	rows: TreeNode[];
	filter: string;
	setFilter(next: string): void;
	/** The folder 在此文件夹中搜索 narrowed to, or null for the whole project. */
	scope: string | null;
	setScope(next: string | null): void;
	load(dir: string): Promise<FileEntry[]>;
	/** Re-read exactly these directories — what every operation does when it finishes. */
	refresh(dirs: Iterable<string>): Promise<void>;
	/** Re-read the root and everything currently open. */
	refreshOpen(): Promise<void>;
	toggle(path: string): void;
	expand(path: string): void;
	collapse(path: string): void;
	collapseAll(): void;
	/** Open every directory on the way to a path, so a newly created file can be selected. */
	reveal(path: string): Promise<void>;
}

export function useFileTree(root: string | null): FileTree {
	const children = useFileTreeStore((s) => s.children);
	const expanded = useFileTreeStore((s) => s.expanded);
	const [filter, setFilter] = useState("");
	const [scope, setScope] = useState<string | null>(null);

	// Idempotent, so every view can say which project it is looking at without the second one
	// throwing away what the first has already loaded.
	useEffect(() => {
		useFileTreeStore.getState().setRoot(root);
	}, [root]);

	/*
	 * Re-read the tree when a turn ends.
	 *
	 * The agent writes files — that is most of what it does — and the panel was loading the tree
	 * once, when the project opened. Watching it work meant watching a list that had been true
	 * several minutes ago: files it had just created were simply absent. Every directory that is
	 * open gets re-read, since those are the ones being looked at.
	 */
	const running = useApp((s) => s.running);
	useEffect(() => {
		if (running || !root) return;
		void useFileTreeStore.getState().refreshOpen();
	}, [running, root]);

	/*
	 * A filter that outlived what it was filtering.
	 *
	 * The scope is a directory, and a directory can be renamed or deleted out from under it — by the
	 * agent, mid-turn, while the dropdown that set it is closed. Dropped when its folder stops
	 * existing, rather than leaving the tree narrowed to a path that resolves to nothing and reads
	 * as an empty project.
	 */
	useEffect(() => {
		if (scope && !(scope in children)) setScope(null);
	}, [scope, children]);

	/**
	 * Flatten the opened parts of the tree into the rows actually on screen.
	 *
	 * While filtering, the whole loaded tree is walked rather than only what is expanded, and a
	 * directory is kept when anything under it matches. Searching only inside folders you had
	 * already opened would answer a question nobody asked — the point of typing a name is to find
	 * where it is, which is precisely what you do not yet know.
	 */
	const rows = useMemo<TreeNode[]>(() => {
		const from = scope ?? root;
		if (!from) return [];
		const needle = filter.trim().toLowerCase();
		const out: TreeNode[] = [];

		const matches = (entry: FileEntry): boolean => entry.name.toLowerCase().includes(needle);
		const hasMatchBelow = (dir: string): boolean =>
			(children[dir] ?? []).some((entry) => matches(entry) || (entry.isDirectory && hasMatchBelow(entry.path)));

		const walk = (dir: string, depth: number) => {
			for (const entry of children[dir] ?? []) {
				if (!needle) {
					out.push({ entry, depth });
					if (entry.isDirectory && expanded.has(entry.path)) walk(entry.path, depth + 1);
					continue;
				}
				const deeper = entry.isDirectory && hasMatchBelow(entry.path);
				if (!matches(entry) && !deeper) continue;
				out.push({ entry, depth });
				// A directory on the path to a match opens itself; there is no point showing a
				// folder that matched and then hiding what matched inside it.
				if (deeper) walk(entry.path, depth + 1);
			}
		};
		walk(from, 0);
		return out;
	}, [root, scope, children, expanded, filter]);

	// Bound once: the store's actions never change identity, and the callers below put several of
	// them in dependency arrays.
	const store = useRef(useFileTreeStore.getState()).current;

	return {
		children,
		expanded,
		rows,
		filter,
		setFilter,
		scope,
		setScope,
		load: store.load,
		refresh: store.refresh,
		refreshOpen: store.refreshOpen,
		toggle: store.toggle,
		expand: store.expand,
		collapse: store.collapse,
		collapseAll: store.collapseAll,
		reveal: store.reveal,
	};
}
