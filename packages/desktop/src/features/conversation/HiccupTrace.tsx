/**
 * 连接抖了一下，这里说一句——用它该有的音量。
 *
 * 从前失败在屏幕上是这样的：一个红色三角，一句「这一轮出错了」，一个展开箭头，右边一个「重试」，
 * 底下再来一行「上次请求失败，进度已保留 · 继续 · 重试」。两行、四个可点的东西、一个红标，为的是
 * 一件多半几秒钟后自己就好了的事。而真自己好了的那些——重连成功——反倒一点痕迹都不留。
 *
 * 轻重反了。所以这里只有一种样子，三个阶段共用：等待时数着秒，接上了变成一行灰字留在原地，真没救
 * 了才换成一句失败，配一个中性的底色和一个可点的下一步。没有红字，没有展开箭头，没有并排的按钮。
 *
 * 长度上也一样克制。一行放不下的原文不往外顶：摘要截到一行，悬停给两百来字，要读全的点开——那里
 * 是一块限高、可滚的地方，而不是把一页 JSON 铺进转录里。
 */

import { translate } from "../../i18n/translate.ts";
import { useEffect, useState } from "react";
import { ChevronRight, CircleAlert, CircleCheck, RotateCw } from "lucide-react";
import { describeHiccup, hiccupTip, type Hiccup } from "../../lib/hiccup.ts";
import { useApp } from "../../store/index.ts";

/** 等待时每秒重画一次，就为了那个数字；不等待时一次都不用。 */
function useTick(active: boolean): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!active) return;
		const timer = setInterval(() => setNow(Date.now()), 500);
		return () => clearInterval(timer);
	}, [active]);
	return now;
}

/**
 * 一条记录，画在它发生的那个位置上。
 *
 * 从前这些记录是转录末尾的一丛，一律挂在运行指示器底下。一轮跑四十分钟、中间断过两次又接上，那句
 * 「重连 2 次后恢复」就贴在最后一行 loading 下面：它说的是四十分钟里某个时刻的事，站的却是「此刻」
 * 的位置。断线是这段工作当中的一件事，该待在它发生的那一段旁边——所以它成了转录里的一行，和压缩标记、
 * 命令边界同一种东西，按 `at` 插进去。见 `conversation/grouping.ts`。
 *
 * 还在等的那一条数出来正好落在末尾，因为它确实正在此刻发生——所以「紧挨着那句正在思考」这件事没有
 * 丢，只是不再靠位置写死，而是从它自己的时刻推出来的。
 */
