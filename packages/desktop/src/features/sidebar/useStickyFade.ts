/**
 * Keep the scroller's upper fade below the rows pinned over it.
 *
 * The rows are held by `position: sticky`; this only tells the mask where they currently are, as
 * the four lengths of `fadeGeometry`. How deeply to soften around them is `.ly-fade-y`'s, because
 * the depth being divided animates and a number frozen here cannot follow it. `sticky.ts` has the
 * reasoning, including why this being a frame behind is harmless when the placement was not.
 *
 * Reads on the frame, writes only on change: this runs on every frame of every scroll of the one
 * surface in the app that is always being scrolled.
 */

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { FADE_TOP } from "../../ui/scroll/Scroller.tsx";
import { fadeGeometry, heldBand, type FadeGeometry, type StickyRow } from "./sticky.ts";

/** 要按钉住的行的下沿淡没的元素，读 `--ly-held-edge` 的就是它们（`misc.css` 的 `ly-under-pin`）。 */
const EDGE_READERS = "[data-ly-row], [data-ly-fades], [data-ly-band]";

/*
 * 这条线只写给顶上那一段里的元素：视口上方四分之一屏到视口一半。
 *
 * 从前写在滚动区上，靠继承传给每一行。可继承的变量一变，整棵列表都要重算样式，开销跟挂着的元素数
 * 成正比——两百个项目时一次一百毫秒，二十个项目也要十毫秒，而滚过项目标题交接时几乎每帧都在变。
 * 真正用得上这条线的只有快滑到钉住的行底下的那几行：下面的行离线还远，值旧一点也照样不透明；
 * 滑出上沿的行已经是 0。所以变量注册成不继承，只写给这一段里的几十个元素。
 *
 * 上面留四分之一屏，是给往回滚、从上沿重新进来的行：`IntersectionObserver` 晚一帧才报，要赶在它们
 * 露出来之前补上。
 */
const NEAR_TOP = "25% 0px -50% 0px";

/*
 * 分组比行挑得更紧：只有下沿离线不到这么远的才写。
 *
 * 分组身上挂着滚动时间线（标题靠它淡出），改一次要连着重算整组的子树，一次半毫秒多；收起的项目只有
 * 一个标题高，顶上那一段能排下十来个，每帧都全写一遍就又是十几毫秒。而标题只在分组下沿离线 36px
 * 以内才淡，再往下的分组值旧一点没有关系。多留的这一段是给一帧滚过的距离，要赶在下沿进 36px 之前写上。
 */
const BAND_LEAD = FADE_TOP + 48;

function writeEdge(node: HTMLElement, edge: number, written: WeakMap<HTMLElement, number>): void {
	if (written.get(node) === edge) return;
	node.style.setProperty("--ly-held-edge", `${edge}px`);
	written.set(node, edge);
}

/**
 * Attach to a scroll viewport. `rail` is the offset headings rest at, in pixels — the strip rests
 * at `gap`, and everything else under it.
 */
