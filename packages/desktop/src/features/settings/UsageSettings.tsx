import { MODEL_CATALOG_SOURCE } from "@lyra/core/model-catalog";
import { Boxes, CalendarDays, ChartLine, Layers, RefreshCw } from "lucide-react";
import { ActionSpinner } from "../../ui/motion/loaders.tsx";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { UsageScan } from "../../../electron/usage-scan.ts";
import { bridge } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";
import { CountUp } from "../../ui/primitives/CountUp.tsx";
import { SkeletonBar, useSlowLoad } from "../../ui/primitives/Skeleton.tsx";
import { DURATION } from "../../ui/motion/tokens.ts";
import { ModelIcon } from "../models/index.ts";
import { Card, EmptyHint, Segmented, TextInput } from "./controls.tsx";
import { dayTotals, providerIdentity, providerLabel, summarise, type ModelUse, type ProviderIdentity, type ProviderNaming, type Range } from "./usage-aggregate.ts";
import { heatLevel, heatmapWeeks, monthLabels, type DayUsage } from "./usage-heatmap.ts";
import { trendColor, UsageTrendChart, type TrendMetric } from "./usage-charts.tsx";
import { formatCompact, formatCost } from "./usage-format.ts";
import { translate, useI18n } from "../../i18n/index.ts";

const WEEKS = 52;

/**
 * 这一页上每一个会跟着区间变的数字。
 *
 * 一个包装而不是在十来处各写一遍 `<CountUp bidirectional ms={…} />`：它们说的是同一件事——按下
 * 「30 天」之后，这一屏的所有读数都是同一批账重新算出来的——所以它们该一起出发、一起停。参数
 * 散在各处，第一次有人调其中一个，这一屏就会变成一堆各走各的数字。
 *
 * `slow` 而不是 `useCountUp` 自己那 520ms：那个默认值是给对话里边跑边涨的 token 数用的，那种
 * 数字没有终点；这里有，按一下就该落定。
 */
function Figure({ value, format }: { value: number; format: (shown: number) => string }) {
	return <CountUp value={value} format={format} bidirectional ms={DURATION.slow} />;
}

export function UsageSettings() {
	const { t } = useI18n();
	const settings = useApp((state) => state.settings);
	const saveSettings = useApp((state) => state.saveSettings);
	/*
	 * 两个来源，因为这一页问的是「这笔账是谁花的」，而不是「现在配着谁」。
	 *
	 * 账按 `providerId` 记，名字只活在 `providers` 里——一个供应商删掉，它花过的钱照样在日志里，
	 * 页面上却只剩一串 id。`providerNames` 是那份不会随删除消失的档案，见 core 里那条注释。
	 */
	const naming = useMemo<ProviderNaming>(
		() => ({ providers: settings?.providers, names: settings?.providerNames }),
		[settings?.providers, settings?.providerNames],
	);
	/** 给一个认不出的供应商起名字：只动档案那一张表，配置里的供应商一个字都不碰。 */
	const nameProvider = useCallback(
		async (id: string, name: string) => {
			if (!settings) return;
			const named = name.trim();
			const names = { ...settings.providerNames };
			// 清空就是收回这个名字，而不是记一行叫「」——下次它会退回显示 id。
			if (named) names[id] = named;
			else delete names[id];
			await saveSettings({ ...settings, providerNames: names });
		},
		[settings, saveSettings],
	);
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
						{refreshing ? <ActionSpinner size={14} /> : <RefreshCw size={14} strokeWidth={1.8} />}
					</button>
				</div>
			</header>

			{view ? (
				<Dashboard view={view} naming={naming} onNameProvider={nameProvider} metric={metric} setMetric={setMetric} hidden={hidden} onToggleProvider={toggleProvider} breakdown={breakdown} setBreakdown={setBreakdown} grid={grid} busiestDay={busiestDay} />
			) : slow || failed ? (
				<UsageSkeleton failed={failed} />
			) : null}
		</div>
	);
}

type UsageView = ReturnType<typeof summarise>;

