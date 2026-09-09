import { useI18n } from "../../i18n/index.ts";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { portal } from "../../ui/overlay/portal.ts";
import { DURATION } from "../../ui/motion/tokens.ts";
import { motionReduced } from "../../ui/motion/reduced.ts";
import { useCountUp } from "../../ui/primitives/useCountUp.ts";
import type { ProviderTrend } from "./usage-aggregate.ts";
import { curveArea, curvePath } from "./usage-chart-curve.ts";
import {
	CHART,
	chartTipPlacement,
	hoverIndexAt,
	metricLabel,
	plotHeightFor,
	pointAtX,
	pointAtY,
	tipContentAt,
	trendColor,
	viewHeightFor,
	type TipContent,
	type TrendMetric,
} from "./usage-chart-hover.ts";
import { formatCompact, formatCost } from "./usage-format.ts";

export { trendColor, type TrendMetric };

/** 一个共用的空集合，好过每次渲染新建一个——它只被读。 */
const NONE_HIDDEN: ReadonlySet<string> = new Set();

/**
 * 一条线按比例拉到另一个点数，好让两条长度不同的线还能逐点相减。
 *
 * 换区间是这张图上唯一会改变点数的操作：7 天的 7 个点和 30 天的 30 个点之间，没有哪一天对着哪
 * 一天。但它们描的是同一条曲线的两段——按位置比例取样，第 30 天还是落在末端，中间那些点落在旧
 * 曲线上对应比例的位置，于是「7 天铺开成 30 天」看起来是这条线自己在展开。
 *
 * 线性取样而不是取最近的那个点：取最近的会在展开时留下一级一级的台阶，而台阶是假的——原始数据
 * 里并没有那样的平台。
 */
function resample(values: number[], length: number, fallback: number): number[] {
	if (values.length === length) return values;
	if (length <= 0) return [];
	if (values.length === 0) return Array.from({ length }, () => fallback);
	if (values.length === 1 || length === 1) {
		const only = values[values.length - 1]!;
		return Array.from({ length }, () => only);
	}
	return Array.from({ length }, (_, index) => {
		const at = (index / (length - 1)) * (values.length - 1);
		const low = Math.floor(at);
		const high = Math.min(values.length - 1, low + 1);
		return values[low]! + (values[high]! - values[low]!) * (at - low);
	});
}

/**
 * 曲线从上一组坐标走到这一组，而不是直接换掉。
 *
 * 费用和 token 是同一批日子的两种读法，中间没有任何东西真的发生了变化——所以那一下不该是一张
 * 图被另一张顶掉，而该是同一条线改了形状。关掉一个供应商同理：纵轴重新分配，留下的曲线长高，
 * 长高的过程本身就是「刚才那条线占掉了这么多」的解释。换区间也算在内，只是要先把旧的那条按比例
 * 拉到新的点数上——见 `resample`。
 *
 * 每帧重算路径而不是让 CSS 去补 `d`：`d` 的过渡要求两条路径的段数和指令完全对得上，而这里段数
 * 恰恰是会变的（换区间就变），一旦对不上浏览器直接跳变，于是动画只在「不需要它」的时候有。
 * 插值插在坐标这一层就没有这个问题，代价是每帧一次 `map`——一条 90 天的线是 90 个加法。
 *
 * 关掉动效时一步到位。这不是把时长改成 0：中间那些帧本身就是这里唯一做的事。
 */
/**
 * 画出来的那一组，先跟这一轮的点数对齐。
 *
 * 补间是在 effect 里跑的，而 effect 在这一帧画完之后才轮到——所以点数刚变的那一帧，手上还是上
 * 一组坐标。少掉的那些点会各自落到基线上，于是曲线在动画开始前先塌下去一帧。按比例拉开就没有
 * 这一下：这一帧画的就是「旧曲线铺到新宽度」，也正是补间该出发的地方。
 *
 * 点数没变时原样返回同一个数组，引用不变，后面的 `useMemo` 也就不必重算。
 */
