/**
 * The two ends of a picture's flight between a thumbnail and the viewer, as keyframes.
 *
 * Pure geometry, apart from the viewer, because the viewer has measured the wrong box more than
 * once and the only symptom each time was a picture that moved oddly — this is the part that can be
 * pinned down by a test instead of by eye.
 *
 * The start is one uniform scale plus a clip, not a squash. A thumbnail usually shows a `cover` crop
 * of a picture with a different shape, so the scale that makes the picture *cover* the thumbnail
 * leaves parts of it hanging outside; `clip-path` trims those, and its corner radius is divided by the
 * scale so that, once scaled, the corners are the thumbnail's own. The first frame is therefore the
 * thumbnail exactly — size, crop and corners — and so is the last frame of the way back. That is
 * what lets the picture stay fully opaque for the whole flight: the old 0.4 start existed to hide a
 * crop that is now simply not drawn, and it made every arrival begin with a flash of a faded copy.
 */

export interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** The part of a thumbnail that actually shows the picture, and how round its corners are. */
export interface Thumb {
	box: Box;
	radius: number;
}

/** One end of the flight: what `Element.animate` takes as a keyframe (a type, so it has the index signature `Keyframe` needs). */
export type FlightKeyframe = {
	transform: string;
	clipPath: string;
};

const px = (n: number) => `${Math.round(n * 100) / 100}px`;

/**
 * Where the full-size picture has to be drawn to look exactly like its thumbnail.
 *
 * `to` is the picture's settled box — measured with no transform on it. Measuring a box that is
 * still on its way somewhere is how the start once came out at 2.8× the thumbnail.
 */
export function atThumbnail(thumb: Thumb, to: Box): FlightKeyframe {
	const from = thumb.box;
	const scale = Math.max(from.width / to.width, from.height / to.height, 0.01);
	const dx = from.x + from.width / 2 - (to.x + to.width / 2);
	const dy = from.y + from.height / 2 - (to.y + to.height / 2);
	// In the picture's own, unscaled pixels: the strip on each side that the thumbnail does not show.
	const insetX = Math.max(0, (to.width - from.width / scale) / 2);
	const insetY = Math.max(0, (to.height - from.height / scale) / 2);
	return {
		transform: `translate(${px(dx)}, ${px(dy)}) scale(${Math.round(scale * 1e5) / 1e5})`,
		clipPath: `inset(${px(insetY)} ${px(insetX)} ${px(insetY)} ${px(insetX)} round ${px(thumb.radius / scale)})`,
	};
}

/**
 * The picture at rest in the viewer.
 *
 * Written as an `inset()` with a radius rather than `none` because a clip can only be interpolated
 * between two shapes of the same kind; from `inset(…)` to `none` it would jump on the last frame.
 */
export function atRest(radius: number): FlightKeyframe {
	return { transform: "none", clipPath: `inset(0px 0px 0px 0px round ${px(radius)})` };
}

/**
 * The rectangle a picture is drawn into inside its element, for the fits that leave margins.
 *
 * `cover` and `fill` paint the whole box, so the box is the answer. `contain` and `scale-down`
 * letterbox, and flying from the letterboxed box would start the picture wider or taller than
 * anything that was on screen.
 */
export function paintedBox(box: Box, natural: { width: number; height: number }, fit: string): Box {
	if ((fit !== "contain" && fit !== "scale-down") || natural.width <= 0 || natural.height <= 0) return box;
	let scale = Math.min(box.width / natural.width, box.height / natural.height);
	if (fit === "scale-down") scale = Math.min(scale, 1);
	const width = natural.width * scale;
	const height = natural.height * scale;
	return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}
