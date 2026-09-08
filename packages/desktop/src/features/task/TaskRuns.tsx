import { translate } from "../../i18n/translate.ts";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { ToolRun } from "../../store/index.ts";
import { DetailCard } from "../conversation/index.ts";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { Text } from "../../ui/primitives/Text.tsx";
import { RunDetail } from "./RunDetail.tsx";

// 和轨迹列表同一套：滚得越快预留越多，否则 setState 追不上滚动，视口里就是白的。
import { overscanFor } from "../../lib/overscan.ts";

/** Only one record expands, so all other offsets stay a multiple of the measured row height. */
export function TaskRuns({ runs, scrollRef, query = "" }: { runs: ToolRun[]; query?: string; scrollRef: RefObject<HTMLDivElement | null> }) {
	const host = useRef<HTMLDivElement>(null);
	const [openId, setOpenId] = useState<string | null>(null);
	const [focusedId, setFocusedId] = useState<string | null>(null);
	const [rowHeight, setRowHeight] = useState(36);
	const [openHeight, setOpenHeight] = useState(0);
	const [range, setRange] = useState({ start: 0, end: 40 });
	/** 上一次量到的滚动位置，用来知道这一帧滚了多快——见 `overscanFor`。 */
	const lastTop = useRef(0);
	/** 只为把上面那条 effect 再叫醒一次——父级的滚动视口是下一帧才到的。 */
	const [ready, setReady] = useState(0);
	const firstId = useRef(runs[0]?.toolCallId);
	const openIndex = runs.findIndex(run => run.toolCallId === openId);
	const extra = openIndex < 0 ? 0 : Math.max(0, openHeight - rowHeight);

	useLayoutEffect(() => {
		const list = host.current;
		const viewport = scrollRef.current;
		/*
		 * 视口还没到，就等下一帧再问一次。
		 *
		 * 这个 ref 是父级的 `Scroller` 渲染的那个 div，而 layout effect 是**子先于父**跑的——轮到
		 * 这里时它常常还是 null。原来是直接 `return`，而依赖里 `scrollRef` 是个恒定的 ref 对象，
		 * 没有任何东西会让这条 effect 再跑一次：scroll 监听于是永远没挂上，可见区间停在初始的
		 * 0..40。300 条记录里往下滚，视口里一行都没有——那片「大得能继续滚的空白」就是它。
		 */
		if (!list || !viewport) {
			const frame = requestAnimationFrame(() => setReady((n) => n + 1));
			return () => cancelAnimationFrame(frame);
		}
		const added = runs.findIndex(run => run.toolCallId === firstId.current);
		if (added > 0 && viewport.scrollTop > list.offsetTop) viewport.scrollTop += added * rowHeight;
		firstId.current = runs[0]?.toolCallId;
		const measure = () => {
			// A hidden dock pane keeps its window and measurements; zero is not a new row size.
			if (!viewport.clientHeight) return;
			const top = Math.max(0, viewport.scrollTop - list.offsetTop);
			const indexAt = (y: number) => {
				if (openIndex < 0 || y < openIndex * rowHeight) return Math.floor(y / rowHeight);
				if (y < (openIndex + 1) * rowHeight + extra) return openIndex;
				return Math.floor((y - extra) / rowHeight);
			};
			const pad = overscanFor(viewport.scrollTop - lastTop.current, Math.ceil(viewport.clientHeight / rowHeight), rowHeight);
			lastTop.current = viewport.scrollTop;
			const start = Math.max(0, Math.min(runs.length - 1, indexAt(top) - pad));
			const end = Math.min(runs.length, indexAt(top + viewport.clientHeight) + pad + 1);
			setRange(prev => prev.start === start && prev.end === end ? prev : { start, end });
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(viewport);
		for (const child of viewport.children) observer.observe(child);
		viewport.addEventListener("scroll", measure, { passive: true });
		return () => { observer.disconnect(); viewport.removeEventListener("scroll", measure); };
	}, [scrollRef, rowHeight, extra, openIndex, runs, ready]);

	const visible = Array.from({ length: Math.max(0, range.end - range.start) }, (_, index) => index + range.start)
		.filter(index => index < runs.length);
	// Keep an expanded record mounted even when it is outside the viewport, preserving detail
	// selection, nested scroll and sticky-header ownership while the rest of the list is windowed.
	if (openIndex >= 0 && !visible.includes(openIndex)) visible.push(openIndex);
	const focusedIndex = runs.findIndex(run => run.toolCallId === focusedId);
	if (focusedIndex >= 0 && !visible.includes(focusedIndex)) visible.push(focusedIndex);
	visible.sort((a, b) => a - b);
	const signature = visible.join(",");
	useLayoutEffect(() => {
		const list = host.current;
		if (!list) return;
		const measure = () => {
			const closed = list.querySelector<HTMLElement>('[data-task-record][data-open="false"]');
			const open = list.querySelector<HTMLElement>('[data-task-record][data-open="true"]');
			if (closed && closed.offsetHeight > 0) setRowHeight(closed.offsetHeight);
			if (open && open.offsetHeight > 0) setOpenHeight(open.offsetHeight);
		};
		measure();
		const observer = new ResizeObserver(measure);
		for (const row of list.children) observer.observe(row);
		return () => observer.disconnect();
	}, [signature, openId]);

	return <div ref={host} className="relative" data-task-records style={{ height: runs.length * rowHeight + extra }}>
		{visible.map(index => {
			const run = runs[index];
			const open = run.toolCallId === openId;
			return <div key={run.toolCallId} data-task-record={run.toolCallId} data-open={open}
				onFocusCapture={() => setFocusedId(run.toolCallId)}
				onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusedId(null); }}
				className={`absolute right-0 left-0 flow-root ${open ? "z-20" : ""}`}
				style={{ top: index * rowHeight + (index > openIndex && openIndex >= 0 ? extra : 0) }}>
				<DetailCard enter={false} open={open} onToggle={() => { setOpenId(open ? null : run.toolCallId); setOpenHeight(0); }}
					summary={<ScrollText text={run.summary} className="ly-fade-tail min-w-0 flex-1 text-detail" />}
					trailing={<>
						<span className={`h-[6px] w-[6px] shrink-0 rounded-full ${run.status === "running" ? "ly-pulse bg-info" : run.status === "error" ? "bg-danger" : "bg-ok/70"}`} />
						<Text size="caption" tone="faint" numeric className="shrink-0">{run.finishedAt ? formatSpan(run.finishedAt - run.startedAt) : translate("common.inProgress")}</Text>
					</>}>
					<RunDetail run={run} query={query} />
				</DetailCard>
			</div>;
		})}
	</div>;
}

function formatSpan(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s`;
	return `${Math.floor(seconds / 60)}m${String(seconds % 60).padStart(2, "0")}s`;
}
