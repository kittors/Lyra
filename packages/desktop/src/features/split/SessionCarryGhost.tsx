import { MessageSquare } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { carryChipAt } from "./carry-chip.ts";
import { subscribeSessionDrag, type SessionDragLive } from "./session-drag.ts";

/** Until the chip has been measured: its widest (max-w-[200px]) and its one-line height. */
const ESTIMATE = { width: 200, height: 34 };

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
	const chip = useRef<HTMLDivElement>(null);
	const [size, setSize] = useState(ESTIMATE);
	useEffect(() => subscribeSessionDrag(setLive), []);
	// Once per carried conversation: its title, and so the chip's width, does not change mid-carry.
	const carried = live?.id ?? null;
	useLayoutEffect(() => {
		const box = chip.current?.getBoundingClientRect();
		if (!box) return;
		setSize((was) => (was.width === box.width && was.height === box.height ? was : { width: box.width, height: box.height }));
	}, [carried]);
	if (!live) return null;
	// Flipped to the pointer's other side near the right or bottom edge; see `carry-chip.ts`.
	const at = carryChipAt(live, size, { width: window.innerWidth, height: window.innerHeight });
	return createPortal(
		<div
			ref={chip}
			data-ly-split-ghost
			style={{ left: at.left, top: at.top }}
			className="ly-glass-solid pointer-events-none fixed z-[100] flex max-w-[200px] items-center gap-2 rounded-lg border border-line-soft px-2.5 py-1.5 shadow-lg shadow-black/20 backdrop-blur-md select-none"
		>
			<MessageSquare size={14} strokeWidth={1.8} className="shrink-0 text-accent" />
			<span className="truncate text-detail font-medium text-ink">{live.title}</span>
		</div>,
		document.body,
	);
}
