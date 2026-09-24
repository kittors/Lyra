import { MessageSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { subscribeSessionDrag, type SessionDragLive } from "./session-drag.ts";

/**
 * The chip that follows the pointer while a conversation is carried — from either list.
 *
 * The project list used to draw its own pill for reorder and suppress this one, which left every
 * conversation that list does not reorder — the pinned ones, the ones outside a project — carried
 * with nothing in the hand at all. One chip, owned by the carry itself, for every conversation; the
 * project list's pill is for projects only.
 */
export function SessionCarryGhost() {
	const [live, setLive] = useState<SessionDragLive | null>(null);
	useEffect(() => subscribeSessionDrag(setLive), []);
	if (!live) return null;
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