export function HiccupRow({ hiccup }: { hiccup: Hiccup }) {
	// 只有还在等的那条要数秒；其余的一次都不用重画。
	const now = useTick(hiccup.outcome === "waiting");
	const [open, setOpen] = useState(false);
	const line = describeHiccup(hiccup, now);
	const tip = hiccupTip(hiccup);
	const failed = hiccup.outcome === "gave_up";

	/*
	 * 放弃了的那条给一个底，其余的不给。
	 *
	 * 等待和恢复是过程里的事，和时间戳同一个量级，不该比它旁边的正文更显眼。而一次真的停下来了的
	 * 失败需要一个边界，否则它看起来仍然像随时会自己好——那正是最该被看见的一条。底色是中性的，
	 * 不是红的：红色是留给「你做错了什么」的，而这里多半不是。
	 *
	 * 尺寸是照着一张参考图收的：圆角比卡片大一档，内边距宽松，图标和那行字垂直居中。第一版把它做
	 * 得又小又紧，圆角只有 8px——那看起来像个挤在角落的小标签，而不是一句「这里停下了」。
	 */
	const shell = failed
		? "flex w-full max-w-[62ch] flex-col gap-1.5 rounded-xl border border-line bg-card px-3.5 py-3"
		: "flex w-fit max-w-full flex-col gap-1.5 px-0.5";

	return (
		/* 外面这层只管它和上下两行之间的距离——`shell` 管的是这条记录自己长什么样。 */
		<div data-hiccup-trace className="mb-2.5">
		<div className={shell} data-hiccup={hiccup.outcome}>
			{/*
			 * 图标和那行字在同一条水平线上。
			 *
			 * 展开的原文在这个 flex 之外，所以点开之后图标不会跟着跑到盒子中间去——它始终对着它在
			 * 说明的那一行。第一版把图标顶部对齐再用 `mt-[3px]` 往下推，那是在手动模拟居中，换个
			 * 字号就又歪了。
			 */}
			<div className="flex min-w-0 items-center gap-2.5">
				<Icon outcome={hiccup.outcome} />
				{/*
				 * 一行，超出就省略号——不换行，不撑高。
				 *
				 * `min-w-0` 是这里真正干活的那个：flex 的子项默认不肯缩到内容宽度以下，少了它
				 * `truncate` 一个字都截不掉，一句长错误会把整条转录顶宽。
				 */}
				<span
					data-ly-tip={tip}
					data-ly-tip-side="top"
					className={`min-w-0 flex-1 truncate tabular-nums ${failed ? "text-label text-ink-muted" : "text-detail text-ink-faint"}`}
				>
					{line}
				</span>
				{/*
				 * 原文有得看时才给这个。
				 *
				 * 它是一句「还有更多」，不是一个待办：所以是行末一个小小的字，不是一个带框的
				 * 按钮，也不是从前那个顶在错误前面、点开才知道里面是什么的箭头。
				 */}
				{hiccup.detail && hiccup.detail !== hiccup.summary && (
					<button
						type="button"
						onClick={() => setOpen((was) => !was)}
						aria-expanded={open}
						className="flex shrink-0 items-center gap-0.5 rounded text-detail text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:text-ink-muted"
					>
						<ChevronRight size={10} strokeWidth={2} className={`transition-transform duration-[var(--ly-t-quick)] ${open ? "rotate-90" : ""}`} />
						{translate(open ? "common.collapse" : "common.details")}
					</button>
				)}
				{failed && <Next hint={hiccup.hint} />}
			</div>
			{/*
			 * 展开之后：限高、可滚、等宽字。
			 *
			 * 中转的错误体动辄一整页 JSON。铺开在转录里会把上面的对话推出屏幕，所以给它一个盒子
			 * 待着——十行的高度，超出的部分自己滚，`overscroll-contain` 免得滚到底之后顺手把整
			 * 条转录也带着走。
			 */}
			{open && hiccup.detail && (
				<pre className="max-h-[10lh] overflow-y-auto overscroll-contain rounded-lg bg-input px-2.5 py-2 text-detail leading-relaxed whitespace-pre-wrap text-ink-faint">
					{hiccup.detail}
				</pre>
			)}
		</div>
		</div>
	);
}

/**
 * 三个阶段，三个图标，一样大。
 *
 * 停下来的那个是圆圈里的感叹号——参考图里就是它，而且它比一个断掉的链条更中性：链条断了是在说
 * 「网线掉了」，而这里也可能是密钥不对。等待时是个转着的圈，因为它确实还在动，比任何文案都更能
 * 说明没卡住；接上了是个安静的对勾。
 */
function Icon({ outcome }: { outcome: Hiccup["outcome"] }) {
	if (outcome === "waiting") {
		return <RotateCw size={13} strokeWidth={2} className="shrink-0 animate-spin text-ink-faint [animation-duration:2s]" />;
	}
	if (outcome === "recovered") {
		return <CircleCheck size={13} strokeWidth={2} className="shrink-0 text-ink-faint" />;
	}
	return <CircleAlert size={15} strokeWidth={1.8} className="shrink-0 text-ink-muted" />;
}

/**
 * 停下来之后，唯一的那个下一步。
 *
 * 从前这里有两个并排的动作，而它们是相反的：一个接着做完，一个把这一轮全丢掉重来一次——后者在一轮
 * 已经花掉几十万 token 的时候，按错就是再花一次。留一个，留那个安全的；重来仍然在消息自己的操作
 * 里，只是不再摆在一句失败旁边勾着人点。
 */
function Next({ hint }: { hint?: string }) {
	const send = useApp((s) => s.send);
	const setView = useApp((s) => s.setView);
	const setSettingsSection = useApp((s) => s.setSettingsSection);

	if (hint === "check-key" || hint === "check-model") {
		return (
			<button
				type="button"
				onClick={() => {
					setView("settings");
					setSettingsSection("models");
				}}
				className="shrink-0 rounded px-1 text-detail text-ink-muted underline decoration-line underline-offset-2 transition-colors hover:text-ink"
			>
				{translate("common.goSettings")}
			</button>
		);
	}
	if (hint) return null;
	return (
		<button
			type="button"
			data-ly-tip={translate("composer.finishUnfinished")}
			onClick={() => void send([{ type: "text", text: translate("common.continue") }], { synthetic: true, carryOn: true })}
			className="shrink-0 rounded px-1 text-detail text-ink-muted underline decoration-line underline-offset-2 transition-colors hover:text-ink"
		>
			{translate("common.continue")}
		</button>
	);
}