function alignTo(drawn: number[][], target: number[][], baseline: number): number[][] {
	const aligned =
		drawn.length === target.length && target.every((series, index) => series.length === drawn[index]?.length);
	return aligned ? drawn : target.map((series, index) => resample(drawn[index] ?? [], series.length, baseline));
}

function useMorphedY(target: number[][], shape: string, baseline: number): number[][] {
	const [drawn, setDrawn] = useState(target);
	const current = useRef(target);
	const lastShape = useRef(shape);

	useEffect(() => {
		const sameShape = lastShape.current === shape;
		lastShape.current = shape;
		if (!sameShape || motionReduced()) {
			current.current = target;
			setDrawn(target);
			return;
		}
		/*
		 * 起点先跟终点对齐点数，只对齐一次。
		 *
		 * 放在循环外面：动画期间点数不再变（变了就是新的一轮），而每帧重取样 90 个点是白做的功。
		 */
		const from = target.map((series, trendIndex) => resample(current.current[trendIndex] ?? [], series.length, baseline));
		const started = performance.now();
		let frame = 0;
		const step = (now: number) => {
			const t = Math.min(1, (now - started) / DURATION.base);
			// 与 --ly-e-out 同一个意思：末段减速，落位看起来是停稳而不是停住。
			const eased = 1 - (1 - t) ** 3;
			const next = target.map((series, trendIndex) =>
				series.map((to, dayIndex) => {
					const was = from[trendIndex]?.[dayIndex] ?? to;
					return was + (to - was) * eased;
				}),
			);
			current.current = next;
			setDrawn(next);
			if (t < 1) frame = requestAnimationFrame(step);
		};
		frame = requestAnimationFrame(step);
		return () => cancelAnimationFrame(frame);
	}, [target, shape, baseline]);

	return useMemo(() => alignTo(drawn, target, baseline), [drawn, target, baseline]);
}

/** 气泡里只留还开着的供应商，合计跟着重算。 */
function visibleReading(reading: TipContent, hidden: ReadonlySet<string>, metric: TrendMetric): TipContent {
	if (hidden.size === 0) return reading;
	const rows = reading.rows.filter((row) => !hidden.has(row.id));
	const sum = rows.reduce((total, row) => total + row.value, 0);
	return { ...reading, rows, total: rows.length > 1 ? metricLabel(sum, metric) : null };
}

interface Hover {
	index: number;
	/** The crosshair's position on screen, so the bubble sits beside the line rather than the pointer. */
	x: number;
	y: number;
	/** The chart's band on screen: the bubble follows the pointer inside it and no further. */
	plot: { top: number; bottom: number };
}

/**
 * The daily trend, and the reading of it.
 *
 * The chart used to answer only when the pointer landed on a data point — a five-pixel circle on a
 * line — which in practice meant it never answered, and the card's own subtitle promised something
 * that did not happen. It now behaves the way every chart people have used behaves: the whole plot
 * is live, the nearest day gets a crosshair, and one bubble states that day for every provider at
 * once rather than one provider at a time.
 *
 * The bubble is portalled to the body. It has to be: the card it lives in is `overflow-hidden`, so
 * anything positioned inside the chart is cut off at the card's edge — and the interesting days are
 * the recent ones, hard against that edge.
 */
