/**
 * The `lsp` tool: who uses this symbol, where is it defined, what did I just break.
 *
 * The operation that justifies the whole layer is `references`, and the reason is one specific
 * silent failure. `grep` cannot see an aliased import — `import { parse as p }`, then `p(...)` —
 * and it cannot follow a re-export chain. A rename done from a grep finds most callsites, misses
 * some, and *looks finished*. Nothing errors. The compiler finds out, or production does.
 *
 * The tool always answers. With no language server it does the text search and says so, in a
 * sentence naming what a text search cannot see — because "found 6" and "text search found 6,
 * which may be missing aliased imports" lead to different next actions, and the second one is the
 * true statement.
 */

import { relative, resolve } from "node:path";
import { errorResult } from "../agent/tool-run.ts";
import { textualReferences, TEXTUAL_CAVEAT } from "../lsp/fallback.ts";
import { CODE_INTEL_KEY, CodeIntelManager } from "../lsp/manager.ts";
import type { CodeLocation } from "../lsp/types.ts";
import { walkFiles } from "../capability/fs.ts";
import type { Tool, ToolContext, ToolResult } from "../types.ts";
import { resolveWorkspacePath } from "./paths.ts";

interface LspArgs {
	operation: "references" | "definition" | "diagnostics" | "rename";
	path: string;
	line?: number;
	column?: number;
	symbol?: string;
	newName?: string;
}

const SEARCHABLE = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

export const lspTool: Tool<LspArgs> = {
	name: "lsp",
	snippet: "Find references, definitions and type errors",
	guidelines: [
		"Before changing an exported symbol, use `lsp references` to find every callsite. A grep misses aliased imports and re-export chains, and the rename will look finished while some callers are broken.",
	],
	description:
		"Ask the language server about a symbol.\n\n" +
		"- `references` — every place a symbol is used, including aliased imports and re-exports that a text search cannot see. Use this before changing anything exported.\n" +
		"- `definition` — where a symbol comes from, following re-export chains.\n" +
		"- `diagnostics` — type errors in one file, without running a full build.\n" +
		"- `rename` — every edit needed to rename a symbol across the project, computed by the server.\n\n" +
		"Give `line` and `column` when you know them (from a `read`), or `symbol` to have the position found for you. " +
		"When no language server is available the answer falls back to a text search and says so.",
	parameters: {
		type: "object",
		properties: {
			operation: { type: "string", enum: ["references", "definition", "diagnostics", "rename"], description: "What to ask." },
			path: { type: "string", description: "File the symbol is in, relative to the workspace root." },
			line: { type: "number", description: "1-indexed line of the symbol." },
			column: { type: "number", description: "1-indexed column of the symbol." },
			symbol: { type: "string", description: "Symbol name, used to locate it when line/column are not given." },
			newName: { type: "string", description: "Required for `rename`." },
		},
		required: ["operation", "path"],
		additionalProperties: false,
	},
	summarize: (args) => `lsp ${args.operation}: ${args.symbol ?? args.path}`,

	async execute(args, ctx): Promise<ToolResult> {
		let absolute: string;
		try {
			absolute = resolveWorkspacePath(ctx.cwd, args.path);
		} catch (error) {
			return errorResult(error instanceof Error ? error.message : String(error));
		}

		const manager = getManager(ctx);
		const backend = await manager.acquire(absolute, ctx.cwd).catch(() => null);

		if (args.operation === "diagnostics") {
			if (!backend) {
				/*
				 * No degraded form of this one exists. A text search cannot produce type errors, and
				 * inventing something adjacent — a lint pass, a regex for obvious mistakes — would
				 * answer a question nobody asked while looking like an answer to this one.
				 */
				return {
					content: [{ type: "text", text: "这个文件没有可用的语言服务器，拿不到类型诊断。可以用 bash 跑一次类型检查。" }],
				};
			}
			const found = await backend.diagnostics(absolute);
			const body = found.length === 0
				? "没有诊断。"
				: found.map((d) => `${relative(ctx.cwd, d.path)}:${d.line}:${d.column} ${d.severity} ${d.message}`).join("\n");
			return { content: [{ type: "text", text: body }], details: { kind: "lsp", operation: "diagnostics", count: found.length } };
		}

		const position = await locate(args, absolute);
		if (!position) {
			return errorResult(
				args.symbol
					? `在 ${args.path} 里找不到符号 "${args.symbol}"。给出 line 与 column，或者先 read 这个文件确认名字。`
					: "需要 `line` 与 `column`，或者一个 `symbol` 名字。",
			);
		}

		if (args.operation === "rename") {
			if (!args.newName?.trim()) return errorResult("`newName` is required for rename.");
			if (!backend) {
				/*
				 * Refused rather than approximated. A textual rename is the exact operation this
				 * whole layer exists to prevent — it is the one that silently drops callsites.
				 */
				return errorResult(
					"没有语言服务器，不能安全地重命名——文本替换会漏掉别名导入和重导出链，而且不会报错。" +
						"改用 `lsp references` 看清楚有哪些地方，再逐个 edit。",
				);
			}
			const edits = await backend.rename(absolute, position.line, position.column, args.newName);
			const byFile = new Map<string, number>();
			for (const edit of edits) byFile.set(edit.path, (byFile.get(edit.path) ?? 0) + 1);
			const summary = [...byFile.entries()].map(([file, count]) => `${relative(ctx.cwd, file)} (${count})`).join("\n");
			return {
				content: [{ type: "text", text: `重命名需要改 ${edits.length} 处，分布在 ${byFile.size} 个文件：\n${summary}` }],
				details: { kind: "lsp", operation: "rename", edits },
			};
		}

		if (backend) {
			const found =
				args.operation === "references"
					? await backend.references(absolute, position.line, position.column)
					: await backend.definition(absolute, position.line, position.column);
			return {
				content: [{ type: "text", text: render(found, ctx.cwd, "exact") }],
				details: { kind: "lsp", operation: args.operation, confidence: "exact", count: found.length },
			};
		}

		if (args.operation === "definition") {
			return {
				content: [{ type: "text", text: "没有语言服务器。用 `symbol` 工具查定义，或者用 `grep` 搜声明。" }],
			};
		}

		const name = args.symbol ?? position.word;
		if (!name) return errorResult("没有语言服务器时，需要 `symbol` 才能做文本搜索。");
		const files = (await walkFiles(ctx.cwd, SEARCHABLE, 8)) ?? [];
		const found = await textualReferences(files, name, ctx.cwd);
		return {
			content: [{ type: "text", text: `${render(found, ctx.cwd, "textual")}\n\n${TEXTUAL_CAVEAT}` }],
			details: { kind: "lsp", operation: "references", confidence: "textual", count: found.length },
		};
	},
};

