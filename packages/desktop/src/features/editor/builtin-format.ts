/**
 * Built-in indentation and syntax-directed formatting without external CLI tools.
 *
 * Runs completely in-memory in pure JavaScript / CodeMirror runtime across macOS and Windows.
 * For languages without external CLI binaries, this ensures reliable, zero-dependency formatting
 * for indentation, braces, scopes, and whitespace.
 */

import { EditorState, type Extension } from "@codemirror/state";
import { ensureSyntaxTree, indentRange, indentUnit, syntaxTree } from "@codemirror/language";
import type { FormatOptions } from "./format.ts";
import { GRAMMARS } from "../../lib/code/highlight.ts";

/**
 * Normalise indentation using a bracket-and-keyword aware state machine.
 * Works across shell, protobuf, cmake, LaTeX, and other stream/legacy formats.
 */
function indentBlockFallback(source: string, indent: string): string {
	const lines = source.split(/\r?\n/);
	const result: string[] = [];
	let depth = 0;

	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		if (!trimmed) {
			result.push("");
			continue;
		}

		let net = 0;
		let leadingCloses = 0;
		let inString: string | false = false;

		for (let c = 0; c < trimmed.length; c++) {
			const ch = trimmed[c];
			if (inString) {
				if (ch === inString && trimmed[c - 1] !== "\\") inString = false;
				continue;
			}
			if (ch === "\"" || ch === "'" || ch === "`") {
				inString = ch;
				continue;
			}
			if (ch === "#" || (ch === "/" && trimmed[c + 1] === "/")) break;

			if (ch === "{" || ch === "[" || ch === "(") {
				net++;
			} else if (ch === "}" || ch === "]" || ch === ")") {
				net--;
				if (net < 0 && -net > leadingCloses) {
					leadingCloses = -net;
				}
			}
		}

		let kwLeading = 0;
		let kwDelta = 0;

		// Shell keywords
		if (/^(fi|done|esac|elif|else)\b/.test(trimmed)) kwLeading++;
		if (/\b(then|do|else)\b$/.test(trimmed) || /^(if|for|while|until|case)\b/.test(trimmed)) {
			if (!/;\s*fi$/.test(trimmed) && !/;\s*done$/.test(trimmed)) kwDelta++;
		}
		if (/^(fi|done|esac)\b/.test(trimmed)) kwDelta--;

		// CMake keywords
		if (/^end(function|macro|if|foreach|while)\b/i.test(trimmed)) {
			kwLeading++;
			kwDelta--;
		} else if (/^(function|macro|if|foreach|while)\b/i.test(trimmed)) {
			kwDelta++;
		}

		// LaTeX environments
		if (trimmed.startsWith("\\end{")) {
			kwLeading++;
			kwDelta--;
		} else if (trimmed.startsWith("\\begin{")) {
			kwDelta++;
		}

		const curIndent = Math.max(0, depth - leadingCloses - kwLeading);
		result.push(indent.repeat(curIndent) + trimmed);
		depth = Math.max(0, depth + net + kwDelta);
	}

	return result.join("\n");
}

/**
 * 缩进本身就是语法的语言，这里一律不碰缩进。
 *
 * 这个兜底做的事是「重新算每一行该缩多少」，而算错的代价按语言分两档。大括号语言里算错是难看；
 * Python、YAML、Haskell 里算错是改语义——一行少缩一级，它就换了个代码块。
 *
 * 就算算对了也仍然不该改。实测：把目录里的 Python 样例喂进来，四空格缩进被整齐地改成两空格
 * （因为默认 `tabWidth` 是 2），层级关系没错、代码也还能跑——但 PEP 8 写的是四空格，于是每个
 * 没装 ruff 的人保存一次 Python 文件，就得到一份不符合社区惯例的 diff。
 *
 * 所以这些语言只清行尾空白。真要格式化它们，装那个语言自己的工具——`format-file.ts` 会优先用它，
 * 这里只在它不在时兜底，而兜底的第一原则是别把事情弄得更糟。
 */
