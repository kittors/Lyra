/**
 * 输入框在这个行数下有多高，画出来看。
 *
 * 「4 行」是个抽象的数——真正要判断的是「够不够写完一段需求」，而那件事只有把框摆在眼前才答得
 * 上来。所以这里画的是框本身，不是一个示意图：圆角、描边、内边距、字号、行高、底下那条控件栏
 * 的高度，全部取自真输入框的同一套值（`.ly-composer` 与 `.ly-composer-text`），高度也用跟
 * `misc.css` 里那条 `min-height` 一模一样的算式。滑到哪一格，看到的就是那一格的实物。
 *
 * 只有底部那排控件是假的：真的那排要模型、要权限、要附件状态，全是这个页面拿不到也不该拿的东
 * 西。用三个占位形代掉，它们在这里的作用只是占住那点高度——那也正是它们对「框有多高」的全部
 * 影响。
 */

import { ArrowUp, Camera, Plus } from "lucide-react";

export function ComposerHeightPreview({ lines }: { lines: number }) {
	return (
		<div className="mt-3 rounded-[18px] border border-line-soft bg-transparent">
			{/*
			 * 与真输入框同源的排版：`.ly-composer-text` 出 padding、字号与 1.625 的行高，这里
			 * 只补上那条 `min-height` 的算式。写死 1.625 而不是再引一个变量，是因为算式的另一半
			 * （24px 的上下 padding）也在那张样式表里，两个数分开放才是真正会走散的写法。
			 */}
			<div
				className="ly-composer-text text-ink-faint"
				style={{ minHeight: `calc(${lines} * 1.625em + 24px)` }}
			>
				输入消息，/ 命令，@ 引用
			</div>
			<div className="flex items-center justify-between gap-1 px-3 pt-0 pb-2.5">
				<div className="flex shrink-0 items-center gap-1 text-ink-faint">
					<span className="flex h-7 w-7 items-center justify-center">
						<Plus size={15} strokeWidth={1.8} />
					</span>
					<span className="flex h-7 w-7 items-center justify-center">
						<Camera size={15} strokeWidth={1.8} />
					</span>
				</div>
				<div className="flex min-w-0 items-center gap-2">
					<span className="h-2 w-16 rounded-full bg-line" />
					<span className="flex h-7 w-7 items-center justify-center rounded-full bg-card text-ink-faint">
						<ArrowUp size={14} strokeWidth={2} />
					</span>
				</div>
			</div>
		</div>
	);
}
