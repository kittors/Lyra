/**
 * 面板布局——每个会话一份，而且只有这一份。
 *
 * 面板（终端、浏览器、文件、Git、任务……）属于会话，不属于窗口。窗口里只有会话的网格：单屏是
 * 只有一屏的分屏，每一屏画的都是「这个会话的对话 + 它自己的面板」。所以这里的每棵树都挂在一个
 * scope 下，scope 就是那一屏的会话 id（空白对话是 `@draft`）。
 *
 * 从前有两层都能装面板：窗口一层跨着所有屏，每一屏又各有一层。两层之间靠一串特例对齐——「已经在
 * 窗口层的留在那儿」「分屏时窗口层冻结在进入分屏的那个会话」「浏览器页面按焦点在两层之间交接」——
 * 每条修一个症状，又在别处埋一个：任务面板分屏后横跨两屏、回到单屏的面板压在标题栏下面、打开
 * 网址冒出第二个浏览器、切一次焦点页面重载一次。架构决定见 `docs/adr/0023-containers-belong-to-sessions.md`。
 *
 * 这个文件只管数据：树、全屏、窄窗口时正显示哪一块、拖动中的临时状态。画成什么样是 `DockView` 的事。
 */

import { create } from "zustand";
import { sameDrop } from "./drop.ts";
import type { DragState } from "./drag-host.ts";
import { dropLegacy, dropTree, flushTree, legacyStorageKey, paneStorageKey, readTree, writeTree } from "./persist.ts";
import { MIN_FRACTION, paneFloor } from "./geometry.ts";
import { defaultDrop, dropFits, placePanel } from "./place.ts";
import {
	areAdjacent,
	defaultTree,
	has,
	insert,
	kinds,
	lift,
	move,
	moveAlong,
	nodeAt,
	pathTo,
	remove,
	resize,
	type Axis,
	type DockNode,
	type DropAt,
	type DropSide,
	type PaneKind,
} from "./tree.ts";

export const emptyDockTree: DockNode = defaultTree();

/**
 * What is filling one screen's dock, and how the room is divided when it is a pair.
 *
 * A pair, because the file tree and the open file are one tool between them: enlarging half of it
 * to read something leaves you unable to reach the next thing. `ratio` is the first pane's share
 * *of the two*, held here rather than derived from the tree — see `restore` for how it goes back.
 */
export interface Maximized {
	panes: PaneKind[];
	ratio: number;
	axis: Axis;
}

/** Where a pane asks to land, and how much of its partner's room it wants when it has one. */
export type Placement = DropAt & { share?: number };

interface ScopedDrag extends DragState {
	scope: string;
	/** What was full screen before the drag lifted it, so a cancel can put it back. */
	maximized: Maximized | null;
}

type Span = { width: number; height: number };

interface PaneDockState {
	trees: Record<string, DockNode>;
	/** Each live screen's measured size. A scope with no size is not on screen right now. */
	sizes: Record<string, Span>;
	maximized: Record<string, Maximized | null>;
	/** Which pane the narrow layout is showing, and which one the keyboard is on. */
	focused: Record<string, PaneKind>;
	/** A pair's split while full screen has it on the *other* axis from its dock. */
	crossRatio: Record<string, number>;
	drag: ScopedDrag | null;
	/**
	 * Which screen's browser hosts the pages nobody else is showing.
	 *
	 * Set by the workspace: the screen that has been on screen longest. See `useBrowserPages`.
	 */
	host: string | null;

	tree(scope: string): DockNode;
	size(scope: string): Span | undefined;
	/**
	 * Read this scope's layout back, the first time a screen shows it.
	 *
	 * `draftFrom` names the blank conversation this one was just sent from: a draft that was
	 * arranged and then given an id keeps the panes it was arranged with.
	 */
	hydrate(scope: string, allowed: PaneKind[], options?: { draftFrom?: string }): void;
	forget(scope: string): void;
	rememberSize(scope: string, span: Span): void;
	setHost(scope: string | null): void;
	open(scope: string, kind: PaneKind, at?: Placement): boolean;
	close(scope: string, kind: PaneKind): void;
	/** Put a panel away wherever it is open. For the panels whose contents are one shared thing. */
	closeEverywhere(kind: PaneKind): void;
	focus(scope: string, kind: PaneKind): void;
	moveTo(scope: string, kind: PaneKind, at: DropAt): void;
	moveAlong(scope: string, kind: PaneKind, side: DropSide): boolean;
	setShare(scope: string, path: number[], index: number, fraction: number, floor?: number): void;
	even(scope: string, path: number[], index: number): void;
	restoreLayout(scope: string, tree: DockNode): void;
	toggleMaximized(scope: string, kind: PaneKind, partner?: PaneKind): void;
	setMaximizedRatio(scope: string, ratio: number): void;
	setMaximizedAxis(scope: string, axis: Axis): void;
	/** Leave full screen, keeping whatever the boundary was dragged to. */
	restore(scope: string): void;
	preview(scope: string, rest: DockNode, kind: PaneKind, at: DropAt | null): void;
	beginDrag(scope: string, drag: DragState): void;
	dragTo(pointer: { x: number; y: number }, at: DropAt | null): void;
	endDrag(cancelled?: boolean): void;
}

