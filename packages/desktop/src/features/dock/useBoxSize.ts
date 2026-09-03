/**
 * The dock's own size in pixels, kept current.
 *
 * The layout is computed in shares and needs no measurement — except for the pixel floors, which
 * are the one part of it that cannot be expressed as a share: what counts as too narrow to read is
 * a number of pixels, and a share does not know how wide the window is.
 *
 * A layout effect and an observer rather than reading the ref during render. Reading the ref gives
 * null on the first pass and never updates afterwards, so the floors would be missing on the frame
 * the window opens and wrong on every frame after a resize.
 */

import { useLayoutEffect, useState } from "react";

export interface BoxSize {
	width: number;
	height: number;
}

export function useBoxSize(
	ref: React.RefObject<HTMLElement | null>,
	expectedWidth?: number,
): BoxSize | null {
	const [measured, setMeasured] = useState<BoxSize | null>(null);

	useLayoutEffect(() => {
		const element = ref.current;
		if (!element) return;
		const measure = () => {
			const { clientWidth: width, clientHeight: height } = element;
			// Zero means hidden rather than tiny; applying floors against it would make every pane
			// the whole dock for the frame before the real size arrives.
			if (width > 0 && height > 0) {
				setMeasured((current) => (current?.width === width && current?.height === height ? current : { width, height }));
			}
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref]);

	if (expectedWidth !== undefined && measured && measured.width !== expectedWidth && expectedWidth > 0) {
		return { width: expectedWidth, height: measured.height };
	}

	return measured;
}
