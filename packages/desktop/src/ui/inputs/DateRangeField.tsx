/**
 * 选一段日子。
 *
 * 一个字段加一张浮出来的月历，和这个应用里每个下拉用的是同一套东西：`ly-field` 的触发器、
 * `Popover` 的定位、翻转、层级和 120ms 的进出。自己写一张浮层意味着自己再答一遍「窗口底部放不下
 * 怎么办」「Escape 关不关」「关的时候要不要动画」——那三个问题这里已经有答案了。
 *
 * **没有一条分隔线。** 层次靠留白和字色分：快捷那一排是药丸，月历是网格，两者之间是 10px 的气。
 * 一张 240px 宽的卡片上画两条横线，得到的是三个盒子叠在一起，而不是一张卡片。
 *
 * 选中的那一段是**一条**，不是几个圆点：中间的日子铺一层淡底连起来，两端压在上面。这样「从哪天
 * 到哪天」是看出来的，不用去读两个日期再在脑子里减一下。
 */

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import { translate } from "../../i18n/translate.ts";
import { Popover, usePopover } from "../overlay/Popover.tsx";
import { addMonths, dayKey, isInterior, monthGrid, monthStart, parseDay, pickDay, type DayRange } from "./day-range.ts";

/**
 * 300 配上收紧的药丸，两个数一起量出来的。
 *
 * 那四个快捷项排成一行要 271px，而 300 宽的面板去掉 `Popover` 自己的 6px 留白和这里的内边距，
 * 只剩 270——**差一个像素**，于是「180 天前」掉到第二行，顶上变成三个加一个，读起来像分了组，
 * 而它们是并列的四个答案。
 *
 * 继续加宽是错的解法：日期是七等分的，多出来的宽度全花在格子之间的空当上，而下一种语言照样会
 * 把它吃掉。所以药丸的横向内边距从 8 收到 6（见下面的 `px-1.5`），四个省出 16px，留下 15px 余量。
 *
 * 真的排不下的语言（俄语那句「Старше 30 дней」）还是会换成两行，那时两行是对的。
 */
const PANEL_WIDTH = 300;
/** 周一起头。中文日历是这么排的，而一周从哪天开始是个地区习惯，不是算术。 */
const WEEK_START = 1;

function weekdayLabels(): string[] {
	const keys = ["week.mon", "week.tue", "week.wed", "week.thu", "week.fri", "week.sat", "week.sun"] as const;
	return keys.map((key) => translate(key));
}

/** `2026/9/21`，和明细表里那一列日期同一个写法。 */
function shortDate(day: string): string {
	const [year, month, date] = day.split("-");
	return `${year}/${Number(month)}/${Number(date)}`;
}

/** 字段上印的那一行：一段日子、一个开头、或者「全部时间」。 */
export function rangeLabel(range: DayRange): string {
	if (!range.from && !range.to) return translate("cleanup.allTime");
	if (range.from && range.to) {
		return range.from === range.to ? shortDate(range.from) : `${shortDate(range.from)} – ${shortDate(range.to)}`;
	}
	if (range.from) return translate("cleanup.since", { date: shortDate(range.from) });
	return translate("cleanup.until", { date: shortDate(range.to as string) });
}

interface Shortcut {
	label: string;
	range: DayRange;
}

/**
 * 常要的那几段，一次点到。
 *
 * 「全部」排第一，因为这个控件绝大多数时候是为它存在的——想清空的人不想先学会用一张日历。后面
 * 三个是「比这更早的」而不是「最近这些」：这一组的用处是清掉旧东西，而不是清掉刚干完的活。
 */
function shortcutsFor(today: Date, earliest: string | null): Shortcut[] {
	const before = (days: number): DayRange => {
		const edge = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days);
		return { from: earliest, to: dayKey(edge) };
	};
	return [
		{ label: translate("cleanup.allTime"), range: { from: null, to: null } },
		{ label: translate("cleanup.olderThan", { n: 30 }), range: before(30) },
		{ label: translate("cleanup.olderThan", { n: 90 }), range: before(90) },
		{ label: translate("cleanup.olderThan", { n: 180 }), range: before(180) },
	];
}

