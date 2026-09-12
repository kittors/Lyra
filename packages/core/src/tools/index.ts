import type { Tool } from "../types.ts";
import { builtinToolGroups } from "./groups.ts";

/**
 * Where the built-in tool list comes from.
 *
 * `ctx.tools` is the real registry — it is what lets a plugin add a tool, or displace one with
 * its own implementation. This binding is how the session reaches it without every caller having
 * to be handed a context; unbound, the groups in `groups.ts` are used, which is what tests and
 * small tools see.
 *
 * Both paths read the same groups. They did not always: this function kept a flat list of its own
 * and the kernel plugin registered another, and five tools existed in only one of them. See
 * `groups.ts`.
 */
let registry: { all(): Tool[] } | null = null;

export function useToolRegistry(next: { all(): Tool[] } | null): void {
	registry = next;
}

export function builtinTools(): Tool[] {
	if (registry) return registry.all();
	return staticTools();
}

export function staticTools(): Tool[] {
	return builtinToolGroups().flat();
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
export { askUserTool } from "./ask-user.ts";
export { ruleTool, RULES_KEY } from "./rule.ts";
export { htmlToText, webFetchTool } from "./web.ts";
export { webSearchTool } from "./search.ts";
export { writeTool } from "./write.ts";