export function UsageTrendChart({
	trends,
	metric,
	labelOf,
	hidden,
}: {
	trends: ProviderTrend[];
	metric: TrendMetric;
	labelOf?: (id: string) => string;
	/** 图例里被关掉的供应商：仍然在图上占着位置，只是淡出，并且不再决定纵轴。 */
	hidden?: ReadonlySet<string>;
}) {
	const { t } = useI18n();
	const svgRef = useRef<SVGSVGElement>(null);
	const [hover, setHover] = useState<Hover | null>(null);
	const [viewHeight, setViewHeight] = useState<number>(CHART.height);
	const plotHeight = plotHeightFor(viewHeight);
	const count = Math.max(0, ...trends.map((trend) => trend.points.length));
	const off = hidden ?? NONE_HIDDEN;
	/*
	 * 关掉的供应商不再撑着纵轴。
	 *
	 * 这正是关掉它的用处：一个花掉 27.8M 的供应商会把其余三个压成贴着底边的一条线，关掉它，剩下
	 * 的才有可读的刻度。所以纵轴跟着可见的那些重算——刻度变了，留下的曲线也就跟着长高，而那段
	 * 长高是动画，不是跳变。全部关掉时退回用全部，否则纵轴会塌到 1 而图上空无一物。
	 */
	const counted = trends.filter((trend) => !off.has(trend.id));
	const values = (counted.length ? counted : trends).flatMap((trend) => trend.points.map((point) => point[metric]));
	const maximum = Math.max(1, ...values);
	/*
	 * 刻度上的数跟着曲线一起走。
	 *
	 * 曲线的形变是在纵轴已经换了刻度的前提下画出来的——中间那些帧既不属于旧刻度也不属于新刻度。
	 * 让刻度自己也从旧的走到新的，这一段就重新自洽了：线在长高，旁边的数也在长。坐标本身仍然用
	 * 真实的 `maximum` 算，动的只是写在轴上的那几个字。
	 */
	const axisMax = useCountUp(maximum, DURATION.base, { bidirectional: true });
	const x = (index: number) => pointAtX(index, count);
	const ticks = [1, 0.75, 0.5, 0.25, 0];

	/*
	 * 每个供应商每一天的纵坐标——图上唯一会动的那组数，所以动画就动它。
	 *
	 * 从值算到坐标要经过 `maximum`，而费用和 token 的量级差着六七个数量级；在坐标这一层插值，
	 * 意味着两种口径之间那一下是曲线在形变，而不是一张图换成另一张图。
	 */
	const target = useMemo(
		() => trends.map((trend) => trend.points.map((point) => pointAtY(point[metric], maximum, plotHeight))),
		[trends, metric, maximum, plotHeight],
	);
	/*
	 * 形状对不上就没有中间态可言。
	 *
	 * 换项目是供应商换了一批——没有「这条线走到那条线」的对应关系。窗口改大小也在这里：拖动边框
	 * 时每一帧都是新的高度，跟着做 220ms 的补间，曲线会一路落在容器后面。这两种直接换。
	 *
	 * 点数不在里面，是后来撤掉的：换区间（7 天到 30 天）本来也算「形状变了」，于是这张图上最常
	 * 按的那个开关恰好是唯一没有过渡的那个——四个区间来回按，图每次都是硬生生换掉一张。同一批
	 * 供应商在同一个高度上，只是问的天数不同，那是同一条线铺得开一点，`resample` 就是干这个的。
	 */
	const shape = useMemo(
		() => `${trends.map((trend) => trend.id).join("|")}@${plotHeight}`,
		[trends, plotHeight],
	);
	const drawn = useMorphedY(target, shape, CHART.top + plotHeight);
	const y = (trendIndex: number, dayIndex: number) => drawn[trendIndex]?.[dayIndex] ?? CHART.top + plotHeight;

	// A day that no longer exists — the range changed under the pointer — must not draw a crosshair.
	const at = hover && hover.index < count ? hover : null;
	const reading = at ? tipContentAt(trends, at.index, metric, labelOf ?? ((id) => id)) : null;
	/*
	 * 读数里也不留关掉的那些。
	 *
	 * 关掉一个供应商却还在气泡里读到它，等于那一下什么也没发生；合计跟着重算，否则「合计」说的
	 * 是一个屏幕上并不存在的总数。只剩一行时不再显示合计——它和那一行是同一个数字。
	 */
	const content = reading ? visibleReading(reading, off, metric) : null;

	const track = (event: React.PointerEvent) => {
		const box = svgRef.current?.getBoundingClientRect();
		const index = box ? hoverIndexAt(event.clientX, box, count) : null;
		if (index === null || !box) {
			setHover(null);
			return;
		}
		const screenX = box.left + (pointAtX(index, count) / CHART.width) * box.width;
		setHover((previous) =>
			previous && previous.index === index && previous.x === screenX && previous.y === event.clientY
				? previous
				: { index, x: screenX, y: event.clientY, plot: { top: box.top, bottom: box.bottom } },
		);
	};

	/*
	 * The viewBox follows the element, and the element does not follow the viewBox — `w-full h-full`
	 * makes its size the card's business — so measuring here cannot feed itself a new size.
	 */
	useEffect(() => {
		const svg = svgRef.current;
		if (!svg || typeof ResizeObserver === "undefined") return;
		const measure = () => setViewHeight(viewHeightFor(svg.getBoundingClientRect()));
		const observer = new ResizeObserver(measure);
		observer.observe(svg);
		measure();
		return () => observer.disconnect();
	}, []);

	/*
	 * A scroll moves the chart and not the bubble, which is fixed to the window — so the reading
	 * would go on pointing at a day that has slid out from under it. Cheaper to drop it than to
	 * follow: the pointer is already somewhere else by then.
	 */
	const showing = at !== null;
	useEffect(() => {
		if (!showing) return;
		const clear = () => setHover(null);
		window.addEventListener("scroll", clear, true);
		window.addEventListener("blur", clear);
		return () => {
			window.removeEventListener("scroll", clear, true);
			window.removeEventListener("blur", clear);
		};
	}, [showing]);

	return (
		<div
			className="flex min-h-[188px] flex-1 flex-col px-3 pt-2 pb-2"
			data-usage-chart={metric}
			onPointerMove={track}
			onPointerDown={track}
			onPointerLeave={() => setHover(null)}
			onPointerCancel={() => setHover(null)}
			onPointerUp={(event) => {
				if (event.pointerType === "touch") setHover(null);
			}}
		>
			<svg
				ref={svgRef}
				viewBox={`0 0 ${CHART.width} ${viewHeight}`}
				preserveAspectRatio="none"
				className="block h-full w-full flex-1 overflow-visible"
				role="img"
				aria-label={t(metric === "cost" ? "usage.dailyCost" : "usage.dailyTokens")}
			>
				{ticks.map((share) => {
					const tick = CHART.top + (1 - share) * plotHeight;
					return (
						<g key={share}>
							<line x1={CHART.left} x2={CHART.width - CHART.right} y1={tick} y2={tick} stroke="var(--color-line)" strokeWidth="1" />
							<text x={CHART.left - 8} y={tick + 4} textAnchor="end" fill="var(--color-ink-faint)" fontSize="10" className="tabular-nums">
								{axisValue(axisMax * share, metric)}
							</text>
						</g>
					);
				})}

				{trends.map((trend, trendIndex) => {
					const points = trend.points.map((_, index) => ({ x: x(index), y: y(trendIndex, index) }));
					const color = trendColor(trendIndex);
					return (
						<g
							key={trend.id}
							data-usage-trend={trend.id}
							className="transition-opacity duration-[var(--ly-t-base)] ease-[var(--ly-e-out)]"
							opacity={off.has(trend.id) ? 0 : 1}
						>
							<path d={curveArea(points, CHART.top + plotHeight)} fill={color} opacity="0.055" />
							<path
								d={curvePath(points)}
								fill="none"
								stroke={color}
								strokeWidth="2"
								strokeLinecap="round"
								strokeLinejoin="round"
								vectorEffect="non-scaling-stroke"
							/>
						</g>
					);
				})}

				{at && (
					<g data-chart-cursor="" pointerEvents="none">
						<line
							x1={x(at.index)}
							x2={x(at.index)}
							y1={CHART.top}
							y2={CHART.top + plotHeight}
							stroke="var(--color-ink-faint)"
							strokeWidth="1"
							strokeDasharray="3 4"
							opacity="0.6"
						/>
						{trends.map((trend, trendIndex) => {
							const value = trend.points[at.index]?.[metric] ?? 0;
							// A zero sits on the baseline; drawing every idle provider there is a row of
							// stacked dots that says nothing the bubble does not already say. 关掉的同理:
							// 一个被关掉的供应商还在十字线上留着圆点，那一下就等于没关。
							return value > 0 && !off.has(trend.id) ? (
								<circle key={trend.id} cx={x(at.index)} cy={y(trendIndex, at.index)} r="3.5" fill={trendColor(trendIndex)} stroke="var(--color-shell)" strokeWidth="1.5" />
							) : null;
						})}
					</g>
				)}

				{count > 0 && (
					<>
						<text x={CHART.left} y={viewHeight - 6} fill="var(--color-ink-faint)" fontSize="10">{dateLabel(trends[0]?.points[0]?.day)}</text>
						<text x={CHART.width - CHART.right} y={viewHeight - 6} textAnchor="end" fill="var(--color-ink-faint)" fontSize="10">
							{dateLabel(trends[0]?.points[count - 1]?.day)}
						</text>
					</>
				)}
			</svg>

			{at && content && <TrendTip anchor={at} content={content} />}
		</div>
	);
}