function Dashboard({
	view,
	naming,
	onNameProvider,
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
	naming: ProviderNaming;
	onNameProvider: (id: string, name: string) => void | Promise<void>;
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
			{/*
			 * 这一行整句换掉，所以是淡进来的。
			 *
			 * 「2026/9/3 至 2026/9/9」和「6 个活跃日」都是句子，句子里的数字没法一位一位地走——能做的
			 * 是让新的一行淡进来，好过在原地被替换掉。`key` 挂在区间上，换区间才重播。
			 */}
			<div key={view.series.length} className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-detail text-ink-faint animate-[ly-fade-up_var(--ly-t-base)_ease-out] motion-reduce:animate-none">
				<span>{dateRange}</span>
				<span>{t("usage.activeDays", { n: totals.activeDays })}</span>
				<span>{t("usage.sessionDays", { n: totals.sessionDays })}</span>
				<span>{t("usage.messages", { n: totals.messages.toLocaleString() })}</span>
			</div>

			<div className="grid gap-3 @3xl:grid-cols-[minmax(245px,0.78fr)_minmax(0,1.45fr)]">
				<Card className="p-4">
					<div className="text-detail font-medium tracking-wide text-ink-faint">{t("usage.estimatedCost")}</div>
					{/*
					 * 换区间时这个数走过去，不是被换掉。
					 *
					 * 7 天和 30 天是同一笔账的两种问法，中间没有任何事情真的发生——一个数字直接跳成
					 * 另一个，读的人得先愣一下才知道自己刚才按了什么。走过去的那半秒本身就说明了
					 * 「这是同一个数，只是问的时段变了」。往下走也一样：区间从大改小，钱本来就该变少。
					 */}
					<div className="mt-1 text-[32px] leading-tight font-semibold tracking-[-0.03em] text-ink tabular-nums">
						{/*
						 * 一分钱没花和「算不出多少钱」是两回事。
						 *
						 * 「暂无价格」说的是后者：有用量，但这些模型查不到价。一条记录都没有的时候它
						 * 是错的——那时答案很确定，就是 $0.00。空着的那一屏顶上挂一个 32px 的「暂无
						 * 价格」，读起来像出了什么问题。
						 */}
						{totals.tokens === 0 ? costLabel(0) : pricedTokens > 0 ? <Figure value={totals.cost} format={costLabel} /> : t("usage.noPrice")}
					</div>
					{/* 空着的时候不解释。这句话说的是「这些数字是怎么算出来的」，而此刻一个数字都没有。 */}
						{totals.tokens > 0 && <div className="mt-1 text-detail text-ink-faint">{t("usage.estimatedCostDetail")}</div>}
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
							<ProviderSpend key={provider.id} identity={providerIdentity(naming, provider.id)} provider={provider} color={trendColor(index)} onName={onNameProvider} />
						))}
						{view.providers.length === 0 && <EmptyHint icon={Boxes}>{t("usage.noUsage")}</EmptyHint>}
						{/*
						 * 第四个往后的那些，合成一行。
						 *
						 * 这张榜按费用排，所以一个**没有价格**的供应商永远垫底——哪怕它烧掉几百万 token。
						 * 本机上就有这么一个：2.2M token、目录里查不到价、于是 $0.00 排在最后一位，在只显示
						 * 前三名的卡片上等于不存在。用户的说法是「用得少的那个一点用量都不显示」，而它其实
						 * 用得不少。
						 *
						 * 卡片高度的账还是要算（上面那条注释），所以不是把榜放开，而是让被截掉的那几个至少
						 * 留下一行：几个、花了多少、多少 token。
						 */}
						{view.providers.length > 3 && <ProviderRest rows={view.providers.slice(3)} />}
					</div>
				</Card>

				{/* A column, so the chart can have whatever height the spend list beside it leaves over. */}
				<Card className="flex flex-col">
					<div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3.5">
						<div>
							<div className="text-label font-medium text-ink">{t("usage.dailyTrend")}</div>
							{totals.tokens > 0 && <div className="mt-0.5 text-detail text-ink-faint">{t("usage.dailyTrendDetail")}</div>}
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
									{providerLabel(naming, provider.id)}
								</button>
							);
						})}
					</div>
					{totals.tokens > 0 ? (
						<UsageTrendChart trends={view.providerTrends} metric={metric} labelOf={(id) => providerLabel(naming, id)} hidden={hidden} />
					) : (
						<EmptyHint icon={ChartLine}>{t("usage.noTrend")}</EmptyHint>
					)}
				</Card>
			</div>

			<div aria-label={t("usage.metrics")} className="mt-3 grid grid-cols-2 overflow-hidden rounded-[12px] border border-line bg-card/40 @2xl:grid-cols-5">
				<Metric label={t("usage.tokensProcessed")} value={totals.tokens} format={formatCompact} sub={t("usage.perActiveDay", { n: formatCompact(totals.activeDays > 0 ? totals.tokens / totals.activeDays : 0) })} />
				<Metric label={t("usage.cacheHit")} value={totals.cacheRead} format={formatCompact} sub={t("usage.ofInput", { percent: percent(totals.cacheRead, totals.input + totals.cacheRead + totals.cacheWrite) })} />
				<Metric label={t("usage.uncachedInput")} value={totals.input} format={formatCompact} sub={t("usage.cacheWrites", { n: formatCompact(totals.cacheWrite) })} />
				<Metric label={t("common.output")} value={totals.output} format={formatCompact} sub={t("usage.withReasoning", { n: formatCompact(totals.reasoning) })} />
				<Metric label={t("usage.cacheSaving")} value={totals.cacheSavings} format={signedCost} sub={t("usage.withoutCache", { cost: costLabel(totals.rawCost) })} />
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
					{/*
					 * 换口径是换一整张表，所以让它淡进来。
					 *
					 * 「模型」和「日期」下面的行没有一条对得上——按模型是 12 个模型，按日期是 12 天——
					 * 所以这里没有「这一行走到那一行」可言，逐行补间只会得到一串没有意义的中间态。整块
					 * 淡入是这种换法唯一诚实的过渡：旧的那张读完了，新的这张开始。
					 */}
					<div key={`${breakdown}:${view.series.length}`} className="min-h-0 flex-1 overflow-y-auto animate-[ly-fade-up_var(--ly-t-base)_ease-out] motion-reduce:animate-none">
						{breakdown === "model" ? <ModelBreakdown rows={view.models} naming={naming} totalCost={totals.cost} /> : <DayBreakdown rows={view.series} totalCost={totals.cost} />}
					</div>
				</Card>

				<Card className="p-4" data-usage-quality="true">
					<div className="text-label font-medium text-ink">{t("usage.priceQuality")}</div>
					<div className="mt-1 text-detail leading-relaxed text-ink-faint">{t("usage.priceQualityDetail")}</div>
					<QualityBar totals={totals} />
					<div className="mt-3 divide-y divide-line-soft">
						<QualityRow label={t("usage.fromProvider")} value={share(totals.quality.provider, totals.tokens)} format={percentLabel} />
						<QualityRow label={t("usage.offlineCatalog")} value={share(totals.quality.catalog, totals.tokens)} format={percentLabel} />
						<QualityRow label={t("usage.manualPrice")} value={share(totals.quality.manual, totals.tokens)} format={percentLabel} />
						<QualityRow label={t("usage.recorded")} value={share(totals.quality.recorded, totals.tokens)} format={percentLabel} />
						<QualityRow label={t("usage.unpriced")} value={share(totals.quality.unpriced, totals.tokens)} format={percentLabel} />
						<QualityRow label={t("usage.cacheSaving")} value={totals.cacheSavings} format={signedCost} />
					</div>
					<div className="mt-3 text-detail leading-relaxed text-ink-faint">
						{t("usage.catalogVersion")} {MODEL_CATALOG_SOURCE.commit.slice(0, 8)} · {new Date(MODEL_CATALOG_SOURCE.updatedAt).toLocaleDateString()}
					</div>
				</Card>
			</div>

			{/*
			 * 清理会话记录不在这一页，在「存储」。
			 *
			 * 它一度排在这里的最后一格：这一页是拿来读的，而删除是读完之后偶尔做一次的事。但位置
			 * 再靠后也改变不了它是一个不可撤销的动作，跟在一屏读数后面等于让每次查账都从「别点错」
			 * 开始。它问的本来也是另一个问题——这台机器上存着什么、还要留多久。
			 */}
			<div className="pt-6 pb-4">
				<div className="mb-3 text-title font-medium text-ink">{t("usage.rhythm")}</div>
				<Card>{busiestDay === 0 ? <EmptyHint icon={CalendarDays}>{t("usage.noRecords")}</EmptyHint> : <div className="px-4 py-4"><Heatmap grid={grid} busiest={busiestDay} /></div>}</Card>
			</div>
		</div>
	);
}

