/**
 * The dock's state: one tree, and the few things that are true *about* the tree rather than in it.
 *
 * This replaces four fields that had to agree with each other — `panelOpen`, `activeTab`,
 * `expanded`, and the tab list — with one that cannot disagree with itself. A pane is open if it
 * is in the tree. Where it is, is where it is. There is no second place that also knows.
 *
 * What is *not* here is anything a pane contains. The side chat's messages, the queued tasks and
 * the browser's target all stay in `sideStore`: those are contents with their own lifetimes, and
 * folding them in would tie a conversation's history to where its window happened to be.
 */

import { create } from "zustand";
import { sameDrop } from "./drop.ts";
import { MIN_FRACTION } from "./geometry.ts";
import { flushTree, readTree, storageKey, writeTree } from "./persist.ts";
import {
	defaultTree,
	has,
	insert,
	kinds,
	areAdjacent,
	move,
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

/** A drag in flight. Null the rest of the time, which is almost all of it. */
interface DragState {
	kind: PaneKind;
	/** Where the pane was when the drag began, so the ghost can start there rather than jump. */
	from: { left: number; top: number; width: number; height: number };
	/** How far into the pane the pointer grabbed it, so the ghost hangs off the pointer correctly. */
	grip: { x: number; y: number };
	pointer: { x: number; y: number };
	/** The landing place currently committed to the tree, so a move is not re-applied per frame. */
	at: DropAt | null;
	/** The tree as it was before the drag, to restore if it lands nowhere. */
	before: DockNode;
	/**
	 * The layout without the carried pane, which is what the drag is hit-tested against.
	 *
	 * Fixed for the whole drag. The preview inserts into a copy of this rather than into whatever
	 * the previous frame produced — see `preview`.
	 */
	rest: DockNode;
}

interface DockState {
	tree: DockNode;
	/** Which pane the collapsed (narrow-window) form is showing. */
	focused: PaneKind;
	/**
	 * What is filling the dock, and how the room is divided when it is a pair.
	 *
	 * A pair, because the file tree and the open file are one tool between them: enlarging half of
	 * it to read something leaves you unable to reach the next thing.
	 *
	 * `ratio` is the first pane's share *of the two*, held here rather than derived from the tree.
	 * It is read from the tree on the way in and written back on the way out, so a width dragged
	 * full screen survives leaving it and a width dragged in the ordinary layout survives entering
	 * it — but while full screen is on, the two panes fill the dock and their split is its own
	 * number. Deriving it from the tree instead means clamping against a row that also holds the
	 * conversation, and a boundary that barely moves.
	 */
	maximized: { panes: PaneKind[]; ratio: number; axis: Axis } | null;
	/**
	 * The pair's split while full screen has it on the *other* axis from the dock.
	 *
	 * Kept here rather than in the tree, which only has room for one number per boundary and is
	 * already holding the one for the axis the panes actually live on.
	 */
	crossRatio: number;
	drag: DragState | null;
	/** The conversation this tree belongs to, so switching saves the old one under the right key. */
	scope: string | null;
	/**
	 * Whether `adopt` has ever run.
	 *
	 * Needed because `null` is a real scope — a conversation with no project runs in a scratch
	 * directory and has a layout of its own. Without this flag the initial `scope: null` is
	 * indistinguishable from "already pointed at the scratch scope", so the first `adopt(null)`
	 * decided there was nothing to do and the saved layout was never read back. Which is to say:
	 * the one case where persistence silently did nothing was the default case.
	 */
	adopted: boolean;

	/**
	 * Open a pane, or focus it if it is already open.
	 *
	 * `beside` is where it belongs when it has a declared partner — see `companion` on
	 * `PanelDefinition`. Passed in rather than looked up, because the registry knows about React
	 * components and this store deliberately does not.
	 */
	open(kind: PaneKind, beside?: { kind: PaneKind; side: DropSide; share?: number }): void;
	close(kind: PaneKind): void;
	toggle(kind: PaneKind): void;
	moveTo(kind: PaneKind, at: DropAt): void;
	/** Leave full screen. Separate from the toggle, for the callers that only ever want out. */
	restore(): void;
	/** Preview a drop, always derived from the layout without the carried pane. */
	preview(rest: DockNode, kind: PaneKind, at: DropAt | null): void;
	/**
	 * Move one boundary. `floor` is how small either side may get, defaulting to the tree's own —
	 * see `resize`, and the caller in `DockView` that scales it for a maximised pair.
	 */
	setShare(path: number[], index: number, fraction: number, floor?: number): void;
	focus(kind: PaneKind): void;
	toggleMaximized(kind: PaneKind, partner?: PaneKind): void;
	/** Move the boundary inside a maximised pair. The first pane's share of the two. */
	setMaximizedRatio(ratio: number): void;
	/** Tell the store which way the pair ended up being split, which only the renderer knows. */
	setMaximizedAxis(axis: Axis): void;
	reset(): void;

	beginDrag(drag: DragState): void;
	dragTo(pointer: { x: number; y: number }, at: DropAt | null): void;
	endDrag(cancelled?: boolean): void;

	/** Point the dock at a conversation, saving whatever the last one had. */
	adopt(scope: string | null, allowed: PaneKind[]): void;
}

/**
 * Where a pane goes when it is opened from the menu rather than dragged.
 *
 * The first panel opens as a column beside the conversation and the second stacks under it; the
 * third starts a column of its own, and so on in pairs.
 *
 * Stacking rather than opening a column every time is what keeps the conversation from being
 * squeezed thinner with each panel. But stacking *without limit* is worse: a fourth panel in one
 * column leaves each of them a couple of rows tall, which is not a terminal or a diff, it is a
 * hint that one exists. Two is where a pane still holds something worth looking at, so a full
 * column hands the next panel to a new one.
 */
export function defaultDrop(tree: DockNode): DropAt {
	const others = kinds(tree).filter((kind) => kind !== "conversation");
	if (others.length === 0) return { side: "right", kind: null };

	const last = others[others.length - 1];
	const path = pathTo(tree, last);
	const parent = path && path.length > 0 ? nodeAt(tree, path.slice(0, -1)) : null;
	const column = parent?.type === "split" && parent.dir === "col" ? parent.children.length : 1;

	/*
	 * A new column goes at the far right of the root, not beside `last`.
	 *
	 * Asking for the right of `last` would split the column it sits in and produce a row nested
	 * inside a column — two panes side by side where one used to be, rather than the new column
	 * this is trying to open.
	 */
	return column >= COLUMN_LIMIT ? { side: "right", kind: null } : { side: "bottom", kind: last };
}

/** How many panels share one column before the next one starts another. */
const COLUMN_LIMIT = 2;

/**
 * Give a freshly opened pane the share its panel asked for, out of what it shares with its partner.
 *
 * `insert` halves whatever it splits, which is the right default and the wrong one for a pair: a
 * file tree wants a column and the file wants the rest. Expressed as *this pane's* share of the
 * two, so a panel declares how much room it needs without knowing which side it landed on.
 *
 * The partner has to be named. This used to assume it was the neighbour on the left — `at - 1` —
 * which holds when the new pane is inserted *after* it (`bottom`, `right`) and is simply a
 * different pane when it is inserted before (`top`, `left`). Opening the tree to the left of the
 * file therefore divided the tree against the *conversation*, and set the conversation to 70% of
 * the window while the pair it was supposed to be dividing kept its even split.
 */
function withShare(
	tree: DockNode,
	kind: PaneKind | null,
	partner: PaneKind | null | undefined,
	share: number | undefined,
): DockNode {
	if (!kind || !partner || share === undefined) return tree;
	const path = pathTo(tree, kind);
	const partnerPath = pathTo(tree, partner);
	// No parent to divide: it is the only pane there, and there is nothing to share with.
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

/** How small either half of a maximised pair may get, as a share of the two. */
const PAIR_MIN = 0.15;

/**
 * How a pair divides the dock when full screen turns it on its side.
 *
 * A tree and a file stacked in a column open even — you are looking at both. Laid side by side
 * they are an editor, and an editor gives the tree a column and the file the rest. The two are
 * different numbers about different axes, so they are remembered separately: writing one into the
 * other is not remembering a size, it is overwriting a different one.
 */
const FULL_SCREEN_RATIO = 0.3;

/**
 * The boundary between two adjacent panes, named the way `resize` needs it.
 *
 * Null unless they really are siblings — which `areAdjacent` has already established by the time
 * anything calls this, but stating it here keeps the function honest on its own.
 */
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
 * Nothing else about it is reconsidered — the ratio and the axis describe a pair that is still a
 * pair, and re-deriving them here would overwrite a boundary the user had dragged.
 */
function survivingMaximized(
	maximized: DockState["maximized"],
	present: PaneKind[],
): DockState["maximized"] {
	if (!maximized) return null;
	const panes = maximized.panes.filter((kind) => present.includes(kind));
	if (panes.length === 0) return null;
	return panes.length === maximized.panes.length ? maximized : { ...maximized, panes };
}

/** Persist, unless the dock has not been pointed at a project yet. */
function save(scope: string | null, tree: DockNode): void {
	writeTree(storageKey(scope), tree);
}

export const useDock = create<DockState>((set, get) => {
	/**
	 * Every mutation goes through here, so nothing can change the tree without saving it.
	 *
	 * `persist` is false for the frames of a drag. Those trees are provisional — and one of them is
	 * a tree with the carried pane missing entirely, which is exactly the arrangement that must not
	 * be what a crash mid-drag leaves behind. The drag saves once, when it is let go.
	 */
	const commit = (tree: DockNode, extra?: Partial<DockState>, persist = true) => {
		const { scope, focused, maximized } = get();
		const present = kinds(tree);
		set({
			tree,
			// A pane that left the tree cannot go on being the focused one; the conversation is the
			// one thing guaranteed to still be there.
			focused: present.includes(focused) ? focused : "conversation",
			/*
			 * Full screen survives a change to the tree, minus whatever left it.
			 *
			 * This used to be dropped outright by any reshaping, on the grounds that it was a path
			 * into the tree and a path means something else once panes move. It is not a path — it
			 * is a set of pane kinds — so the reason went away and the behaviour stayed, and what it
			 * cost was the two most ordinary things you do while full screen: clicking a file in a
			 * maximised tree collapsed the whole layout back to normal instead of showing the file
			 * beside it, and closing one of a maximised pair dropped the other one out of full
			 * screen along with it.
			 *
			 * A kind that is no longer in the tree is dropped, and full screen ends when nothing is
			 * left of it. Callers that need it gone for a reason of their own — `open`, for a panel
			 * that would otherwise be invisible behind the maximised one — pass `maximized: null`
			 * explicitly through `extra`.
			 */
			maximized: survivingMaximized(maximized, present),
			...extra,
		});
		if (persist) save(scope, tree);
	};

	return {
		tree: defaultTree(),
		focused: "conversation",
		maximized: null,
		crossRatio: FULL_SCREEN_RATIO,
		drag: null,
		scope: null,
		adopted: false,

		open: (kind, beside) => {
			const { tree, maximized } = get();
			// Already open: bring it to attention rather than doing nothing, which is what the
			// narrow layout and the keyboard both need from this.
			if (has(tree, kind)) {
				set({ focused: kind });
				return;
			}
			// Beside its partner when it has one and the partner is here; otherwise wherever new
			// panes go. A file opening under the tree instead of next to it is the difference
			// between a file browser and two unrelated panels.
			const paired = beside && has(tree, beside.kind);
			const at = paired ? { side: beside.side, kind: beside.kind } : defaultDrop(tree);
			const next = withShare(insert(tree, kind, at), paired ? kind : null, beside?.kind, beside?.share);
			/*
			 * Opened beside a pane that is full screen? Then it is full screen too.
			 *
			 * Clicking a file in a maximised tree is the case: the file pane is being opened
			 * *because of* the tree, and the answer to "where does it go" is "next to the thing
			 * that asked for it" whether or not that thing is filling the dock. Collapsing the
			 * layout instead threw away the full screen the user had chosen, to show them the file
			 * in a pane a third of the size.
			 *
			 * Anything else ends full screen, because the panel that was just asked for would
			 * otherwise open behind the maximised one and appear not to have opened at all.
			 */
			const partner = paired && maximized?.panes.includes(beside.kind) ? maximized : null;
			const panes = partner ? kinds(next).filter((each) => each === kind || partner.panes.includes(each)) : null;
			commit(next, {
				focused: kind,
				maximized: partner && panes ? { ...partner, panes, ratio: ratioOf(next, panes) } : null,
			});
		},

		close: (kind) => commit(remove(get().tree, kind)),

		toggle: (kind) => {
			const { tree, focused } = get();
			if (!has(tree, kind)) {
				get().open(kind);
				return;
			}
			/*
			 * A shortcut pressed twice puts the pane away.
			 *
			 * Only when it is already the one being looked at, so ⌘P from inside the terminal
			 * moves you to the files rather than closing them — which is the behaviour the old
			 * `toggleTab` had, and the one that makes a shortcut usable as "go there".
			 */
			if (focused === kind) commit(remove(tree, kind));
			else set({ focused: kind });
		},

		/*
		 * Rearranging ends full screen, because the two are asking for opposite things.
		 *
		 * Full screen is "show me only this"; moving a pane is "show me where everything goes".
		 * Keeping both would move a pane to a place the user cannot see, and — worse — a pane in
		 * flight is briefly *out* of the tree, so the set would quietly lose it on the way past and
		 * hand back a pane that is no longer part of the full screen it was dragged out of.
		 */
		moveTo: (kind, at) => commit(move(get().tree, kind, at), { maximized: null }),

		/**
		 * Show what a drop would do, by inserting into the layout the carried pane has left.
		 *
		 * `rest`, never the current tree, and that is the whole reason this exists. The preview
		 * rearranges the panes, so applying the next preview to the rearranged layout would make
		 * each answer depend on the one before it — and it oscillates. Concretely: drag a pane onto
		 * the conversation's bottom edge and the two become stacked; the pointer has not moved, but
		 * it is now a quarter of the way down a pane half as tall, which is that pane's *top* band,
		 * so the next frame moves it again and the frame after that moves it back.
		 *
		 * Inserting into a fixed `rest` makes it idempotent: one pointer position means one layout,
		 * however many frames it is held there and whatever route it took. `null` — over no landing
		 * region at all — shows `rest` itself, with the carried pane simply not in the dock. It is
		 * being carried; the ghost is where it is.
		 */
		preview: (rest, kind, at) => commit(at ? insert(rest, kind, at) : rest, { maximized: null }, false),

		// Not through `commit`: this runs on every frame of a splitter drag, and the pane set is
		// unchanged by definition — a resize cannot orphan the focused pane.
		setShare: (path, index, fraction, floor) => {
			const tree = resize(get().tree, path, index, fraction, floor);
			set({ tree });
			save(get().scope, tree);
		},

		// Guarded, because this is called on every pointer-down anywhere in a pane: without the
		// check, clicking around inside the conversation would re-render the whole dock per click.
		focus: (kind) => {
			if (get().focused !== kind) set({ focused: kind });
		},

		/**
		 * Fill the dock with this pane — or with the pair it belongs to, when it has one here.
		 *
		 * `pairPath` only answers when the two are genuinely adjacent, so a tree and a file dragged
		 * to opposite ends of the window enlarge one at a time like anything else.
		 */
		toggleMaximized: (kind, partner) => {
			const { tree, maximized } = get();
			if (!has(tree, kind)) return;
			if (maximized?.panes.includes(kind)) {
				get().restore();
				return;
			}
			// The pair, when there is one and it is genuinely beside this pane; otherwise just this
			// one. Ordered by the tree so it reads the way the panes are laid out.
			const together = partner && has(tree, partner) && areAdjacent(tree, kind, partner);
			const panes = together ? kinds(tree).filter((each) => each === kind || each === partner) : [kind];
			// The axis is provisional: the renderer decides it from how much room there is, and
			// says so. Seeded from the tree so the first frame is not a guess.
			const seam = seamOf(tree, panes);
			const split = seam && nodeAt(tree, seam.path);
			const axis: Axis = split?.type === "split" ? split.dir : "row";
			set({ maximized: { panes, ratio: ratioOf(tree, panes), axis } });
		},

		/**
		 * The renderer decides the axis — it is the only thing that knows how much room there is —
		 * and turning the pair on its side changes which remembered proportion applies.
		 */
		setMaximizedAxis: (axis) => {
			const { maximized, tree, crossRatio } = get();
			if (!maximized || maximized.axis === axis) return;
			const seam = seamOf(tree, maximized.panes);
			const split = seam && nodeAt(tree, seam.path);
			const docked = split?.type === "split" ? split.dir : axis;
			// Back on the panes' own axis, the tree's own split is the answer; across it, the
			// proportion this pair was last given on that axis.
			set({ maximized: { ...maximized, axis, ratio: axis === docked ? ratioOf(tree, maximized.panes) : crossRatio } });
		},

		setMaximizedRatio: (ratio) => {
			const maximized = get().maximized;
			if (!maximized) return;
			// Clamped in the frame the user is looking at, where the pair fills the dock.
			set({ maximized: { ...maximized, ratio: Math.min(1 - PAIR_MIN, Math.max(PAIR_MIN, ratio)) } });
		},

		/**
		 * Leave full screen, keeping whatever the boundary was dragged to.
		 *
		 * Written back scaled: the pair filled the dock and now holds part of a row again, so what
		 * is preserved is the ratio between them rather than the numbers.
		 *
		 * Only when the axis matches. Full screen puts a stacked pair side by side, and how wide
		 * you made the tree there says nothing about how tall you want it back in its column —
		 * writing one into the other is not remembering a size, it is overwriting a different one.
		 */
		restore: () => {
			const { tree, maximized } = get();
			if (!maximized) return;
			set({ maximized: null });
			if (maximized.panes.length !== 2) return;
			const seam = seamOf(tree, maximized.panes);
			if (!seam) return;
			const split = nodeAt(tree, seam.path);
			if (split?.type !== "split") return;
			// Across the panes' own axis there is nowhere in the tree to put it, so it is kept for
			// the next time full screen turns them that way.
			if (split.dir !== maximized.axis) {
				set({ crossRatio: maximized.ratio });
				return;
			}
			const pair = (split.sizes[seam.index] ?? 0) + (split.sizes[seam.index + 1] ?? 0);
			const next = resize(tree, seam.path, seam.index, maximized.ratio * pair, MIN_FRACTION * pair);
			set({ tree: next });
			save(get().scope, next);
		},

		reset: () => commit(defaultTree(), { focused: "conversation", maximized: null }),

		beginDrag: (drag) => set({ drag }),

		/*
		 * Only when the landing place changes, which is the only part of this anyone renders from.
		 *
		 * `pointer` used to be written every frame, and every frame therefore re-rendered every
		 * component subscribed to this store — the whole dock, panels and all, sixty times a
		 * second, to update a number nothing reads. That was most of what "the app flickers while
		 * dragging" was. The pointer is still kept, because the drag state should describe the
		 * drag; it just no longer costs a render to keep it current.
		 */
		dragTo: (pointer, at) => {
			const drag = get().drag;
			if (!drag) return;
			if (drag.at === at || sameDrop(drag.at, at)) {
				drag.pointer = pointer;
				return;
			}
			set({ drag: { ...drag, pointer, at } });
		},

		endDrag: (cancelled) => {
			const drag = get().drag;
			set({ drag: null });
			if (!drag) return;
			/*
			 * Put the layout back when the drag lands nowhere — and it *has* to be put back, not
			 * merely left alone: while a drag is in flight the carried pane is not in the tree, so
			 * "leaving it" would be losing it. Escape takes the same path.
			 */
			if (cancelled || !drag.at) commit(drag.before);
			// The drag's own frames were not persisted; this is the one write it makes.
			else save(get().scope, get().tree);
		},

		adopt: (scope, allowed) => {
			const { adopted, scope: leaving, tree } = get();
			if (adopted && leaving === scope) return;
			// The outgoing conversation's pending write must land under its own key, before the key
			// changes — otherwise its layout is saved as the incoming one's.
			flushTree();

			const stored = readTree(storageKey(scope), allowed);

			/*
			 * A draft that has just been given an id keeps the layout it was arranged with.
			 *
			 * The panes are opened while the conversation is still unsent — that is when you set up
			 * to work — and it gets its id the moment the first message is stored. Reading the new
			 * key there would find nothing and reset the dock, throwing away an arrangement made
			 * seconds earlier.
			 *
			 * Two conditions on it, because "the scope went from null to an id" is *also* what
			 * happens the first time you click an existing conversation after launch — and this
			 * branch used to fire unconditionally, so that conversation's own saved layout was
			 * overwritten by whatever the untouched draft happened to be holding. Which is the exact
			 * thing per-conversation layouts exist to prevent, on the first click of every session.
			 *
			 * So: only when the incoming id has no layout of its own to be overwritten, and only
			 * when the draft was actually arranged into something. A default dock is not an
			 * arrangement worth carrying anywhere.
			 */
			if (adopted && scope && leaving === null && !stored && kinds(tree).length > 1) {
				set({ scope, drag: null });
				save(scope, tree);
				return;
			}

			set({
				scope,
				adopted: true,
				tree: stored ?? defaultTree(),
				focused: "conversation",
				maximized: null,
				drag: null,
			});
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
