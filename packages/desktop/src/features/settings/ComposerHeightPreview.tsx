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
		 * `ly-composer` and `bg-float` are all it takes to look like that box.
		 *
		 * The real box's fill is not its own: sitting on the conversation or a panel, it gets
		 * `--color-float` from `composer.css`, plus the two shadows — one at the ground, one lifting it,
		 * a set for each theme. This used to copy only the radius and border, so what showed through was
		 * the card's `bg-card/40`, with no shadow to speak of, and the box dissolved into the background.
		 *
		 * Underfoot here is a settings card, out of reach of the rule that gives the fill by position, so
		 * the real box's colour is written on directly. The shadows are left to `ly-composer`, light and
		 * dark following the theme, rather than written again here — a rewritten copy would drift from
		 * the real box sooner or later.
		 */
		<div className="ly-composer mt-3 rounded-2xl border bg-float transition-[border-color] duration-[var(--ly-t-quick)]">
			{/*
			 * Type from the same source as the real composer: `.ly-composer-text` supplies the padding, the
			 * font size and the 20/14 line height, and only the `min-height` formula is added here. The top
			 * and bottom padding read `--ly-composer-in`, the real box's variable, so changing one moves
			 * the other.
			 *
			 * The height transitions: drag one notch and the box grows to it rather than jumping. That is
			 * only visible because `applyAppearance` no longer holds back transitions app-wide when the
			 * line count changes — see `beginRepaint` in `theme.ts`.
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
