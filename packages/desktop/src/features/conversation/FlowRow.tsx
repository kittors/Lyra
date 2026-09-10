/**
 * 一轮对话的过程行：思考、一段工具活、一条命令，共用的那个骨架。
 *
 * 模型先想，然后动手，最后才说话。这三种行是同一件事的三个阶段，读者是连着看的——所以它们必须
 * 长得像同一种东西。在此之前它们是三种：三个行高、三个间距、三种「正在跑」的说法（图标脉动、
 * 文字扫光、图标转圈）。每隔几行就要重新认一次这是什么，那种累不是哪一行不好看造成的，是它们
 * 互相不像造成的。
 *
 * 这个组件只管骨架，不管内容：一个前置图标、一句标题、一个点、一段会被省略的摘要、一个可选的
 * 尾部，最右边是展开箭头。展开与否、里面画什么，都还是各自的事。
 *
 * 图标和箭头分居两端，是因为它们说的是两件事：图标说「这一行是什么」，箭头说「点开还是收起」。
 * 它们一度共用最左边那一格（悬停时互换），于是鼠标一放上去，那一行的身份标志就没了。
 *
 * 「正在跑」只有一种说法：摘要上扫过一道光（`ly-glide`，见 glide.css）。不再有第二个转圈的东西
 * 陪着它——同一件事说两遍，就是长任务让人觉得吵的原因。
 */

import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export function FlowRow({
	icon,
	title,
	summary,
	trailing,
	running,
	followEnd,
	open,
	onToggle,
	label,
	className = "",
	...rest
}: {
	/** 前置图标，常驻。它说的是这一行是什么，不参与展开/收起。 */
	icon: ReactNode;
	/** 这一行是什么。不参与压缩——先被吃掉的永远该是摘要。 */
	title?: ReactNode;
	/** 这一行做了什么。长了省略号；运行中它是唯一带动效的东西。 */
	summary?: ReactNode;
	/** 靠右的附注，比如改动行数。 */
	trailing?: ReactNode;
	running?: boolean;
	/**
	 * 摘要正在被一个字一个字写出来时，把字尾顶在右边。
	 *
	 * 一句正在生长的话如果左对齐，超出行宽之后看到的永远是它的开头——而开头早就读完了。要看的是
	 * 刚写出来的那几个字，所以让内容右对齐、宽度取 `max-content`，行把左边裁掉。
	 */
	followEnd?: boolean;
	/** 省略即为不可展开：不可展开的行不换 chevron，也没有指针手势。 */
	open?: boolean;
	onToggle?: () => void;
	label?: string;
	className?: string;
} & Record<`data-${string}`, string | undefined>) {
	const expandable = onToggle !== undefined;
	const body = (
		<>
			{/* 图标一直在：它说的是这一行是什么（在想 / 在动手 / 在跑命令），不该被别的东西顶掉。 */}
			<span className="ly-flow-lead">{icon}</span>
			{title && <span className="ly-flow-title text-ink-muted">{title}</span>}
			{title && summary ? <span className="ly-flow-dot" aria-hidden /> : null}
			{/*
			 * 扫光挂在外层，字挂在内层，而且 key 在内层——这一条是踩出来的。
			 *
			 * `animation` 是一个属性，第二个类不会叠加而是替换，所以扫光和入场淡入不能共用一个 span。
			 * key 放外层的话，句子每多一个从句（「读取文件 8 个」变成 9 个）React 就换掉正在扫光的那个
			 * 元素，光就跳回起点——一次忙碌的运行里每秒好几次，那是闪烁不是扫过。光属于这一行（它和
			 * 这段活一样长命），淡入属于那些字（变的是它们）。
			 */}
			{/*
			 * 正在逐字写的那一句借 `ly-fade-edge` 的遮罩：两头化开，深浅由 flow-row.css 说了算。
			 * 不写的时候不挂——那条规则会给 `position: fixed` 的后代造出一个包含块（见 portal.ts）。
			 */}
			{summary !== undefined && summary !== null && summary !== "" && (
				<span
					className={`ly-flow-summary ${running ? "ly-glide" : ""} ${followEnd ? "ly-fade-edge" : ""}`}
					data-follow-end={followEnd ? "" : undefined}
				>
					{summary}
				</span>
			)}
			{trailing && <span className="ly-flow-trail">{trailing}</span>}
			{/* 展开箭头在最右边——它说的是「点开还是收起」，和前面那个图标是两件事。 */}
			{expandable && <ChevronRight size={12} strokeWidth={2} className="ly-flow-chevron" />}
		</>
	);

	const shell = `ly-flow-row text-label text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:text-ink-muted ${className}`;

	if (!expandable) {
		return (
			<div className={shell} role="status" {...rest}>
				{body}
			</div>
		);
	}
	return (
		<button
			type="button"
			onClick={onToggle}
			aria-expanded={open}
			aria-label={label}
			data-expandable=""
			data-open={open ? "" : undefined}
			className={`${shell} w-full cursor-pointer text-left`}
			{...rest}
		>
			{body}
		</button>
	);
}
