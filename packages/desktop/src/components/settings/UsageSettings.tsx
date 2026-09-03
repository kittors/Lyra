/**
 * What has been spent, and when.
 *
 * The page used to add up `SessionMeta.usage` and stamp each conversation on the day it was last
 * touched — which answers "how much in total" and nothing else, and gets even that slightly wrong:
 * a refactor spread over three days landed entirely on the third. It now reads the logs (see
 * `usage-scan.ts`), so a day means the day, and every number can be broken down by model.
 *
 * The scan is the expensive part and it is cached against each log's size, so the wait is once per
 * change rather than once per visit.
 */

import { useEffect, useMemo, useState } from "react";
import { useApp } from "../../store.ts";
import type { UsageScan } from "../../../electron/usage-scan.ts";
import { Card, EmptyHint, SectionTitle } from "./controls.tsx";
import { Segmented } from "./controls.tsx";
import { SkeletonBar, useSlowLoad } from "../../ui/primitives/Skeleton.tsx";
import { heatLevel, heatmapWeeks, monthLabels, type DayUsage } from "./usage-heatmap.ts";
import { dayTotals, providerLabel, summarise, type Range } from "./usage-aggregate.ts";
import { DailyBars, ModelBars } from "./usage-charts.tsx";
import { formatCompact, formatCost } from "./usage-format.ts";
import { bridge } from "../../services/index.ts";

/** A year of the heatmap: the span over which a rhythm is actually visible. */
const WEEKS = 52;

export function UsageSettings() {
	// Only to put a name to the provider ids the logs record; nothing here reads a key.
	const providers = useApp((s) => s.settings?.providers);
	const [scan, setScan] = useState<UsageScan | null>(null);
	const [failed, setFailed] = useState(false);
	const [range, setRange] = useState<Range>(30);
	const slow = useSlowLoad(scan === null && !failed);

	useEffect(() => {
		let live = true;
		void bridge.usage
			.scan()
			.then((result) => {
				if (live) setScan(result);
			})
			.catch(() => {
				if (live) setFailed(true);
			});
		return () => {
			live = false;
		};
	}, []);

	/*
	 * `now` is fixed for the life of the page rather than read at each render.
	 *
	 * Every range, streak and axis is measured from it, and a `new Date()` inside the calculation
	 * would let the day roll over between two of them — which is rare, silent, and produces a
	 * chart whose last column is a day the totals above it do not include.
	 */
	const now = useMemo(() => new Date(), []);
	const view = useMemo(() => (scan ? summarise(scan, range, now) : null), [scan, range, now]);

	// The heatmap is always the whole year, whatever the range above it is: it is the one thing on
	// the page that answers "when do I work", and a seven-day answer to that is not one.
	const grid = useMemo(() => heatmapWeeks(scan ? dayTotals(scan) : [], now, WEEKS), [scan, now]);
	const busiestDay = useMemo(() => Math.max(0, ...grid.flat().map((d) => d.tokens)), [grid]);

	const totals = view?.totals;
	const top = view?.models[0];

	return (
		<div className="pt-8">
			<h1 className="text-display leading-tight font-semibold tracking-tight text-ink">使用统计</h1>
			<p className="mt-2 pb-6 text-label text-ink-muted">
				按天和按模型统计的 token 与花费，全部来自本地会话日志，不上传任何数据。
			</p>

			<div className="flex items-center justify-between pb-4">
				<span className="text-label text-ink-muted">时间范围</span>
				<Segmented
					value={String(range)}
					onChange={(next) => setRange(Number(next) as Range)}
					options={[
						{ value: "7", label: "最近 7 天" },
						{ value: "30", label: "最近 30 天" },
						{ value: "0", label: "全部" },
					]}
				/>
			</div>

			{/*
			 * Reading the logs, drawn as the page that is coming rather than as a dash.
			 *
			 * A tile reading 「—」 is indistinguishable from a tile reading zero, and the two mean
			 * opposite things: one is "nothing has been measured yet", the other is "measured, and
			 * it was nothing". So while the scan runs the page is its own outline, and once it
			 * lands every number is a number.
			 */}
			{!totals || !view ? (
				/*
				 * Nothing at all until the wait is long enough to be worth drawing.
				 *
				 * A home with a handful of conversations scans in under 50ms, and a placeholder
				 * that appears for three frames is a flicker — which reads as a glitch rather than
				 * as progress. Past the threshold it is the outline of the page; see `useSlowLoad`.
				 */
				slow || failed ? <UsageSkeleton failed={failed} /> : null
			) : (
				<>
					<div className="@container mb-8">
						<div className="grid grid-cols-2 gap-3 @lg:grid-cols-3">
							<Stat
								label="tokens 用量"
								value={formatCompact(totals.tokens)}
								full={totals.tokens.toLocaleString()}
								sub={formatCost(totals.cost) ?? undefined}
							/>
							<Stat label="会话数" value={formatCompact(totals.sessionDays)} sub="按天计，一个会话跨天算多次" />
							<Stat label="消息数" value={formatCompact(totals.messages)} full={totals.messages.toLocaleString()} />
							<Stat label="活跃天数" value={String(totals.activeDays)} />
							<Stat label="当前连续天数" value={String(view.streak)} sub={view.streak > 0 ? "还没断" : undefined} />
							{/*
							 * The one tile whose value is a name.
							 *
							 * With no usage in the range there is no name to give, and a dash there
							 * would be the only dash on a page of zeroes — so it says what it means.
							 */}
							<Stat
								label="最常用模型"
								value={top ? top.model : "暂无模型"}
								muted={!top}
								sub={top ? `${providerLabel(providers, top.provider)} · ${(top.share * 100).toFixed(0)}%` : undefined}
								small
							/>
						</div>
					</div>

					<SectionTitle>按天 token 趋势</SectionTitle>
					<Card>
						{view.totals.tokens === 0 ? (
							<EmptyHint>这个区间没有用量。</EmptyHint>
						) : (
							<DailyBars series={view.series} />
						)}
					</Card>

					<div className="pt-6">
						<SectionTitle>按模型</SectionTitle>
						<Card>
							{view.models.length === 0 ? (
								<EmptyHint>这个区间还没有模型用量。</EmptyHint>
							) : (
								<ModelBars models={view.models} providerName={(id) => providerLabel(providers, id)} />
							)}
						</Card>
					</div>

					<div className="pt-6 pb-4">
						<SectionTitle>活跃热力图</SectionTitle>
						<Card>
							{busiestDay === 0 ? (
								<EmptyHint>还没有使用记录。</EmptyHint>
							) : (
								<div className="px-4 py-4">
									<Heatmap grid={grid} busiest={busiestDay} />
								</div>
							)}
						</Card>
					</div>
				</>
			)}
		</div>
	);
}