function ProviderSpend({
	identity,
	provider,
	color,
	onName,
}: {
	identity: ProviderIdentity;
	provider: UsageView["providers"][number];
	color: string;
	onName: (id: string, name: string) => void | Promise<void>;
}) {
	const { t } = useI18n();
	return (
		<div data-usage-spend={provider.id}>
			<div className="flex items-center gap-2 text-label">
				<ModelIcon model={provider.id} name={identity.label} size={14} />
				<ProviderName identity={identity} id={provider.id} onName={onName} />
				<span className="shrink-0 font-medium text-ink tabular-nums">
					{provider.unpricedTokens === provider.tokens ? t("usage.unpriced") : <Figure value={provider.cost} format={costLabel} />}
				</span>
			</div>
			{/* 占比条跟着数字一起变宽变窄，用的是同一段时长——两个说同一件事的东西不该分头到达。 */}
			<div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink/[0.06]">
				<div
					className="h-full rounded-full transition-[width] duration-[var(--ly-t-slow)] ease-[var(--ly-e-out)] motion-reduce:transition-none"
					style={{ width: `${Math.max(provider.share * 100, 1)}%`, background: color }}
				/>
			</div>
			<div className="mt-1 text-detail text-ink-faint tabular-nums">
				<Figure value={provider.share * 100} format={(shown) => shown.toFixed(1)} />% ·{" "}
				<Figure value={provider.tokens} format={formatCompact} /> token
			</div>
		</div>
	);
}

