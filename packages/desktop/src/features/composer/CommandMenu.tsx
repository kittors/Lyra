/**
 * The list that appears when a message starts with a slash.
 *
 * Above the field, because the field sits at the bottom of the window and a list under it would
 * open off-screen or shove the conversation upward as it grew.
 *
 * Names only, with the description in a bubble beside whichever row is current. Two earlier tries
 * were worse in opposite directions: putting the description on every row left three things per
 * line and nothing scannable, and putting it in one line at the foot of the panel meant a sentence
 * clipped to a width that could not carry it — "对 quantum 项目的当前改动、Haiku 输出或实现计划执行
 * Opus 审查门…" says less than nothing.
 *
 * The bubble follows the highlight rather than the pointer. That is the one thing an ordinary
 * tooltip could not do here: this list is driven by the arrow keys, and a tip that waits for a
 * hover is absent exactly when the description is being looked for.
 *
 * Presentational. Which commands, which one is current and what picking one does belong to the
 * composer, since they are the same state as the text being typed.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * One row.
 *
 * Flattened rather than carrying a `SlashCommand`, because two different things end up in the same
 * list — commands read off disk and the handful built into the app — and the list has no reason to
 * know which is which.
 */
export interface CommandEntry {
	name: string;
	description: string;
	argumentHint?: string;
	/** 内置 / 项目 / 个人 / Claude — shown in the bubble, not on the row. */
	origin: string;
}

/**
 * The matched run in the app's ink, everything else a step back.
 *
 * Emphasising the match rather than dimming the remainder, so a list filtered to one letter does
 * not become a wall of grey with one dark speck in it.
 */
function Highlighted({ text, term }: { text: string; term: string }) {
	const at = term ? text.toLowerCase().indexOf(term.toLowerCase()) : -1;
	if (at < 0) return <span className="text-ink">{text}</span>;
	return (
		<>
			<span className="text-ink-muted">{text.slice(0, at)}</span>
			<span className="font-semibold text-ink">{text.slice(at, at + term.length)}</span>
			<span className="text-ink-muted">{text.slice(at + term.length)}</span>
		</>
	);
}

export function CommandMenu({
	commands,
	term,
	active,
	onPick,
	onHover,
}: {
	commands: CommandEntry[];
	/** What has been typed after the slash, for highlighting. */
	term: string;
	active: number;
	onPick: (command: CommandEntry) => void;
	onHover: (index: number) => void;
}) {
	const panel = useRef<HTMLDivElement>(null);
	const list = useRef<HTMLDivElement>(null);
	/**
	 * Where the bubble sits, as an offset from the panel's own top.
	 *
	 * A number from the start, and never cleared. Gating the bubble on "has it been measured yet"
	 * meant it did not exist until a layout pass had run — so on the frame a filter narrowed the
	 * list, the description was simply gone.
	 */
	const [tipTop, setTipTop] = useState(0);

	/*
	 * Measured rather than derived from a row height.
	 *
	 * The rows are one line today and a wrapped argument hint would make one of them two, at which
	 * point index × height puts the bubble beside the wrong command. Asking the element where it is
	 * cannot drift.
	 */
	const place = useCallback(() => {
		const row = list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
		// Nothing to measure against yet: keep the last position rather than dropping the bubble.
		if (!row || !panel.current) return;
		const rowBox = row.getBoundingClientRect();
		const panelBox = panel.current.getBoundingClientRect();
		setTipTop(rowBox.top - panelBox.top);
	}, [active]);

	/*
	 * Scroll first, then measure, and both before the browser paints.
	 *
	 * `useLayoutEffect` because a bubble placed against the pre-scroll position and corrected a
	 * frame later is a visible jump on every arrow keypress.
	 */
	useLayoutEffect(() => {
		const row = list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
		// `nearest` so walking a long list scrolls by one row rather than recentring each time.
		row?.scrollIntoView({ block: "nearest" });
		place();
		// `commands` too: filtering moves the rows without moving the highlight's index.
	}, [active, commands, place]);

	// The panel's own size settles after fonts load; re-measure rather than trust the first pass.
	useEffect(() => {
		const observer = new ResizeObserver(place);
		if (panel.current) observer.observe(panel.current);
		return () => observer.disconnect();
	}, [place]);

	if (commands.length === 0) return null;
	const current = commands[Math.min(active, commands.length - 1)];

	return (
		/*
		 * The wrapper does not clip, so the bubble can sit outside the panel; the panel itself does,
		 * so the rows stay inside its corners.
		 */
		<div ref={panel} className="absolute bottom-full left-0 z-40 mb-2">
			<div className="ly-glass-solid min-w-[220px] max-w-[380px] overflow-hidden rounded-[12px] border border-line-soft">
				<div ref={list} onScroll={place} className="ly-scroll max-h-[min(320px,42vh)] overflow-y-auto p-1">
					{commands.map((command, index) => (
						<button
							key={`${command.origin}:${command.name}`}
							type="button"
							data-index={index}
							role="option"
							aria-selected={index === active}
							/*
							 * `onMouseDown` with the default prevented, not `onClick`.
							 *
							 * Clicking moves focus out of the textarea before the click lands, which closes
							 * the menu and loses the caret. Taking it on mousedown and refusing the focus
							 * change keeps the field focused throughout, so picking with the mouse leaves
							 * you where picking with Enter does.
							 */
							onMouseDown={(event) => {
								event.preventDefault();
								onPick(command);
							}}
							onMouseMove={() => onHover(index)}
							className={`flex w-full items-baseline gap-2 rounded-[7px] px-2.5 py-[5px] text-left font-mono text-label transition-colors duration-[var(--ly-t-quick)] ${
								index === active ? "bg-card-hover" : ""
							}`}
						>
							<span className="truncate">
								<Highlighted text={command.name} term={term} />
							</span>
							{command.argumentHint && (
								<span className="shrink-0 truncate text-detail text-ink-faint">{command.argumentHint}</span>
							)}
						</button>
					))}
				</div>
			</div>

			{/*
			 * The app's own tooltip surface, positioned by hand.
			 *
			 * `ly-tooltip` rather than another bordered card: a tip is a transient annotation, and at
			 * this size one more panel in the same palette reads as one more piece of UI to parse. It
			 * wraps, so a full sentence arrives whole instead of ending in an ellipsis.
			 */}
			{current.description && (
				<div
					className="ly-tooltip pointer-events-none absolute left-full ml-2 w-max"
					style={{ top: tipTop }}
					role="tooltip"
					data-ly-command-detail
				>
					{current.description}
					<span className="ml-1.5 opacity-60">{current.origin}</span>
				</div>
			)}
		</div>
	);
}
