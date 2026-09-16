import { useEffect, useRef, useState } from "react";

/** How long a pointer must sit on a step before the mark becomes the action. */
export const STEP_HOVER_MS = 1000;

export function useDelayedOffer(enabled: boolean, ms = STEP_HOVER_MS) {
	const [show, setShow] = useState(false);
	const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const clear = () => {
		if (timer.current) clearTimeout(timer.current);
		timer.current = null;
	};
	useEffect(() => () => clear(), []);
	useEffect(() => {
		if (enabled) return;
		clear();
		setShow(false);
	}, [enabled]);
	return {
		show: enabled && show,
		enter: () => {
			if (!enabled) return;
			clear();
			timer.current = setTimeout(() => setShow(true), ms);
		},
		leave: () => {
			clear();
			setShow(false);
		},
	};
}
