import { ChevronDown, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { entryKey, SOURCE_LABEL, type Entry } from "@lyra/core/trajectory-view";
import { IconButton } from "../../../ui/primitives/IconButton.tsx";
import { draggedRange, LANE_HEIGHT, timelineDomain, timelineHit, timelineLane, type TimeRange } from "./timeline-geometry.ts";
export type { TimeRange } from "./timeline-geometry.ts";

const HEIGHT = LANE_HEIGHT * 3;
const hint = "点击查看记录 · 拖选范围 · 方向键浏览，Enter 查看";
const offset = (ms: number) => ms < 1000 ? `${Math.round(ms)}ms` : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60_000).toFixed(1)}m`;

/** Preview the brush locally; committing it once keeps the ledger still under the pointer. */
export const TraceTimeline = memo(function TraceTimeline({ entries, range, selected, onRange, onSelect, matches, paused = false }: {
	matches?: ReadonlySet<string>; paused?: boolean; entries: Entry[]; range: TimeRange | null; selected: string | null;
	onRange: (range: TimeRange | null) => void; onSelect: (entry: Entry) => void;
}) {
	const root = useRef<HTMLElement>(null);
	const [expanded, setExpanded] = useState(true);
	const initialized = useRef(false);
	const [short, setShort] = useState(false);
	const [cramped, setCramped] = useState(false);
	const manualView = useRef(false);
	const canvas = useRef<HTMLCanvasElement>(null);
	const drag = useRef<number | null>(null);
	const [draft, setDraft] = useState<TimeRange | null>(null);
	const [view, setView] = useState<TimeRange | null>(null);
	const [hover, setHover] = useState<Entry | undefined>();
	const [preview, setPreview] = useState<string | null>(null);
	const points = useMemo(() => entries.filter(entry => entry.source === "request" || entry.source === "tool-call" || entry.source === "compaction" || entry.source === "subagent" || entry.source === "assistant" && !entry.linkedSeqs?.length), [entries]);
	const domain = useMemo(() => timelineDomain(points), [points]);
	const shown = view ?? domain;
	const visible = expanded && !short;
	const brush = draft ?? range;
	const current = points.findIndex(entry => entryKey(entry) === (preview ?? selected));
	const activeEntry = points[Math.max(0, current)];
	const described = hover ?? (preview ? activeEntry : undefined);
	const cancel = () => { drag.current = null; setDraft(null); setHover(undefined); setPreview(null); };
	useEffect(() => {
		const parent = root.current?.parentElement;
		if (!parent) return;
		const observer = new ResizeObserver(() => {
			if (!parent.clientHeight) return;
			setShort(parent.clientHeight < 240);
			setCramped(parent.clientHeight < 160);
			if (initialized.current) return;
			initialized.current = true;
			const preference = window.sessionStorage.getItem("lyra.trace.timeline");
			setExpanded(preference ? preference === "open" : parent.clientHeight >= 400);
		});
		observer.observe(parent); return () => observer.disconnect();
	}, []);
	useEffect(() => {
		if (paused || range) setView(current => current ?? domain);
		else if (!manualView.current) setView(null);
	}, [paused, range, domain]);
	useEffect(() => {
		const entry = points.find(item => entryKey(item) === selected);
		if (!entry) return;
		setPreview(null);
		setView(current => {
			if (!current) return current;
			const start = entry.startedAt ?? entry.ts, end = entry.finishedAt ?? start;
			if (end >= current.start && start <= current.end) return current;
			const span = current.end - current.start;
			const left = Math.max(domain.start, Math.min(domain.end - span, start));
			return { start: left, end: left + span };
		});
	}, [selected, points, domain]);
	const reset = () => { manualView.current = false; setView(null); setDraft(null); onRange(null); };
	const zoom = (factor: number) => {
		manualView.current = true;
		const span = Math.min(domain.end - domain.start, Math.max(1, (shown.end - shown.start) * factor));
		const at = brush ? (brush.start + brush.end) / 2 : (shown.start + shown.end) / 2;
		const start = Math.max(domain.start, Math.min(domain.end - span, at - span / 2));
		setView(span === domain.end - domain.start ? null : { start, end: start + span });
	};
	useEffect(() => {
		const el = canvas.current; if (!el || !visible) return;
		const paint = () => {
			const width = el.clientWidth; if (!width) return;
			const dpr = devicePixelRatio, style = getComputedStyle(el);
			const color = (token: string) => style.getPropertyValue(`--color-${token}`).trim();
			el.width = Math.round(width * dpr); el.height = HEIGHT * dpr;
			const ctx = el.getContext("2d"); if (!ctx) return;
			ctx.scale(dpr, dpr);
			const x = (time: number) => (time - shown.start) / (shown.end - shown.start) * width;
			for (const entry of points) {
				const left = x(entry.startedAt ?? entry.ts), right = Math.max(left + 2, x(entry.finishedAt ?? entry.startedAt ?? entry.ts));
				if (right < 0 || left > width) continue;
				const lane = timelineLane(entry), y = lane * LANE_HEIGHT + 3;
				ctx.fillStyle = entry.status === "error" ? color("danger") : lane === 1 ? color("ok") : lane === 2 ? color("violet") : color("info");
				ctx.globalAlpha = matches && !matches.has(entryKey(entry)) ? 0.2 : brush && ((entry.finishedAt ?? entry.startedAt ?? entry.ts) < brush.start || (entry.startedAt ?? entry.ts) > brush.end) ? 0.18 : 0.65;
				ctx.fillRect(Math.max(0, left), y, Math.min(width, right) - Math.max(0, left), 10);
				if (entryKey(entry) === (preview ?? selected) || entry === hover) {
					ctx.globalAlpha = 1; ctx.strokeStyle = color("ink"); ctx.lineWidth = 1.5;
					ctx.strokeRect(Math.max(1, left), y - 1, Math.max(3, Math.min(width - 1, right) - Math.max(1, left)), 12);
				}
			}
			if (brush) {
				const left = Math.max(0, x(brush.start)), right = Math.min(width, x(brush.end));
				ctx.globalAlpha = 0.12; ctx.fillStyle = color("info"); ctx.fillRect(left, 0, right - left, HEIGHT);
				ctx.globalAlpha = 0.9; ctx.fillRect(left, 0, 1.5, HEIGHT); ctx.fillRect(right - 1.5, 0, 1.5, HEIGHT);
			}
		};
		paint(); const observer = new ResizeObserver(paint); observer.observe(el);
		const theme = new MutationObserver(paint); theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });
		return () => { observer.disconnect(); theme.disconnect(); };
	}, [points, shown, brush, selected, hover, preview, visible, matches]);
	const point = (el: HTMLCanvasElement, clientX: number, clientY: number) => { const bounds = el.getBoundingClientRect(); return { x: clientX - bounds.left, y: clientY - bounds.top, width: bounds.width }; };
	return <section ref={root} hidden={cramped} className="shrink-0 px-3 pb-1" aria-label="时间概览" data-trace-timeline>
		<div className="flex h-8 items-center gap-1 text-caption text-ink-muted">
			<button type="button" aria-label="时间概览" aria-expanded={visible} className="mr-auto flex items-center gap-1 rounded py-1 hover:text-ink" onClick={() => { cancel(); window.sessionStorage.setItem("lyra.trace.timeline", expanded ? "closed" : "open"); setExpanded(!expanded); }}><ChevronDown size={12} style={{ transform: expanded ? undefined : "rotate(-90deg)" }} />{short ? "时间轴 · 放大面板查看" : expanded ? "时间轴" : "展开时间轴"}</button>
			{/*
			 * 收起的时候，这三个不在。
			 *
			 * 它们缩放的是下面那条时间轴，所以时间轴收起时它们无事可做——原先是画成禁用留在原地，而禁用
			 * 只是 40% 不透明度，落在本来就是 `text-ink-faint` 的图标上和可用状态几乎看不出分别：三个
			 * 按得下去的按钮，按了什么也不发生。禁用留给「展开了，但这一段没有可缩放的范围」。
			 */}
			{visible && <>
				<IconButton explainDisabled size="sm" label="缩小时间范围" icon={<ZoomOut size={12} />} onClick={() => zoom(2)} disabled={!view} />
				<IconButton explainDisabled size="sm" label="放大时间范围" icon={<ZoomIn size={12} />} onClick={() => zoom(0.5)} disabled={!points.length || shown.end - shown.start <= 1} />
				<IconButton explainDisabled size="sm" label="重置时间范围" icon={<RotateCcw size={12} />} onClick={reset} disabled={!range && !view} />
			</>}
		</div>
		<div hidden={!visible}>
		<div className="flex h-6 items-center justify-between text-caption text-ink-muted"><span>{brush ? `聚焦 ${offset(brush.start - domain.start)} 至 ${offset(brush.end - domain.start)}` : "点击记录 · 拖选聚焦"}</span>{brush && <button type="button" className="rounded px-1 hover:bg-hover" onClick={() => { setDraft(null); onRange(null); }}>清除范围</button>}</div>

		<div className="flex items-start gap-2">
			<div aria-hidden className="flex w-7 shrink-0 flex-col text-caption text-ink-faint" style={{ lineHeight: `${LANE_HEIGHT}px` }}><span>模型</span><span>工具</span><span>协作</span></div>
			<canvas ref={canvas} className="block min-w-0 flex-1 touch-none rounded bg-card/30 outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent" style={{ height: HEIGHT }} tabIndex={0} role="slider" aria-label={hint} aria-valuemin={0} aria-valuemax={Math.max(0, points.length - 1)} aria-valuenow={Math.max(0, current)} aria-valuetext={activeEntry ? `#${activeEntry.seq} ${SOURCE_LABEL[activeEntry.source]} ${activeEntry.summary}` : undefined} data-ly-tip={described ? `#${described.seq} ${SOURCE_LABEL[described.source]} · ${described.summary}\n${described.durationMs === undefined ? "未记录耗时" : offset(described.durationMs)}` : hint}
				onPointerDown={event => { if (event.button !== 0) return; drag.current = point(event.currentTarget, event.clientX, event.clientY).x; event.currentTarget.setPointerCapture(event.pointerId); }}
				onPointerMove={event => {
					const { x, y, width } = point(event.currentTarget, event.clientX, event.clientY);
					if (drag.current !== null) setDraft(draggedRange(drag.current, x, width, shown));
					else setHover(timelineHit(points, x, y, width, shown));
				}}
				onPointerLeave={() => setHover(undefined)}
				onPointerUp={event => {
					const start = drag.current; drag.current = null; setDraft(null); if (start === null) return;
					const { x, y, width } = point(event.currentTarget, event.clientX, event.clientY);
					const next = draggedRange(start, x, width, shown);
					if (next) onRange(next);
					else {
						const near = timelineHit(points, x, y, width, shown);
						if (near) onSelect(near);
					}
				}}
				onPointerCancel={() => { drag.current = null; setDraft(null); }}
				onKeyDown={event => {
					if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); onRange(null); return; }
					if (event.key === "Enter" && points.length) {
						event.preventDefault(); event.stopPropagation();
						if (!event.repeat) onSelect(points[Math.max(0, current)]);
						return;
					}
					if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key) || !points.length) return;
					event.preventDefault(); event.stopPropagation();
					const next = event.key === "Home" ? 0 : event.key === "End" ? points.length - 1 : Math.max(0, Math.min(points.length - 1, current + (event.key === "ArrowLeft" ? -1 : 1)));
					const entry = points[next], start = entry.startedAt ?? entry.ts, end = entry.finishedAt ?? start;
					setPreview(entryKey(entry));
					if (view && (end < shown.start || start > shown.end)) {
						const span = shown.end - shown.start, left = Math.max(domain.start, Math.min(domain.end - span, start - span / 2));
						setView({ start: left, end: left + span });
					}
				}} />
		</div>
		<div aria-hidden className="mt-0.5 flex justify-between pl-9 text-caption text-ink-faint tabular-nums"><span>{offset(shown.start - domain.start)}</span><span>{offset(shown.end - domain.start)}</span></div>
	<input type="range" aria-label="平移时间视口" className="ly-trace-pan block h-3 w-full" min={domain.start} max={Math.max(domain.start, domain.end - (shown.end - shown.start))} step={1} value={shown.start} disabled={!view} onChange={event => { manualView.current = true; const start = Number(event.target.value); setView({ start, end: start + shown.end - shown.start }); }} />
		</div>
	</section>;
});
