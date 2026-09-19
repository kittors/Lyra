import { useEffect, useRef, useState, type RefObject } from "react";
import { bridge } from "../../services/index.ts";
import { overflowPanels, type Span } from "./place.ts";
import { popOutPanel } from "./popout.ts";
import type { Floor } from "./layout.ts";
import type { DockNode, PaneKind } from "./tree.ts";

/** Recheck restored layouts and real resizes, not just the menu's original insertion. */
export function useOverflowWindows({ tree, size, floor, dock, scope, sessionId, paused, container, onFailure }: {
	tree: DockNode;
	size: Span | null;
	floor: (kind: PaneKind) => Floor;
	dock: "window" | "pane";
	scope: string;
	sessionId: string | null;
	paused: boolean;
	container: RefObject<HTMLElement | null>;
	onFailure(error: unknown): void;
}): void {
	const kind = size ? overflowPanels(tree, size, floor)[0] : undefined;
	const attempt = useRef("");
	const busy = useRef(false);
	const [completed, setCompleted] = useState(0);
	const failure = useRef(onFailure);
	failure.current = onFailure;
	const signature = JSON.stringify([scope, size, tree]);
	useEffect(() => {
		if (paused || !kind || !bridge.windows?.openPanel || busy.current || attempt.current === signature) return;
		let cancelled = false;
		// Ownership transfers use flushSync; let the current React commit finish first.
		const transfer = () => {
			const element = container.current;
			// Entrance opacity does not suspend a layout; an inert retained pane does.
			if (cancelled || attempt.current === signature || !element || element.closest("[inert]") || !element.checkVisibility({ visibilityProperty: true })) return;
			attempt.current = signature;
			busy.current = true;
			void popOutPanel({ dock, scope, kind, sessionId }).catch((error: unknown) => failure.current(error)).finally(() => {
				busy.current = false;
				setCompleted(value => value + 1);
			});
		};
		queueMicrotask(transfer);
		const activation = new MutationObserver(transfer);
		for (let element = container.current?.parentElement; element; element = element.parentElement) {
			activation.observe(element, { attributes: true, attributeFilter: ["inert"] });
		}
		return () => { cancelled = true; activation.disconnect(); };
	}, [paused, kind, signature, dock, scope, sessionId, container, completed]);
}
