import { useRef, useState, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { translate } from "../../i18n/translate.ts";
import { shortcutLabel } from "../../ui/keyboard.ts";
import { GRIP_REACH, GRIP_TOP, GRIP_WIDTH } from "./geometry.ts";
import type { DropSide, PaneKind } from "./tree.ts";

const ARROWS: Record<string, DropSide> = {
	ArrowLeft: "left", ArrowRight: "right", ArrowUp: "top", ArrowDown: "bottom",
};

/** The same gesture belongs to tool panes and to the conversation's custom title bar. */
export function PaneGrip({ kind, label, carried, onDragStart, onMove, onArrowMove }: {
	kind: PaneKind;
	label: string;
	carried: boolean;
	onDragStart(event: PointerEvent<HTMLElement>): void;
	onMove(side: DropSide): void;
	onArrowMove(side: DropSide): boolean;
}) {
	const grip = useRef<HTMLButtonElement>(null);
	const [preview, setPreview] = useState<DropSide | null>(null);
	const dock = grip.current?.closest("[data-ly-pane-dock], [data-dock-panes]");
	return <><button
		ref={grip}
		type="button"
		data-dock-grip={kind}
		data-dock-heading
		aria-label={shortcutLabel(translate("pane.moveHint", { label }))}
		data-ly-tip={translate("common.move")}
		onPointerDown={(event) => { setPreview(null); onDragStart(event); }}
		onBlur={() => setPreview(null)}
		onKeyDown={(event) => {
			const side = ARROWS[event.key];
			if (!side && (!preview || !["Enter", " ", "Escape"].includes(event.key))) return;
			event.preventDefault();
			event.stopPropagation();
			if (side && !event.altKey) setPreview(onArrowMove(side) ? null : side);
			else {
				if (side) onMove(side);
				else if (preview && event.key !== "Escape") onMove(preview);
				setPreview(null);
			}
		}}
		className={`ly-dock-grip no-drag absolute top-0 left-1/2 flex -translate-x-1/2 touch-none justify-center ${carried ? "cursor-grabbing" : "cursor-grab"}`}
		style={{ height: GRIP_REACH, width: GRIP_WIDTH, paddingTop: GRIP_TOP }}
	>
		<span aria-hidden className="h-[3px] w-9 rounded-full bg-ink-faint" />
	</button>
		{preview && dock && createPortal(<div data-dock-keyboard-drop={preview} className="ly-dock-keyboard-drop pointer-events-none absolute inset-2 z-30" aria-live="polite">
			<span className="absolute left-1/2 top-2 -translate-x-1/2 whitespace-nowrap rounded-md border border-line bg-shell px-2 py-1 text-detail text-ink shadow-md">
				{translate(`pane.move.${preview}`)} <kbd className="ml-2 text-ink-muted">Enter</kbd>
			</span>
		</div>, dock)}
	</>;
}
