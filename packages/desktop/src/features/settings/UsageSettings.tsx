import { MODEL_CATALOG_SOURCE } from "@lyra/core/model-catalog";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { UsageScan } from "../../../electron/usage-scan.ts";
import { bridge } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";
import { SkeletonBar, useSlowLoad } from "../../ui/primitives/Skeleton.tsx";
import { ModelIcon } from "../models/index.ts";
import { Card, EmptyHint, Segmented } from "./controls.tsx";
import { dayTotals, providerLabel, summarise, type ModelUse, type Range } from "./usage-aggregate.ts";
import { heatLevel, heatmapWeeks, monthLabels, type DayUsage } from "./usage-heatmap.ts";
import { trendColor, UsageTrendChart, type TrendMetric } from "./usage-charts.tsx";
import { formatCompact, formatCost } from "./usage-format.ts";
import { translate, useI18n } from "../../i18n/index.ts";

const WEEKS = 52;

export function UsageSettings() {
	const { t } = useI18n();
	const providers = useApp((state) => state.settings?.providers);
	const [scan, setScan] = useState<UsageScan | null>(null);
	const [failed, setFailed] = useState(false);
	const [refreshing, setRefreshing] = useState(false);
	const [range, setRange] = useState<Range>(30);
	const [metric, setMetric] = useState<TrendMetric>("cost");
	/*
	 * 图例里被关掉的供应商。
	 *
	 * 图例本来只是一排色点和名字——看着像能点，点了什么也不发生。而它恰恰是这张图最需要的那个
	 * 操作：一个花掉大头的供应商会把其余几个压成贴着底边的一条线，关掉它，剩下的才有刻度可读。
	 * 状态放在这里而不是图表里面，因为图例和图是两个兄弟节点，共同的父亲只有这里。
	 */
	const [hidden, setHidden] = useState<ReadonlySet<string>>(() => new Set());
	const toggleProvider = useCallback((id: string) => {
		setHidden((current) => {
			const next = new Set(current);
			if (!next.delete(id)) next.add(id);
			return next;
		});
	}, []);
	const [breakdown, setBreakdown] = useState<"model" | "day">("model");
	const slow = useSlowLoad(scan === null && !failed);

	const load = useCallback(async (refresh = false) => {
		if (refresh) setRefreshing(true);
		setFailed(false);
		try {
			setScan(await bridge.usage.scan());
		} catch {
			setFailed(true);
		} finally {
			setRefreshing(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const now = useMemo(() => new Date(), []);
	const view = useMemo(() => (scan ? summarise(scan, range, now) : null), [scan, range, now]);
	const grid = useMemo(() => heatmapWeeks(scan ? dayTotals(scan) : [], now, WEEKS), [scan, now]);
	const busiestDay = useMemo(() => Math.max(0, ...grid.flat().map((day) => day.tokens)), [grid]);

	return (
		<div className="pt-8">
			<header className="flex flex-wrap items-start justify-between gap-4 pb-5">
				<div>
					<h1 className="text-display leading-tight font-semibold tracking-tight text-ink">{t("usage.title")}</h1>
					<p className="mt-2 text-label text-ink-muted">{t("usage.intro")}</p>
				</div>
				<div className="flex items-center gap-2">
					<Segmented
						value={String(range)}
						onChange={(next) => setRange(Number(next) as Range)}
						options={[
							{ value: "7", label: t("usage.days7") },
							{ value: "30", label: t("usage.days30") },
							{ value: "90", label: t("usage.days90") },
							{ value: "0", label: t("common.all") },
						]}
					/>
					<button
						type="button"
						aria-label={t("usage.refresh")}
						data-ly-tip={t("usage.refreshDetail")}
						onClick={() => void load(true)}
						disabled={refreshing}
						className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:bg-card-hover hover:text-ink disabled:opacity-50"
					>
						<RefreshCw size={14} strokeWidth={1.8} className={refreshing ? "animate-spin" : undefined} />
					</button>
				</div>
			</header>

			{view ? (
				<Dashboard view={view} providers={providers} metric={metric} setMetric={setMetric} hidden={hidden} onToggleProvider={toggleProvider} breakdown={breakdown} setBreakdown={setBreakdown} grid={grid} busiestDay={busiestDay} />
			) : slow || failed ? (
				<UsageSkeleton failed={failed} />
			) : null}
		</div>
	);
}

type UsageView = ReturnType<typeof summarise>;

function Dashboard({
	view,
	providers,
	metric,
	setMetric,
	hidden,
	onToggleProvider,
	breakdown,
	setBreakdown,
	grid,
	busiestDay,
}: {
	view: UsageView;
	providers: { id: string; name: string }[] | undefined;
	metric: TrendMetric;
	setMetric: (metric: TrendMetric) => void;
	hidden: ReadonlySet<string>;
	onToggleProvider: (id: string) => void;
	breakdown: "model" | "day";
	setBreakdown: (breakdown: "model" | "day") => void;
	grid: DayUsage[][];
	busiestDay: number;
}) {
	const { t } = useI18n();
	const totals = view.totals;
	const pricedTokens = totals.tokens - totals.quality.unpriced;
	const dateRange = rangeLabel(view.series);

	return (
		<div data-usage-dashboard="true" className="@container">
			<div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-detail text-ink-faint">
				<span>{dateRange}</span>
				<span>{t("usage.activeDays", { n: totals.activeDays })}</span>
				<span>{t("usage.sessionDays", { n: totals.sessionDays })}</span>
				<span>{t("usage.messages", { n: totals.messages.toLocaleString() })}</span>
			</div>

			<div className="grid gap-3 @3xl:grid-cols-[minmax(245px,0.78fr)_minmax(0,1.45fr)]">
				<Card className="p-4">
					<div className="text-detail font-medium tracking-wide text-ink-faint">{t("usage.estimatedCost")}</div>
					<div className="mt-1 text-[32px] leading-tight font-semibold tracking-[-0.03em] text-ink tabular-nums">
						{pricedTokens > 0 ? costLabel(totals.cost) : t("usage.noPrice")}
					</div>
					<div className="mt-1 text-detail text-ink-faint">{t("usage.estimatedCostDetail")}</div>
					{/*
					 * The top three, not the top four.
					 *
					 * The two cards share a row, so the taller one sets the height of both — and this
					 * one is a list, which grows, while the chart beside it is a fixed shape. A fourth
					 * provider added a row here and an equal band of empty card over there. Three
					 * spends and the chart end at about the same place.
					 */}
					<div className="mt-4 space-y-3">
						{view.providers.slice(0, 3).map((provider, index) => (
							<ProviderSpend key={provider.id} name={providerLabel(providers, provider.id)} provider={provider} color={trendColor(index)} />
						))}
						{view.providers.length === 0 && <div className="py-5 text-center text-label text-ink-faint">{t("usage.noUsage")}</div>}
					</div>
				</Card>

				{/* A column, so the chart can have whatever height the spend list beside it leaves over. */}
				<Card className="flex flex-col">
					<div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3.5">
						<div>
							<div className="text-label font-medium text-ink">{t("usage.dailyTrend")}</div>
							<div className="mt-0.5 text-detail text-ink-faint">{t("usage.dailyTrendDetail")}</div>
						</div>
						<Segmented value={metric} onChange={setMetric} options={[{ value: "cost", label: t("common.cost") }, { value: "tokens", label: "Token" }]} />
					</div>
					{/*
					 * 图例是开关，不是标注。
					 *
					 * 它一直长着一副能点的样子——一排色点配名字，和所有图表里那种点一下就能过滤的
					 * 图例一模一样——而点下去什么也不发生。现在点下去就是关掉那条线：它淡出，纵轴
					 * 按剩下的重新分配，留下的曲线跟着长起来，而那段长起来正好说明了刚才被压掉多少。
					 *
					 * `aria-pressed` 而不是勾选框：这是一个开着或关着的开关，读屏念出来也该是这样。
					 */}
					<div className="flex flex-wrap gap-x-1 gap-y-1 px-3 pt-2 text-detail text-ink-muted">
						{view.providerTrends.map((provider, index) => {
							const off = hidden.has(provider.id);
							return (
								<button
									key={provider.id}
									type="button"
									aria-pressed={!off}
									data-usage-legend={provider.id}
									data-off={off || undefined}
									onClick={() => onToggleProvider(provider.id)}
									data-ly-tip={off ? t("usage.showProvider") : t("usage.hideProvider")}
									className={`flex items-center gap-1.5 rounded-md px-1.5 py-0.5 transition-[color,background-color,transform] duration-[var(--ly-t-quick)] hover:bg-card-hover active:scale-[0.96] ${off ? "text-ink-faint" : "text-ink-muted hover:text-ink"}`}
								>
									{/* 关掉时留一个空心圈：位置和颜色都还在，只是这条线现在不在图上。 */}
									<span
										className="h-2 w-2 rounded-full transition-all duration-[var(--ly-t-base)] ease-[var(--ly-e-out)]"
										style={off ? { boxShadow: `inset 0 0 0 1.5px ${trendColor(index)}` } : { background: trendColor(index) }}
									/>
									{providerLabel(providers, provider.id)}
								</button>
							);
						})}
					</div>
					{totals.tokens > 0 ? (
						<UsageTrendChart trends={view.providerTrends} metric={metric} labelOf={(id) => providerLabel(providers, id)} hidden={hidden} />
					) : (
						<EmptyHint>{t("usage.noTrend")}</EmptyHint>
					)}
				</Card>
			</div>

			<div aria-label={t("usage.metrics")} className="mt-3 grid grid-cols-2 overflow-hidden rounded-[12px] border border-line bg-card/40 @2xl:grid-cols-5">
				<Metric label={t("usage.tokensProcessed")} value={formatCompact(totals.tokens)} sub={t("usage.perActiveDay", { n: formatCompact(totals.activeDays > 0 ? totals.tokens / totals.activeDays : 0) })} />
				<Metric label={t("usage.cacheHit")} value={formatCompact(totals.cacheRead)} sub={t("usage.ofInput", { percent: percent(totals.cacheRead, totals.input + totals.cacheRead + totals.cacheWrite) })} />
				<Metric label={t("usage.uncachedInput")} value={formatCompact(totals.input)} sub={t("usage.cacheWrites", { n: formatCompact(totals.cacheWrite) })} />
				<Metric label={t("common.output")} value={formatCompact(totals.output)} sub={t("usage.withReasoning", { n: formatCompact(totals.reasoning) })} />
				<Metric label={t("usage.cacheSaving")} value={signedCost(totals.cacheSavings)} sub={t("usage.withoutCache", { cost: costLabel(totals.rawCost) })} />
			</div>

			{/*
			 * `items-start`, so the right-hand card is only as tall as what it says.
			 *
			 * A grid stretches its items by default, which paired a twelve-row table with a six-row
			 * one and gave the shorter card 200px of empty background to hold up. Neither card wants
			 * to be the other's height — they are two separate readings, not two columns of one.
			 */}
			<div className="mt-6 grid items-start gap-3 @3xl:grid-cols-[minmax(0,1.55fr)_260px]">
				{/*
				 * Capped and scrolled rather than however long the list happens to be.
				 *
				 * Twelve rows at 38px each ran to roughly 500px, which pushed 「使用节奏」 off the
				 * bottom of the pane — the breakdown is something you consult, and it was setting the
				 * height of a page it is one part of. The header stays out of the scroller so the
				 * period switch is always reachable.
				 */}
				<Card className="flex max-h-[420px] flex-col" data-usage-breakdown="true">
					<div className="flex shrink-0 items-center justify-between border-b border-line-soft px-4 py-3">
						<div className="text-label font-medium text-ink">{t("usage.breakdown")}</div>
						<Segmented value={breakdown} onChange={setBreakdown} options={[{ value: "model", label: t("common.model") }, { value: "day", label: t("common.date") }]} />
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto">
						{breakdown === "model" ? <ModelBreakdown rows={view.models} providers={providers} totalCost={totals.cost} /> : <DayBreakdown rows={view.series} totalCost={totals.cost} />}
					</div>
				</Card>

				<Card className="p-4" data-usage-quality="true">
					<div className="text-label font-medium text-ink">{t("usage.priceQuality")}</div>
					<div className="mt-1 text-detail leading-relaxed text-ink-faint">{t("usage.priceQualityDetail")}</div>
					<QualityBar totals={totals} />
					<div className="mt-3 divide-y divide-line-soft">
						<QualityRow label={t("usage.fromProvider")} value={percent(totals.quality.provider, totals.tokens)} />
						<QualityRow label={t("usage.offlineCatalog")} value={percent(totals.quality.catalog, totals.tokens)} />
						<QualityRow label={t("usage.manualPrice")} value={percent(totals.quality.manual, totals.tokens)} />
						<QualityRow label={t("usage.recorded")} value={percent(totals.quality.recorded, totals.tokens)} />
						<QualityRow label={t("usage.unpriced")} value={percent(totals.quality.unpriced, totals.tokens)} />
						<QualityRow label={t("usage.cacheSaving")} value={signedCost(totals.cacheSavings)} />
					</div>
					<div className="mt-3 text-detail leading-relaxed text-ink-faint">
						目录版本 {MODEL_CATALOG_SOURCE.commit.slice(0, 8)} · {new Date(MODEL_CATALOG_SOURCE.updatedAt).toLocaleDateString()}
					</div>
				</Card>
			</div>

			<div className="pt-6 pb-4">
				<div className="mb-3 text-title font-medium text-ink">{t("usage.rhythm")}</div>
				<Card>{busiestDay === 0 ? <EmptyHint>{t("usage.noRecords")}</EmptyHint> : <div className="px-4 py-4"><Heatmap grid={grid} busiest={busiestDay} /></div>}</Card>
			</div>
		</div>
	);
}

function ProviderSpend({ name, provider, color }: { name: string; provider: UsageView["providers"][number]; color: string }) {
	const { t } = useI18n();
	return (
		<div>
			<div className="flex items-center gap-2 text-label">
				<ModelIcon model={provider.id} name={name} size={14} />
				<span className="min-w-0 flex-1 truncate text-ink">{name}</span>
				<span className="shrink-0 font-medium text-ink tabular-nums">{provider.unpricedTokens === provider.tokens ? t("usage.unpriced") : costLabel(provider.cost)}</span>
			</div>
			<div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink/[0.06]"><div className="h-full rounded-full" style={{ width: `${Math.max(provider.share * 100, 1)}%`, background: color }} /></div>
			<div className="mt-1 text-detail text-ink-faint tabular-nums">{(provider.share * 100).toFixed(1)}% · {formatCompact(provider.tokens)} token</div>
		</div>
	);
}

function Metric({ label, value, sub }: { label: string; value: string; sub: string }) {
	return <div className="min-w-0 border-b border-line-soft px-3.5 py-3 odd:border-r even:border-r-0 last:col-span-2 last:border-b-0 @2xl:border-b-0 @2xl:odd:border-r @2xl:even:border-r @2xl:last:col-span-1 @2xl:last:border-r-0"><div className="truncate text-detail text-ink-muted">{label}</div><div className="mt-1 text-title font-medium text-ink tabular-nums">{value}</div><div className="mt-0.5 truncate text-detail text-ink-faint tabular-nums">{sub}</div></div>;
}

function ModelBreakdown({ rows, providers, totalCost }: { rows: ModelUse[]; providers: { id: string; name: string }[] | undefined; totalCost: number }) {
	const { t } = useI18n();
	if (rows.length === 0) return <EmptyHint>{t("usage.noModelUsage")}</EmptyHint>;
	return <BreakdownTable rows={rows.slice(0, 12).map((row) => ({ key: row.key, label: row.model, provider: providerLabel(providers, row.provider), cost: row.cost, tokens: row.tokens, unpriced: row.unpricedTokens === row.tokens, share: totalCost > 0 ? row.cost / totalCost : row.share }))} remaining={Math.max(0, rows.length - 12)} />;
}

function DayBreakdown({ rows, totalCost }: { rows: UsageView["series"]; totalCost: number }) {
	const { t } = useI18n();
	const ranked = [...rows].filter((row) => row.tokens > 0).sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
	if (ranked.length === 0) return <EmptyHint>{t("usage.noDailyUsage")}</EmptyHint>;
	const totalTokens = viewTokens(ranked);
	return <BreakdownTable rows={ranked.slice(0, 12).map((row) => ({ key: row.day, label: fullDate(row.day), provider: "", cost: row.cost, tokens: row.tokens, unpriced: row.cost === 0 && row.tokens > 0, share: totalCost > 0 ? row.cost / totalCost : row.tokens / Math.max(1, totalTokens) }))} remaining={Math.max(0, ranked.length - 12)} />;
}

interface BreakdownRow { key: string; label: string; provider: string; cost: number; tokens: number; unpriced: boolean; share: number }

function BreakdownTable({ rows, remaining }: { rows: BreakdownRow[]; remaining: number }) {
	const { t } = useI18n();
	return <div className="px-4 pb-2"><div className="grid grid-cols-[minmax(0,1fr)_78px_78px] gap-4 border-b border-line-soft py-2 text-detail text-ink-faint @xl:grid-cols-[minmax(0,1fr)_100px_78px_62px_90px]"><span>{t("common.project")}</span><span className="hidden text-right @xl:block">{t("common.provider")}</span><span className="text-right">{t("common.cost")}</span><span className="hidden text-right @xl:block">{t("usage.share")}</span><span className="text-right">Token</span></div>{rows.map((row) => <div key={row.key} className="grid min-h-[38px] grid-cols-[minmax(0,1fr)_78px_78px] items-center gap-4 border-b border-line-soft text-label last:border-b-0 @xl:grid-cols-[minmax(0,1fr)_100px_78px_62px_90px]"><div className="min-w-0"><div className="truncate text-ink">{row.label}</div>{row.provider && <div className="truncate text-detail text-ink-faint @xl:hidden">{row.provider}</div>}</div><div className="hidden truncate text-right text-detail text-ink-faint @xl:block">{row.provider}</div><div className="text-right text-ink tabular-nums">{row.unpriced ? t("usage.unpriced") : costLabel(row.cost)}</div><div className="hidden text-right text-ink-muted tabular-nums @xl:block">{(row.share * 100).toFixed(1)}%</div><div className="text-right text-ink-muted tabular-nums">{formatCompact(row.tokens)}</div></div>)}{remaining > 0 && <div className="py-2 text-center text-detail text-ink-faint">另有 {remaining} 项</div>}</div>;
}

function QualityBar({ totals }: { totals: UsageView["totals"] }) {
	const parts = [totals.quality.provider, totals.quality.catalog, totals.quality.manual, totals.quality.recorded, totals.quality.unpriced];
	return <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-ink/[0.06]">{parts.map((value, index) => value > 0 ? <span key={index} style={{ width: `${(value / Math.max(1, totals.tokens)) * 100}%`, background: index === 4 ? "var(--color-line)" : trendColor(index) }} /> : null)}</div>;
}

function QualityRow({ label, value }: { label: string; value: string }) {
	return <div className="flex items-center justify-between gap-3 py-2 text-label"><span className="text-ink-muted">{label}</span><span className="shrink-0 text-ink tabular-nums">{value}</span></div>;
}

function UsageSkeleton({ failed }: { failed: boolean }) {
	const { t } = useI18n();
	if (failed) return <Card><EmptyHint>{t("usage.readFailed")}</EmptyHint></Card>;
	return <div aria-busy="true" aria-live="polite"><span className="sr-only">{t("usage.reading")}</span><div className="grid gap-3 @3xl:grid-cols-2"><Card className="p-4"><SkeletonBar width="36%" height={10} /><SkeletonBar width="52%" height={30} className="mt-3" />{[76, 58, 42].map((width) => <SkeletonBar key={width} width={`${width}%`} height={12} className="mt-4" />)}</Card><Card className="p-4"><SkeletonBar width="24%" height={12} /><div className="mt-5 flex h-[170px] items-end gap-2">{[24, 38, 30, 62, 44, 78, 55, 70, 48, 66, 36, 58].map((height, index) => <span key={index} className="ly-skeleton flex-1 rounded-t" style={{ height: `${height}%` }} />)}</div></Card></div></div>;
}

function Heatmap({ grid, busiest }: { grid: DayUsage[][]; busiest: number }) {
	const { t } = useI18n();
	const labels = monthLabels(grid);
	return <div className="flex w-full overflow-x-auto [justify-content:safe_center]" dir="rtl"><div dir="ltr" className="inline-block py-1"><div className="relative mb-1 h-[14px]">{labels.map((label) => <span key={label.column} className="absolute top-0 text-detail text-ink-faint" style={{ left: label.column * 14 }}>{label.text}</span>)}</div><div className="flex gap-[3px]">{grid.map((week) => <div key={week[0]?.key} className="flex flex-col gap-[3px]">{week.map((day) => { const future = day.date.getTime() > Date.now(); return <span key={day.key} data-ly-tip={future ? undefined : heatTip(day)} data-ly-tip-side="top" className={`h-[11px] w-[11px] rounded-[3px] transition-colors duration-[var(--ly-t-quick)] ${future ? "opacity-40" : ""} ${SHADES[heatLevel(day.tokens, busiest)]}`} />; })}</div>)}</div><div className="mt-2.5 flex items-center justify-end gap-1 text-detail text-ink-faint"><span className="mr-1">{t("usage.less")}</span>{SHADES.map((shade, index) => <span key={shade} className={`h-[11px] w-[11px] rounded-[3px] ${shade}`} aria-label={t("usage.bucket", { index })} />)}<span className="ml-1">{t("usage.more")}</span></div></div></div>;
}

const SHADES = ["bg-ink/[0.06]", "bg-info/25", "bg-info/45", "bg-info/70", "bg-info"] as const;

function heatTip(day: DayUsage): string {
	const date = translate("usage.monthDay", { month: day.date.getMonth() + 1, day: day.date.getDate() });
	if (day.messages === 0) return translate("usage.dayIdle", { date });
	return translate("usage.dayUsed", {
		date,
		sessions: day.sessions,
		tokens: day.tokens.toLocaleString(),
		cost: day.cost > 0 ? ` · ${costLabel(day.cost)}` : "",
	});
}

function costLabel(value: number): string { return formatCost(value) ?? "$0.00"; }
function signedCost(value: number): string { return `${value < 0 ? "−" : ""}${costLabel(Math.abs(value))}`; }
function percent(value: number, total: number): string { return `${(total > 0 ? (value / total) * 100 : 0).toFixed(1)}%`; }
function viewTokens(rows: { tokens: number }[]): number { return rows.reduce((sum, row) => sum + row.tokens, 0); }
function fullDate(day: string): string { const [year, month, date] = day.split("-"); return `${year}/${Number(month)}/${Number(date)}`; }
function rangeLabel(series: { day: string }[]): string { return series.length > 0 ? translate("usage.range", { from: fullDate(series[0].day), to: fullDate(series[series.length - 1].day) }) : translate("usage.noRange"); }