/**
 * The page, before it has anything in it.
 *
 * The same boxes in the same places, so nothing moves when the numbers land — the first scan of a
 * large home takes a couple of seconds, and a page that rearranges itself at the end of that wait
 * reads as a second load rather than as the same one finishing.
 *
 * A failure is not a slow success and does not get an outline: it gets a sentence, because the
 * thing to do about it is different.
 */
function UsageSkeleton({ failed }: { failed: boolean }) {
	if (failed) {
		return (
			<Card>
				<EmptyHint>读取会话日志失败，用量暂时无法统计。</EmptyHint>
			</Card>
		);
	}

	return (
		<div aria-busy="true" aria-live="polite">
			<span className="sr-only">正在读取会话日志</span>
			<div className="@container mb-8">
				<div className="grid grid-cols-2 gap-3 @lg:grid-cols-3">
					{Array.from({ length: 6 }, (_, index) => (
						<div key={index} className="rounded-[12px] border border-line bg-card/40 px-4 py-3.5">
							<SkeletonBar width="52%" height={9} />
							<SkeletonBar width="38%" height={18} className="mt-2.5" />
						</div>
					))}
				</div>
			</div>

			<SectionTitle>按天 token 趋势</SectionTitle>
			<Card>
				{/* Bars of assorted heights rather than a flat row: a chart is what is coming. */}
				<div className="flex h-[120px] items-end gap-[3px] px-4 pt-4 pb-3">
					{SKELETON_BARS.map((height, index) => (
						<span key={index} className="ly-skeleton flex-1 rounded-[2px]" style={{ height: `${height}%` }} />
					))}
				</div>
			</Card>

			<div className="pt-6">
				<SectionTitle>按模型</SectionTitle>
				<Card>
					<div className="flex flex-col gap-2.5 px-4 py-3.5">
						{[68, 44, 26].map((width) => (
							<div key={width}>
								<SkeletonBar width={`${width}%`} height={10} />
								<SkeletonBar width="100%" height={5} className="mt-1.5" />
							</div>
						))}
					</div>
				</Card>
			</div>
		</div>
	);
}

