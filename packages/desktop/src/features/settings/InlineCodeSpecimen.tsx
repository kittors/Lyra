/**
 * 句子里那一小块代码，此刻真正的样子。
 *
 * 紧挨着调它的那几行控件，和「输入框默认高度」底下那个框同一个位置、同一个理由：一串十六进制
 * 和一个行数都是没人能在脑子里换算成画面的东西，得看着改。要看的东西离动手的地方一远，就变成
 * 「改一下、滚下去看一眼、再滚回来」。
 *
 * 不并排两套，和代码主题那两个 specimen 不一样，这是故意的：语法主题要并排是因为选它的时候人在
 * 两套配色之间比较，而行内代码的自定义只编辑当前深浅色的那一套（见外观页那两行），并排摆一套不能
 * 编辑的只会让人去点它。
 *
 * **`prose-dw` 是这里的全部意思。** 套上它，这枚 `<code>` 吃的就是回答里那条一模一样的规则——
 * 同一个 `.prose-dw code`、同一批变量、同一个 `box-shadow`。要是在这儿照着 `theme.ts` 把颜色重算
 * 一遍，两边迟早会不一致，而不一致的那一方恰好是号称「预览」的这一方：它会给出一个看着合理的
 * 错数。底色用 `bg-shell` 而不是卡片色，因为回答是画在窗口那张底上的，不是画在卡片上。
 */

import { Fragment, type ReactNode } from "react";
import { useI18n } from "../../i18n/index.ts";

export function InlineCodeSpecimen() {
	const { t } = useI18n();
	return (
		<div className="prose-dw rounded-xl border border-line-soft bg-shell px-3 py-2.5">
			<p>{withCodeSpans(t("codePreview.inlineSentence"))}</p>
		</div>
	);
}

/**
 * 按反引号切开，奇数段画成 `<code>`。
 *
 * 一句话里有两处行内代码，`t()` 给的是一整串字符串而不是 JSX，所以标记得由字符串自己带。用的是
 * markdown 本来的写法，翻译的人照着抄反引号就行，不必认识任何占位符语法。
 */
function withCodeSpans(sentence: string): ReactNode[] {
	return sentence
		.split("`")
		.map((part, index) =>
			index % 2 === 1 ? (
				// noArrayIndexKey 在这里不适用（本仓库用 oxlint，不认 biome 的抑制注释，所以这只是一句说明）: 段的身份就是它的位置。
				<code key={index}>{part}</code>
			) : (
				<Fragment key={index}>{part}</Fragment>
			),
		);
}
