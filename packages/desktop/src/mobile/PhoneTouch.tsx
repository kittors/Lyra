/**
 * Long press, on a phone: where a pointer's hover and right-click went.
 *
 * Mounted once, only on a phone. It watches the document rather than being threaded through every
 * row, the same way the drawer gesture does, and hands each long press to whatever already knows
 * what that thing can do:
 *
 * - A session or project row has a context menu. The press opens exactly that menu — the same
 *   items, the same confirmations — by giving the row the `contextmenu` a right-click would have.
 * - A message has no menu; its actions are the row that hovering reveals under it. The phone
 *   gathers those buttons into a menu (every action still goes through the real button), and adds
 *   the one thing a finger needs that a pointer does not: a way to select part of the text.
 *
 * Either way the pressed thing is lifted over a blurred page (`lift.ts`), the menu arranges itself
 * around it (`keep-clear.ts`), and the phone gives a tap you can feel (`haptics.ts`).
 */

import { TextSelect } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { translate } from "../i18n/translate.ts";
import { holdClear } from "../ui/overlay/keep-clear.ts";
import { MenuBody, MenuItem, MenuLabel, Popover } from "../ui/overlay/Popover.tsx";
import { lendClipboard } from "./clipboard.ts";
import { haptic } from "./haptics.ts";
import { lift, type Lifted } from "./lift.ts";
import { claimTouch, drift, hold, HOLD_MS, pressTarget, type Hold, type PressTarget } from "./long-press.ts";
import { PhoneSheet } from "./PhoneSheet.tsx";

interface Pressed {
	target: PressTarget;
	point: { x: number; y: number };
	lifted: Lifted;
}

/** How long after a long press a click is taken to be its echo rather than a new tap. */
const ECHO_MS = 450;

/**
 * Until when a click is the lifted finger's echo rather than a new tap.
 *
 * Armed when a finger that fired a long press lifts; disarmed by the next finger down, and by a menu
 * choice pressing the button it stands for — that click is the point, not an echo.
 */
let echoUntil = 0;

