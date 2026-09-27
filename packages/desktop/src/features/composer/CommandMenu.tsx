import { Box, Eraser, FoldVertical, Settings2, SquareTerminal } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import type { CommandEntry } from "./command-catalog.ts";
import { useI18n, type MessageKey } from "../../i18n/index.ts";

const GROUPS: Record<CommandEntry["kind"], MessageKey> = {
	builtin: "command.builtin",
	command: "command.custom",
	skill: "command.skills",
};

/** One anchored list: names, descriptions and origins share a stable centre line. */
export function CommandMenu({ commands, active, keyboardSelection, onPick, onHover, id, term }: {
	commands: CommandEntry[];
	term: string;
	active: number;
	keyboardSelection: boolean;
	onPick: (command: CommandEntry) => void;
	onHover: (index: number) => void;
	id: string;
}) {
	const { t } = useI18n();
	const panel = useRef<HTMLDivElement>(null);
	const list = useRef<HTMLDivElement>(null);
	const pointer = useRef<{ x: number; y: number } | null>(null);
	const previous = useRef<{ commands: CommandEntry[]; term: string; active: number }>({ commands: [], term, active });
	const [height, setHeight] = useState(340);
	const open = commands.length > 0;
	const shown = open ? commands : previous.current.commands;
	const shownTerm = open ? term : previous.current.term;
	const shownActive = open ? active : previous.current.active;
	useLayoutEffect(() => { if (open) previous.current = { commands, term, active }; }, [commands, term, active, open]);
	useLayoutEffect(() => {
		const anchor = panel.current?.parentElement;
		if (!anchor) return;
		const measure = () => setHeight(Math.max(0, Math.min(340, anchor.getBoundingClientRect().top - 12)));
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(anchor);
		window.addEventListener("resize", measure);
		return () => { observer.disconnect(); window.removeEventListener("resize", measure); };
	}, [open]);
	useLayoutEffect(() => {
		if (!open || !keyboardSelection) return;
		const viewport = list.current;
		const row = viewport?.querySelector<HTMLElement>(`[data-index="${active}"]`);
		if (!viewport || !row) return;
		// Scroll only this list, never the transcript behind its absolutely positioned popup.
		const box = row.getBoundingClientRect();
		const view = viewport.getBoundingClientRect();
		if (box.top < view.top + 36) viewport.scrollTop -= view.top + 36 - box.top;
		else if (box.bottom > view.bottom - 48) viewport.scrollTop += box.bottom - view.bottom + 48;
	}, [active, commands, open, keyboardSelection]);
	return <div ref={panel} id={id} role={open ? "listbox" : undefined} aria-label={t("command.slash")} aria-hidden={!open} inert={!open}
		data-open={open} className="ly-command-menu ly-glass-solid absolute bottom-full left-0 right-0 z-40 mb-2 overflow-hidden rounded-[18px] border border-line-soft">
		<div style={{ maxHeight: height }} className="flex flex-col">
			<Scroller scrollRef={list} className="ly-menu-scroll min-h-0" contentClassName="p-1.5">
				{shown.map((command, index) => {
					const Icon = command.kind === "skill" ? Box : command.action === "compact" ? FoldVertical : command.action === "clear" ? Eraser : command.action === "manage-commands" ? Settings2 : SquareTerminal;
					return <div key={`${command.kind}:${command.name}`}>
						{!shownTerm && command.kind !== shown[index - 1]?.kind && <div className="px-3 pb-1 pt-2 text-detail text-ink-faint">{t(GROUPS[command.kind])}</div>}
						<button id={`${id}-${index}`} type="button" role={open ? "option" : undefined} tabIndex={-1}
							aria-label={[command.name, command.description, command.origin].filter(Boolean).join(t("common.comma"))} aria-selected={index === shownActive}
							data-index={index} data-command-kind={command.kind}
							onMouseDown={(event) => event.preventDefault()} onClick={() => onPick(command)} onMouseMove={(event) => {
								// Scrolling can move a new row under a stationary pointer without a new selection intent.
								if (pointer.current?.x === event.clientX && pointer.current.y === event.clientY) return;
								pointer.current = { x: event.clientX, y: event.clientY };
								onHover(index);
							}}
							className={`ly-scroll ly-command-option flex h-9 w-full items-center gap-2 rounded-[12px] px-3 text-left text-label transition-colors duration-[var(--ly-t-quick)] ${index === shownActive ? "bg-card-hover" : ""}`}>
							<Icon size={16} strokeWidth={1.8} className="shrink-0 text-ink-muted" />
							<ScrollText text={command.name} className="min-w-0 max-w-[42%] shrink-0 text-ink" />
							<ScrollText text={command.description} className="min-w-0 flex-1 text-ink-muted" />
							<ScrollText text={command.origin} className="ml-auto min-w-0 max-w-[20%] shrink-0 text-detail text-ink-faint" />
						</button>
					</div>;
				})}
			</Scroller>
		</div>
	</div>;
}