/**
 * The bubble, measured and placed after it has been rendered.
 *
 * Its size depends on the provider names in it, so where it goes cannot be known before it exists.
 * It is therefore rendered hidden at the origin and moved in a layout effect — before the browser
 * paints, so nothing is ever seen in the corner — and the effect runs on every render rather than
 * on a dependency list, because the pointer moving is exactly when it needs to move.
 */
function TrendTip({ anchor, content }: { anchor: Hover; content: TipContent }) {
	const { t } = useI18n();
	const ref = useRef<HTMLDivElement>(null);

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const at = chartTipPlacement(anchor, { width: el.offsetWidth, height: el.offsetHeight }, { width: window.innerWidth, height: window.innerHeight }, anchor.plot);
		el.style.left = `${Math.round(at.left)}px`;
		el.style.top = `${Math.round(at.top)}px`;
		el.style.visibility = "visible";
	});

	return portal(
		<div
			ref={ref}
			role="tooltip"
			data-chart-tip=""
			className="ly-chart-tip ly-glass-solid pointer-events-none fixed z-[200] min-w-[148px] max-w-[280px] rounded-[10px] border border-line-soft px-2.5 py-2"
			style={{ left: 0, top: 0, visibility: "hidden" }}
		>
			<div className="text-detail font-medium text-ink tabular-nums">{content.title}</div>
			<div className="mt-1.5 space-y-1">
				{content.rows.map((row) => (
					<div key={row.id} className="flex items-center gap-2 text-detail">
						<span className="h-2 w-2 shrink-0 rounded-full" style={{ background: row.color }} />
						<span className="min-w-0 flex-1 truncate text-ink-muted">{row.label}</span>
						<span className="shrink-0 tabular-nums text-ink">{row.text}</span>
					</div>
				))}
			</div>
			{content.total && (
				<div className="mt-1.5 flex items-center gap-2 border-t border-line-soft pt-1.5 text-detail">
					<span className="flex-1 text-ink-faint">{t("usage.total")}</span>
					<span className="shrink-0 tabular-nums font-medium text-ink">{content.total}</span>
				</div>
			)}
		</div>,
	);
}

function axisValue(value: number, metric: TrendMetric): string {
	if (metric === "tokens") return formatCompact(value);
	if (value >= 1_000) return `$${formatCompact(value)}`;
	if (value >= 100) return `$${value.toFixed(0)}`;
	return formatCost(value) ?? "$0";
}

function dateLabel(day: string | undefined): string {
	if (!day) return "";
	const [, month, date] = day.split("-");
	return `${Number(month)}/${Number(date)}`;
}
