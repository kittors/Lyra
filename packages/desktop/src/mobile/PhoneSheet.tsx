/**
 * A sheet that rises from the bottom edge — the phone's answer to a dialog in the middle of a window.
 *
 * On a phone the bottom of the screen is where the thumb already is, and a sheet anchored there can
 * be pulled back down the way it came. It reads its own height from its content, stops short of the
 * status bar, keeps its last line clear of the home indicator, and goes away three ways: the close
 * button, a tap on what it is covering, and a swipe down on its handle.
 *
 * `aria-modal`, so the back button on Android counts it as a layer (see the bridge's `layerDepth`)
 * and closes it with the Escape it dispatches.
 */

import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { translate } from "../i18n/translate.ts";
import { motionReduced } from "../ui/motion/reduced.ts";
import { portal } from "../ui/overlay/portal.ts";

/** Far enough down that it cannot be an accident; a flick counts from less. */
const PULL_CLOSE = 96;

export function PhoneSheet({
	title,
	onClose,
	children,
}: {
	title: string;
	onClose: () => void;
	children: React.ReactNode;
}) {
	const [leaving, setLeaving] = useState(false);
	const sheet = useRef<HTMLDivElement>(null);
	const pull = useRef<{ y: number; t: number; dy: number } | null>(null);

	const close = useCallback(() => {
		if (motionReduced()) onClose();
		else setLeaving(true);
	}, [onClose]);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.stopPropagation();
			close();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [close]);

	/*
	 * The handle follows the finger down, and only down: a sheet dragged upwards past its own height
	 * is a sheet coming loose. Released far enough or fast enough, it carries on out; otherwise it
	 * settles back where it was.
	 */
	const onTouchStart = (event: React.TouchEvent) => {
		pull.current = { y: event.touches[0].clientY, t: event.timeStamp, dy: 0 };
		sheet.current?.setAttribute("data-dragging", "");
	};
	const onTouchMove = (event: React.TouchEvent) => {
		const start = pull.current;
		if (!start || !sheet.current) return;
		start.dy = Math.max(0, event.touches[0].clientY - start.y);
		sheet.current.style.transform = start.dy ? `translateY(${start.dy}px)` : "";
	};
	const onTouchEnd = (event: React.TouchEvent) => {
		const start = pull.current;
		pull.current = null;
		const element = sheet.current;
		if (!start || !element) return;
		element.removeAttribute("data-dragging");
		const speed = start.dy / Math.max(1, event.timeStamp - start.t);
		if (start.dy > PULL_CLOSE || (start.dy > 24 && speed > 0.6)) {
			close();
			return;
		}
		element.style.transform = "";
	};

	return portal(
		<div
			data-ly-phone-sheet=""
			data-leaving={leaving || undefined}
			className="ly-phone-sheet-layer"
			onPointerDown={(event) => {
				if (event.target === event.currentTarget) close();
			}}
		>
			<div
				ref={sheet}
				role="dialog"
				aria-modal="true"
				aria-label={title}
				className="ly-phone-sheet"
				onAnimationEnd={(event) => {
					if (event.target === event.currentTarget && leaving) onClose();
				}}
			>
				<div className="ly-phone-sheet-head" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
					<span aria-hidden className="ly-phone-sheet-grabber" />
					<span className="ly-phone-sheet-title">{title}</span>
					<button type="button" aria-label={translate("common.close")} onClick={close} className="ly-phone-sheet-close">
						<X size={17} strokeWidth={2} aria-hidden />
					</button>
				</div>
				<div className="ly-phone-sheet-body">{children}</div>
			</div>
		</div>,
	);
}
