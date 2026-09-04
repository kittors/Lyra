import { skillTool } from "../skills/tool.ts";
import type { Tool } from "../types.ts";
import { bashOutputTool, bashTool } from "./bash.ts";
import { editTool } from "./edit.ts";
import { globTool } from "./glob.ts";
import { grepTool } from "./grep.ts";
import { lsTool } from "./ls.ts";
import { readTool } from "./read.ts";
import { recallTool } from "./recall.ts";
import { symbolTool } from "./symbol.ts";
import { taskTool } from "./task.ts";
import { previewTool } from "./preview.ts";
import { learnTool } from "./learn.ts";
import { ruleTool } from "./rule.ts";
import { todoTool } from "./todo.ts";
import { webSearchTool } from "./search.ts";
import { webFetchTool } from "./web.ts";
import { writeTool } from "./write.ts";

/** The built-in tool set, in the order they are advertised to the model. */
/**
 * Where the built-in tool list comes from.
 *
 * `ctx.tools` is the real registry — it is what lets a plugin add a tool, or displace one with
 * its own implementation. This binding is how the session reaches it without every caller having
 * to be handed a context; unbound, the list below is used, which is what tests and small tools
 * see.
 */
let registry: { all(): Tool[] } | null = null;

export function useToolRegistry(next: { all(): Tool[] } | null): void {
	registry = next;
}

export function builtinTools(): Tool[] {
	if (registry) return registry.all();
	return staticTools();
}

function staticTools(): Tool[] {
	return [
		readTool,
		writeTool,
		editTool,
		lsTool,
		globTool,
		grepTool,
		symbolTool,
		bashTool,
		bashOutputTool,
		todoTool,
		taskTool,
		skillTool,
		ruleTool,
		recallTool,
		learnTool,
		webFetchTool,
		webSearchTool,
		previewTool,
	] as Tool[];
}

/** Tools a read-only agent may use. */
export const READ_ONLY_TOOL_NAMES = ["read", "ls", "glob", "grep", "bash_output", "web_fetch", "recall"];

export { bashOutputTool, bashTool, isReadOnlyCommand } from "./bash.ts";
export { computeDiff, formatDiff, type DiffHunk, type DiffLine, type FileDiff } from "./diff.ts";
export { editTool } from "./edit.ts";
export { globToRegExp, globTool } from "./glob.ts";
export { grepTool } from "./grep.ts";
export { invalidateIndex, symbolTool } from "./symbol.ts";
export { lsTool } from "./ls.ts";
export { recallTool } from "./recall.ts";
export { displayPath, resolveWorkspacePath } from "./paths.ts";
export { hasRead, markRead, readTool } from "./read.ts";
export { AGENTS_KEY, BUILTIN_AGENTS, taskTool, type AgentDefinition } from "./task.ts";
export { previewTool } from "./preview.ts";
export { readTodos, todoTool, TODOS_KEY, type TodoItem } from "./todo.ts";
export { ruleTool, RULES_KEY } from "./rule.ts";
export { htmlToText, webFetchTool } from "./web.ts";
export { webSearchTool } from "./search.ts";
export { writeTool } from "./write.ts";
