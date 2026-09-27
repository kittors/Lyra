/**
 * Telling a long press apart from a tap and from a scroll, and deciding what it was pressed on.
 *
 * On a phone the long press is where a pointer's hover and right-click both went. Session rows,
 * project rows and messages hide their actions until the pointer is over them; a finger never is,
 * so those actions come back as a menu on a held finger — the way every list on the phone already
 * works, and the way the reference apps do it.
 *
 * The decisions are pure so they can be argued with in a test. The hard part is the same as the
 * drawer's (`drawer-gesture.ts`): a finger that lands on a row is, for its first few hundred
 * milliseconds, a tap, a scroll and a long press all at once, and each wrong verdict is felt — a
 * scroll that pops a menu, or a hold that opens the conversation instead.
 */

/** A touch, at a moment. `t` is `event.timeStamp` or `performance.now()` — only differences matter. */
export interface Point {
	x: number;
	y: number;
	t: number;
}

/**
 * How long a still finger has to rest before it is a long press.
 *
 * iOS opens its own context menus at about half a second. A little under that feels like the app
 * noticed rather than like it waited, and is still well past any tap — taps land and lift in about
 * a tenth of that.
 */
export const HOLD_MS = 420;

/**
 * How far a held finger may wander and still be holding.
 *
 * A thumb resting on glass is never perfectly still, and what it drifts by is a few points. Past this
 * it is going somewhere — a scroll, a drag of the drawer — and the press is over.
 */
export const SLOP = 10;

export interface Hold {
	start: Point;
	/** The finger moved too far, lifted too soon, or a second one arrived. */
	cancelled: boolean;
	/** The press has already become a long press; the rest of the touch belongs to its menu. */
	fired: boolean;
}

let claimed = false;

/**
 * Whether a long press has taken the finger that is down right now.
 *
 * Once a menu is open on a held finger, the finger drifting sideways is not a drawer drag and its
 * drifting downwards is not a scroll. `useDrawerGesture` asks this before it starts following.
 */
export function touchClaimed(): boolean {
	return claimed;
}

export function claimTouch(value: boolean): void {
	claimed = value;
}

export function hold(start: Point): Hold {
	return { start, cancelled: false, fired: false };
}

/** Fold in a movement. Once the finger has gone past the slop the press cannot come back. */
export function drift(press: Hold, point: Point): Hold {
	if (press.cancelled || press.fired) return press;
	const dx = point.x - press.start.x;
	const dy = point.y - press.start.y;
	return dx * dx + dy * dy > SLOP * SLOP ? { ...press, cancelled: true } : press;
}

/** Whether, at `now`, the finger has been down and still for long enough. */
export function ripe(press: Hold, now: number): boolean {
	return !press.cancelled && !press.fired && now - press.start.t >= HOLD_MS;
}

/**
 * What a press landed on, and what should be lifted to show it.
 *
 * `row` is a session or project in the sidebar: those already have a context menu, and the long
 * press opens exactly that one. `message` is one entry in a transcript, whose actions live in the
 * row that hovering reveals underneath it; the phone gathers them into a menu of its own.
 */
export type PressTarget =
	| { kind: "row"; element: HTMLElement; lift: HTMLElement }
	| { kind: "message"; element: HTMLElement; lift: HTMLElement };

/**
 * Anything a finger holds for its own reasons: text to be selected and edited, a surface already
 * floating above the page, or something that asks to be left alone.
 */
const EXEMPT =
	"input, textarea, select, [contenteditable], .cm-editor, [data-ly-popover], [data-ly-overlay], [data-ly-modal], [data-ly-lift], [data-ly-no-press]";

/** Rows that carry a context menu: a conversation, and a project heading. */
const ROW = "[data-ly-hover-row][data-ly-row], [data-ly-hover-row][data-ly-project]";

/** A message, of any of the transcripts that share the same shape — the main one, a side chat, a sub-agent. */
const MESSAGE = ".group\\/msg";

export function pressTarget(from: Element | null): PressTarget | null {
	if (!from || from.closest(EXEMPT)) return null;

	const row = from.closest<HTMLElement>(ROW);
	if (row) return { kind: "row", element: row, lift: row };

	const message = from.closest<HTMLElement>(MESSAGE);
	if (message) {
		/*
		 * The bubble when there is one — a sent message is the bubble, and the row of actions below
		 * it is chrome. A reply has no bubble; its first child is the text and the work, without the
		 * action row that is its last child.
		 */
		const bubble = message.querySelector<HTMLElement>(".ly-user-bubble");
		const lift = bubble ?? (message.firstElementChild instanceof HTMLElement ? message.firstElementChild : message);
		return { kind: "message", element: message, lift };
	}
	return null;
}
