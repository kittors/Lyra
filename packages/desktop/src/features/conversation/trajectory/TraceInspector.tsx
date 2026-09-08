import { translate } from "../../../i18n/translate.ts";
import { useEffect, useRef, useState } from "react";
import { SourceIcon } from "./SourceIcon.tsx";
import { available } from "../../../services/index.ts";
import { ArrowUpRight, ArrowLeft, ChevronLeft, ChevronRight, Ellipsis, FileText, GitBranch, ScrollText as OutputIcon } from "lucide-react";
import { openViewer } from "../../image/index.ts";
import { SOURCE_LABEL, STATUS_LABEL, entryKey, type Entry } from "@lyra/core/trajectory-view";
import { IconButton } from "../../../ui/primitives/IconButton.tsx";
import { ScrollText } from "../../../ui/scroll/ScrollText.tsx";
import { Popover, MenuBody, MenuItem, usePopover, type Anchor } from "../../../ui/overlay/Popover.tsx";
import { TraceText } from "../detail/TraceText.tsx";
import { useI18n } from "../../../i18n/index.ts";

export function TraceInspector({ anchor, entry, all, query, onSelect, onClose, onExport, onOutput, onFork, previous, next }: {
	anchor: Anchor; previous?: () => void; next?: () => void;
	entry: Entry; all: Entry[]; query: string; onSelect: (entry: Entry) => void; onClose: () => void; onExport: () => void; onOutput: () => void; onFork: () => void;
}) {
	const { t } = useI18n();
	const [tab, setTab] = useState<"content" | "info" | "raw">("content");
	const menu = usePopover();
	const [width, setWidth] = useState(380);
	const resize = useRef<{ x: number; width: number } | null>(null);
	const header = useRef<HTMLDivElement>(null);
	useEffect(() => {
		const element = header.current;
		if (!element) return;
		const previous = document.activeElement;
		const opener = previous instanceof HTMLElement && previous !== document.body ? previous : null;
		const popup = element.closest("[data-trace-inspector]");
		element.focus({ preventScroll: true });
		return () => {
			// Restore after React's DOM commit, which can otherwise return focus to the body.
			// A sibling popover or an outside click may already own the user's new focus.
			if (document.activeElement !== document.body && !popup?.contains(document.activeElement)) return;
			const fallback = anchor instanceof HTMLElement ? anchor.querySelector<HTMLButtonElement>("button:not(:disabled)") : null;
			const target = opener?.isConnected ? opener : fallback;
			if (target?.isConnected) target.focus({ preventScroll: true });
		};
	}, [anchor]);
	const pairs = all.filter(candidate => candidate !== entry && (entry.linkedSeqs?.includes(candidate.seq) || entry.source === "subagent" && candidate.parentId === entry.correlationId));
	const facts: [string, string | number | undefined][] = [
		[t("trace.status"), entry.status && STATUS_LABEL[entry.status]], [t("common.provider"), entry.provider], [t("common.model"), entry.model],
		[t("trace.callId"), entry.correlationId], [t("trace.parentAgent"), entry.parentId],
		[t("trace.started"), entry.startedAt === undefined ? undefined : new Date(entry.startedAt).toLocaleString()],
		[t("trace.ended"), entry.finishedAt === undefined ? undefined : new Date(entry.finishedAt).toLocaleString()],
		[t("trace.elapsed"), entry.durationMs === undefined ? undefined : `${entry.durationMs.toLocaleString()} ms`],
		[t("trace.firstToken"), entry.ttftMs === undefined ? undefined : `${entry.ttftMs.toLocaleString()} ms`],
		[t("trace.generation"), entry.decodeMs === undefined ? undefined : `${entry.decodeMs.toLocaleString()} ms`],
		[t("trace.speed"), entry.decodeMs && entry.usage ? `${(entry.usage.output / entry.decodeMs * 1000).toFixed(1)} token/s` : undefined],
	];
	return <aside data-trace-inspector className="ly-trace-inspector" style={{ width }} aria-label={t("trace.detail")}>
		<div role="separator" aria-label={t("trace.resize")} aria-orientation="vertical" aria-valuemin={360} aria-valuemax={720} aria-valuenow={width} tabIndex={0} className="ly-trace-resize" onPointerDown={event => { resize.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (resize.current) setWidth(Math.max(360, Math.min(720, resize.current.width + resize.current.x - event.clientX))); }} onPointerUp={() => { resize.current = null; }} onPointerCancel={() => { resize.current = null; }} onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); setWidth(Math.max(360, Math.min(720, width + (event.key === "ArrowLeft" ? 20 : -20)))); } }} />
		<div ref={header} tabIndex={-1} role="group" aria-label={t("trace.detail")} data-trace-inspector-header className="flex h-9 shrink-0 items-center gap-1 px-2 text-caption text-ink-muted outline-none">
			<IconButton label={t("trace.back")} size="sm" icon={<ArrowLeft size={14} />} onClick={onClose} />
			<ScrollText text={`#${entry.seq} · ${SOURCE_LABEL[entry.source]}`} className="min-w-0 flex-1" />
			<IconButton label={t("trace.previous")} size="sm" icon={<ChevronLeft size={14} />} disabled={!previous} onClick={() => previous?.()} />
			<IconButton label={t("trace.next")} size="sm" icon={<ChevronRight size={14} />} disabled={!next} onClick={() => next?.()} />
			<IconButton label={t("trace.actions")} size="sm" icon={<Ellipsis size={14} />} onClick={menu.toggle} />
		</div>
		{menu.open && <Popover anchor={menu.anchor} onClose={menu.close} label={t("trace.actions")}><MenuBody>
			{available("sessions", "exportTrajectory") && <MenuItem icon={<FileText size={14} />} onClick={() => { menu.close(); onExport(); }}>{t("trace.openFile")}</MenuItem>}
			{available("sessions", "exportTrajectory") && entry.metadata && typeof entry.metadata === "object" && "outputPath" in entry.metadata && typeof entry.metadata.outputPath === "string" ? <MenuItem icon={<OutputIcon size={14} />} onClick={() => { menu.close(); onOutput(); }}>{t("trace.viewRaw")}</MenuItem> : null}
			<MenuItem icon={<GitBranch size={14} />} onClick={() => { menu.close(); onFork(); }}>{t("trace.forkHere")}</MenuItem>
		</MenuBody></Popover>}
		<div role="tablist" aria-label={t("trace.content")} className="flex shrink-0 gap-1 border-b border-line-soft px-2 pb-1">
			{(["content", "info", "raw"] as const).map(value => <button key={value} type="button" role="tab" aria-selected={tab === value} className={`rounded px-3 py-1 text-caption ${tab === value ? "bg-card-hover text-ink" : "text-ink-muted hover:bg-hover"}`} onClick={() => setTab(value)}>{value === "content" ? t("common.content") : value === "info" ? t("common.info") : t("common.raw")}</button>)}
		</div>
		<div className="min-h-0 flex-1 overflow-auto pb-3 pr-2" role="tabpanel" key={entryKey(entry)}>
		<div hidden={tab !== "content"}>
			<p className="px-3 pt-3 text-label text-ink">{entry.summary}</p>

			{entry.input && <TraceText title={t("common.input")} text={entry.input} kind={entry.toolName ? "json" : "text"} query={query} />}
			{entry.command && entry.command !== entry.input && <TraceText title={t("commands.title")} text={entry.command} kind="shell" query={query} />}
			{entry.detail && entry.detail !== entry.input && entry.detail !== entry.output && <TraceText markdown={!entry.toolName} title={t("common.details")} text={entry.detail} query={query} />}
			{entry.output && <TraceText markdown={entry.source === "assistant" || entry.source === "subagent"} title={t("common.output")} text={entry.output} query={query} />}
			</div><div hidden={tab !== "info"} className="px-3 py-2">
			<dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 py-2 text-caption">
				{facts.filter(([, value]) => value !== undefined).map(([label, value]) => <div key={label} className="contents"><dt className="text-ink-faint">{label}</dt><dd className="min-w-0 break-words text-ink-muted tabular-nums">{value}</dd></div>)}
			</dl>
			{entry.usage && <TraceText title={t("trace.tokens")} kind="json" text={JSON.stringify(entry.usage, null, 2)} />}
			{entry.metadata !== undefined && <TraceText title={t("trace.structured")} kind="json" text={JSON.stringify(entry.metadata, null, 2)} query={query} />}
			</div><div hidden={tab !== "raw"}><TraceText title={t("trace.rawEntry")} text={JSON.stringify(entry, null, 2)} kind="json" query={query} /></div><div hidden={tab !== "content"}>
			{entry.images?.map((part, index) => <button type="button" key={index} className="mx-3 my-2 block" onClick={event => openViewer((entry.images ?? []).map(image => ({ src: `data:${image.mimeType};base64,${image.data}` })), index, event.currentTarget.getBoundingClientRect(), event.currentTarget)}><img alt={t("trace.image", { seq: entry.seq, index: index + 1 })} className="max-h-52 max-w-full rounded-lg object-contain" src={`data:${part.mimeType};base64,${part.data}`} /></button>)}
			{pairs.length > 0 && <div className="px-3 py-2"><p className="mb-1 text-caption text-ink-faint">{translate("traceInspector.relatedCount", { n: pairs.length })}</p>{pairs.slice(0, 20).map(pair => <button type="button" key={entryKey(pair)} className="ly-item ly-scroll flex h-7 w-full min-w-0 gap-2 rounded px-1 text-left text-caption text-ink-muted" onClick={() => onSelect(pair)}><SourceIcon source={pair.source} size={12} /><span className="shrink-0 tabular-nums">#{pair.seq}</span><ScrollText text={`${SOURCE_LABEL[pair.source]} · ${pair.summary}`} className="min-w-0 flex-1" /><ArrowUpRight size={12} className="shrink-0" /></button>)}{pairs.length > 20 && <p className="text-caption text-ink-faint">{t("trace.parentHint")}</p>}</div>}
		</div></div></aside>;
}