/** How small either half of a maximised pair may get, as a share of the two. */
const PAIR_MIN = 0.15;

/**
 * How a pair divides the dock when full screen turns it on its side.
 *
 * A tree and a file stacked in a column open even — you are looking at both. Laid side by side
 * they are an editor, and an editor gives the tree a column and the file the rest.
 */
const FULL_SCREEN_RATIO = 0.3;

/** Write to memory, and through to disk — a bare conversation is "nothing stored", not a row. */
function persist(scope: string, tree: DockNode): void {
	if (tree.type === "leaf" && tree.kind === "conversation") dropTree(paneStorageKey(scope));
	else writeTree(paneStorageKey(scope), tree);
}

/**
 * Give a freshly opened pane the share its panel asked for, out of what it shares with its partner.
 *
 * `insert` halves whatever it splits, which is the right default and the wrong one for a pair: a
 * file tree wants a column and the file wants the rest. Expressed as *this pane's* share of the
 * two, so a panel declares how much room it needs without knowing which side it landed on.
 */
function withShare(tree: DockNode, kind: PaneKind, partner: PaneKind, share: number): DockNode {
	const path = pathTo(tree, kind);
	const partnerPath = pathTo(tree, partner);
	if (!path || path.length === 0 || !partnerPath) return tree;
	const parent = path.slice(0, -1);
	// Only siblings have a boundary between them to move.
	if (parent.join() !== partnerPath.slice(0, -1).join()) return tree;
	const split = nodeAt(tree, parent);
	if (split?.type !== "split") return tree;
	const at = path[path.length - 1];
	const beside = partnerPath[partnerPath.length - 1];
	if (Math.abs(at - beside) !== 1) return tree;
	// `resize` names a boundary by the child on its near side, so ask for the near one's share.
	const near = Math.min(at, beside);
	const pair = (split.sizes[near] ?? 0) + (split.sizes[near + 1] ?? 0);
	const mine = at === near ? share : 1 - share;
	return resize(tree, parent, near, mine * pair);
}

/** The boundary between two adjacent panes, named the way `resize` needs it. */
function seamOf(tree: DockNode, panes: PaneKind[]): { path: number[]; index: number } | null {
	const [one, other] = panes;
	const first = pathTo(tree, one);
	const second = pathTo(tree, other);
	if (!first || !second || first.length !== second.length) return null;
	const parent = first.slice(0, -1);
	if (parent.join() !== second.slice(0, -1).join()) return null;
	const near = Math.min(first[first.length - 1], second[second.length - 1]);
	return { path: parent, index: near };
}

/** What the first of a pair currently holds, as a share of the two. Half for anything else. */
function ratioOf(tree: DockNode, panes: PaneKind[]): number {
	if (panes.length !== 2) return 0.5;
	const seam = seamOf(tree, panes);
	if (!seam) return 0.5;
	const split = nodeAt(tree, seam.path);
	if (split?.type !== "split") return 0.5;
	const near = split.sizes[seam.index] ?? 0;
	const far = split.sizes[seam.index + 1] ?? 0;
	return near + far > 0 ? near / (near + far) : 0.5;
}

/**
 * What is left of full screen once the tree has changed shape.
 *
 * Panes that are no longer there stop being part of it; when none of them are, full screen is over.
 * Nothing else is reconsidered — the ratio and the axis describe a pair that is still a pair.
 */
function survivingMaximized(maximized: Maximized | null, present: PaneKind[]): Maximized | null {
	if (!maximized) return null;
	const panes = maximized.panes.filter((kind) => present.includes(kind));
	if (panes.length === 0) return null;
	return panes.length === maximized.panes.length ? maximized : { ...maximized, panes };
}