/**
 * 一个供应商的名字，以及删掉之后还能把它认回来的那个入口。
 *
 * 还配着的供应商这里就是一行字——名字归设置页管，在用量页上改它只会让两处说法不一。
 *
 * 删掉的不一样：它的账还在这一页上，而名字已经没人知道了。2026-09 之前删掉的那些连档案都没有，
 * 页面上只剩 `mttnetnn` 这样一串——「这些不知道是啥」。这时唯一还认得它的是用户自己，所以名字
 * 变成一个可以点的东西：点开就地改，写进那份不随删除消失的档案。
 *
 * 回车保存，Esc 放弃，失焦也保存——一个只能用键盘确认的内联输入，点到别处就丢掉刚打的字。
 */
function ProviderName({
	identity,
	id,
	onName,
}: {
	identity: ProviderIdentity;
	id: string;
	onName: (id: string, name: string) => void | Promise<void>;
}) {
	const { t } = useI18n();
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState("");

	if (identity.configured) return <span data-ly-tip={identity.label} data-ly-tip-when="truncated" className="min-w-0 flex-1 truncate text-ink">{identity.label}</span>;

	if (editing) {
		const commit = () => {
			setEditing(false);
			if (draft.trim() !== (identity.named ? identity.label : "")) void onName(id, draft);
		};
		return (
			<TextInput
				value={draft}
				onChange={setDraft}
				autoFocus
				aria-label={t("usage.nameProvider")}
				placeholder={t("usage.providerNameHint")}
				className="ly-field-compact w-full min-w-0 flex-1"
				onBlur={commit}
				onKeyDown={(event) => {
					if (event.key === "Enter") commit();
					if (event.key === "Escape") setEditing(false);
				}}
			/>
		);
	}

	/*
	 * 认领过的名字，和还配着的供应商长得一模一样——**不标「已删除」**。
	 *
	 * 那个标记说的是「这个供应商不在设置里了」，而看这一页的人不关心这件事：账是历史，「供应商A
	 * 花了两百块」在它被删掉之后仍然是同一句话。标出来只是替一个内部状态占掉一行字的位置。
	 *
	 * 没认领的那些（只剩一串 id）淡一档。区别不在于它被删没删，而在于**这还不是一个名字**——
	 * 一串 `mttnetnn` 用正文色印出来，读的人会以为那就是它的名字，于是不会想到它可以改。
	 */
	return (
		<button
			type="button"
			data-usage-provider={id}
			data-ly-tip={t("usage.nameProvider")}
			onClick={() => {
				setDraft(identity.named ? identity.label : "");
				setEditing(true);
			}}
			className="flex min-w-0 flex-1 items-center rounded-md text-left transition-colors hover:text-accent"
		>
			<span className={`min-w-0 truncate ${identity.named ? "text-ink" : "text-ink-muted"}`}>{identity.label}</span>
		</button>
	);
}

