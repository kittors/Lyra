/**
 * The tools that ship with the app, grouped by what they touch.
 *
 * One list, because there used to be two. The kernel's tools plugin registered four groups and
 * `index.ts` kept a flat list of its own beside them — and they drifted apart: `rule`, `recall`,
 * `learn`, `lsp` and `web_search` only ever reached the flat one. The desktop binds the kernel
 * registry, so for the desktop those five tools did not exist: they were written, tested, shipped,
 * and never advertised to a model. 23,000 tool calls of real session logs contain none of them.
 * Nothing compared the two lists, so nothing said so. `test/tool-registry.test.ts` now does.
 *
 * Grouped rather than flat so a configuration can drop a whole area — an agent with no shell, one
 * that reads but never writes — by not registering that group. The order within a group is the
 * order the model is told about them.
 */

import { skillTool } from "../skills/tool.ts";
import type { Tool } from "../types.ts";
import { askUserTool } from "./ask-user.ts";
import { bashOutputTool, bashTool } from "./bash.ts";
import { editTool } from "./edit.ts";
import { globTool } from "./glob.ts";
import { grepTool } from "./grep.ts";
import { learnTool } from "./learn.ts";
import { lsTool } from "./ls.ts";
import { lspTool } from "./lsp.ts";
import { previewTool } from "./preview.ts";
import { readTool } from "./read.ts";
import { recallTool } from "./recall.ts";
import { ruleTool } from "./rule.ts";
import { webSearchTool } from "./search.ts";
import { symbolTool } from "./symbol.ts";
import { taskTool } from "./task.ts";
import { todoTool } from "./todo.ts";
import { webFetchTool } from "./web.ts";
import { writeTool } from "./write.ts";

/** Reading and changing files, and asking what a symbol is. */
export const FILE_TOOLS = [
	readTool,
	writeTool,
	editTool,
	lsTool,
	globTool,
	grepTool,
	symbolTool,
	lspTool,
] as unknown as Tool[];

/** Running commands, and reading what a backgrounded one has printed since. */
export const SHELL_TOOLS = [bashTool, bashOutputTool] as unknown as Tool[];

/** The agent's own working memory: its plan, its delegates, its rules, what it has been told. */
export const AGENT_TOOLS = [
	todoTool,
	taskTool,
	skillTool,
	ruleTool,
	recallTool,
	learnTool,
	askUserTool,
] as unknown as Tool[];

/** Reaching outside the machine, and showing the result. */
export const WEB_TOOLS = [webFetchTool, webSearchTool, previewTool] as unknown as Tool[];

/** Every built-in, in the order they are advertised to the model. */
export function builtinToolGroups(): Tool[][] {
	return [FILE_TOOLS, SHELL_TOOLS, AGENT_TOOLS, WEB_TOOLS];
}
