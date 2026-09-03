/**
 * Remembering the layout, per conversation.
 *
 * Per conversation rather than per project, because that is the grain the work actually has: one
 * conversation is debugging and wants the terminal and the diff, the next is reading and wants the
 * file tree, and they are frequently in the same repository. Sharing one arrangement across a
 * project meant every switch either carried the wrong panes along or had to be rebuilt by hand.
 *
 * `localStorage` for the same reason the pane widths use it — this is a per-window preference, and
 * reading it synchronously on the first render is what stops the dock painting the default layout
 * for a frame before the saved one arrives.
 *
 * Everything that comes back out of storage is treated as hostile. It may have been written by an
 * older version, may name a panel that no longer exists, may have been hand-edited, and may not
 * be a tree at all. A layout that fails to load is a mild annoyance; a layout that loads *badly*
 * paints an empty window, which is indistinguishable from a crash.
 */

import { defaultTree, has, leafOf, normalize, type DockNode, type PaneKind } from "./tree.ts";

/** Bumped when the stored shape changes in a way older data cannot be read as. */
const VERSION = 1;

/**
 * How long a change waits before it is written.
 *
 * The pane widths write on every frame of a drag, which is right for one short number. A tree is
 * a whole JSON document and a splitter drag produces one per frame, so this one waits — long
 * enough to collapse a drag into a single write, short enough that closing the app right after
 * letting go still saves what you did.
 */
const SAVE_DELAY = 120;

/**
 * Where one conversation's layout is kept.
 *
 * `@draft` covers the conversation that has not been sent yet and so has no id — see `adopt`,
 * which hands that layout over the moment one is assigned rather than letting it be forgotten.
 */
export const storageKey = (session: string | null | undefined): string => `dw:dock:${session || "@draft"}`;

/**
 * Rebuild a tree from unknown data, dropping whatever cannot be trusted.
 *
 * Structural nonsense is discarded outright. Panes are dropped when their kind is not registered
 * — a plugin that provided one may be gone — and when their kind has already been seen, which is
 * how a duplicate that should never have been written gets repaired rather than rejected.
 */
function sift(raw: unknown, allowed: Set<string>, seen: Set<string>): DockNode | null {
	if (!raw || typeof raw !== "object") return null;
	const node = raw as Record<string, unknown>;

	if (node.type === "leaf") {
		const kind = node.kind;
		if (typeof kind !== "string" || !allowed.has(kind) || seen.has(kind)) return null;
		seen.add(kind);
		return leafOf(kind as PaneKind);
	}

	if (node.type !== "split") return null;
	if (node.dir !== "row" && node.dir !== "col") return null;
	if (!Array.isArray(node.children)) return null;
	const stored = Array.isArray(node.sizes) ? node.sizes : [];

	const children: DockNode[] = [];
	const sizes: number[] = [];
	node.children.forEach((child, i) => {
		const next = sift(child, allowed, seen);
		if (!next) return;
		children.push(next);
		const share = stored[i];
		sizes.push(typeof share === "number" && Number.isFinite(share) && share > 0 ? share : 0);
	});
	if (children.length === 0) return null;
	// `normalize` re-shares these, so a stored set that does not add up is repaired rather than
	// being a reason to throw the layout away.
	return { type: "split", dir: node.dir, children, sizes };
}

/**
 * A usable tree from any input at all.
 *
 * Never returns null and never throws: every caller of this is on the path that paints the
 * window, and the worst acceptable outcome there is the default layout.
 */
export function sanitize(raw: unknown, allowed: Iterable<PaneKind>): DockNode {
	const sifted = sift(raw, new Set<string>(allowed), new Set<string>());
	const tree = sifted ? normalize(sifted) : null;
	if (!tree) return defaultTree();
	if (has(tree, "conversation")) return tree;
	/*
	 * The conversation went missing — invariant 1 — so it is put back rather than the whole
	 * layout being discarded. Beside what survived, taking the larger share: it is the thing the
	 * window is for, and the panes that outlived it are the accessories.
	 */
	return (
		normalize({ type: "split", dir: "row", children: [leafOf("conversation"), tree], sizes: [0.6, 0.4] }) ?? defaultTree()
	);
}

export const serialize = (tree: DockNode): string => JSON.stringify({ v: VERSION, tree });

/** Read a stored layout, or null when there is nothing usable saved under this key. */
export function readTree(key: string, allowed: Iterable<PaneKind>): DockNode | null {
	let raw: string | null = null;
	try {
		raw = window.localStorage.getItem(key);
	} catch {
		// Storage can be unavailable outright — a private window, a quota error. The dock works
		// perfectly well without it; it just forgets.
		return null;
	}
	if (!raw) return null;
	try {
		const parsed = JSON.parse(raw) as { v?: unknown; tree?: unknown };
		if (parsed?.v !== VERSION) return null;
		return sanitize(parsed.tree, allowed);
	} catch {
		return null;
	}
}

/*
 * One pending write for the whole app, holding only the newest value.
 *
 * A splitter drag over one second produces sixty calls to `writeTree` and should produce one
 * write. Keeping the latest rather than a queue is what makes that true regardless of how long
 * the drag ran.
 */
let timer: number | undefined;
let queued: { key: string; tree: DockNode } | null = null;

function flush(): void {
	if (timer !== undefined) {
		window.clearTimeout(timer);
		timer = undefined;
	}
	const write = queued;
	queued = null;
	if (!write) return;
	try {
		window.localStorage.setItem(write.key, serialize(write.tree));
	} catch {
		// Out of quota, or storage turned off. Not worth interrupting anyone over.
	}
}

export function writeTree(key: string, tree: DockNode): void {
	queued = { key, tree };
	if (timer === undefined) timer = window.setTimeout(flush, SAVE_DELAY);
}

/**
 * Write immediately.
 *
 * Called when the window is going away and when the project changes — both are moments where the
 * pending write would otherwise be thrown out, and the second one would additionally write the
 * old project's layout under the new project's key a beat later.
 */
export const flushTree = flush;
