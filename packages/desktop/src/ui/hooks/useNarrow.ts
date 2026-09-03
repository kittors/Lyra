import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Whether an element is too narrow for a two-column layout, measured from the element itself.
 *
 * Panel contents cannot ask the window how much room they have — the same component runs in a
 * 368px panel and across a full-width column. This watches the box it is actually given.
 *
 * The first measurement is taken as soon as the node arrives rather than left to the observer's
 * initial callback. That callback lands after paint, so a component that starts at `false` renders
 * one frame of the wrong layout — and worse, anything keyed to the flip (a list/detail reset, say)
 * fires a beat after the user has already acted, undoing what they just did.
 *
 * A callback ref, not a ref object. The difference is not stylistic: a `useRef` + `useLayoutEffect`
 * pair only attaches the observer on the effect's first run, so a component that renders something
 * *else* first — an empty state while the project loads — never attaches at all, or attaches to a
 * node that is then replaced. Either way the observer ends up watching nothing, the flag keeps
 * whatever value it happened to have, and a panel opened to full screen goes on drawing the
 * stacked layout at a thousand pixels wide. React calls a callback ref every time the node changes,
 * which is exactly the event that matters.
 */
export function useNarrow(threshold: number): [boolean, (node: HTMLDivElement | null) => void] {
	const [narrow, setNarrow] = useState(false);
	const watching = useRef<ResizeObserver | null>(null);

	const attach = useCallback(
		(node: HTMLDivElement | null) => {
			watching.current?.disconnect();
			watching.current = null;
			if (!node) return;

			setNarrow(node.clientWidth > 0 && node.clientWidth < threshold);
			const observer = new ResizeObserver(([entry]) => {
				// Zero width means hidden, not narrow; a background tab would otherwise reshape itself.
				if (entry.contentRect.width > 0) setNarrow(entry.contentRect.width < threshold);
			});
			observer.observe(node);
			watching.current = observer;
		},
		[threshold],
	);

	// The observer must not outlive the component that asked for it.
	useEffect(() => () => watching.current?.disconnect(), []);

	return [narrow, attach];
}
