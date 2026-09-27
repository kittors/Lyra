/**
 * `allowed-tools`, read the way skills in the wild write it.
 *
 * `.claude/skills` is loaded as-is, and Claude Code accepts three spellings of this field — a YAML
 * list, or one string separated by spaces or by commas — with its own tool names (`Read`,
 * `WebFetch`), sometimes narrowed by a permission pattern (`Bash(git add *)`). The loader used to
 * accept only a list and compared its names exactly against ours, which are lowercase. A string
 * was dropped, so the skill ran with every tool; a list matched nothing, so it ran with none but
 * `skill`. Neither said a word.
 *
 * A name that reads as none of our tools is kept as written and reported, not dropped. Enforcement
 * treats an empty list as no restriction, so dropping a skill's only names would lift the very
 * restriction it asked for; a name kept as written matches no tool, and the restriction stands.
 */

export interface AllowedTools {
	/** Our tool names, deduplicated, in the order written. Undefined when the field restricts nothing. */
	tools?: string[];
	/** One sentence per thing that could not be taken as written, for the author to see. */
	problems: string[];
}

/**
 * Every built-in tool's name.
 *
 * Copied rather than imported: the tool modules import the skill tool, which imports the loader,
 * which imports this. `test/skill-allowed-tools.test.ts` holds the copy to `builtinToolGroups()`.
 */
const BUILTIN_TOOLS = [
	"read",
	"write",
	"edit",
	"ls",
	"glob",
	"grep",
	"symbol",
	"lsp",
	"bash",
	"bash_output",
	"todo_write",
	"task",
	"skill",
	"rule",
	"recall",
	"learn",
	"ask_user",
	"web_fetch",
	"web_search",
	"preview",
];

/** Case, `_` and `-` tell no two tools apart here, and Claude Code writes ours without the `_`. */
const fold = (name: string): string => name.toLowerCase().replace(/[-_]/g, "");

/**
 * Claude Code's tools whose counterpart here goes by another name, keyed by `fold`.
 *
 * Its other names need no entry: `WebFetch` and `web_fetch` fold to the same key. Tools with no
 * counterpart (`NotebookEdit`, `Workflow`, `PowerShell`, …) are left out on purpose, so that they
 * are reported rather than quietly granting something near them.
 */
const RENAMED = new Map([
	// Its subagent tool, called `Task` until it was renamed; `Task` folds onto ours as it is.
	["agent", "task"],
	["askuserquestion", "ask_user"],
	["multiedit", "edit"],
	// Reading a background job and stopping one are both `bash_output` here: it takes `kill`.
	["taskoutput", "bash_output"],
	["taskstop", "bash_output"],
	["killshell", "bash_output"],
	["killbash", "bash_output"],
	// Its task list is four tools; ours is one checklist.
	["taskcreate", "todo_write"],
	["taskget", "todo_write"],
	["tasklist", "todo_write"],
	["taskupdate", "todo_write"],
]);

// A Map, not an object literal: `constructor` is a name someone can write.
const KNOWN = new Map([...BUILTIN_TOOLS.map((name) => [fold(name), name] as const), ...RENAMED]);

/** `Bash(git add *)` → `Bash` and `git add *`. */
const SCOPED = /^([^\s()]+)\((.*)\)$/s;

/**
 * What a tool name looks like here, host-provided ones included. The desktop adds `browser_open`
 * and its siblings, which the loader cannot see, so an unknown name of this shape is taken on trust
 * rather than reported.
 */
const OUR_SHAPE = /^[a-z][a-z0-9_]*$/;

export function readAllowedTools(value: unknown): AllowedTools {
	if (value === undefined || value === null) return { problems: [] };
	if (typeof value !== "string" && !Array.isArray(value)) {
		return { problems: [`\`allowed-tools\` 要写成列表或字符串，这里是 \`${show(value)}\`，已忽略：这个技能不限制工具。`] };
	}

	const problems: string[] = [];
	const items: unknown[] = typeof value === "string" ? [value] : value;
	const strays = items.filter((item) => typeof item !== "string");
	if (strays.length > 0) problems.push(`\`allowed-tools\` 里不是工具名的项已跳过：${list(strays.map(show))}。`);

	const tools: string[] = [];
	const scoped: string[] = [];
	const widened: string[] = [];
	const unmatched: string[] = [];
	const serverWide: string[] = [];
	for (const entry of items.filter((item): item is string => typeof item === "string").flatMap(splitEntries)) {
		const match = SCOPED.exec(entry);
		const name = match?.[1] ?? entry;
		// MCP tools are `mcp__<server>__<tool>` here as in Claude Code, and their case is part of the name.
		const mcp = name.startsWith("mcp__");
		const known = mcp ? name : KNOWN.get(fold(name));
		const tool = known ?? name;
		add(tools, tool);
		if (mcp && namesWholeServer(name)) add(serverWide, entry);
		else if (!known && !OUR_SHAPE.test(name)) add(unmatched, entry);
		else if (match?.[2].trim()) {
			add(scoped, entry);
			add(widened, tool);
		}
	}

	if (scoped.length > 0) {
		/*
		 * Widened to the whole tool rather than refused. There is no per-command or per-path scope
		 * here to narrow it with, and refusing `bash` would leave a `Bash(git commit *)` skill unable
		 * to do the one thing it names.
		 */
		problems.push(`\`allowed-tools\` 里括号中的范围在 Lyra 不生效，${list(widened)} 按整个工具放行：${list(scoped)}。`);
	}
	if (unmatched.length > 0) problems.push(`\`allowed-tools\` 里对应不到 Lyra 工具的项不会放行任何调用：${list(unmatched)}。`);
	if (serverWide.length > 0) {
		problems.push(`\`allowed-tools\` 里指整个 MCP 服务的项不会放行任何调用，Lyra 只认完整的工具名 \`mcp__<服务>__<工具>\`：${list(serverWide)}。`);
	}
	return { tools, problems };
}

/**
 * Split on commas and whitespace, but not inside a scope's parentheses: Claude Code's own skills
 * write `Agent(scan-inventory, scan-verifier)` and `Bash(git add *)`, each of them one entry.
 */
function splitEntries(text: string): string[] {
	const entries: string[] = [];
	let current = "";
	let depth = 0;
	for (const char of text) {
		if (depth === 0 && (char === "," || /\s/.test(char))) {
			if (current) entries.push(current);
			current = "";
			continue;
		}
		if (char === "(") depth += 1;
		else if (char === ")" && depth > 0) depth -= 1;
		current += char;
	}
	if (current) entries.push(current);
	return entries;
}

/** `mcp__github` or `mcp__github__*`: every tool a server has, which a list of exact names cannot say. */
function namesWholeServer(name: string): boolean {
	const rest = name.slice("mcp__".length);
	return !rest.includes("__") || rest.endsWith("__*");
}

function add(into: string[], item: string): void {
	if (!into.includes(item)) into.push(item);
}

/**
 * The first few, quoted and clipped. The settings page gives this one line, and a real skill lists
 * fifteen `Bash(...)` patterns and an `Agent(...)` naming seven subagents.
 */
function list(items: string[]): string {
	const shown = items.slice(0, 3).map((item) => `\`${clip(item)}\``).join("、");
	return items.length > 3 ? `${shown} 等 ${items.length} 项` : shown;
}

function show(value: unknown): string {
	try {
		return clip(JSON.stringify(value) ?? String(value));
	} catch {
		// `&x [read, *x]` is a list that contains itself, and one odd file must not stop the rest loading.
		return typeof value;
	}
}

function clip(text: string): string {
	return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}
