/**
 * 「当前版本更新内容」只显示一种语言。
 *
 * GitHub Release 正文里七种语言写在一起，注释在发布页上是隐形的。关于页和更新对话框不是发布页：
 * 界面是英文就只出英文，是中文就只出中文，没有写过的语言退回英文。不能把整份正文一股脑铺出来。
 *
 *     <!-- lyra:notes en -->
 *     ### New
 *     ...
 *     <!-- lyra:notes zh-CN -->
 *     ### 新功能
 *     ...
 */

import type { ResolvedUiLocale } from "../../i18n/index.ts";

/** 行首的分段标记，语言码取 `ResolvedUiLocale`（`zh-CN`、`zh-TW`、`en`…）。 */
const MARKER = /^[ \t]*<!--[ \t]*lyra:notes[ \t]+([A-Za-z-]+)[ \t]*-->[ \t]*$/gm;

/**
 * 当前语言没有自己那一段时，往哪退。
 *
 * 两种中文互相看得懂，先试对面再试英文。日语、韩语、法语、俄语没写过就直接英文。
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
	const normalized = notes.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
	const marks = [...normalized.matchAll(MARKER)];
	if (marks.length === 0) return sections;

	for (const [index, mark] of marks.entries()) {
		const tag = mark[1];
		if (!tag) continue;
		const from = (mark.index ?? 0) + mark[0].length;
		const to = index + 1 < marks.length ? (marks[index + 1]?.index ?? normalized.length) : normalized.length;
		const body = unwrapReleaseFold(normalized.slice(from, to).trim());
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
 * GitHub 上非英文段可以收在 `<details>` 里。关于页已经按语言挑过了，披露条是多余的壳。
 */
function unwrapReleaseFold(body: string): string {
	let text = body.trim();
	const commented = text.match(/^<!--\s*([\s\S]*?)\s*-->$/);
	if (commented?.[1]) text = commented[1].trim();
	text = text.replace(/^<details\b[^>]*>\s*<summary\b[^>]*>[\s\S]*?<\/summary>\s*/i, "");
	text = text.replace(/\s*<\/details>\s*$/i, "");
	return text.trim();
}

/**
 * 关于页 / 更新对话框要用的那一段：一种语言，换界面语言就换这一段。
 *
 * 没有分段标记的旧 release 仍整段返回，免得历史上那些只有一种语言的说明变成空白。
 * 一旦写了标记，就绝不再把七种语言一起交出去。
 */
export function notesForLocale(notes: string, locale: ResolvedUiLocale): string {
	const trimmed = notes.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
	if (!trimmed) return "";

	const sections = splitNotesByLocale(trimmed);
	if (sections.size === 0) return trimmed;

	for (const candidate of [locale, ...(FALLBACKS[locale] ?? []), "en"]) {
		const body = sections.get(candidate);
		if (body) return body;
	}
	return sections.get("en") ?? sections.values().next().value ?? "";
}