/**
 * 榜单截断处剩下的那些，合成一行。
 *
 * 不是「还有 N 个」这么一句——那只说明有东西被藏起来了，没说明藏起来的是什么。花了多少、多少
 * token 才是看这张卡片的人要判断的：一行 $0.00 配着 2.2M token，一眼就知道那是个没配上价格的
 * 供应商，而不是一个没在用的。
 */
function ProviderRest({ rows }: { rows: UsageView["providers"] }) {
	const { t } = useI18n();
	const cost = rows.reduce((sum, each) => sum + each.cost, 0);
	const tokens = rows.reduce((sum, each) => sum + each.tokens, 0);
	const unpriced = rows.every((each) => each.unpricedTokens === each.tokens);
	return (
		<div data-usage-rest="true" className="flex items-center gap-2 border-t border-line-soft pt-2.5 text-detail text-ink-faint">
			<span className="min-w-0 flex-1 truncate">{t("usage.otherProviders", { n: rows.length })}</span>
			<span className="shrink-0 tabular-nums">{unpriced ? t("usage.unpriced") : costLabel(cost)}</span>
			<span className="shrink-0 tabular-nums">{formatCompact(tokens)} token</span>
		</div>
	);
}

function Metric({ label, value, format, sub }: { label: string; value: number; format: (shown: number) => string; sub: React.ReactNode }) {
	return <div className="min-w-0 border-b border-line-soft px-3.5 py-3 odd:border-r even:border-r-0 last:col-span-2 last:border-b-0 @2xl:border-b-0 @2xl:odd:border-r @2xl:even:border-r @2xl:last:col-span-1 @2xl:last:border-r-0"><div className="truncate text-detail text-ink-muted">{label}</div><div className="mt-1 text-title font-medium text-ink tabular-nums"><Figure value={value} format={format} /></div><div className="mt-0.5 truncate text-detail text-ink-faint tabular-nums">{sub}</div></div>;
}

function ModelBreakdown({ rows, naming, totalCost }: { rows: ModelUse[]; naming: ProviderNaming; totalCost: number }) {
	const { t } = useI18n();
	if (rows.length === 0) return <EmptyHint icon={Layers}>{t("usage.noModelUsage")}</EmptyHint>;
	return <BreakdownTable rows={rows.slice(0, 12).map((row) => ({ key: row.key, label: row.model, model: row.model, provider: providerLabel(naming, row.provider), cost: row.cost, tokens: row.tokens, unpriced: row.unpricedTokens === row.tokens, share: totalCost > 0 ? row.cost / totalCost : row.share }))} remaining={Math.max(0, rows.length - 12)} />;
}

function DayBreakdown({ rows, totalCost }: { rows: UsageView["series"]; totalCost: number }) {
	const { t } = useI18n();
	const ranked = [...rows].filter((row) => row.tokens > 0).sort((a, b) => b.cost - a.cost || b.tokens - a.tokens);
	if (ranked.length === 0) return <EmptyHint icon={CalendarDays}>{t("usage.noDailyUsage")}</EmptyHint>;
	const totalTokens = viewTokens(ranked);
	return <BreakdownTable rows={ranked.slice(0, 12).map((row) => ({ key: row.day, label: fullDate(row.day), provider: "", cost: row.cost, tokens: row.tokens, unpriced: row.cost === 0 && row.tokens > 0, share: totalCost > 0 ? row.cost / totalCost : row.tokens / Math.max(1, totalTokens) }))} remaining={Math.max(0, ranked.length - 12)} />;
}

/** `model` 有值才画厂牌：按日期拆的那张表，每一行是一个日期，日期没有厂牌。 */
interface BreakdownRow { key: string; label: string; model?: string; provider: string; cost: number; tokens: number; unpriced: boolean; share: number }