export function useStickyFade(viewport: React.RefObject<HTMLDivElement | null>, gap: number, rail: number): void {
	/** Found once per change to the list rather than once per frame. */
	const rows = useRef<{ node: HTMLElement; rail: number }[]>([]);
	const stale = useRef(true);
	const written = useRef<FadeGeometry>({ top: -1, inset: -1, room: -1, run: -1 });
	const frame = useRef(0);
	/** 顶上那一段里的读者，和每个读者身上现在写着的值。见 `NEAR_TOP`。 */
	const near = useRef(new Set<HTMLElement>());
	const edgeOn = useRef(new WeakMap<HTMLElement, number>());
	const edge = useRef(0);

	const measure = useCallback(() => {
		const view = viewport.current;
		if (!view) return;

		if (stale.current) {
			const strip = view.querySelector<HTMLElement>("[data-ly-rail]");
			rows.current = [
				...(strip ? [{ node: strip, rail: gap }] : []),
				...[...view.querySelectorAll<HTMLElement>("[data-ly-head]")].map((node) => ({ node, rail })),
			];
			stale.current = false;
		}

		/*
		 * Every read, then the one write.
		 *
		 * `getBoundingClientRect` flushes pending layout, and a style written between two of them
		 * makes the next flush again — so interleaving would mean a forced reflow per pinned row,
		 * every frame.
		 */
		const origin = view.getBoundingClientRect().top;
		const measured: StickyRow[] = rows.current.map(({ node, rail: at }) => {
			const box = node.getBoundingClientRect();
			return { top: box.top - origin, bottom: box.bottom - origin, rail: at };
		});
		/*
		 * The depth the softening allows for is the depth it is about to eat into.
		 *
		 * Zero while the scroller is at its top: nothing is being softened then, so no row needs
		 * protecting from it, and a strip sitting a hundred pixels down is not "nearly held".
		 */
		const band = heldBand(measured, view.scrollTop > 0 ? FADE_TOP : 0);
		/*
		 * Where the held rows are, and nothing about how deep to soften.
		 *
		 * That split is the fix rather than a refactor. How deep is `--ly-fade-top`, it animates,
		 * and the sidebar's mask reaches it only through the lengths derived in `.ly-fade-y` — so
		 * a depth written from here is a transition overwritten with one of its own frames. It was
		 * also arithmetic that had the single-run case backwards: with one run `nextTop` equals
		 * `bottom`, so the gap it wrote was zero, every stop of that gradient landed on the same
		 * offset, and the sidebar went from opaque to transparent in no pixels at all. Which is to
		 * say it had no top fade — the reported defect, on every frame but the handful where a
		 * heading happened to be approaching its rail.
		 */
		const next = fadeGeometry(band);

		// 还在读的阶段，量完再写，理由同上。
		const bands: HTMLElement[] = [];
		for (const node of near.current) {
			if (!node.hasAttribute("data-ly-band")) continue;
			const bottom = node.getBoundingClientRect().bottom - origin;
			if (bottom >= 0 && bottom <= next.inset + BAND_LEAD) bands.push(node);
		}

		const last = written.current;
		if (last.top !== next.top || last.inset !== next.inset || last.room !== next.room || last.run !== next.run) {
			view.style.setProperty("--ly-hold-top", `${next.top}px`);
			view.style.setProperty("--ly-fade-inset", `${next.inset}px`);
			view.style.setProperty("--ly-hold-room", `${next.room}px`);
			view.style.setProperty("--ly-hold-run", `${next.run}px`);
			written.current = next;
		}
		/*
		 * 同一条下沿，再写一份给列表的行读：它们要按这条线在滑进钉住的行底下之前淡没。只写顶上那一段，
		 * 见 `NEAR_TOP` 和 `BAND_LEAD`。线没变也要走一遍：分组是按位置挑的，刚滑进来的要补上。
		 */
		edge.current = next.inset;
		for (const node of near.current) if (!node.hasAttribute("data-ly-band")) writeEdge(node, next.inset, edgeOn.current);
		for (const node of bands) writeEdge(node, next.inset, edgeOn.current);
	}, [viewport, gap, rail]);

	const schedule = useCallback(() => {
		if (frame.current) return;
		frame.current = requestAnimationFrame(() => {
			frame.current = 0;
			measure();
		});
	}, [measure]);

	useLayoutEffect(() => {
		const view = viewport.current;
		if (!view) return;
		// 这个集合本身不换，只增删成员；取一次给清理用，不在清理时再读 ref。
		const nearby = near.current;
		stale.current = true;
		measure();

		view.addEventListener("scroll", schedule, { passive: true });

		/*
		 * A project folding shut changes heights without touching the DOM — CSS is animating a grid
		 * track — so only a `ResizeObserver` sees it, and it has to watch the blocks that shrink
		 * rather than the viewport, whose own size never changes.
		 */
		const sizes = new ResizeObserver(schedule);
		const watch = () => {
			sizes.disconnect();
			sizes.observe(view);
			for (const child of view.children) sizes.observe(child);
		};
		watch();

		/*
		 * 新挂上的读者当场写上现在的值，不等它进了顶上那一段再补：切标签、开归档时整张列表是在顶上
		 * 换出来的，等一帧就是一帧没按线淡的行。
		 */
		const readers = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const node = entry.target as HTMLElement;
					if (!entry.isIntersecting) {
						near.current.delete(node);
						continue;
					}
					near.current.add(node);
					// 分组等 `measure` 按位置挑，这里一写就是每个滑进来的分组都付一次重算。
					if (!node.hasAttribute("data-ly-band")) writeEdge(node, edge.current, edgeOn.current);
				}
			},
			{ root: view, rootMargin: NEAR_TOP },
		);
		const within = (root: HTMLElement) => [...(root.matches(EDGE_READERS) ? [root] : []), ...root.querySelectorAll<HTMLElement>(EDGE_READERS)];
		const adopt = (root: HTMLElement) => {
			for (const node of within(root)) {
				writeEdge(node, edge.current, edgeOn.current);
				readers.observe(node);
			}
		};
		const drop = (root: HTMLElement) => {
			for (const node of within(root)) {
				readers.unobserve(node);
				near.current.delete(node);
			}
		};
		adopt(view);

		/*
		 * Marks the cached rows stale and asks for a frame; it does not go looking for them here.
		 * Titles type themselves out a character at a time, which is a mutation per frame per
		 * running conversation, and re-querying the list on each one is work done many times over
		 * to reach the same answer. The next measurement needs it once. Readers that came or went are
		 * the one thing taken from the records: typing adds text nodes, which carry none.
		 */
		const changes = new MutationObserver((records) => {
			for (const record of records) {
				for (const node of record.removedNodes) if (node instanceof HTMLElement) drop(node);
				for (const node of record.addedNodes) if (node instanceof HTMLElement) adopt(node);
			}
			stale.current = true;
			watch();
			schedule();
		});
		changes.observe(view, { childList: true, subtree: true });

		return () => {
			view.removeEventListener("scroll", schedule);
			sizes.disconnect();
			changes.disconnect();
			readers.disconnect();
			nearby.clear();
			if (frame.current) cancelAnimationFrame(frame.current);
		};
	}, [measure, schedule, viewport]);

	// The list can be replaced without the viewport changing — switching tab, opening the archive.
	useEffect(() => {
		stale.current = true;
		schedule();
	});
}
