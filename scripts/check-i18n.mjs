#!/usr/bin/env node
/**
 * Text a person reads, written in one language, in a program that offers seven.
 *
 * The interface language setting used to move the menus and leave everything else where it was: the
 * settings page said "Mobile sync" in the sidebar and 「移动端同步」 in the page. There was no
 * mechanism behind the translations — a `t()` call happened where somebody remembered one, and the
 * next component written did not. Memory is not a mechanism, so this is.
 *
 * What counts as a finding: a string literal or a piece of JSX text containing Han characters, in
 * the renderer's source. Comments do not — this codebase reasons in Chinese in its comments on
 * purpose, and that is writing for the people who maintain it rather than for the people using it.
 *
 *   node scripts/check-i18n.mjs             # 报告，非零退出表示有新增
 *   node scripts/check-i18n.mjs --list      # 把每一条打出来，改的时候看
 *   node scripts/check-i18n.mjs --update    # 把当前状况写回基线（只允许变小）
 *   node scripts/check-i18n.mjs --rebase    # 脚本认得更多了，重新记账（允许变大）
 *
 * The baseline is a count per file, not a list of strings: a list would have to be regenerated on
 * every rewording and would turn into a file nobody reads. A count catches the two things that
 * matter — a new file that hardcodes, and an old one that grows — and cannot be satisfied by moving
 * a string from one line to another.
 */

import { readFile, writeFile } from "node:fs/promises";
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "packages/desktop/src");
const BASELINE = join(ROOT, "scripts/i18n-baseline.json");

const HAN = /[一-鿿]/;

/**
 * Where Chinese is the content rather than the interface.
 *
 * `i18n/messages` is the translations themselves — the one place the words are supposed to be in
 * seven languages at once.
 *
 * `format-catalog` is code samples. Each entry exists to put something on every colour a syntax
 * theme declares, so its strings are `"你好"` inside a Go function and `"匿名"` inside a Python
 * dataclass. Those are the sample's subject matter, not labels: translating them would leave the
 * samples doing the same job in a different alphabet, and nobody reads them as sentences.
 *
 * `release-notes` writes the changelog, and its `lang` is the language of the *release* — the user
 * picks it in the release panel with a control of its own, separately from the interface. Wiring it
 * to the window's language would mean an English window could no longer publish Chinese notes,
 * which is the whole point of that control.
 *
 * `markdown/inline` holds one CJK *character range* inside a regular expression — the check that
 * decides where a bare URL ends. Those are code points, not words, and the scanner has no way to
 * tell a range apart from a string without lexing regex literals, which is a lot of machinery for
 * one line.
 *
 * `locales` is the same thing for the interface language, down to the single-character mark each
 * one is drawn with — 「中」, 「繁」, 「日」. Those are the writing systems naming themselves.
 *
 * `commit-language` is a list of languages, each written in itself — 「简体中文」, 「日本語」,
 * 「Русский」. That is how a language picker is supposed to read, and translating an entry would
 * make it name a language in a language its speaker may not read.
 *
 * Nothing else belongs here. Other text going *to* a model would qualify on the same reasoning —
 * the language a prompt is written in is a property of the prompt — but the renderer has none of
 * it; what looked like it (`lib/thinking-words`) is the phrase beside the timer, which is exactly
 * the kind of thing a person reads.
 */
const EXEMPT = [
	"i18n/messages/",
	"i18n/translate.ts",
	"features/settings/format-catalog.ts",
	"features/git/release-notes.ts",
	"features/git/commit-language.ts",
	"i18n/locales.ts",
	"lib/markdown/inline.ts",
];

/**
 * Strip comments, so the reasoning this codebase writes in Chinese is not a finding.
 *
 * Newlines survive — including the ones inside a block comment, which are replaced one for one.
 * Anything else and every line number after the first `/* *\/` is wrong, which matters twice: the
 * `--list` output stops being clickable, and the inline exemption below is keyed by line.
 */
function stripComments(src) {
	let out = "";
	let i = 0;
	while (i < src.length) {
		const two = src.slice(i, i + 2);
		if (two === "//") {
			// Stop *at* the newline and let the loop copy it: adding one here as well shifted every
			// line after a `//` comment by one, which is why `--list` line numbers never quite lined
			// up with the file.
			i = src.indexOf("\n", i);
			if (i === -1) i = src.length;
		} else if (two === "/*") {
			const end = src.indexOf("*/", i + 2);
			const body = src.slice(i, end === -1 ? src.length : end + 2);
			i = end === -1 ? src.length : end + 2;
			out += body.replace(/[^\n]/g, "");
		} else {
			out += src[i];
			i += 1;
		}
	}
	return out;
}

/**
 * Lines a `i18n-exempt` note has spoken for.
 *
 * There is a third kind of Chinese string, next to "a label" and "a whole file of samples": one
 * that a person never reads and that must not move. `CARRY_ON_PROMPTS` in `store/derive.ts` is the
 * case that produced this — the text 「继续」 sends, which `grouping.ts` matches saved transcripts
 * against to keep an interrupted turn's timings whole. Translating it froze the table into the
 * launch language and quietly stopped older conversations from matching. A file-wide exemption
 * would be wrong here (the same file has real notices in it), so the note is a line away from what
 * it excuses, with the reason written beside it.
 *
 * It covers from the next line to the first blank one, so one note speaks for a whole table rather
 * than needing to be repeated on every row.
 */
