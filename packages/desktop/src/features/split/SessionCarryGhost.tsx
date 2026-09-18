import { MessageSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { subscribeSessionDrag, type SessionDragLive } from "./session-drag.ts";

/**
 * The chip that follows the pointer when a conversation is carried from 「聊天」.
 *
 * The project list already draws its own pill for reorder. This one is only for a carry that
 * did not start there — otherwise two ghosts sit on top of each other.
 */
export function SessionCarryGhost({ suppressed }: { suppressed: boolean }) {
	const [live, setLive] = useState<SessionDragLive | null>(null);
	useEffect(() => subscribeSessionDrag(setLive), []);
	if (suppressed || !live) return null;
	return createPortal(
		<div
			data-ly-split-ghost
			style={{ left: live.x + 12, top: live.y + 12 }}
			className="ly-glass-solid pointer-events-none fixed z-[100] flex max-w-[200px] items-center gap-2 rounded-lg border border-line-soft px-2.5 py-1.5 shadow-lg shadow-black/20 backdrop-blur-md select-none"
		>
			<MessageSquare size={14} strokeWidth={1.8} className="shrink-0 text-accent" />
			<span className="truncate text-detail font-medium text-ink">{live.title}</span>
		</div>,
		document.body,
	);
}