export function DateRangeField({
	value,
	onChange,
	earliest,
	today,
	ariaLabel,
}: {
	value: DayRange;
	onChange: (range: DayRange) => void;
	/** 最早有记录的那天。比它更早的日子画出来但点不动——那儿本来就没有东西可删。 */
	earliest?: string | null;
	/** 注入的「今天」，让测试不必等到明天才跑得一样。 */
	today?: Date;
	ariaLabel?: string;
}) {
	const menu = usePopover();
	/*
	 * 「今天」在这个组件活着的期间固定成一天。
	 *
	 * 每次渲染重新 `new Date()` 得到的是一个每帧都不同的对象：下面的 `useMemo` 全部失效，而且
	 * 一个跨零点还开着的面板会在某一帧悄悄换掉「最晚可选」那条线。
	 */
	const [mounted] = useState(() => new Date());
	const now = today ?? mounted;
	return (
		<>
			<button
				type="button"
				onClick={menu.toggle}
				aria-label={ariaLabel}
				aria-haspopup="dialog"
				aria-expanded={menu.open}
				data-ly-field=""
				data-ly-date-range=""
				/*
				 * 按内容撑开，只保一个下限。
				 *
				 * 钉死宽度试过，两头都不对：短了把日期截成「2026/8/2 – 2026/8…」——一个截断的日期
				 * 等于没写，而右边明明还空着一大片；长了又让「全部时间」四个字旁边拖一条空白。而且
				 * 每种语言、每个月份位数要的宽度都不一样，没有哪个数字是对的。
				 *
				 * 怕的那个「选一次日期整块就换个样子」不是宽度引起的，是从前那行 `flex-wrap` 整组换行
				 * ——那个已经由 `Row` 的两列排版解决了。这里撑开只让字段的左边缘往左挪一点，右边缘
				 * 贴着卡片不动，那一行别的东西一个都不会动。
				 *
				 * 下限 120，免得「全部时间」时字段缩成一颗药丸，和隔壁那行的控件对不齐。
				 */
				className="ly-field ly-field-compact min-w-[120px] justify-between gap-2"
			>
				<span className="min-w-0 truncate tabular-nums">{rangeLabel(value)}</span>
				<ChevronRight
					size={13}
					strokeWidth={1.9}
					className="shrink-0 text-ink-faint transition-transform duration-[var(--ly-t-quick)]"
					style={{ transform: menu.open ? "rotate(90deg)" : "rotate(0deg)" }}
				/>
			</button>

			{menu.open && (
				<Popover
					anchor={menu.anchor}
					onClose={menu.close}
					placement="bottom"
					align="start"
					width={PANEL_WIDTH}
					role="dialog"
					label={ariaLabel ?? translate("cleanup.pickRange")}
					bodyClassName="px-2 pt-2 pb-2.5"
				>
					<Calendar value={value} onChange={onChange} earliest={earliest ?? null} today={now} />
				</Popover>
			)}
		</>
	);
}