export function PhoneTouch() {
	const [message, setMessage] = useState<Pressed | null>(null);
	const [reading, setReading] = useState<HTMLElement | null>(null);

	// Every copy button in the app writes through this, and a phone page served over HTTP has none.
	useEffect(() => void lendClipboard(), []);

	useEffect(() => {
		let press: Hold | null = null;
		let target: PressTarget | null = null;
		let timer = 0;
		let watching = 0;

		const cancel = () => {
			window.clearTimeout(timer);
			press = null;
			target = null;
		};

		/*
		 * Put a row's lift down once its menu is gone.
		 *
		 * The menu belongs to the row's own component, which says nothing on the way out, so this
		 * watches for it: once one has appeared, the lift lasts exactly as long as some popover is
		 * still up and not on its way out. A menu swapping itself for its rename form is one
		 * popover replacing another in the same commit, so the watch never sees a gap there.
		 */
		const watch = (lifted: Lifted) => {
			const started = performance.now();
			let seen = false;
			const tick = () => {
				const alive = [...document.querySelectorAll("[data-ly-popover]")].some((el) => !el.classList.contains("ly-pop-out"));
				if (alive) seen = true;
				if ((seen && !alive) || (!seen && performance.now() - started > 700)) {
					watching = 0;
					holdClear(null);
					lifted.drop();
					return;
				}
				watching = requestAnimationFrame(tick);
			};
			watching = requestAnimationFrame(tick);
		};

		const fire = () => {
			const current = target;
			if (!press || !current || press.cancelled || !current.element.isConnected) return;
			press = { ...press, fired: true };
			claimTouch(true);
			haptic("medium");

			const point = { x: press.start.x, y: press.start.y };
			const lifted = lift(current.lift, current.kind, point);
			holdClear({ rect: lifted.rect, onPlace: (spot) => lifted.shift(spot.shift) });

			if (current.kind === "message") {
				setMessage({ target: current, point, lifted });
				return;
			}

			/*
			 * The row's own right-click, delivered by hand. Its handler prevents the default, which is
			 * how this knows there was someone to receive it; a row without a menu gets its lift put
			 * straight back down rather than hanging over a menu that never came.
			 */
			const origin = current.element.querySelector("button") ?? current.element;
			const request = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: point.x, clientY: point.y, button: 2 });
			origin.dispatchEvent(request);
			if (!request.defaultPrevented) {
				holdClear(null);
				lifted.drop();
				return;
			}
			watch(lifted);
		};

		const onStart = (event: TouchEvent) => {
			if (event.touches.length !== 1) {
				cancel();
				return;
			}
			const found = pressTarget(event.target instanceof Element ? event.target : null);
			if (!found) {
				cancel();
				return;
			}
			const touch = event.touches[0];
			claimTouch(false);
			echoUntil = 0;
			window.clearTimeout(timer);
			press = hold({ x: touch.clientX, y: touch.clientY, t: performance.now() });
			target = found;
			timer = window.setTimeout(fire, HOLD_MS);
		};

		const onMove = (event: TouchEvent) => {
			if (!press) return;
			// The menu is up under a finger that has not lifted yet: nothing under it should scroll.
			if (press.fired) {
				if (event.cancelable) event.preventDefault();
				return;
			}
			const touch = event.touches[0];
			if (!touch) return;
			press = drift(press, { x: touch.clientX, y: touch.clientY, t: performance.now() });
			if (press.cancelled) cancel();
		};

		const onEnd = (event: TouchEvent) => {
			// Lifting the finger ends the press; it is not also a tap on the row that was held.
			if (press?.fired) {
				if (event.cancelable) event.preventDefault();
				echoUntil = performance.now() + ECHO_MS;
			}
			cancel();
			claimTouch(false);
		};

		/*
		 * Android and Chromium raise a `contextmenu` of their own on a long press, a moment after
		 * this one fires. Left alone it would reopen the same menu at the finger instead of beside
		 * the row. Ours is synthetic and passes; the platform's is dropped while a press is live.
		 */
		const onContextMenu = (event: MouseEvent) => {
			if (!event.isTrusted) return;
			if (press || performance.now() < echoUntil) {
				event.preventDefault();
				event.stopImmediatePropagation();
			}
		};

		// The click a lifted finger can still produce on the row, if the touch end was not cancellable.
		const onClick = (event: MouseEvent) => {
			if (performance.now() >= echoUntil) return;
			if (event.target instanceof Element && event.target.closest("[data-ly-popover]")) return;
			echoUntil = 0;
			event.preventDefault();
			event.stopPropagation();
		};

		// No selection starting under a finger that is becoming a long press.
		const onSelectStart = (event: Event) => {
			if (press) event.preventDefault();
		};

		document.addEventListener("touchstart", onStart, { capture: true, passive: true });
		document.addEventListener("touchmove", onMove, { capture: true, passive: false });
		document.addEventListener("touchend", onEnd, { capture: true, passive: false });
		document.addEventListener("touchcancel", onEnd, { capture: true, passive: false });
		window.addEventListener("contextmenu", onContextMenu, true);
		document.addEventListener("click", onClick, true);
		document.addEventListener("selectstart", onSelectStart, true);
		return () => {
			cancel();
			cancelAnimationFrame(watching);
			holdClear(null);
			claimTouch(false);
			document.removeEventListener("touchstart", onStart, true);
			document.removeEventListener("touchmove", onMove, true);
			document.removeEventListener("touchend", onEnd, true);
			document.removeEventListener("touchcancel", onEnd, true);
			window.removeEventListener("contextmenu", onContextMenu, true);
			document.removeEventListener("click", onClick, true);
			document.removeEventListener("selectstart", onSelectStart, true);
		};
	}, []);

	const closeMessage = () => {
		holdClear(null);
		message?.lifted.drop();
		setMessage(null);
	};

	return (
		<>
			{message && (
				<MessageMenu
					pressed={message}
					onClose={closeMessage}
					onRead={(source) => {
						closeMessage();
						setReading(source);
					}}
				/>
			)}
			{reading && <ReadSheet source={reading} onClose={() => setReading(null)} />}
		</>
	);
}