function exemptLines(source) {
	const lines = source.split("\n");
	const exempt = new Set();
	for (let i = 0; i < lines.length; i++) {
		if (!/i18n-exempt\b/.test(lines[i])) continue;
		for (let j = i + 1; j < lines.length && lines[j].trim() !== ""; j++) exempt.add(j + 1);
	}
	return exempt;
}

/** Every user-visible Chinese string in one file, as `{ line, text }`. */
export function findings(source) {
	const stripped = stripComments(source);
	const spared = exemptLines(source);
	const found = [];
	const at = (index) => stripped.slice(0, index).split("\n").length;
	const keep = (line, text) => {
		if (!spared.has(line)) found.push({ line, text });
	};
	for (const match of stripped.matchAll(/"[^"\n]*"|'[^'\n]*'|`[^`]*`/g)) {
		if (HAN.test(match[0])) keep(at(match.index), match[0].trim().slice(0, 80));
	}
	/*
	 * JSX text, including the half of it that sits beside an expression.
	 *
	 * `<span>{n} 个活跃日</span>` is a sentence with a number in the middle of it, and the first
	 * version of this looked only for runs with no braces at all — so every count, every duration,
	 * every "N files changed" in the app was invisible to it. Those are exactly the strings most
	 * likely to be written inline and never translated, because they do not look like labels.
	 *
	 * The expressions are blanked rather than skipped: what is left is the text a reader sees, and
	 * a `{...}` between two Chinese words must not join them into one finding.
	 */
	for (const match of stripped.matchAll(/>([^<>]*)</g)) {
		const text = match[1].replace(/\{[^{}]*\}/g, " ");
		if (HAN.test(text)) keep(at(match.index), text.trim().replace(/\s+/g, " ").slice(0, 80));
	}
	return found;
}

function walk(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) walk(path, out);
		else if (/\.tsx?$/.test(name)) out.push(path);
	}
	return out;
}

const args = new Set(process.argv.slice(2));
const files = walk(SOURCE).sort();
const counts = {};
const detail = {};

for (const path of files) {
	const key = relative(SOURCE, path);
	if (EXEMPT.some((prefix) => key.startsWith(prefix))) continue;
	const found = findings(await readFile(path, "utf8"));
	if (found.length > 0) {
		counts[key] = found.length;
		detail[key] = found;
	}
}

const baseline = JSON.parse(await readFile(BASELINE, "utf8").catch(() => "{}"));
const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
const was = Object.values(baseline).reduce((sum, n) => sum + n, 0);

if (args.has("--update") || args.has("--rebase")) {
	/*
	 * 三种写基线的理由，只有一种不需要解释。
	 *
	 * `--update` 是清掉了一批，数字只能变小。第一次是记账，那时还没有「变多」可言。
	 *
	 * `--rebase` 是这个脚本自己变严了——比如学会认 `{n} 个活跃日` 这种夹着表达式的句子之后，
	 * 一夜之间多出两百多条。那些不是新写的债，是一直都在、只是看不见。它必须单独一个开关，
	 * 因为「检查变严」和「代码变差」在数字上长得一模一样，而混用会让基线失去意义。
	 */
	const fresh = Object.keys(baseline).length === 0;
	if (!fresh && total > was && !args.has("--rebase")) {
		console.error(`\n✖ 基线只能变小：现在 ${total} 条，基线 ${was} 条。先把新增的翻译掉。\n` +
			`（如果是这个脚本认得更多了，用 --rebase 重新记账。）\n`);
		process.exit(1);
	}
	await writeFile(BASELINE, `${JSON.stringify(counts, null, "\t")}\n`);
	console.log(fresh ? `\n✓ 基线记下 ${total} 条，从这里开始只能变少\n` : total > was ? `\n✓ 基线重记为 ${total} 条（原 ${was}），多出来的是这次才认得的\n` : `\n✓ 基线 ${was} → ${total} 条，少了 ${was - total} 条\n`);
	process.exit(0);
}

if (args.has("--list")) {
	for (const [file, found] of Object.entries(detail).sort((a, b) => b[1].length - a[1].length)) {
		console.log(`\n${file}  (${found.length})`);
		for (const one of found) console.log(`  ${String(one.line).padStart(4)}  ${one.text}`);
	}
}

const grown = [];
for (const [file, n] of Object.entries(counts)) {
	const before = baseline[file] ?? 0;
	if (n > before) grown.push(`  ${file}: ${before} → ${n}`);
}

if (grown.length > 0) {
	console.error(
		`\n✖ 这些文件里的硬编码中文变多了：\n${grown.join("\n")}\n\n` +
		`界面文案要走 i18n：组件里用 useI18n() 的 t()，别处用 translate()，key 加进\n` +
		`packages/desktop/src/i18n/messages/ 的七个目录里（zh-CN.ts 是源，其余 satisfies 它，\n` +
		`所以漏掉一种语言是类型错误）。\n\n` +
		`看清单：  node scripts/check-i18n.mjs --list\n` +
		`清完之后：node scripts/check-i18n.mjs --update\n`,
	);
	process.exit(1);
}

const shrunk = was - total;
console.log(
	shrunk > 0
		? `✓ 硬编码中文 ${total} 条，比基线少 ${shrunk} 条。记得 node scripts/check-i18n.mjs --update`
		: `✓ 硬编码中文 ${total} 条，没有新增`,
);
