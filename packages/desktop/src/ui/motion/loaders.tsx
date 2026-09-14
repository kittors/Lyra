/**
 * 「正在忙」的三个记号，以及它们各管哪里。
 *
 * 分成两个而不是一个，是因为「正在忙」其实是两句话：
 *
 * `StatusSpinner` 说的是**这一条正在跑**。它是某个对象的状态值，出现在一列同族状态记号中间
 * ——上下左右是 ✓、✗、时钟、待办圆点——同屏可能好几个在跑，你是旁观者。任务清单的每一步、
 * 流水线的每一行、工具卡的运行中都是它。
 *
 * `ActionSpinner` 说的是**你按的那下正在回来**。它顶替的是一个刚被按下的动作图标（刷新、保存、
 * 下载、发布），或者填在一个刚被清空的角标位上；同屏通常只有一个，你在等它。全应用三十来处
 * 按钮都是它。
 *
 * 判据是可以机械执行的：把这个记号删掉，原地会出现什么。是状态图标就用 `StatusSpinner`，是
 * 一个可点的动作图标（或一个计数）就用 `ActionSpinner`。`test/ui/loading-consistency.test.ts`
 * 守着这条。
 *
 * `BreatheLoader` 只在侧栏的会话行上，那一处问的不是同一个问题，见它自己的注释。
 *
 * 前两个都是 r=10 的描边圆，和 lucide 的 `CheckCircle2`、`XCircle`、`Clock` 精确重合——它们
 * 就是那一列里的邻居。在这之前这里是一枚八条射线的星芒，一列圆里混一个星，每次都从队列里
 * 跳出来一次。几何和那些数字怎么定的，写在 `styles/loading.css` 的 Loading 一节。
 */

/**
 * 一圈虚线，匀速转。
 *
 * 六段等分，所以转过 60° 就回到自身：没有可追踪的端点，眼睛抓不到锚点。这是它敢转、而一段
 * 弧不敢的原因——一段弧有头，十几个同时在屏幕上，每一个都在自己的相位上把视线勾一下。
 *
 * 颜色走 `currentColor`，默认跟着周围的文字走。要它说话大声一点的地方（任务清单里正在跑的
 * 那一步、流水线里排队的那一条）自己传 `text-accent`、`text-amber-500`。
 */
export function StatusSpinner({ size = 14, className = "" }: { size?: number; className?: string }) {
	return (
		<svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className={`ly-dash shrink-0 ${className}`}>
			<circle cx="12" cy="12" r="10" />
		</svg>
	);
}

/**
 * 一段亮弧沿着一圈淡轨道跑。
 *
 * 轨道是这个记号的重点，不是装饰：亮弧单独转的话，图形的轮廓跟着弧一起走，在按钮那个方寸
 * 之间会读成「有东西在里面甩」。垫一圈淡的，形状就恒定是一个完整的圆，动的只有亮处。
 *
 * 轨道浓度走 `--ly-track`，默认 0.18。实心底的按钮（`bg-ink`、`bg-accent`）上 `currentColor`
 * 是底色的反色，0.18 基本看不见，那几处传 `onFill`——见 `loading.css` 里那一档的注释。
 */
export function ActionSpinner({
	size = 14,
	className = "",
	onFill = false,
}: {
	size?: number;
	className?: string;
	/** 画在实心底的按钮上（`bg-ink` / `bg-accent`），轨道要更浓才看得见。 */
	onFill?: boolean;
}) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			aria-hidden
			className={`ly-arc ${onFill ? "ly-arc--on-fill " : ""}shrink-0 ${className}`}
		>
			<circle className="ly-arc-track" cx="12" cy="12" r="10" />
			<circle className="ly-arc-head" cx="12" cy="12" r="10" />
		</svg>
	);
}

/**
 * 一圈波纹离开静止的中心，颜色一路走过调色板。
 *
 * 给侧栏的会话行。那一列可能同时有好几行在跑，而你还要用它读标题——所以这里连「亮处在走」都不
 * 要：什么都不旋转、什么都不位移，余光里它只是缓缓涨落的一团。换成上面那两个试过，一列里并排
 * 三四个各自明灭，读标题时总有东西在旁边闪。
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
