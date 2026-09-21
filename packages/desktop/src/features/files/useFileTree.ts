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
import { baseName } from "../../lib/paths.ts";
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

/**
 * Flatten the opened parts of the tree into the rows actually on screen.
 *
 * While filtering, the whole loaded tree is walked rather than only what is expanded, and a
 * directory is kept when anything under it matches. Searching only inside folders you had already
 * opened would answer a question nobody asked — the point of typing a name is to find where it is,
 * which is precisely what you do not yet know.
 *
 * Exported and pure so the arrangement can be checked without a window. Everything it decides —
 * whether a project's folders each get a row, what a filter hides, how deep a match indents — is
 * the kind of rule that is only noticed once it is wrong.
 */
export function treeRows({
	roots,
	scope,
	children,
	expanded,
	filter,
}: {
	roots: string[];
	scope: string | null;
	children: Record<string, FileEntry[]>;
	expanded: ReadonlySet<string>;
	filter: string;
}): TreeNode[] {
	const bases = scope ? [scope] : roots;
	if (bases.length === 0) return [];
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
			// A directory on the path to a match opens itself; there is no point showing a folder
			// that matched and then hiding what matched inside it.
			if (deeper) walk(entry.path, depth + 1);
		}
	};

	/*
	 * One base opens straight into its contents; several get a row each.
	 *
	 * The single case is the overwhelmingly common one and must look exactly as it always has — a
	 * row saying 「Lyra」 above the contents of Lyra is a level of nesting that tells you nothing.
	 * With several there is no such thing as "the" root, and which folder a file is in is the first
	 * thing you need to know about it.
	 */
	if (bases.length === 1) {
		walk(bases[0], 0);
		return out;
	}
	for (const base of bases) {
		// While filtering, a folder with nothing matching under it is not worth a row — the same
		// rule `walk` applies one level down.
		if (needle && !hasMatchBelow(base)) continue;
		out.push({ entry: { name: baseName(base), path: base, isDirectory: true, size: 0 }, depth: 0 });
		if (expanded.has(base) || needle) walk(base, 1);
	}
	return out;
}

export function useFileTree(roots: string[]): FileTree {
	const children = useFileTreeStore((s) => s.children);
	const expanded = useFileTreeStore((s) => s.expanded);
	const [filter, setFilter] = useState("");
	const [scope, setScope] = useState<string | null>(null);
	/*
	 * The paths, as one dependency.
	 *
	 * The array's identity changes on every render of whoever computed it while its contents do
	 * not, and keying these effects on identity would re-read the whole tree whenever anything
	 * else in the window re-rendered. `\0` separates because it is the one byte no filesystem
	 * allows in a name — a space would split `~/My Projects/app` into two roots that do not exist.
	 */
	const key = roots.join("\0");

	// Idempotent, so every view can say which project it is looking at without the second one
	// throwing away what the first has already loaded.
	useEffect(() => {
		useFileTreeStore.getState().setRoots(key ? key.split("\0") : []);
	}, [key]);

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
		if (running || !key) return;
		void useFileTreeStore.getState().refreshOpen();
	}, [running, key]);

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

	const rows = useMemo<TreeNode[]>(
		() => treeRows({ roots, scope, children, expanded, filter }),
		[roots, scope, children, expanded, filter],
	);

	// Bound once: the store's actions never change identity, and the callers below put several of
	// them in dependency arrays.
	//
	// `react/hooks` 读到 `useFileTreeStore` 这个名字就认为 hook 被当成值传了。zustand 的 store
	// 两样都是：调用它是 hook，`.getState()` 是它上面的静态方法，规则分辨不了这两种用法。
	// oxlint-disable-next-line react/hooks
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
