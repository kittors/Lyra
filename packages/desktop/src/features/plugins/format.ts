/**
 * 市场里几个数怎么写。
 *
 * 下载量是给人比较两个条目用的，精确到个位没有意义，一千二百三十四和一千二百三十五读起来一样。
 * 按界面语言缩写（`1.2K`、`1.2千`），而不是自己拼一个单位——`Intl` 知道每种语言的写法。
 */

import { translate } from "../../i18n/translate.ts";

export function compactCount(n: number): string {
	if (n < 1000) return String(n);
	try {
		return new Intl.NumberFormat(translate("market.numberLocale"), { notation: "compact", maximumFractionDigits: 1 }).format(n);
	} catch {
		return `${Math.round(n / 100) / 10}k`;
	}
}
