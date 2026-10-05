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

import { translate } from "../../i18n/translate.ts";
import { ArrowUp, Camera, Plus } from "lucide-react";

export function ComposerHeightPreview({ lines }: { lines: number }) {
	return (
		/*
		 * `ly-composer` 和 `bg-float`，这两样是「看起来像那个框」的全部。
		 *
		 * 真框的底色不是它自己的：坐在对话区或面板上时，`composer.css` 给它 `--color-float`，外加
		 * 那两层阴影——一层贴地，一层托起，深浅各一套。这里原来只抄了圆角和描边，于是透出来的是
		 * 卡片的 `bg-card/40`，又没有阴影可言，一个框就这么化进背景里了。
		 *
		 * 这里脚下是设置页的卡片，那条按位置给底色的规则够不着，所以把真框的那层颜色直接写上。
		 * 阴影交给 `ly-composer`，深浅两套跟着主题走，不必在这里重写一遍——重写的那份迟早会跟真框
		 * 走散。
		 */
		<div className="ly-composer mt-3 rounded-2xl border bg-float transition-[border-color] duration-[var(--ly-t-quick)]">
			{/*
			 * 与真输入框同源的排版：`.ly-composer-text` 出 padding、字号与 20/14 的行高，这里
			 * 只补上那条 `min-height` 的算式。上下 padding 读 `--ly-composer-in`，和真框同一条
			 * 变量，改一边另一边跟着走。
			 *
			 * 高度带过渡：拖一格，框是长上去的，不是跳过去的。这条过渡只有在
			 * `applyAppearance` 不再为「行数变了」按住全应用的过渡之后才看得见——见 `theme.ts`
			 * 里的 `beginRepaint`。
			 */}
			<div
				className="ly-composer-text text-ink-faint transition-[min-height] duration-[var(--ly-t-base)] ease-[var(--ly-e-out)]"
				style={{ minHeight: `calc(${lines} * 1em * 20 / 14 + var(--ly-composer-in) * 2)` }}
			>
				{translate("composerPreview.placeholder")}
			</div>
			<div className="ly-composer-bar flex items-center justify-between gap-1">
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
					<span className="flex h-7 w-7 items-center justify-center rounded-lg bg-ink text-shell opacity-50">
						<ArrowUp size={14} strokeWidth={2} />
					</span>
				</div>
			</div>
		</div>
	);
}