function Calendar({
	value,
	onChange,
	earliest,
	today,
}: {
	value: DayRange;
	onChange: (range: DayRange) => void;
	earliest: string | null;
	today: Date;
}) {
	const todayKey = dayKey(today);
	/** 开着的是哪个月。从已选的开头进，没选过就从这个月进。 */
	const [month, setMonth] = useState(() => monthStart(parseDay(value.from) ?? today));
	/*
	 * 鼠标底下那一天，只在选了开头、还没选结尾时有用。
	 *
	 * 它让「再点一下会选出多长一段」在点下去之前就看得见——这是一段日子和两个日期之间的全部
	 * 区别。没有它，第一次点完之后整张月历会僵在那里，只有一个孤零零的圆点。
	 */
	const [hovered, setHovered] = useState<string | null>(null);
	const grid = useMemo(() => monthGrid(month, WEEK_START), [month]);
	const weekdays = useMemo(() => weekdayLabels(), []);
	const shortcuts = useMemo(() => shortcutsFor(today, earliest), [today, earliest]);

	/** 正在比划的那一段：选了开头还没选结尾时，把鼠标那天当结尾预演一次。 */
	const preview: DayRange = value.from && !value.to && hovered
		? { from: value.from < hovered ? value.from : hovered, to: value.from < hovered ? hovered : value.from }
		: value;

	return (
		<div onMouseLeave={() => setHovered(null)}>
			{/* 快捷那一排。药丸，不是按钮——它们是几个现成的答案，不是四个并列的动作。 */}
			<div className="flex flex-wrap gap-1 px-0.5">
				{shortcuts.map((shortcut) => {
					const active = shortcut.range.from === value.from && shortcut.range.to === value.to;
					return (
						<button
							key={shortcut.label}
							type="button"
							data-ly-range-shortcut={shortcut.label}
							data-active={active || undefined}
							onClick={() => onChange(shortcut.range)}
							className={`rounded-full px-1.5 py-0.5 text-detail transition-colors duration-[var(--ly-t-quick)] ${
								active ? "bg-accent/12 text-accent" : "text-ink-muted hover:bg-card-hover hover:text-ink"
							}`}
						>
							{shortcut.label}
						</button>
					);
				})}
			</div>

			{/* 月份那一行。左右两个箭头贴着两端，月份居中——一张日历的导航该长这样。 */}
			<div className="mt-2.5 flex items-center justify-between px-0.5">
				<MonthStep direction={-1} onClick={() => setMonth(addMonths(month, -1))} />
				<span className="text-label font-medium text-ink tabular-nums">
					{translate("cleanup.yearMonth", { year: month.getFullYear(), month: month.getMonth() + 1 })}
				</span>
				{/* 到了这个月就不能再往后：以后的日子上没有会话。 */}
				<MonthStep direction={1} onClick={() => setMonth(addMonths(month, 1))} disabled={monthStart(today).getTime() <= month.getTime()} />
			</div>

			<div className="mt-1.5 grid grid-cols-7 gap-y-0.5">
				{weekdays.map((name) => (
					<span key={name} className="flex h-6 items-center justify-center text-detail text-ink-faint">
						{name}
					</span>
				))}
				{/*
				 * 每一格是「一层底 + 一个数字」两层。
				 *
				 * 中间那些日子的底铺满整格、左右不留缝，于是一行里它们连成一条；两端是一个实心圆，
				 * 压在这条上面。都用圆角就会得到一串珠子，中间断开的那些缝恰恰是「这是一段」里最该
				 * 连上的地方。
				 */}
				{grid.flat().map((date) => {
					const key = dayKey(date);
					const outside = date.getMonth() !== month.getMonth();
					const future = key > todayKey;
					const tooEarly = Boolean(earliest && key < earliest);
					const disabled = future || tooEarly;
					const start = key === preview.from;
					const end = key === preview.to;
					const edge = start || end;
					const interior = isInterior(key, preview);
					/*
					 * 端点朝向中间那半边也要铺底。
					 *
					 * 圆是 28px，格子宽将近 40——端点格子整格透明的话，圆和隔壁那条淡底之间会空出
					 * 五六个像素，一段连续的日子于是断在两头。铺的是**半边**：起点铺右半，终点铺左半，
					 * 圆外侧那几像素留白，因为那儿正是这一段结束的地方。
					 *
					 * 只选了一天时两头是同一格，没有中间，也就没有要连的东西。
					 */
					const single = preview.from !== null && preview.from === preview.to;
					const half = edge && !single ? (start ? "left-1/2 right-0" : "left-0 right-1/2") : null;
					return (
						<button
							key={key}
							type="button"
							disabled={disabled}
							data-ly-day={key}
							data-selected={edge || undefined}
							onMouseEnter={() => setHovered(key)}
							onClick={() => onChange(pickDay(value, key))}
							className={`relative flex h-7 items-center justify-center text-detail tabular-nums transition-colors duration-[var(--ly-t-quick)] disabled:cursor-default ${
								interior ? "bg-accent/10" : ""
							}`}
						>
							{half && <span data-ly-day-band="" className={`absolute inset-y-0 ${half} bg-accent/10`} />}
							{edge && <span className="absolute inset-y-0 left-1/2 w-7 -translate-x-1/2 rounded-full bg-accent" />}
							<span
								className={`relative ${
									edge
										? "font-medium text-white"
										: disabled
											? "text-ink-faint/45"
											: outside
												? "text-ink-faint"
												: key === todayKey
													? "font-medium text-accent"
													: "text-ink-muted"
								}`}
							>
								{date.getDate()}
							</span>
						</button>
					);
				})}
			</div>
		</div>
	);
}

/** 翻月的那两个。22px，和别处的图标按钮同一档——不是 26px 的那一档。 */
function MonthStep({ direction, onClick, disabled }: { direction: -1 | 1; onClick: () => void; disabled?: boolean }) {
	const Icon = direction === -1 ? ChevronLeft : ChevronRight;
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-label={translate(direction === -1 ? "cleanup.prevMonth" : "cleanup.nextMonth")}
			className="flex h-[22px] w-[22px] items-center justify-center rounded-md text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink disabled:pointer-events-none disabled:opacity-35"
		>
			<Icon size={14} strokeWidth={1.9} aria-hidden />
		</button>
	);
}
