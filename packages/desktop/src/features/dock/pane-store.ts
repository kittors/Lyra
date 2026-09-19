/**
 * A dock that lives inside one tiled conversation, not in the window.
 *
 * Opening a browser from a split screen's header must land in that screen. The window
 * dock is a different tree: it holds panels opened against the window, and stays
 * draggable around the conversation grid. Each screen keeps its own tree here and
 * uses the same insert / fit / drag moves.
 *
 * Inserts and moves ask the tile's pixel span first. A landing that would put any
 * pane below its floor is refused — that is the crushed conversation in a 2×2 tile,
 * and `fitTree` overlapping is not an answer to it.
 */

import { create } from "zustand";
import { sameDrop } from "./drop.ts";
import { dropTree, flushTree, paneStorageKey, readTree, writeTree } from "./persist.ts";
import { paneFloor } from "./geometry.ts";
import { dropFits, placePanel } from "./place.ts";
import { defaultDrop, type DragState } from "./store.ts";
import {
	defaultTree,
	has,
	insert,
	lift,
	move,
	remove,
	resize,
	type DockNode,
	type DropAt,
	type PaneKind,
} from "./tree.ts";

export const emptyDockTree: DockNode = defaultTree();

interface PaneDrag extends DragState {
	scope: string;
}

type DockSpan = { width: number; height: number };

interface PaneDockState {
	trees: Record<string, DockNode>;
	sizes: Record<string, DockSpan>;
	drag: PaneDrag | null;
	tree(scope: string): DockNode;
	size(scope: string): DockSpan | undefined;
	rememberSize(scope: string, span: DockSpan): void;
	open(scope: string, kind: PaneKind, at?: DropAt): boolean;
	close(scope: string, kind: PaneKind): void;
	toggle(scope: string, kind: PaneKind): boolean;
	setShare(scope: string, path: number[], index: number, fraction: number): void;
	even(scope: string, path: number[], index: number): void;
	moveTo(scope: string, kind: PaneKind, at: DropAt): void;
	/** 把盘上存着的那棵树读回来。`allowed` 只有渲染层知道，所以由 `PaneDock` 在挂载时递进来。 */
	hydrate(scope: string, allowed: PaneKind[]): void;
	preview(scope: string, rest: DockNode, kind: PaneKind, at: DropAt | null): void;
	beginDrag(scope: string, drag: DragState): void;
	dragTo(pointer: { x: number; y: number }, at: DropAt | null): void;
	endDrag(cancelled?: boolean): void;
	forget(scope: string): void;
}

/**
 * 写进内存，顺手写进盘。
 *
 * 窗口 dock 一直有 `persist.ts`，这一层从前没有对应物——分屏里调好的终端、文件树，刷新一次
 * 就全没了，而两屏本身好好地恢复着。那种「恢复了一半」比整个不恢复更让人confused。
 */
function write(trees: Record<string, DockNode>, scope: string, tree: DockNode): Record<string, DockNode> {
	if (tree.type === "leaf" && tree.kind === "conversation") {
		dropTree(paneStorageKey(scope));
		if (!(scope in trees)) return trees;
		const next = { ...trees };
		delete next[scope];
		return next;
	}
	writeTree(paneStorageKey(scope), tree);
	return { ...trees, [scope]: tree };
}

function allowedDrop(tree: DockNode, span: DockSpan | undefined, kind: PaneKind, at: DropAt | null): DropAt | null {
	if (!at) return null;
	if (!span) return at;
	return dropFits(tree, span, paneFloor, kind, at) ? at : null;
}

export const usePaneDock = create<PaneDockState>((set, get) => ({
	trees: {},
	sizes: {},
	drag: null,
	tree: (scope) => get().trees[scope] ?? emptyDockTree,
	size: (scope) => get().sizes[scope],
	rememberSize(scope, span) {
		if (!(span.width > 0) || !(span.height > 0)) return;
		const current = get().sizes[scope];
		if (current && current.width === span.width && current.height === span.height) return;
		set({ sizes: { ...get().sizes, [scope]: span } });
	},
	open(scope, kind, at) {
		const tree = get().tree(scope);
		if (has(tree, kind)) return true;
		const span = get().sizes[scope];
		const drop = at
			? allowedDrop(tree, span, kind, at) ?? (span ? placePanel(tree, span, paneFloor, kind) : null)
			: span
				? placePanel(tree, span, paneFloor, kind)
				: defaultDrop(tree);
		if (!drop) return false;
		set({ trees: write(get().trees, scope, insert(tree, kind, drop)) });
		return true;
	},
	close(scope, kind) {
		set({ trees: write(get().trees, scope, remove(get().tree(scope), kind)) });
	},
	toggle(scope, kind) {
		const tree = get().tree(scope);
		if (has(tree, kind)) {
			get().close(scope, kind);
			return true;
		}
		return get().open(scope, kind);
	},
	setShare(scope, path, index, fraction) {
		const tree = get().tree(scope);
		const next = resize(tree, path, index, fraction);
		if (next === tree) return;
		set({ trees: write(get().trees, scope, next) });
	},
	even(scope, path, index) {
		get().setShare(scope, path, index, 0.5);
	},
	hydrate(scope, allowed) {
		// 内存里已经有了就不读盘：那一份比盘上新。
		if (get().trees[scope]) return;
		const stored = readTree(paneStorageKey(scope), allowed);
		if (!stored || (stored.type === "leaf" && stored.kind === "conversation")) return;
		set({ trees: { ...get().trees, [scope]: stored } });
	},
	moveTo(scope, kind, at) {
		const tree = get().tree(scope);
		const next = move(tree, kind, at);
		const span = get().sizes[scope];
		if (span && !dropFits(lift(tree, kind) ?? tree, span, paneFloor, kind, at)) return;
		set({ trees: write(get().trees, scope, next) });
	},
	preview(scope, rest, kind, at) {
		const span = get().sizes[scope];
		const drop = allowedDrop(rest, span, kind, at);
		set({ trees: write(get().trees, scope, drop ? insert(rest, kind, drop) : rest) });
	},
	beginDrag(scope, drag) {
		set({ drag: { ...drag, scope } });
	},
	dragTo(pointer, at) {
		const drag = get().drag;
		if (!drag) return;
		const span = get().sizes[drag.scope];
		const drop = allowedDrop(drag.rest, span, drag.kind, at);
		if (drag.at === drop || sameDrop(drag.at, drop)) {
			drag.pointer = pointer;
			return;
		}
		set({ drag: { ...drag, pointer, at: drop } });
	},
	endDrag(cancelled) {
		const drag = get().drag;
		set({ drag: null });
		if (!drag) return;
		if (cancelled || !drag.at) set({ trees: write(get().trees, drag.scope, drag.before) });
	},
	forget(scope) {
		/*
		 * 只忘掉内存里那份，盘上的留着。
		 *
		 * `forget` 是这一屏从界面上消失时调的（`PaneDock` 卸载），而那既可能是关掉了这一屏，
		 * 也可能只是刷新或者换了页。把盘上那份一起删掉，就等于「刷新一次布局就没了」——正是
		 * 这次要修的毛病。真正该删的时候走的是 `write` 里那条空树分支。
		 */
		flushTree();
		set((state) => {
			if (!(scope in state.trees) && !(scope in state.sizes) && state.drag?.scope !== scope) return state;
			const trees = { ...state.trees };
			const sizes = { ...state.sizes };
			delete trees[scope];
			delete sizes[scope];
			return { trees, sizes, drag: state.drag?.scope === scope ? null : state.drag };
		});
	},
}));
