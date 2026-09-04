/**
 * Describing a session, rather than running one.
 *
 * Two questions the UI asks and the agent never does: what is loaded, and where is the context
 * window going. Both need the session's inputs and neither is part of taking a turn, so they read
 * the session rather than living inside it.
 *
 * `SessionFacts` is the read-only face of a session — the fields these answers are made of, and
 * nothing that could change one.
 */

import { access } from "node:fs/promises";
import { platform } from "node:os";
import { join } from "node:path";
import type { Settings } from "../config/settings.ts";
import { resolveModel } from "../config/settings.ts";
import type { McpManager, McpServerStatus } from "../mcp/client.ts";
import type { Plugin, PluginDiagnostic } from "../plugins/loader.ts";
import { buildSystemPrompt, loadProjectInstructions } from "../prompt/system.ts";
import { formatSkillCatalogue, type Skill, type SkillDiagnostic } from "../skills/loader.ts";
import type { SessionMeta } from "../session/store.ts";
import type { AgentDefinition } from "../tools/task.ts";
import type { Message, Tool } from "../types.ts";
import { buildContextBreakdown, type ContextBreakdown } from "./context.ts";

export interface SessionStatus {
	meta: SessionMeta;
	running: boolean;
	skills: Skill[];
	skillDiagnostics: SkillDiagnostic[];
	plugins: Plugin[];
	pluginDiagnostics: PluginDiagnostic[];
	mcp: McpServerStatus[];
	agents: AgentDefinition[];
	toolNames: string[];
}

/** Everything the two answers below are made of. Read-only by construction. */
export interface SessionFacts {
	readonly meta: SessionMeta;
	readonly running: boolean;
	readonly cwd: string;
	readonly messages: Message[];
	readonly settings: Settings;
	readonly tools: Tool[];
	readonly skills: Skill[];
	readonly skillDiagnostics: SkillDiagnostic[];
	readonly plugins: Plugin[];
	readonly pluginDiagnostics: PluginDiagnostic[];
	readonly mcpStatuses: McpServerStatus[];
	readonly agents: AgentDefinition[];
	readonly mcp: McpManager;
	scratchDir(): string;
}

export async function describeSession(session: SessionFacts): Promise<SessionStatus> {
	return {
		meta: session.meta,
		running: session.running,
		skills: session.skills,
		skillDiagnostics: session.skillDiagnostics,
		plugins: session.plugins,
		pluginDiagnostics: session.pluginDiagnostics,
		mcp: session.mcpStatuses,
		agents: session.agents,
		toolNames: session.tools.map((t) => t.name),
	};
}

/**
 * Where this session's context window is going, by segment.
 *
 * Built here rather than in the UI because only the session holds the inputs: the assembled
 * prompt, the tool schemas as the provider will receive them, and which of those tools came
 * from an MCP server rather than from the kernel. Rebuilding the prompt to measure it is
 * cheap next to a request, and it is the only way for the figure to be the real one.
 */
export async function describeContext(session: SessionFacts): Promise<ContextBreakdown | null> {
	const resolved = resolveModel(session.settings, session.meta.modelId || session.settings.defaultModelId);
	if (!resolved) return null;

	const projectInstructions = await loadProjectInstructions(session.cwd);
	const mcpNames = new Set(session.mcp.allTools().map((tool) => tool.name));

	return buildContextBreakdown({
		model: resolved.model,
		messages: session.messages,
		systemPrompt: await buildSystemPrompt({
			cwd: session.cwd,
			tools: session.tools,
			skills: session.skills,
			agents: session.agents,
			projectInstructions,
			platform: platform(),
			modelName: resolved.model.name,
			isGitRepo: await pathExists(join(session.cwd, ".git")),
			scratchDir: session.scratchDir(),
		}),
		builtinTools: session.tools.filter((tool) => !mcpNames.has(tool.name)),
		mcpTools: session.tools.filter((tool) => mcpNames.has(tool.name)),
		skillCatalogue: formatSkillCatalogue(session.skills),
		projectInstructions,
	});
}

/** Whether a path is there, without caring why it is not. */
async function pathExists(path: string): Promise<boolean> {
	return access(path).then(() => true).catch(() => false);
}
