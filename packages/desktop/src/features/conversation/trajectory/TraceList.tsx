import { translate } from "../../../i18n/translate.ts";
import { onPhone } from "../../../services/index.ts";
import { ArrowDown, ChevronRight } from "lucide-react";
import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { entryKey, SOURCE_LABEL, STATUS_LABEL, type Entry } from "@lyra/core/trajectory-view";
import { SourceIcon } from "./SourceIcon.tsx";
import { Scroller } from "../../../ui/scroll/Scroller.tsx";
import { ScrollText } from "../../../ui/scroll/ScrollText.tsx";

import { overscanFor } from "../../../lib/overscan.ts";
type Row = { id: string; entry: Entry } | { id: string; turn: number; count: number };

export const TraceList = memo(function TraceList({ entries, selected, onSelect, resetKey, collapsed, onCollapse, target, focused: timeFocus, paused = false, onFollowing }: {
	entries: Entry[]; selected: string | null; onSelect: (entry: Entry) => void; resetKey: string;
	focused?: ReadonlySet<string> | null; paused?: boolean; onFollowing?: (following: boolean) => void;
	collapsed: Set<number>; onCollapse: (turn: number) => void; target: string | null;
}) {
	const height = onPhone() ? 44 : 36;
	const viewport = useRef<HTMLDivElement>(null);
	const follow = useRef(true);
	const [seen, setSeen] = useState(entries.length);
	useLayoutEffect(() => { if (paused) { follow.current = false; onFollowing?.(false); } }, [paused, onFollowing]);
	const previous = useRef(resetKey);
	const consumedTarget = useRef<string | null>(null);
	const [range, setRange] = useState({ start: 0, end: 40 });
	/** 上一次量到的滚动位置，用来知道这一帧滚了多快——见 `overscanFor`。 */
	const lastTop = useRef(0);
	const [focused, setFocused] = useState<string | null>(null);
	const rows = useMemo(() => {
		const result: Row[] = []; let last: number | undefined = -1;
		const counts = new Map<number, number>();
		for (const entry of entries) if (entry.turn !== undefined) counts.set(entry.turn, (counts.get(entry.turn) ?? 0) + 1);
		for (const entry of entries) {
			if (entry.turn !== undefined && entry.turn !== last) result.push({ id: `turn:${entry.turn}:${entryKey(entry)}`, turn: entry.turn, count: counts.get(entry.turn) ?? 0 });
			last = entry.turn;
			if (entry.turn === undefined || !collapsed.has(entry.turn)) result.push({ id: entryKey(entry), entry });
		}
		return result;
	}, [entries, collapsed]);
	useLayoutEffect(() => {
		const el = viewport.current; if (!el) return;
		if (previous.current !== resetKey) { previous.current = resetKey; follow.current = false; el.scrollTop = 0; setSeen(entries.length); }
		if (follow.current && !paused) { el.scrollTop = el.scrollHeight; setSeen(entries.length); }
		const measure = () => {
			if (!el.clientHeight) return;
			const pad = overscanFor(el.scrollTop - lastTop.current, Math.ceil(el.clientHeight / height), height);
			lastTop.current = el.scrollTop;
			setRange({ start: Math.max(0, Math.floor(el.scrollTop / height) - pad), end: Math.min(rows.length, Math.ceil((el.scrollTop + el.clientHeight) / height) + pad) });
		};
		measure(); const observer = new ResizeObserver(measure); observer.observe(el);
		el.addEventListener("scroll", measure, { passive: true });
		return () => { observer.disconnect(); el.removeEventListener("scroll", measure); };
	}, [rows, resetKey, height, paused, entries.length]);
	useLayoutEffect(() => {
		if (!target) { consumedTarget.current = null; return; }
		if (consumedTarget.current === target) return; const index = rows.findIndex(row => row.id === target), el = viewport.current;
		if (index >= 0 && el) { consumedTarget.current = target; follow.current = false; el.scrollTop = Math.max(0, index * height - el.clientHeight / 2); }
	}, [target, rows, height]);
	const indices = Array.from({ length: Math.max(0, range.end - range.start) }, (_, i) => range.start + i).filter(index => index < rows.length);
	const focusedIndex = rows.findIndex(row => row.id === focused);
	if (focusedIndex >= 0 && !indices.includes(focusedIndex)) indices.push(focusedIndex);
	return <div className="relative flex min-h-0 flex-1 flex-col"><Scroller scrollRef={viewport} className="min-h-0 flex-1" contentClassName="pl-2 pr-3" onScroll={el => { follow.current = !paused && el.scrollHeight - el.clientHeight - el.scrollTop < 4; onFollowing?.(follow.current); if (follow.current) setSeen(entries.length); }}>
		<div data-trace-list role="list" aria-label={translate("traceList.label")} className="relative" style={{ height: rows.length * height }}>
			{indices.map(index => {
				const row = rows[index];
				return <div key={row.id} role="listitem" aria-posinset={index + 1} aria-setsize={rows.length} className="absolute inset-x-0" style={{ top: index * height, height: height }}>
					{"entry" in row ? <button type="button" data-trace-entry={row.id} data-time-focus={timeFocus?.has(row.id) || undefined} aria-pressed={selected === row.id} onClick={() => onSelect(row.entry)} onKeyDown={event => {
							if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
							event.preventDefault();
							const candidates = event.key === "ArrowDown" ? rows.slice(index + 1) : rows.slice(0, index).reverse();
							const next = candidates.find(candidate => "entry" in candidate);
							if (!next) return;
							setFocused(next.id); follow.current = false; onFollowing?.(false);
							requestAnimationFrame(() => {
								const button = [...(viewport.current?.querySelectorAll<HTMLButtonElement>("[data-trace-entry]") ?? [])].find(element => element.dataset.traceEntry === next.id);
								button?.focus({ preventScroll: true }); button?.scrollIntoView({ block: "nearest" });
							});
						}} onFocus={() => setFocused(row.id)} onBlur={() => setFocused(null)}
						className={`ly-scroll flex h-full w-full items-center gap-2 rounded-md px-1.5 text-left text-caption ${selected === row.id ? "bg-card-hover text-ink" : timeFocus?.has(row.id) ? "bg-info/10 text-ink" : "text-ink-muted hover:bg-card-hover/50"}`} style={{ paddingLeft: row.entry.parentId ? 18 : undefined }}>
						<span className={`flex shrink-0 items-center ${row.entry.status === "running" ? "ly-pulse text-info" : row.entry.status === "error" ? "text-danger" : "text-ink-faint"}`} data-ly-tip={row.entry.status ? STATUS_LABEL[row.entry.status] : SOURCE_LABEL[row.entry.source]}><SourceIcon source={row.entry.source} /></span>
						<ScrollText text={row.entry.summary} className="min-w-0 flex-1" />
						<span className="shrink-0 text-ink-faint tabular-nums" data-ly-tip={translate("traceList.step", {
							step: row.entry.step ?? "—",
							duration: row.entry.durationMs === undefined ? translate("traceList.noDuration") : `${row.entry.durationMs} ms`,
						})}>{row.entry.durationMs === undefined ? `#${row.entry.seq}` : row.entry.durationMs < 1000 ? `${row.entry.durationMs}ms` : `${(row.entry.durationMs / 1000).toFixed(1)}s`}</span>
					</button> : <button type="button" aria-expanded={!collapsed.has(row.turn)} onClick={() => onCollapse(row.turn)} className="flex h-full w-full items-center gap-1.5 px-1.5 text-left text-caption text-ink-faint"><ChevronRight size={12} style={{ transform: collapsed.has(row.turn) ? undefined : "rotate(90deg)" }} /><span>{translate("traceList.turn", { n: row.turn })}</span><span className="ml-auto tabular-nums">{row.count}</span></button>}
				</div>;
			})}
		</div>
	</Scroller>
	{/* Floated over the ledger rather than stacked under it: as a flex sibling it was pinned flat
	    against the bottom edge with nothing under it, and every appearance shortened the scroller by
	    its own height — a jump in the rows at the moment new ones arrive. Same shape as the
	    transcript's `BackToLatest`, which does this job one panel over. */}
	{entries.length > seen && !paused && <div className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center">
		<button type="button" className="ly-composer ly-enter pointer-events-auto flex h-7 items-center gap-1.5 rounded-full border border-line-soft bg-float px-3 text-caption text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:text-ink" onClick={() => { follow.current = true; onFollowing?.(true); setSeen(entries.length); if (viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; }}>
			<span className="h-[6px] w-[6px] shrink-0 rounded-full bg-accent" /><ArrowDown size={12} strokeWidth={2} />{translate("traceList.newEntries", { n: entries.length - seen })}
		</button>
	</div>}
	</div>;
});