/**
 * Heights for the placeholder chart, fixed rather than random.
 *
 * A random skeleton redraws itself on every render, which is movement that means nothing — and on
 * a page that re-renders while loading it reads as data arriving and changing its mind.
 */
const SKELETON_BARS = [38, 52, 30, 64, 46, 72, 55, 41, 60, 34, 48, 66, 43, 57, 36, 50, 62, 40, 54, 45];

function Stat({
	label,
	value,
	full,
	sub,
	small,
	muted,
}: {
	label: string;
	value: string;
	/** The exact number, when the tile shows a rounded one. */
	full?: string;
	sub?: string;
	/** For a value that is a name rather than a number, and has to fit one. */
	small?: boolean;
	/** The value is a stand-in for an absent one — 「暂无模型」 — not a measurement. */
	muted?: boolean;
}) {
	return (
		<div
			className="@container rounded-[12px] border border-line bg-card/40 px-4 py-3.5"
			data-ly-tip={full && full !== value ? full : undefined}
			data-ly-tip-side="top"
		>
			<div className="truncate text-detail text-ink-muted">{label}</div>
			<div
				className={`mt-1 truncate leading-tight font-semibold tracking-tight ${
					small ? "text-label" : "text-heading"
				} ${muted ? "font-normal text-ink-faint" : "text-ink"}`}
			>
				{value}
			</div>
			{sub && <div className="mt-0.5 truncate text-detail text-ink-faint">{sub}</div>}
		</div>
	);
}

/**
 * A year of days, one column per week.
 *
 * Scrolls rather than shrinks: squares below about 9pt stop being distinguishable from their gaps.
 * It starts scrolled to the right, because the useful end of a history of usage is the recent end.
 */
function Heatmap({ grid, busiest }: { grid: DayUsage[][]; busiest: number }) {
	const labels = monthLabels(grid);

	return (
		/*
		 * Centred in the card, and still scrollable when it does not fit.
		 *
		 * `safe center` is what makes those two compatible. Plain `center` on a flex container that
		 * overflows pushes the first columns out through the *start* edge, where no scrolling can
		 * reach them — the oldest months become unreadable at exactly the window widths where the
		 * grid needed scrolling in the first place. `safe` falls back to `start` in that case, so
		 * the year is centred on a wide card and scrollable on a narrow one.
		 */
		<div className="flex w-full overflow-x-auto [justify-content:safe_center]" dir="rtl">
			<div dir="ltr" className="inline-block py-1">
				<div className="relative mb-1 h-[14px]">
					{labels.map((label) => (
						<span key={label.column} className="absolute top-0 text-detail text-ink-faint" style={{ left: label.column * 14 }}>
							{label.text}
						</span>
					))}
				</div>

				<div className="flex gap-[3px]">
					{grid.map((week) => (
						<div key={week[0]?.key} className="flex flex-col gap-[3px]">
							{week.map((day) => {
								const future = day.date.getTime() > Date.now();
								return (
									<span
										key={day.key}
										data-ly-tip={future ? undefined : tipFor(day)}
										data-ly-tip-side="top"
										className={`h-[11px] w-[11px] rounded-[3px] transition-colors duration-[var(--ly-t-quick)] ${
											future ? "opacity-40" : ""
										} ${SHADES[heatLevel(day.tokens, busiest)]}`}
									/>
								);
							})}
						</div>
					))}
				</div>

				<div className="mt-2.5 flex items-center justify-end gap-1 text-detail text-ink-faint">
					<span className="mr-1">少</span>
					{SHADES.map((shade, i) => (
						<span key={shade} className={`h-[11px] w-[11px] rounded-[3px] ${shade}`} aria-label={`第 ${i} 档`} />
					))}
					<span className="ml-1">多</span>
				</div>
			</div>
		</div>
	);
}

/** Five steps of one hue, so the scale reads as one scale. */
const SHADES = ["bg-ink/[0.06]", "bg-info/25", "bg-info/45", "bg-info/70", "bg-info"] as const;

function tipFor(day: DayUsage): string {
	const date = `${day.date.getMonth() + 1}月${day.date.getDate()}日`;
	if (day.messages === 0) return `${date} · 没有使用`;
	const parts = [`${day.sessions} 个会话`, `${day.tokens.toLocaleString()} token`];
	if (day.cost > 0) parts.push(`$${day.cost.toFixed(4)}`);
	return `${date} · ${parts.join(" · ")}`;
}