function BreakdownTable({ rows, remaining }: { rows: BreakdownRow[]; remaining: number }) {
	const { t } = useI18n();
	return <div className="px-4 pb-2"><div className="grid grid-cols-[minmax(0,1fr)_78px_78px] gap-4 border-b border-line-soft py-2 text-detail text-ink-faint @xl:grid-cols-[minmax(0,1fr)_100px_78px_62px_90px]"><span>{t("common.project")}</span><span className="hidden text-right @xl:block">{t("common.provider")}</span><span className="text-right">{t("common.cost")}</span><span className="hidden text-right @xl:block">{t("usage.share")}</span><span className="text-right">Token</span></div>{rows.map((row) => <div key={row.key} className="grid min-h-[38px] grid-cols-[minmax(0,1fr)_78px_78px] items-center gap-4 border-b border-line-soft text-label last:border-b-0 @xl:grid-cols-[minmax(0,1fr)_100px_78px_62px_90px]">{/*
		 * 厂牌在名字左边，和模型菜单、供应商花费那几处是同一个记号。
		 *
		 * 这一列本来是纯文字：`gemini-3.8-flash…`、`deepseek-flash`、`claude-opus-4-6-thinking`，
		 * 一列长得几乎一样的字符串，而且列窄到要截断——读它等于逐行读完。别处的模型名旁边一直有
		 * 厂牌，唯独这张表没有，于是同一个模型在两个地方长得不一样。
		 */}<div className="flex min-w-0 items-center gap-2">{row.model !== undefined && <ModelIcon model={row.model} size={13} />}<div className="min-w-0"><div data-ly-tip={row.label} data-ly-tip-when="truncated" className="truncate text-ink">{row.label}</div>{row.provider && <div data-ly-tip={row.provider} data-ly-tip-when="truncated" className="truncate text-detail text-ink-faint @xl:hidden">{row.provider}</div>}</div></div><div data-ly-tip={row.provider} data-ly-tip-when="truncated" className="hidden truncate text-right text-detail text-ink-faint @xl:block">{row.provider}</div><div className="text-right text-ink tabular-nums">{row.unpriced ? t("usage.unpriced") : costLabel(row.cost)}</div><div className="hidden text-right text-ink-muted tabular-nums @xl:block">{(row.share * 100).toFixed(1)}%</div><div className="text-right text-ink-muted tabular-nums">{formatCompact(row.tokens)}</div></div>)}{remaining > 0 && <div className="py-2 text-center text-detail text-ink-faint">{t("usage.andMore", { n: remaining })}</div>}</div>;
}

/*
 * 每一段都在，宽度为零的也在。
 *
 * 之前是 `value > 0` 才画：一段从有到无就是整个 `<span>` 被摘掉，剩下的几段瞬间重排，没有中间态
 * 可言。让它们一直在那儿、只让宽度过渡，换区间时这条带子是自己重新分配的，而不是被换了一条。
 */
function QualityBar({ totals }: { totals: UsageView["totals"] }) {
	const parts = [totals.quality.provider, totals.quality.catalog, totals.quality.manual, totals.quality.recorded, totals.quality.unpriced];
	return <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-ink/[0.06]">{parts.map((value, index) => <span key={index} className="transition-[width] duration-[var(--ly-t-slow)] ease-[var(--ly-e-out)] motion-reduce:transition-none" style={{ width: `${(value / Math.max(1, totals.tokens)) * 100}%`, background: index === 4 ? "var(--color-line)" : trendColor(index) }} />)}</div>;
}

function QualityRow({ label, value, format }: { label: string; value: number; format: (shown: number) => string }) {
	return <div className="flex items-center justify-between gap-3 py-2 text-label"><span className="text-ink-muted">{label}</span><span className="shrink-0 text-ink tabular-nums"><Figure value={value} format={format} /></span></div>;
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
/** 百分比拆成「算出这个数」和「把它写出来」两步，动画要插值的是前者。 */
function share(value: number, total: number): number { return total > 0 ? (value / total) * 100 : 0; }
function percentLabel(value: number): string { return `${value.toFixed(1)}%`; }
function percent(value: number, total: number): string { return percentLabel(share(value, total)); }
function viewTokens(rows: { tokens: number }[]): number { return rows.reduce((sum, row) => sum + row.tokens, 0); }
function fullDate(day: string): string { const [year, month, date] = day.split("-"); return `${year}/${Number(month)}/${Number(date)}`; }
function rangeLabel(series: { day: string }[]): string { return series.length > 0 ? translate("usage.range", { from: fullDate(series[0].day), to: fullDate(series[series.length - 1].day) }) : translate("usage.noRange"); }
