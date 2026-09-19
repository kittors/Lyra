/**
 * A dock that lives inside one tiled conversation, not in the window.
 *
 * Opening a browser from a split screen's header must land in that screen. The window
 * dock is a different tree: it holds panels opened against the window, and stays
 * draggable around the conversation grid. Each screen keeps its own tree here and
 * uses the same insert / fit / drag moves.
 *
 * Inserts and moves ask the tile's pixel span first. A landing that would put any
 * pane below its floor is refused. Tile floors allow dense tool layouts, while
 * keeping their axes and preventing overlapping cards.
 */

import { create } from "zustand";
import { sameDrop } from "./drop.ts";
import { dropTree, flushTree, paneStorageKey, readTree, writeTree } from "./persist.ts";
import { tilePaneFloor } from "./geometry.ts";
import { dropFits, placePanel } from "./place.ts";
import { defaultDrop, type DragState } from "./store.ts";
import {
	defaultTree,
	has,
	insert,
	lift,
	move,
	moveAlong,
	remove,
	resize,
	type DockNode,
	type DropAt,
	type DropSide,
	type PaneKind,
} from "./tree.ts";

export const emptyDockTree: DockNode = defaultTree();

interface PaneDrag extends DragState {
	scope: string;
	maximized: PaneKind | null;
}

type DockSpan = { width: number; height: number };

interface PaneDockState {
	trees: Record<string, DockNode>;
	sizes: Record<string, DockSpan>;
	drag: PaneDrag | null;
	maximized: Record<string, PaneKind | null>;
	toggleMaximized(scope: string, kind: PaneKind): void;
	restore(scope: string): void;
	restoreLayout(scope: string, tree: DockNode): void;
	tree(scope: string): DockNode;
	size(scope: string): DockSpan | undefined;
	rememberSize(scope: string, span: DockSpan): void;
	open(scope: string, kind: PaneKind, at?: DropAt): boolean;
	close(scope: string, kind: PaneKind): void;
	toggle(scope: string, kind: PaneKind): boolean;
	setShare(scope: string, path: number[], index: number, fraction: number): void;
	even(scope: string, path: number[], index: number): void;
	moveTo(scope: string, kind: PaneKind, at: DropAt): void;
	moveAlong(scope: string, kind: PaneKind, side: DropSide): boolean;
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
		// Empty is a loaded layout, not permission to re-read a pending deletion from disk.
		return { ...trees, [scope]: tree };
	}
	writeTree(paneStorageKey(scope), tree);
	return { ...trees, [scope]: tree };
}

function allowedDrop(tree: DockNode, span: DockSpan | undefined, kind: PaneKind, at: DropAt | null): DropAt | null {
	if (!at) return null;
	if (!span) return at;
	return dropFits(tree, span, tilePaneFloor, kind, at) ? at : null;
}

export const usePaneDock = create<PaneDockState>((set, get) => ({
	trees: {},
	sizes: {},
	drag: null,
	maximized: {},
	toggleMaximized(scope, kind) {
		if (!has(get().tree(scope), kind)) return;
		set({ maximized: { ...get().maximized, [scope]: get().maximized[scope] === kind ? null : kind } });
	},
	restore(scope) {
		if (get().maximized[scope]) set({ maximized: { ...get().maximized, [scope]: null } });
	},
	restoreLayout(scope, tree) {
		set({ trees: write(get().trees, scope, tree) });
	},
	tree: (scope) => get().trees[scope] ?? emptyDockTree,
	size: (scope) => get().sizes[scope],
	rememberSize(scope, span) {
		if (!(span.width > 0) || !(span.height > 0)) return;
		const current = get().sizes[scope];
		if (current && current.width === span.width && current.height === span.height) return;
		set({ sizes: { ...get().sizes, [scope]: span } });
	},
	open(scope, kind, at) {
		get().restore(scope);
		const tree = get().tree(scope);
		if (has(tree, kind)) return true;
		const span = get().sizes[scope];
		const preferred = tree.type === "leaf" ? { side: "right" as const, kind: tree.kind } : defaultDrop(tree);
		const drop = at
			? allowedDrop(tree, span, kind, at) ?? (span ? placePanel(tree, span, tilePaneFloor, kind) : null)
			: span
				? allowedDrop(tree, span, kind, preferred) ?? placePanel(tree, span, tilePaneFloor, kind)
				: preferred;
		if (!drop) return false;
		set({ trees: write(get().trees, scope, insert(tree, kind, drop)) });
		return true;
	},
	close(scope, kind) {
		if (get().maximized[scope] === kind) get().restore(scope);
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
		const rest = lift(tree, kind);
		if (!rest) return;
		// With one neighbor, a keyboard edge move divides that pair evenly, like a leaf drop.
		const target = at.kind === null && rest.type === "leaf" ? { ...at, kind: rest.kind } : at;
		const next = move(tree, kind, target);
		const span = get().sizes[scope];
		if (span && !dropFits(rest, span, tilePaneFloor, kind, target)) return;
		get().restore(scope);
		set({ trees: write(get().trees, scope, next) });
	},
	moveAlong(scope, kind, side) {
		const tree = get().tree(scope);
		const next = moveAlong(tree, kind, side);
		if (!next) return false;
		if (next !== tree) set({ trees: write(get().trees, scope, next) });
		return true;
	},
	preview(scope, rest, kind, at) {
		const span = get().sizes[scope];
		const drop = allowedDrop(rest, span, kind, at);
		// A preview may omit the carried pane. Only endDrag may commit it to disk.
		set({ trees: { ...get().trees, [scope]: drop ? insert(rest, kind, drop) : rest } });
	},
	beginDrag(scope, drag) {
		set({ drag: { ...drag, scope, maximized: get().maximized[scope] ?? null }, maximized: { ...get().maximized, [scope]: null } });
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
		if (!drag) return;
		const restore = cancelled || !drag.at;
		set({
			drag: null,
			trees: write(get().trees, drag.scope, restore ? drag.before : get().tree(drag.scope)),
			maximized: { ...get().maximized, [drag.scope]: restore ? drag.maximized : null },
		});
	},
	forget(scope) {
		if (get().drag?.scope === scope) get().endDrag(true);
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
			const maximized = { ...state.maximized };
			delete trees[scope];
			delete sizes[scope];
			delete maximized[scope];
			return { trees, sizes, maximized, drag: state.drag?.scope === scope ? null : state.drag };
		});
	},
}));
