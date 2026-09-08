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
		 * `ly-composer` 和 `bg-shell`，这两样是「看起来像那个框」的全部。
		 *
		 * 真框自己是透明的：它看着有底色，是因为它坐在对话区的 `--color-shell` 上，外加
		 * `composer.css` 里那两层阴影——一层贴地，一层托起，深浅各一套。这里原来只抄了圆角和描边，
		 * 于是透出来的是卡片的 `bg-card/40`，又没有阴影可言，一个框就这么化进背景里了。
		 *
		 * 底色写死成 `bg-shell` 而不是继续透明，是因为它脚下这次是卡片而不是对话区；要跟真框长
		 * 得一样，就得自己把真框脚下那层颜色带上。阴影交给 `ly-composer`，深浅两套跟着主题走，
		 * 不必在这里重写一遍——重写的那份迟早会跟真框走散。
		 */
		<div className="ly-composer mt-3 rounded-[18px] border border-line-soft bg-shell transition-[border-color,box-shadow] duration-[var(--ly-t-base)]">
			{/*
			 * 与真输入框同源的排版：`.ly-composer-text` 出 padding、字号与 1.625 的行高，这里
			 * 只补上那条 `min-height` 的算式。写死 1.625 而不是再引一个变量，是因为算式的另一半
			 * （24px 的上下 padding）也在那张样式表里，两个数分开放才是真正会走散的写法。
			 *
			 * 高度带过渡：拖一格，框是长上去的，不是跳过去的。这条过渡只有在
			 * `applyAppearance` 不再为「行数变了」按住全应用的过渡之后才看得见——见 `theme.ts`
			 * 里的 `beginRepaint`。
			 */}
			<div
				className="ly-composer-text text-ink-faint transition-[min-height] duration-[var(--ly-t-base)] ease-[var(--ly-e-out)]"
				style={{ minHeight: `calc(${lines} * 1.625em + 24px)` }}
			>
				{translate("composerPreview.placeholder")}
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
