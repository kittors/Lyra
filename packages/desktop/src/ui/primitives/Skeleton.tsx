/**
 * Placeholders shaped like the thing that has not arrived yet.
 *
 * The point is not to entertain during a wait — it is that the page is already the right shape
 * when the content lands, so nothing jumps. A spinner or a 读取中… line says "wait" and then
 * rearranges everything underneath it the moment it goes; these occupy the same boxes the real
 * rows and cards will.
 *
 * They are only for a *first* load. Once there is something to show, showing it beats showing a
 * drawing of it — a revalidation behind real content must leave that content alone.
 */

import { useEffect, useState } from "react";

/**
 * Whether a load has gone on long enough to be worth drawing a placeholder for.
 *
 * A skeleton that appears for two frames is a flicker, and a flicker reads as a glitch rather than
 * as progress — measured against a warm cache the catalogue filled in 59ms, of which the
 * placeholder held 32. Under the threshold nothing is shown at all, which is the honest depiction
 * of a wait nobody noticed.
 */
export function useSlowLoad(loading: boolean, delay = 220): boolean {
	const [slow, setSlow] = useState(false);

	useEffect(() => {
		if (!loading) {
			setSlow(false);
			return;
		}
		const timer = window.setTimeout(() => setSlow(true), delay);
		return () => window.clearTimeout(timer);
	}, [loading, delay]);

	return slow;
}

/** One dim block. `width` is any CSS length, so a row of them can look like text rather than bars. */
export function SkeletonBar({ width, height = 10, className = "" }: { width: string; height?: number; className?: string }) {
	return <span className={`ly-skeleton block rounded-full ${className}`} style={{ width, height }} />;
}

/**
 * A catalogue card: mark, title, two lines of description, and the button on the right.
 *
 * The widths vary per index so a grid of them does not read as a printed pattern — the eye finds
 * repetition faster than it finds text, and a perfectly regular placeholder looks like a bug.
 */
export function SkeletonCard({ index = 0 }: { index?: number }) {
	const title = [92, 116, 78, 104][index % 4] ?? 96;
	const second = [82, 64, 90, 71][index % 4] ?? 78;

	return (
		<div className="flex items-start gap-3 p-3" aria-hidden>
			<span className="ly-skeleton block shrink-0 rounded-[10px]" style={{ width: 36, height: 36 }} />
			<div className="min-w-0 flex-1 pt-0.5">
				<SkeletonBar width={`${title}px`} height={11} />
				<SkeletonBar width="100%" height={9} className="mt-2.5" />
				<SkeletonBar width={`${second}%`} height={9} className="mt-1.5" />
			</div>
			<span className="ly-skeleton mt-0.5 block shrink-0 rounded-lg" style={{ width: 58, height: 26 }} />
		</div>
	);
}

/** A settings list row: mark, title, one line, and the switch. */
export function SkeletonRow({ index = 0 }: { index?: number }) {
	const title = [70, 96, 58, 84][index % 4] ?? 76;
	const detail = [68, 84, 56, 76][index % 4] ?? 70;

	return (
		<div className="flex items-center gap-3 py-3.5" aria-hidden>
			<span className="ly-skeleton block shrink-0 rounded-[9px]" style={{ width: 32, height: 32 }} />
			<div className="min-w-0 flex-1">
				<SkeletonBar width={`${title}px`} height={11} />
				<SkeletonBar width={`${detail}%`} height={9} className="mt-2" />
			</div>
			<span className="ly-skeleton block shrink-0 rounded-full" style={{ width: 34, height: 20 }} />
		</div>
	);
}

/**
 * A grid of cards, matching the catalogue's own two-column layout.
 *
 * `label` is what a screen reader is told instead of the shapes, which mean nothing to it.
 */
export function SkeletonGrid({ count = 6, label = "正在读取" }: { count?: number; label?: string }) {
	return (
		<div className="pt-6" role="status" aria-label={label}>
			<div className="grid grid-cols-1 gap-x-4 @2xl:grid-cols-2">
				{Array.from({ length: count }, (_, index) => (
					<SkeletonCard key={index} index={index} />
				))}
			</div>
		</div>
	);
}

/** A stack of settings rows, matching the list they stand in for. */
export function SkeletonList({ count = 5, label = "正在读取" }: { count?: number; label?: string }) {
	return (
		<div role="status" aria-label={label}>
			{Array.from({ length: count }, (_, index) => (
				<SkeletonRow key={index} index={index} />
			))}
		</div>
	);
}
