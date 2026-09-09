import type { MessageKey } from "../../i18n/messages/index.ts";
import { translate } from "../../i18n/translate.ts";
import { Minimize2, Bot, FileCode, FolderArchive, MessageSquare, Paperclip, Puzzle } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import type { MentionItem, MentionKind } from "./mention-catalog.ts";

/** Section headings, as keys — this table is built at import time. */
const GROUPS: Record<MentionKind, MessageKey> = {
	action: "mention.actions",
	file: "mention.filesAndFolders",
	subagent: "mention.agents",
	plugin: "mention.pluginsAndSkills",
	session: "mention.sessions",
};

export function MentionMenu({
	items,
	term,
	active,
	keyboardSelection,
	onPick,
	onHover,
	id,
}: {
	items: MentionItem[];
	term: string;
	active: number;
	keyboardSelection: boolean;
	onPick: (item: MentionItem) => void;
	onHover: (index: number) => void;
	id: string;
}) {
	const pointer = useRef<{ x: number; y: number } | null>(null);
	const panel = useRef<HTMLDivElement>(null);
	const list = useRef<HTMLDivElement>(null);
	const previous = useRef<{ items: MentionItem[]; term: string; active: number }>({
		items: [],
		term,
		active,
	});
	const [height, setHeight] = useState(340);
	const open = items.length > 0;
	const shown = open ? items : previous.current.items;
	const shownTerm = open ? term : previous.current.term;
	const shownActive = open ? active : previous.current.active;

	useLayoutEffect(() => {
		if (open) previous.current = { items, term, active };
	}, [items, term, active, open]);

	useLayoutEffect(() => {
		const anchor = panel.current?.parentElement;
		if (!anchor) return;
		const measure = () => setHeight(Math.max(0, Math.min(340, anchor.getBoundingClientRect().top - 12)));
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(anchor);
		window.addEventListener("resize", measure);
		return () => {
			observer.disconnect();
			window.removeEventListener("resize", measure);
		};
	}, [open]);

	useLayoutEffect(() => {
		if (!open || !keyboardSelection) return;
		const viewport = list.current;
		const row = viewport?.querySelector<HTMLElement>(`[data-index="${active}"]`);
		if (!viewport || !row) return;
		const box = row.getBoundingClientRect();
		const view = viewport.getBoundingClientRect();
		if (box.top < view.top + 36) viewport.scrollTop -= view.top + 36 - box.top;
		else if (box.bottom > view.bottom - 48) viewport.scrollTop += box.bottom - view.bottom + 48;
	}, [active, items, open, keyboardSelection]);

	return (
		<div
			ref={panel}
			id={id}
			role={open ? "listbox" : undefined}
			aria-label={translate("mention.menu")}
			aria-hidden={!open}
			inert={!open}
			data-open={open}
			className="ly-mention-menu ly-glass-solid absolute bottom-full left-0 right-0 z-40 mb-2 overflow-hidden rounded-[18px] border border-line-soft"
		>
			<div style={{ maxHeight: height }} className="flex flex-col">
				<Scroller scrollRef={list} className="ly-menu-scroll min-h-0" contentClassName="p-1.5">
					{shown.map((item, index) => {
						const Icon =
							item.id === "action:compact" ? Minimize2 : item.kind === "action"
								? Paperclip
								: item.kind === "subagent"
									? Bot
									: item.kind === "plugin"
										? Puzzle
										: item.kind === "session"
											? MessageSquare
											: item.title.endsWith("/")
												? FolderArchive
												: FileCode;

						const isFirstOfGroup = !shownTerm && item.kind !== shown[index - 1]?.kind;

						return (
							<div key={item.id}>
								{isFirstOfGroup && (
									<div className="px-3 pb-1 pt-2 text-detail text-ink-faint">
										{translate(GROUPS[item.kind])}
									</div>
								)}
								<button
									id={`${id}-${index}`}
									type="button"
									role={open ? "option" : undefined}
									tabIndex={-1}
									aria-label={`${item.title}，${item.description ?? ""}，${item.origin ?? ""}`}
									aria-selected={index === shownActive}
									data-index={index}
									data-mention-kind={item.kind}
									/* Which one this is, apart from the label. The label is three translated
									   pieces joined by a comma, so anything matching on it moves with the
									   language; the title is the agent's own name and does not. */
									data-mention-title={item.title}
									onMouseDown={(event) => event.preventDefault()}
									onClick={() => onPick(item)}
									onMouseMove={(event) => {
										if (pointer.current?.x === event.clientX && pointer.current.y === event.clientY) return;
										pointer.current = { x: event.clientX, y: event.clientY };
										onHover(index);
									}}
									className={`ly-scroll ly-mention-option flex h-9 w-full items-center gap-2 rounded-[12px] px-3 text-left text-label transition-colors duration-[var(--ly-t-quick)] ${
										index === shownActive ? "bg-card-hover" : ""
									}`}
								>
									<Icon size={16} strokeWidth={1.8} className="shrink-0 text-ink-muted" />
									<ScrollText text={item.title} className="min-w-0 max-w-[42%] shrink-0 text-ink" />
									{item.description && (
										<ScrollText text={item.description} className="min-w-0 flex-1 text-ink-muted" />
									)}
									{item.origin && (
										<ScrollText
											text={item.origin}
											className="ml-auto min-w-0 max-w-[20%] shrink-0 text-detail text-ink-faint"
										/>
									)}
								</button>
							</div>
						);
					})}
				</Scroller>
			</div>
		</div>
	);
}
