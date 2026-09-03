/**
 * Human-readable one-liners for tool calls.
 *
 * The main process sends a summary with each live `tool_start`, but a session reopened from
 * disk only has the raw call, so the same labels are derived here from the arguments.
 */
export function summarizeToolCall(name: string, args: Record<string, unknown>): string {
	const str = (key: string): string | undefined => (typeof args[key] === "string" ? (args[key] as string) : undefined);

	switch (name) {
		case "read": {
			const target = str("path") ?? str("file") ?? str("filePath");
			return target ? `Read ${target}` : "Read file";
		}
		case "write": {
			const target = str("path") ?? str("file") ?? str("filePath");
			return target ? `Write ${target}` : "Write file";
		}
		case "edit": {
			const target = str("path") ?? str("file") ?? str("filePath");
			return target ? `Edit ${target}` : "Edit file";
		}
		case "ls": {
			const target = str("path") ?? str("dir") ?? str("cwd");
			return `List ${target ?? "."}`;
		}
		case "glob": {
			const term = str("pattern") ?? str("query") ?? str("search");
			return term ? `Find ${term}` : "Find files";
		}
		case "grep": {
			const term = str("pattern") ?? str("query") ?? str("search");
			return term ? `Search "${term}"` : "Search";
		}
		case "symbol": {
			const term = str("name") ?? str("query") ?? str("symbol") ?? str("pattern");
			return term ? `Find definition of ${term}` : "Find definition";
		}
		case "web_search": {
			const term = str("query") ?? str("pattern") ?? str("search");
			return term ? `Search ${term}` : "Search the web";
		}
		case "bash": {
			const cmd = str("description") ?? (str("command") ?? "bash").split("\n")[0].slice(0, 80);
			return cmd || "Run bash command";
		}
		case "bash_output":
			return `Check job ${str("id") ?? ""}`.trim() || "Check job";
		case "todo_write":
			return "Update task list";
		case "task":
			return str("description") ?? "Sub-agent task";
		case "skill":
			return `Skill: ${str("name") ?? ""}`.trim() || "Skill";
		case "web_fetch":
			return `Fetch ${str("url") ?? ""}`.trim() || "Fetch URL";
		default:
			// MCP tools are named mcp__<server>__<tool>; show the readable half.
			if (name.startsWith("mcp__")) {
				const [, server, tool] = name.split("__");
				return `${server}: ${tool}`;
			}
			return name;
	}
}
