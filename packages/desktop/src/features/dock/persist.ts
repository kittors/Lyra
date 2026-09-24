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
 * 一个会话的面板布局存在哪——每个会话一份，也只有这一份。
 *
 * 面板属于会话，不属于窗口：单屏是只有一屏的分屏，所以单屏和分屏读写的是同一把钥匙。`@draft`
 * 是还没发出第一条消息的那个空白对话，它没有 id，但一样可以摆好面板再开口。
 *
 * 钥匙名沿用分屏时代的 `dw:panedock:`，存量数据因此不用搬。
 */
export const paneStorageKey = (scope: string): string => `dw:panedock:${scope}`;

/**
 * 旧版窗口 dock 按会话存的那一份，只读一次、并进上面那把钥匙之后就删。
 *
 * 从前面板有两个家：窗口一层（跨所有屏，`dw:dock:<会话>`）和每一屏自己一层（`dw:panedock:<会话>`）。
 * 同一个会话可能两边都存着东西——单屏时开的任务面板在前者，分屏时开的浏览器在后者。合并时一个
 * 都不丢，见 `pane-store.ts` 的 `hydrate`。
 */
export const legacyStorageKey = (scope: string): string => `dw:dock:${scope}`;

/** 旧版窗口 dock 记「此刻认哪把钥匙」用的，两层合成一层之后没有意义了。 */
const LEGACY_AT_KEY = "dw:dock:at";

/** 把旧版那一行删掉。读不到、删不掉都不值得打断任何人。 */
export function dropLegacy(scope: string): void {
	if (noWindow()) return;
	try {
		window.localStorage.removeItem(legacyStorageKey(scope));
		window.localStorage.removeItem(LEGACY_AT_KEY);
	} catch {
		// 存储关了，下次再读到也只是再合并一遍，结果相同。
	}
}

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
 * 每把钥匙一份待写值，只留最新的那个。
 *
 * 一次持续一秒的分隔线拖拽会调六十次 `writeTree`，而它应该只产生一次写。按 key 留最新值而不是
 * 排一条队，是这一点无论拖多久都成立的原因。
 */
let timer: number | undefined;
/**
 * 按 key 排队，不是一个槽。
 *
 * 从前这里是单个 `{ key, tree }`：后一次写会把前一次顶掉，而两次的 key 可能不是同一个。
 * 只有窗口 dock 一个写者时看不出来——它每次写的都是同一把钥匙。分屏里每一屏各有一棵 dock 树，
 * 一旦它们也开始存，同一个 120ms 窗口里就会有好几把钥匙争这一个槽，先来的静静丢掉。
 */
const queued = new Map<string, DockNode | null>();

/**
 * 没有 window 就什么都不做。
 *
 * 这个文件开头就写着：存储用不了时 dock 照常工作，只是会忘事。从前只有读那一侧照着做了
 * （`readTree` 包了 try/catch），写这一侧没有——它一直只被渲染进程调用，所以看不出来。
 * pane dock 也开始存之后，无 DOM 的单测里 `window.setTimeout` 当场就抛了。
 */
const noWindow = (): boolean => typeof window === "undefined";

function schedule(): void {
	if (noWindow()) return;
	if (timer === undefined) timer = window.setTimeout(flush, SAVE_DELAY);
}

function flush(): void {
	if (noWindow()) return;
	if (timer !== undefined) {
		window.clearTimeout(timer);
		timer = undefined;
	}
	if (queued.size === 0) return;
	const writes = [...queued];
	queued.clear();
	for (const [key, tree] of writes) {
		try {
			if (tree === null) window.localStorage.removeItem(key);
			else window.localStorage.setItem(key, serialize(tree));
		} catch {
			// Out of quota, or storage turned off. Not worth interrupting anyone over.
		}
	}
}

export function writeTree(key: string, tree: DockNode): void {
	queued.set(key, tree);
	schedule();
}

/** 这一份不再存在了——空树不值得占一行，留着还会在下次读出来。 */
export function dropTree(key: string): void {
	queued.set(key, null);
	schedule();
}

/**
 * Write immediately.
 *
 * Called when the window is going away and when the project changes — both are moments where the
 * pending write would otherwise be thrown out, and the second one would additionally write the
 * old project's layout under the new project's key a beat later.
 */
export const flushTree = flush;