const INDENT_IS_SYNTAX = new Set(["py", "pyi", "pyw", "yaml", "yml", "hs", "lhs", "coffee", "nim", "elm", "sass", "styl", "haml", "slim", "pug", "jade"]);

/** 行尾空白无论如何都该清掉：它在任何语言里都不表达任何东西。 */
function trimTrailing(source: string): string {
	return `${source
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.join("\n")
		.trimEnd()}\n`;
}

/** Collapse leading tabs/spaces onto the indent this save asked for. */
function alignIndent(text: string, indentStr: string, tabSize: number): string {
	if (indentStr === "\t") {
		const block = " ".repeat(tabSize);
		return text.replace(new RegExp(`^(?:${block})+`, "gm"), (spaces) => "\t".repeat(spaces.length / tabSize));
	}
	return text.replace(/^\t+/gm, (tabs) => indentStr.repeat(tabs.length));
}

/** How long one document may take to parse before the grammar is given up on. */
const PARSE_BUDGET_MS = 5_000;

/**
 * A state whose syntax tree covers the whole document, or null when it cannot be had in the budget.
 *
 * `EditorState.create` parses only the first 3,000 characters, and for at most 20ms — what an editor
 * needs to paint its first screen, with the rest parsed later, in the background, by the view. There
 * is no view here, and `indentRange` skips every line the tree does not reach: a longer file had its
 * top reindented and the rest left as it was, and on a machine busy enough to spend the 20ms first,
 * even a short one came out differently each time — a formatter that changed its own output on the
 * second pass.
 *
 * `ensureSyntaxTree` finishes the parse, but in place, and `syntaxTree` — which indentation reads —
 * still answers from the tree the state was created with. An empty transaction is what hands the
 * finished tree to a state.
 */
function fullyParsed(doc: string, extensions: Extension[]): EditorState | null {
	const created = EditorState.create({ doc, extensions });
	if (!ensureSyntaxTree(created, created.doc.length, PARSE_BUDGET_MS)) return null;
	const state = created.update({}).state;
	return syntaxTree(state).length >= state.doc.length ? state : null;
}

/**
 * Format source text using built-in CodeMirror grammars and indentation engines.
 */
export async function formatWithBuiltin(
	extension: string,
	source: string,
	options: FormatOptions,
): Promise<string> {
	if (INDENT_IS_SYNTAX.has(extension)) return trimTrailing(source);

	const indentStr = options.useTabs ? "\t" : " ".repeat(options.tabWidth || 2);
	const tabSize = options.tabWidth || 2;
	// 1. If we have a CodeMirror grammar with syntax tree indentation, use it
	const grammarLoader = GRAMMARS[extension];
	if (grammarLoader) {
		try {
			const ext = await grammarLoader();
			const extensions: Extension[] = [
				Array.isArray(ext) ? ext : [ext],
				indentUnit.of(indentStr),
				EditorState.tabSize.of(tabSize),
			];
			/*
			 * Run indentRange until it stops changing the document.
			 *
			 * One pass is not enough: Rust's grammar first keeps rustfmt's four spaces (no
			 * changes), then a second EditorState with the same indentUnit rewrites them to
			 * tabWidth. Kotlin used to fall through to the bracket scanner on an empty first
			 * pass and break the braces. Either way, save-twice must be a no-op.
			 */
			let text = source;
			for (let i = 0; i < 3; i++) {
				const state = fullyParsed(text, extensions);
				// A grammar that cannot finish in the budget gets no half-indented file: the fallback below.
				if (!state) throw new Error("the grammar did not finish parsing this document");
				const tr = indentRange(state, 0, state.doc.length);
				if (!tr || tr.length === 0) break;
				const next = state.update({ changes: tr }).state.doc.toString();
				if (next === text) break;
				text = next;
			}
			return trimTrailing(alignIndent(text, indentStr, tabSize));
		} catch {
			// Fall back to block indentation scanner
		}
	}

	// 2. Otherwise run bracket & block indentation engine
	const fallback = indentBlockFallback(source, indentStr);
	return fallback
		.split(/\r?\n/)
		.map((l) => l.trimEnd())
		.join("\n")
		.trimEnd() + "\n";
}
