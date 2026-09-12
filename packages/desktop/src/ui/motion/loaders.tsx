/**
 * 「正在忙」的两个记号，以及它们各管哪里。
 *
 * `Spinner` 是通用的那个：按钮里、工具卡上、任务清单的每一步、面板的角上，全应用二十几处都是它。
 * 在这之前那些地方各写各的——任务清单自己描了一段圆弧，其余多半是随手抓一个 lucide 的 `Loader2`
 * 或 `RefreshCw` 套上 `ly-spin` 转起来，同一句话被说成好几种腔调。
 *
 * `BreatheLoader` 只在侧栏的会话行上，那一处问的不是同一个问题，见它自己的注释。
 *
 * 两个都不旋转。为什么，以及那些数字是怎么定的，写在 `styles/loading.css` 的 Loading 一节。
 */

/** 八条。再多在 12px 上并成一团灰，再少就数得出根数、露出机关。 */
const RAY_COUNT = 8;

/** 走完一圈的时间。一圈八格，每格 100ms。 */
const PERIOD_MS = 800;

const RAYS = Array.from({ length: RAY_COUNT }, (_, index) => index);

/**
 * 第 `index` 条射线的动画应当从哪一刻开始。
 *
 * 负的 delay 表示「已经跑过这么久了」，于是各条线一上来就分散在周期的不同位置上。倒着数是为了
 * 让亮处顺时针走：`index` 是顺时针排的，delay 若正着递增，最亮的一条会一格一格往回退。
 */
function delayOf(index: number): string {
	return `${-((RAY_COUNT - index) % RAY_COUNT) * (PERIOD_MS / RAY_COUNT)}ms`;
}

/**
 * 一圈射线，亮处沿圈走。
 *
 * 颜色走 `currentColor`，默认跟着周围的文字走——它顶替的是二十几个 lucide 图标，那些图标就是这么
 * 上色的，换成一个自带颜色的东西会让它在按钮里、在状态行里各自跳出来一次。要它说话大声一点的
 * 地方（任务清单里正在跑的那一步、流水线里排队的那一条）自己传 `text-accent`、`text-amber-500`。
 *
 * 几何在 24 的 viewBox 里量：射线从半径 4.4 到 9.6，圆头两端各外扩 1.15。内圈留出的空洞在
 * 相邻两条之间还剩 1px 的缝，是 8 条线不糊成一个实心点的下限。
 */
export function Spinner({ size = 14, className = "" }: { size?: number; className?: string }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" aria-hidden className={`ly-star shrink-0 ${className}`}>
			{RAYS.map((index) => (
				<line
					key={index}
					x1="12"
					y1="2.4"
					x2="12"
					y2="7.6"
					transform={`rotate(${index * (360 / RAY_COUNT)} 12 12)`}
					style={{ animationDelay: delayOf(index) }}
				/>
			))}
		</svg>
	);
}

/**
 * 一圈波纹离开静止的中心，颜色一路走过调色板。
 *
 * 给侧栏的会话行。那一列可能同时有好几行在跑，而你还要用它读标题——所以这里连「亮处在走」都不
 * 要：什么都不旋转、什么都不位移，余光里它只是缓缓涨落的一团。换成通用的那个射线记号试过，
 * 一列里并排三四个各自明灭，读标题时总有东西在旁边闪。
 *
 * 颜色走完 accent → info → violet 的那 2.4 秒，是它说「跑了多久」的方式：扫一眼知道它活着，
 * 多看一会儿知道它**还**活着，而没有任何东西变快或变响。
 */
export function BreatheLoader({ size = 14, className = "" }: { size?: number; className?: string }) {
	return (
		<span aria-hidden className={`ly-breathe shrink-0 ${className}`} style={{ width: size, height: size }}>
			{/* 两道波纹差半个周期，所以总有一道正在离场；`b` 是核心。 */}
			<i />
			<i />
			<b />
		</span>
	);
}
