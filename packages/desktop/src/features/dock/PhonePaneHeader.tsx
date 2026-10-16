/**
 * A panel's title bar on a phone: the way back, what this is, and what the panel offers.
 *
 * On a phone a panel is a page pushed over the conversation rather than a pane beside it, so its bar
 * is a page's — a back arrow where the desktop has ✕, the name in the middle — and none of what a
 * window pane carries: there is no window to pop out into, nothing to maximise from, and nowhere to
 * drag it to. Those three were drawn here anyway until this existed, as 20px marks a thumb could not
 * hit, and the pop-out one did nothing at all on a phone.
 *
 * Back closes the panel. Kept open behind the conversation it would come back exactly as it was —
 * which is what the conversation's sheet offers by listing it again, so there is nothing to keep.
 * In the tabs layout a panel has no close of its own (its tab does); there it hands the screen back
 * to the conversation and stays where it is.
 */

import { ChevronLeft, X } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";
import { useLayout } from "../../app/layout.tsx";
import { useDockScope } from "../../app/session-scope.tsx";
import { translate } from "../../i18n/translate.ts";
import { useEdgeBack } from "../../mobile/edge-back.ts";
import { usePaneDock } from "./pane-store.ts";
import type { PaneKind } from "./tree.ts";

/**
 * On a tablet the layout is not compact and a panel sits beside the conversation rather than over
 * it — not a page, so not a way back: there it keeps a close, at a thumb's size, and nothing else of
 * a window pane's.
 */
export function PhonePaneHeader({
	kind,
	label,
	icon,
	title,
	actions,
	onClose,
}: {
	kind: PaneKind;
	label: string;
	icon?: React.ReactNode;
	title?: React.ReactNode;
	actions?: React.ReactNode;
	onClose?: () => void;
}) {
	const scope = useDockScope();
	const { compact } = useLayout();
	// A page only in the compact layout, where one pane is the screen; and only the one in front.
	const front = usePaneDock((state) => (scope ? state.focused[scope] === kind : false)) && compact;
	const back = useCallback(() => {
		if (onClose) onClose();
		else if (scope) usePaneDock.getState().focus(scope, "conversation");
	}, [onClose, scope]);

	/*
	 * Escape is back — which is also Android's back button, dispatched by the shell as an Escape.
	 * Listened for on the way up, so a sheet open over the page closes first and keeps it.
	 */
	// And a thumb from the left edge, the page following it (`edge-back.ts`).
	const bar = useRef<HTMLDivElement>(null);
	useEdgeBack({
		page: () => bar.current?.closest<HTMLElement>(".ly-dock-pane") ?? null,
		under: () => bar.current?.closest("[data-dock-panes]")?.querySelector<HTMLElement>(':scope > .ly-dock-pane[data-pane="conversation"]') ?? null,
		active: front,
		onBack: back,
	});

	useEffect(() => {
		if (!front) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			// The drawer pulled over this page is the top layer, and the app's own Escape closes it.
			if (document.querySelector('[data-pane="drawer"]:not([inert])')) return;
			event.preventDefault();
			back();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [front, back]);
	if (!compact) {
		return (
			<div data-dock-header={kind} className="ly-phone-bar ly-phone-bar-beside">
				<div data-dock-heading className="ly-phone-bar-heading">
					{title ?? (
						<>
							{icon && <span className="ly-phone-bar-mark">{icon}</span>}
							<span className="ly-phone-bar-label">{label}</span>
						</>
					)}
				</div>
				<div data-dock-actions className="ly-phone-bar-side ly-phone-bar-end">
					{actions}
					{onClose && (
						<button type="button" aria-label={translate("pane.closeOne", { label })} onClick={onClose} className="ly-phone-bar-icon ly-press">
							<X size={18} strokeWidth={2} aria-hidden />
						</button>
					)}
				</div>
			</div>
		);
	}

	return (
		<div
			ref={bar}
			data-dock-header={kind}
			/*
			 * A layer, for Android's back button: the shell counts `aria-modal` elements and closes the top
			 * one with an Escape (see the bridge's `layerDepth`). On the bar rather than the pane, which
			 * the count skips — it passes over anything with `data-pane`, which is how it avoids counting
			 * the drawer twice, and every pane carries one. Only while the page is in front.
			 */
			aria-modal={front || undefined}
			className="ly-phone-bar"
		>
			<div className="ly-phone-bar-side">
				<button type="button" aria-label={translate("common.back")} onClick={back} className="ly-phone-bar-icon ly-press">
					<ChevronLeft size={24} strokeWidth={1.9} aria-hidden />
				</button>
			</div>
			<div data-dock-heading className="ly-phone-bar-heading">
				{title ?? (
					<>
						{icon && <span className="ly-phone-bar-mark">{icon}</span>}
						<span className="ly-phone-bar-label">{label}</span>
					</>
				)}
			</div>
			<div data-dock-actions className="ly-phone-bar-side ly-phone-bar-end">
				{actions}
			</div>
		</div>
	);
}