/** The action row under a message — the one hovering reveals on a desktop. */
function actionRow(message: HTMLElement): HTMLElement | null {
	const own = [...message.children].find((child) => child.hasAttribute("data-ly-hover-reveal"));
	return (own as HTMLElement | undefined) ?? null;
}

/** What a button says it does: its tooltip, which is the short name, or else its accessible one. */
function labelOf(button: HTMLButtonElement): string {
	const name = button.getAttribute("aria-label") ?? "";
	if (button.disabled) return name;
	return button.getAttribute("data-ly-tip") || name;
}

function MessageMenu({
	pressed,
	onClose,
	onRead,
}: {
	pressed: Pressed;
	onClose: () => void;
	onRead: (source: HTMLElement) => void;
}) {
	const row = actionRow(pressed.target.element);
	const actions = row ? [...row.querySelectorAll<HTMLButtonElement>("button")] : [];
	// The time and the turn's figures, which lived in the same row and would otherwise be lost.
	const stamp = row
		? [...row.children]
				.filter((child) => child.tagName !== "BUTTON")
				.map((child) => child.textContent?.trim() ?? "")
				.filter(Boolean)
				.join(" · ")
		: "";

	/*
	 * The menu goes first, then the button is pressed: an action that asks a question — undoing a
	 * message that is not the last one — opens its dialog into a window with nothing else on top.
	 */
	const run = (action: () => void) => {
		onClose();
		requestAnimationFrame(() => {
			echoUntil = 0;
			action();
		});
	};

	return (
		<Popover anchor={pressed.point} onClose={onClose} width="compact" label={translate("phone.messageActions")}>
			<MenuBody>
				{stamp && <MenuLabel>{stamp}</MenuLabel>}
				{actions.map((button, index) => (
					<MenuItem
						key={index}
						icon={<Glyph from={button} />}
						disabled={button.disabled}
						onClick={() =>
							run(() => {
								button.click();
								if (button.querySelector(".lucide-copy")) haptic("light");
							})
						}
					>
						{labelOf(button)}
					</MenuItem>
				))}
				<MenuItem icon={<TextSelect size={13} strokeWidth={1.8} />} onClick={() => run(() => onRead(pressed.target.lift))}>
					{translate("phone.selectText")}
				</MenuItem>
			</MenuBody>
		</Popover>
	);
}

/** The button's own icon, redrawn in the menu — the menu is a list of those buttons, so it shows them. */
function Glyph({ from }: { from: HTMLElement }) {
	const ref = useRef<HTMLSpanElement>(null);
	useLayoutEffect(() => {
		const icon = from.querySelector("svg");
		const host = ref.current;
		if (!host) return;
		host.replaceChildren(...(icon ? [icon.cloneNode(true)] : []));
	}, [from]);
	return <span ref={ref} aria-hidden className="ly-phone-glyph flex items-center justify-center" />;
}

/**
 * The message again, in a sheet where text can be selected.
 *
 * The transcript itself is not selectable on a phone — a long press there opens the menu instead —
 * so this is the way to take a sentence rather than the whole reply: the same rendering, copied in,
 * with the system's own selection handles and copy button.
 */
function ReadSheet({ source, onClose }: { source: HTMLElement; onClose: () => void }) {
	const body = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const host = body.current;
		if (!host) return;
		const copy = source.cloneNode(true) as HTMLElement;
		copy.removeAttribute("id");
		for (const node of copy.querySelectorAll("[id]")) node.removeAttribute("id");
		copy.removeAttribute("inert");
		copy.classList.add("ly-read-copy");
		host.replaceChildren(copy);
	}, [source]);
	return (
		<PhoneSheet title={translate("phone.selectText")} onClose={onClose}>
			<div ref={body} data-ly-selectable className="ly-read" />
		</PhoneSheet>
	);
}
