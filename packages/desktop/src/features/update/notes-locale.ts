/**
 * 一份发版说明，七种语言，读的人只看见自己那一种。
 *
 * 发版说明是 GitHub Release 的正文，界面把它整段渲染在「关于」里。而这个应用的界面本身是跟着
 * 系统语言走的——于是一个把 Lyra 切成日语用的人，点开关于页面，看到的是一整屏中文。说明写得
 * 再清楚也没用，那一屏对他等于空白。
 *
 * 办法是让正文自己带上分段标记，客户端按当前语言挑出一段：
 *
 *     <!-- lyra:notes zh-CN -->
 *     ## 修好了什么
 *     ...
 *     <!-- lyra:notes en -->
 *     ## What's fixed
 *     ...
 *
 * 标记用 HTML 注释，是因为它要同时活在两个地方：GitHub 的发布页上没有「当前语言」这回事，谁都
 * 该看到全文，而注释在那里是隐形的，七段依次排下来就是一份完整的多语言说明；客户端这边知道读的
 * 人是谁，于是只留一段。同一份文本，两种读法，不用维护两份。
 *
 * 没有标记的正文原样返回——历史上每一个 release 都是这样的，它们不该因为多了这套约定而变成空白。
 */

import type { ResolvedUiLocale } from "../../i18n/index.ts";

/** 行首的分段标记，语言码取 `ResolvedUiLocale` 的写法（`zh-CN`、`zh-TW`、`en`…）。 */
const MARKER = /^[ \t]*<!--[ \t]*lyra:notes[ \t]+([A-Za-z-]+)[ \t]*-->[ \t]*$/gm;

/**
 * 挑不到时依次退到哪里。
 *
 * 繁体退简体、简体退繁体：两种中文之间互相看得懂，比退回英文近得多。其余语言退英文——发版说明
 * 里技术名词居多，英文是这群人的第二语言，而中文对其中大多数不是。
 */
const FALLBACKS: Record<ResolvedUiLocale, readonly ResolvedUiLocale[]> = {
	"zh-CN": ["zh-TW", "en"],
	"zh-TW": ["zh-CN", "en"],
	en: [],
	fr: ["en"],
	ru: ["en"],
	ko: ["en"],
	ja: ["en"],
};

/** 正文切成「语言 → 那一段」。没有任何标记时返回空表，交给调用方原样处理。 */
export function splitNotesByLocale(notes: string): Map<string, string> {
	const sections = new Map<string, string>();
	const marks = [...notes.matchAll(MARKER)];
	if (marks.length === 0) return sections;

	for (const [index, mark] of marks.entries()) {
		const tag = mark[1];
		if (!tag) continue;
		const from = (mark.index ?? 0) + mark[0].length;
		const to = index + 1 < marks.length ? (marks[index + 1]?.index ?? notes.length) : notes.length;
		const body = notes.slice(from, to).trim();
		/*
		 * 先到的那一段留下。
		 *
		 * 同一个语言码写了两次是笔误，而两段里哪一段是想要的没人说得准；取前一段至少是稳定的，
		 * 且与「从上往下读」一致。
		 */
		if (body && !sections.has(tag)) sections.set(tag, body);
	}
	return sections;
}

/**
 * 这份发版说明，给这个语言的人看的是哪一段。
 *
 * 没有分段标记就是整段——这是所有旧版本的形状，也是写发版说明的人忘了分段时该有的样子：宁可给
 * 一段读不懂的，也不给一片空白。
 */
export function notesForLocale(notes: string, locale: ResolvedUiLocale): string {
	const trimmed = notes.trim();
	if (!trimmed) return "";

	const sections = splitNotesByLocale(trimmed);
	if (sections.size === 0) return trimmed;

	for (const candidate of [locale, ...(FALLBACKS[locale] ?? []), "en"]) {
		const body = sections.get(candidate);
		if (body) return body;
	}
	// 标记齐全但一个都对不上（比如只写了 de）：把第一段给他，仍然好过空白。
	return sections.values().next().value ?? trimmed;
}
