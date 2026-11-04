/**
 * Where the chip that follows a carried conversation sits, relative to the pointer.
 *
 * Below and to the right of the pointer, as it always was — except near the right or bottom edge,
 * where it flips to the other side. Carrying a conversation to the right edge is how a side-by-side
 * split is made, and with the chip fixed at the pointer's lower right it was drawn entirely past the
 * window there: x 1357.6 for a 141px chip in a 1364px window, nothing in the hand at the moment
 * that matters most.
 */

export const CHIP_GAP = 12;
/** Room kept between the chip and the window's edge, so a flipped chip is not flush against it. */
const EDGE = 4;

export function carryChipAt(
	pointer: { x: number; y: number },
	chip: { width: number; height: number },
	viewport: { width: number; height: number },
): { left: number; top: number } {
	const flipX = pointer.x + CHIP_GAP + chip.width > viewport.width - EDGE;
	const flipY = pointer.y + CHIP_GAP + chip.height > viewport.height - EDGE;
	return {
		left: flipX ? Math.max(EDGE, pointer.x - CHIP_GAP - chip.width) : pointer.x + CHIP_GAP,
		top: flipY ? Math.max(EDGE, pointer.y - CHIP_GAP - chip.height) : pointer.y + CHIP_GAP,
	};
}