/**
 * Two stored layouts of one conversation, from before the two layers became one.
 *
 * Nothing the person opened is dropped. The window-era layout is the base — it is the full-size
 * arrangement they looked at on a single screen — and whatever only the screen layer held is added
 * where a new panel would go.
 */
function merged(windowLayout: DockNode | null, screenLayout: DockNode | null): DockNode | null {
	if (!windowLayout) return screenLayout;
	if (!screenLayout) return windowLayout;
	let tree = windowLayout;
	for (const kind of kinds(screenLayout)) {
		if (!has(tree, kind)) tree = insert(tree, kind, defaultDrop(tree));
	}
	return tree;
}

const isBare = (tree: DockNode | null | undefined): boolean => !tree || (tree.type === "leaf" && tree.kind === "conversation");

export const usePaneDock = create<PaneDockState>((set, get) => {
	/**
	 * Every structural change goes through here, so nothing changes a tree without saving it.
	 *
	 * `save` is false for the frames of a drag: those trees are provisional, and one of them is a
	 * tree with the carried pane missing entirely — exactly what a crash mid-drag must not leave.
	 */
	const commit = (scope: string, tree: DockNode, extra?: { focused?: PaneKind; maximized?: Maximized | null }, save = true) => {
		const state = get();
		const present = kinds(tree);
		const focused = extra?.focused ?? state.focused[scope] ?? "conversation";
		const maximized = extra && "maximized" in extra ? (extra.maximized ?? null) : survivingMaximized(state.maximized[scope] ?? null, present);
		set({
			trees: { ...state.trees, [scope]: tree },
			// A pane that left the tree cannot go on being the focused one.
			focused: { ...state.focused, [scope]: present.includes(focused) ? focused : "conversation" },
			maximized: { ...state.maximized, [scope]: maximized },
		});
		if (save) persist(scope, tree);
	};

	return {
		trees: {},
		sizes: {},
		maximized: {},
		focused: {},
		crossRatio: {},
		drag: null,
		host: null,

		tree: (scope) => get().trees[scope] ?? emptyDockTree,
		size: (scope) => get().sizes[scope],

		hydrate(scope, allowed, options) {
			// Memory is newer than disk: a screen that remounts keeps what it had.
			if (get().trees[scope]) return;
			const screenLayout = readTree(paneStorageKey(scope), allowed);
			const windowLayout = readTree(legacyStorageKey(scope), allowed);
			let tree = merged(isBare(windowLayout) ? null : windowLayout, isBare(screenLayout) ? null : screenLayout);
			/*
			 * 空白对话发出第一条消息、拿到 id 的那一下。
			 *
			 * 人常在开口之前先把面板摆好——那正是准备干活的时候。这时新 id 名下什么都没有，读新钥匙
			 * 只会读到空，刚摆好的布局就被扔了。只在调用方明说「这是刚从空白对话变来的」时才搬：
			 * 点开一个本来就存在、只是没存过布局的会话，看起来一模一样，却不该继承草稿的面板。
			 */
			if (!tree && options?.draftFrom) {
				const draft = get().trees[options.draftFrom] ?? readTree(paneStorageKey(options.draftFrom), allowed);
				if (!isBare(draft)) tree = draft;
			}
			if (windowLayout) dropLegacy(scope);
			if (!tree || isBare(tree)) return;
			set({ trees: { ...get().trees, [scope]: tree } });
			persist(scope, tree);
		},

		forget(scope) {
			if (get().drag?.scope === scope) get().endDrag(true);
			/*
			 * 只忘掉内存里那份，盘上的留着。
			 *
			 * `forget` 是这一屏从界面上消失时调的，而那既可能是关掉了这一屏，也可能只是刷新或者
			 * 这一格换了会话。盘上那份一起删掉，就等于「刷新一次布局就没了」。
			 */
			flushTree();
			set((state) => {
				if (!(scope in state.trees) && !(scope in state.sizes) && state.drag?.scope !== scope) return state;
				const trees = { ...state.trees };
				const sizes = { ...state.sizes };
				const maximized = { ...state.maximized };
				const focused = { ...state.focused };
				delete trees[scope];
				delete sizes[scope];
				delete maximized[scope];
				delete focused[scope];
				return { trees, sizes, maximized, focused, drag: state.drag?.scope === scope ? null : state.drag };
			});
		},

		rememberSize(scope, span) {
			if (!(span.width > 0) || !(span.height > 0)) return;
			const current = get().sizes[scope];
			if (current && current.width === span.width && current.height === span.height) return;
			set({ sizes: { ...get().sizes, [scope]: span } });
		},

		setHost(scope) {
			if (get().host !== scope) set({ host: scope });
		},

		/**
		 * Open a pane, or bring it forward if it is already open.
		 *
		 * A panel with a declared partner lands beside it when the partner is here. Everything else
		 * lands where a new panel goes — the edge that keeps every pane readable when there is one,
		 * and the usual edge otherwise, drawn squeezed. The floors choose *where*, never *whether*.
		 */
		open(scope, kind, at) {
			const state = get();
			const tree = state.tree(scope);
			if (has(tree, kind)) {
				set({ focused: { ...state.focused, [scope]: kind } });
				return true;
			}
			const paired = Boolean(at && at.kind !== null && has(tree, at.kind));
			const span = state.sizes[scope];
			// The same rule a single screen always had: the first panel is a column at the screen's edge.
			const usual = defaultDrop(tree);
			// The asked-for edge only counts while its neighbour is actually here.
			const asked = at && (at.kind === null || has(tree, at.kind)) ? { side: at.side, kind: at.kind } : null;
			let drop: DropAt;
			if (paired && asked) drop = asked;
			else if (asked && (!span || dropFits(tree, span, paneFloor, kind, asked))) drop = asked;
			else drop = (span ? placePanel(tree, span, paneFloor, kind) : null) ?? asked ?? usual;
			let next = insert(tree, kind, drop);
			if (paired && at?.kind && at.share !== undefined) next = withShare(next, kind, at.kind, at.share);
			/*
			 * Opened beside a pane that is full screen? Then it is full screen too — clicking a file in
			 * a maximised tree is the case. Anything else ends full screen, because the panel that was
			 * just asked for would otherwise open behind the maximised one.
			 */
			const current = state.maximized[scope] ?? null;
			const partner = paired && at?.kind && current?.panes.includes(at.kind) ? current : null;
			const panes = partner ? kinds(next).filter((each) => each === kind || partner.panes.includes(each)) : null;
			commit(scope, next, {
				focused: kind,
				maximized: partner && panes ? { ...partner, panes, ratio: ratioOf(next, panes) } : null,
			});
			return true;
		},

		close(scope, kind) {
			const tree = get().tree(scope);
			if (!has(tree, kind)) return;
			commit(scope, remove(tree, kind));
		},

		closeEverywhere(kind) {
			for (const [scope, tree] of Object.entries(get().trees)) {
				if (has(tree, kind)) get().close(scope, kind);
			}
		},

		// Guarded: this runs on every pointer-down inside a pane.
		focus(scope, kind) {
			if (get().focused[scope] === kind) return;
			set({ focused: { ...get().focused, [scope]: kind } });
		},

		/*
		 * Rearranging ends full screen: full screen is "show me only this", moving a pane is "show me
		 * where everything goes", and a pane in flight is briefly out of the tree.
		 */
		moveTo(scope, kind, at) {
			const tree = get().tree(scope);
			const rest = lift(tree, kind);
			if (!rest) return;
			// With one neighbour, a keyboard edge move divides that pair evenly, like a leaf drop.
			const target = at.kind === null && rest.type === "leaf" ? { ...at, kind: rest.kind } : at;
			commit(scope, move(tree, kind, target), { maximized: null });
		},

		moveAlong(scope, kind, side) {
			const tree = get().tree(scope);
			const next = moveAlong(tree, kind, side);
			if (!next) return false;
			if (next !== tree) commit(scope, next, { maximized: null });
			return true;
		},

		setShare(scope, path, index, fraction, floor) {
			const tree = get().tree(scope);
			const next = resize(tree, path, index, fraction, floor);
			if (next === tree) return;
			set({ trees: { ...get().trees, [scope]: next } });
			persist(scope, next);
		},

		even(scope, path, index) {
			get().setShare(scope, path, index, 0.5);
		},

		restoreLayout(scope, tree) {
			commit(scope, tree, { maximized: null });
		},

		/**
		 * Fill this screen with the pane — or with the pair it belongs to, when the partner is right
		 * beside it. Only this screen: another conversation on the window is not touched.
		 */
		toggleMaximized(scope, kind, partner) {
			const state = get();
			const tree = state.tree(scope);
			if (!has(tree, kind)) return;
			if (state.maximized[scope]?.panes.includes(kind)) {
				get().restore(scope);
				return;
			}
			const together = partner && has(tree, partner) && areAdjacent(tree, kind, partner);
			const panes = together ? kinds(tree).filter((each) => each === kind || each === partner) : [kind];
			// The axis is provisional: the renderer decides it from how much room there is, and says so.
			const seam = seamOf(tree, panes);
			const split = seam && nodeAt(tree, seam.path);
			const axis: Axis = split?.type === "split" ? split.dir : "row";
			set({ maximized: { ...state.maximized, [scope]: { panes, ratio: ratioOf(tree, panes), axis } } });
		},

		setMaximizedRatio(scope, ratio) {
			const maximized = get().maximized[scope];
			if (!maximized) return;
			set({ maximized: { ...get().maximized, [scope]: { ...maximized, ratio: Math.min(1 - PAIR_MIN, Math.max(PAIR_MIN, ratio)) } } });
		},

		/**
		 * The renderer decides the axis — it is the only thing that knows how much room there is —
		 * and turning the pair on its side changes which remembered proportion applies.
		 */
		setMaximizedAxis(scope, axis) {
			const state = get();
			const maximized = state.maximized[scope];
			if (!maximized || maximized.axis === axis) return;
			const tree = state.tree(scope);
			const seam = seamOf(tree, maximized.panes);
			const split = seam && nodeAt(tree, seam.path);
			const docked = split?.type === "split" ? split.dir : axis;
			const ratio = axis === docked ? ratioOf(tree, maximized.panes) : (state.crossRatio[scope] ?? FULL_SCREEN_RATIO);
			set({ maximized: { ...state.maximized, [scope]: { ...maximized, axis, ratio } } });
		},

		/*
		 * Written back scaled: the pair filled the screen and now holds part of a row again, so what
		 * survives is the ratio between them. Only on the panes' own axis — how wide you made the tree
		 * side by side says nothing about how tall you want it back in its column.
		 */
		restore(scope) {
			const state = get();
			const maximized = state.maximized[scope];
			if (!maximized) return;
			set({ maximized: { ...state.maximized, [scope]: null } });
			if (maximized.panes.length !== 2) return;
			const tree = state.tree(scope);
			const seam = seamOf(tree, maximized.panes);
			if (!seam) return;
			const split = nodeAt(tree, seam.path);
			if (split?.type !== "split") return;
			if (split.dir !== maximized.axis) {
				set({ crossRatio: { ...get().crossRatio, [scope]: maximized.ratio } });
				return;
			}
			const pair = (split.sizes[seam.index] ?? 0) + (split.sizes[seam.index + 1] ?? 0);
			const next = resize(tree, seam.path, seam.index, maximized.ratio * pair, MIN_FRACTION * pair);
			set({ trees: { ...get().trees, [scope]: next } });
			persist(scope, next);
		},

		/**
		 * Show what a drop would do, by inserting into the layout the carried pane has left.
		 *
		 * `rest`, never the current tree: applying the next preview to the previewed layout would make
		 * each answer depend on the one before, and it oscillates. Never written to disk — only
		 * `endDrag` commits a drag.
		 */
		preview(scope, rest, kind, at) {
			commit(scope, at ? insert(rest, kind, at) : rest, { maximized: null }, false);
		},

		beginDrag(scope, drag) {
			const maximized = get().maximized[scope] ?? null;
			set({ drag: { ...drag, scope, maximized }, maximized: { ...get().maximized, [scope]: null } });
		},

		/*
		 * Only when the landing place changes, which is the only part of this anyone renders from.
		 * The pointer is kept current without costing a render.
		 */
		dragTo(pointer, at) {
			const drag = get().drag;
			if (!drag) return;
			if (drag.at === at || sameDrop(drag.at, at)) {
				drag.pointer = pointer;
				return;
			}
			set({ drag: { ...drag, pointer, at } });
		},

		/*
		 * Put the layout back when the drag lands nowhere — and it has to be put back, not left: while
		 * a drag is in flight the carried pane is not in the tree. Escape takes the same path.
		 */
		endDrag(cancelled) {
			const drag = get().drag;
			if (!drag) return;
			set({ drag: null });
			if (cancelled || !drag.at) commit(drag.scope, drag.before, { maximized: drag.maximized });
			else persist(drag.scope, get().tree(drag.scope));
		},
	};
});

/**
 * Save on the way out.
 *
 * The write is debounced, so a change made in the last tenth of a second before the window closes
 * would otherwise be the one change that never survives — and that is exactly the change someone
 * would notice, because it is the one they just made.
 */
if (typeof window !== "undefined") window.addEventListener("beforeunload", flushTree);