function render(items: CodeLocation[], cwd: string, confidence: "exact" | "textual"): string {
	if (items.length === 0) return confidence === "exact" ? "语言服务器没有找到引用。" : "文本搜索没有找到。";
	const head = confidence === "exact" ? `找到 ${items.length} 处（语言服务器，含别名导入与重导出）：` : `文本搜索找到 ${items.length} 处：`;
	const lines = items
		.slice(0, 200)
		.map((item) => `${relative(cwd, resolve(cwd, item.path)) || item.path}:${item.line}:${item.column}${item.text ? `  ${item.text}` : ""}`);
	const more = items.length > 200 ? `\n… 还有 ${items.length - 200} 处` : "";
	return `${head}\n${lines.join("\n")}${more}`;
}

/**
 * Turn a symbol name into a position, when the caller gave one instead of coordinates.
 *
 * Prefers a line that looks like a declaration. Asking the server about a *usage* of a symbol
 * returns the same reference set in most cases, but not for a shadowed name — and the declaration
 * is the position a person means when they name a symbol.
 */
async function locate(args: LspArgs, absolute: string): Promise<{ line: number; column: number; word?: string } | null> {
	if (typeof args.line === "number" && typeof args.column === "number") {
		return { line: args.line, column: args.column, word: args.symbol };
	}
	if (!args.symbol) return null;

	const { readFile } = await import("node:fs/promises");
	const content = await readFile(absolute, "utf8").catch(() => null);
	if (content === null) return null;

	const lines = content.split("\n");
	const word = new RegExp(`\\b${args.symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
	const declaration = new RegExp(`\\b(?:function|class|const|let|var|interface|type|enum)\\s+${args.symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);

	let firstUse: { line: number; column: number } | null = null;
	for (let i = 0; i < lines.length; i += 1) {
		const match = word.exec(lines[i]);
		if (!match) continue;
		if (declaration.test(lines[i])) return { line: i + 1, column: match.index + 1, word: args.symbol };
		firstUse ??= { line: i + 1, column: match.index + 1 };
	}
	return firstUse ? { ...firstUse, word: args.symbol } : null;
}

function getManager(ctx: ToolContext): CodeIntelManager {
	const existing = ctx.state.get(CODE_INTEL_KEY);
	if (existing instanceof CodeIntelManager) return existing;
	const manager = new CodeIntelManager();
	ctx.state.set(CODE_INTEL_KEY, manager);
	return manager;
}
