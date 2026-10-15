/**
 * The colours handed to the window for what it paints outside the page, dimmed with the page.
 *
 * The theme decides the title strip's colour and the colour of the system's buttons drawn into it
 * (see `applyAppearance`). A scrim over the window should cover those too, and cannot — they are not
 * in the document — so the colours themselves are mixed with every scrim held in `scrims.ts` and
 * sent again, and sent back as they were once the scrims are gone. The window's own backing colour
 * is left alone: it only shows while a resize outruns the page, and a dialog does not change it.
 */

import { bridge } from "../../services/index.ts";
import { heldScrims, onScrimsChange, type Scrim } from "../../ui/overlay/scrims.ts";

export interface WindowColors {
	/** The window's backing colour. */
	color: string;
	/** The title strip the system draws its buttons on. */
	headerColor: string;
	/** The buttons' glyphs. */
	symbolColor: string;
}

let base: WindowColors | null = null;
let following = false;

/** Hand the window the theme's colours, as they look under whatever scrims are up now. */
export function sendWindowColors(colors: WindowColors): void {
	base = colors;
	if (!following) {
		following = true;
		onScrimsChange(send);
	}
	send();
}

/**
 * The colours as they look under the scrims held now — what `sendWindowColors` sends.
 *
 * Under a light scrim, a dialog's, the buttons dim along with the page, as everything else in the
 * strip does. Under a heavy one — the image viewer's 72%, a video filling the window — the page is
 * as good as gone, and glyphs dimmed with it vanish (#2b2b2b on #444444); those buttons are still
 * how the window is closed, so on that dark field they are drawn the way a dark theme draws them.
 */
export function tintedWindowColors(colors: WindowColors, scrims: Scrim[] = heldScrims()): WindowColors {
	const under = (hex: string) => scrims.reduce((colour, scrim) => blend(colour, scrim), hex);
	const headerColor = under(colors.headerColor);
	const heavy = scrims.some((scrim) => scrim.alpha >= HEAVY);
	const symbolColor = heavy ? blend(headerColor, { color: "#ffffff", alpha: 0.6 }) : under(colors.symbolColor);
	return { color: colors.color, headerColor, symbolColor };
}

/** A scrim that leaves little of the page to see: past this the buttons stop dimming with it. */
const HEAVY = 0.5;

function send(): void {
	if (!base) return;
	try {
		bridge.setWindowTheme?.(tintedWindowColors(base));
	} catch {
		// No host to tell: a page without the preload. A scrim must not take a dialog down with it.
	}
}

/** `hex` with `scrim` laid over it. Anything that is not `#rrggbb` is passed through untouched. */
function blend(hex: string, scrim: Scrim): string {
	const from = rgb(hex);
	const over = rgb(scrim.color);
	if (!from || !over) return hex;
	const a = Math.max(0, Math.min(1, scrim.alpha));
	return `#${from.map((v, i) => Math.round(v + (over[i]! - v) * a).toString(16).padStart(2, "0")).join("")}`;
}

function rgb(hex: string): number[] | null {
	const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
	return match ? [0, 2, 4].map((i) => Number.parseInt(match[1]!.slice(i, i + 2), 16)) : null;
}
