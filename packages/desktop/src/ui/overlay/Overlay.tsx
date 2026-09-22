import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { dismissHoverLayers } from "./hover-layers.ts";
import { portal } from "./portal.ts";

export const OverlayDepth = createContext(0);
type Dismiss = (after?: () => void) => void;

/** One lifecycle for Escape, backdrop, cancel and completion, including nested dialogs. */
export function Overlay({ children, onClose, align = "center", width = 460, label, returnFocus }: {
	children: React.ReactNode | ((dismiss: Dismiss) => React.ReactNode);
	onClose: () => void;
	align?: "center" | "bottom";
	width?: number;
	label?: string;
	returnFocus?: HTMLElement;
}) {
	const depth = useContext(OverlayDepth) + 1;
	const id = useId();
	const card = useRef<HTMLDivElement>(null);
	const callback = useRef(onClose);
	callback.current = onClose;
	const dismissed = useRef(false);
	const completion = useRef<(() => void) | null>(null);
	const [leaving, setLeaving] = useState(false);
	const dismiss = useCallback<Dismiss>((after) => {
		if (dismissed.current) return;
		dismissed.current = true;
		completion.current = after ?? (() => callback.current());
		setLeaving(true);
	}, []);
	/*
	 * An answer already given is not withdrawn by an unmount.
	 *
	 * The completion runs on `animationend`, which is a frame that only arrives while this is still
	 * on screen — so anything that takes the dialog away mid-exit silently cancels what was just
	 * confirmed. That is not hypothetical: a confirmation raised from inside a menu is rendered by
	 * the menu, the menu closes itself 120ms after the press lands outside it, and the exit here
	 * runs for 130. Ten milliseconds decided whether 「确认切换」 changed the model, and the answer
	 * was no.
	 *
	 * Fixing the menu is worth doing on its own — see `data-ly-overlay` in `Popover` — but a promise
	 * that depends on nobody unmounting the promiser is the wrong shape regardless of who does it.
	 */
	useEffect(() => () => {
		const complete = completion.current;
		completion.current = null;
		complete?.();
	}, []);
	/*
	 * Clear what the pointer had summoned, once — see `hover-layers`.
	 *
	 * Only what is on screen at this moment, deliberately. The scrim covers the window, so nothing
	 * new can be provoked underneath it and a standing claim would buy nothing; what it would cost
	 * is this dialog's own tooltips, and dialogs here are full of them. What needs clearing is the
	 * tooltip or hover card that was already up: both are drawn above the scrim, and only a press
	 * takes them away. Opening a dialog from the keyboard is not a press, which is how a 248px card
	 * came to sit over a confirmation asking whether to delete the conversation it described.
	 */
	useLayoutEffect(() => dismissHoverLayers(), []);
	useLayoutEffect(() => {
		const previous = returnFocus ?? document.activeElement;
		const element = card.current;
		if (!element) return;
		const heading = element.querySelector('h1,h2,h3,[data-dialog-title]');
		if (heading && !label) { heading.id ||= `${id}-title`; element.setAttribute("aria-labelledby", heading.id); }
		if (!element.contains(document.activeElement)) {
			const target = element.querySelector<HTMLElement>('[autofocus],button,input,textarea,select,[tabindex="0"]');
			const bounds = element.getBoundingClientRect();
			const rect = target?.getBoundingClientRect();
			// Short dialogs open at their title, without scrolling straight to an offscreen action.
			(target && rect && rect.top >= bounds.top && rect.bottom <= bounds.bottom ? target : element).focus({ preventScroll: true });
		}
		const onKey = (event: KeyboardEvent) => {
			if (event.defaultPrevented || [...document.querySelectorAll('[data-ly-modal]')].at(-1) !== element) return;
			if (event.key === "Escape") { event.preventDefault(); dismiss(); }
			if (event.key !== "Tab") return;
			const targets = [...element.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),textarea:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter((el) => el.checkVisibility({ visibilityProperty: true }));
			if (!targets.length) { event.preventDefault(); element.focus(); return; }
			const first = targets[0], last = targets.at(-1);
			if (document.activeElement === element) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
			else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
			else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
		};
		window.addEventListener("keydown", onKey);
		return () => { window.removeEventListener("keydown", onKey); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
	}, [dismiss, id, label, returnFocus]);
	return portal(<OverlayDepth.Provider value={depth}>
		{/*
		 * On the scrim, not just the card: how deep this modal sits, for anything below deciding
		 * whether a press landed outside itself. A menu that raised this dialog must not read a
		 * click on it — or on the scrim it put over everything — as a click elsewhere. See the
		 * press-outside test in `Popover`.
		 */}
		<div data-ly-overlay={depth} className={`fixed inset-0 flex justify-center p-4 sm:p-8 ${align === "center" ? "items-center" : "items-end pb-[120px]"} ${leaving ? "ly-scrim-out" : "ly-scrim-in"}`}
			style={{ zIndex: 60 + depth * 20 }} onMouseDown={(event) => { if (event.target === event.currentTarget) dismiss(); }}>
			<div ref={card} data-ly-modal role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}
				style={{ width, maxWidth: "100%" }}
				className={`ly-dialog-surface flex max-h-[85dvh] min-h-0 flex-col overflow-hidden rounded-[22px] border border-line bg-float outline-none ${leaving ? "ly-dialog-out" : "ly-dialog-in"}`}
				onAnimationEnd={(event) => { if (event.target !== event.currentTarget || !leaving) return; const complete = completion.current; completion.current = null; complete?.(); }}>
				{typeof children === "function" ? children(dismiss) : children}
			</div>
		</div>
	</OverlayDepth.Provider>);
}
