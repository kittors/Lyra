/**
 * Which conversations this window is showing, and which one has the composer focus.
 *
 * Held here rather than in the app store because it is one window's tiling: another window of
 * the same app has its own tree, and the live transcript slot is still singular. Focusing a
 * pane is what swaps that slot.
 */

import { create } from "zustand";
import {
	adopt,
	contains,
	defaultTree,
	firstSession,
	leafCount,
	nodeAt,
	removeLeaf,
	replaceLeaf,
	resize,
	sessionIds,
	splitLeaf,
	type DropSide,
	type ResizeFloor,
	type SplitNode,
} from "./tree.ts";
import { useApp } from "../../store/index.ts";
import { loadSplit, saveSplit } from "./persist.ts";

export interface SplitState {
	tree: SplitNode;
	focused: string | null;
	windowId: string;
	hydrate: (windowId: string, existing: Set<string>, fallbackProject?: string) => void;
	reset: (sessionId?: string | null) => void;
	focus: (sessionId: string | null) => void;
	show: (sessionId: string) => void;
	split: (target: string | null, incoming: string, side: DropSide) => "split" | "replace" | "focus" | "full";
	close: (sessionId: string) => string | null;
	resize: (path: number[], index: number, share: number, floor?: ResizeFloor) => void;
	even: (path: number[], index: number, floor?: ResizeFloor) => void;
	forgetMissing: (existing: Set<string>) => void;
}

function persist(state: Pick<SplitState, "windowId" | "tree" | "focused">): void {
	if (!state.windowId) return;
	saveSplit(state.windowId, state.tree, state.focused);
}

export const useSplit = create<SplitState>((set, get) => ({
	tree: defaultTree(),
	focused: null,
	windowId: "",

	hydrate(windowId, existing, fallbackProject = "") {
		const previous = get();
		/*
		 * The tiling belongs to the window. Focusing a conversation from another project
		 * updates `workspace` — that used to reload `ly:split:…:theOtherPath` and throw
		 * away a four-pane mix. Once this window has a tree, keep it.
		 */
		if (previous.windowId === windowId && windowId !== "") return;
		const loaded = loadSplit(windowId, fallbackProject);
		/*
		 * An empty `existing` is "the list has not arrived", not "every conversation was
		 * deleted". Adopting against it would throw the saved tiling away on every boot.
		 */
		let tree = existing.size === 0 ? loaded.tree : adopt(loaded.tree, existing);
		let focused = loaded.focused && contains(tree, loaded.focused) ? loaded.focused : null;
		const loadedEmpty = leafCount(tree) === 1 && firstSession(tree) === null;
		const live = leafCount(previous.tree) > 1 || firstSession(previous.tree) !== null;
		if (loadedEmpty && live) {
			tree = previous.tree;
			focused = previous.focused;
		}
		const active = useApp.getState().activeSessionId;
		if (leafCount(tree) === 1 && firstSession(tree) === null && active) {
			tree = { type: "leaf", sessionId: active };
			focused = active;
		}
		set({ windowId, tree, focused });
	},

	reset(sessionId = null) {
		const tree = { type: "leaf" as const, sessionId };
		set({ tree, focused: sessionId });
		persist({ ...get(), tree, focused: sessionId });
	},

	focus(sessionId) {
		if (get().focused === sessionId) return;
		set({ focused: sessionId });
		persist(get());
	},

	show(sessionId) {
		const { tree, focused } = get();
		if (contains(tree, sessionId)) {
			set({ focused: sessionId });
			persist({ ...get(), focused: sessionId });
			return;
		}
		const target = focused && contains(tree, focused) ? focused : null;
		const next = replaceLeaf(tree, target, sessionId);
		set({ tree: next, focused: sessionId });
		persist({ ...get(), tree: next, focused: sessionId });
	},

	split(target, incoming, side) {
		const { tree } = get();
		if (contains(tree, incoming)) {
			set({ focused: incoming });
			persist({ ...get(), focused: incoming });
			return "focus";
		}
		const split = splitLeaf(tree, target, incoming, side);
		if (split) {
			set({ tree: split, focused: incoming });
			persist({ ...get(), tree: split, focused: incoming });
			return "split";
		}
		if (leafCount(tree) >= 4) {
			const next = replaceLeaf(tree, target, incoming);
			set({ tree: next, focused: incoming });
			persist({ ...get(), tree: next, focused: incoming });
			return "replace";
		}
		return "full";
	},

	close(sessionId) {
		const { tree } = get();
		const next = removeLeaf(tree, sessionId);
		const remaining = sessionIds(next);
		const focused = remaining.includes(get().focused ?? "") ? get().focused : remaining[0] ?? null;
		set({ tree: next, focused });
		persist({ ...get(), tree: next, focused });
		return focused;
	},

	resize(path, index, share, floor) {
		const tree = resize(get().tree, path, index, share, floor);
		if (tree === get().tree) return;
		set({ tree });
		persist({ ...get(), tree });
	},

	even(path, index, floor) {
		const node = nodeAt(get().tree, path);
		if (!node || node.type !== "split") return;
		const near = node.sizes[index];
		const far = node.sizes[index + 1];
		if (near === undefined || far === undefined) return;
		get().resize(path, index, (near + far) / 2, floor);
	},

	forgetMissing(existing) {
		/*
		 * `adopt` always returns a new split object. Comparing by identity would rewrite the
		 * tree (and persist it) on every `sessions` refresh — a streaming reply would rebalance
		 * the handles once a second. Only a missing id is a reason to walk it.
		 *
		 * An empty set is "the list has not arrived", the same as `hydrate`. Treating it as
		 * "every conversation was deleted" would throw a four-pane mix away on every boot.
		 */
		if (existing.size === 0) return;
		if (sessionIds(get().tree).every((id) => existing.has(id))) return;
		const tree = adopt(get().tree, existing);
		if (tree === get().tree) return;
		const current = get().focused;
		const focused = current && contains(tree, current) ? current : null;
		set({ tree, focused });
		persist({ ...get(), tree, focused });
	},
}));
