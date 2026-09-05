/**
 * What a session can do, as opposed to what it has done.
 *
 * Tools, skills, sub-agents and MCP servers are discovered together, replaced together when the
 * settings change, and read together every turn — so they are one object rather than ten fields on
 * the session. It also gives the diagnostics somewhere to live: a skill that failed to parse is
 * part of this answer, not an error to throw away.
 *
 * The scratch state map rides along because its lifetime is the same. It holds the symbol index,
 * the todo list and the skill catalogue — things a tool wrote down for the next tool to read.
 */

import { ExtensionHost } from "../extensions/host.ts";
import { lyraHome } from "../session/store.ts";
import { CODE_INTEL_KEY, CodeIntelManager } from "../lsp/manager.ts";
import { McpManager, type McpServerStatus } from "../mcp/client.ts";
import { BUILTIN_RESOURCES } from "../resources/handlers.ts";
import { ResourceRouter } from "../resources/router.ts";
import type { Settings } from "../config/settings.ts";
import type { Plugin, PluginDiagnostic } from "../plugins/loader.ts";
import type { Skill, SkillDiagnostic } from "../skills/loader.ts";
import { ARTIFACTS_KEY, MCP_KEY, PLUGINS_KEY, type Artifact, type McpLookup } from "../resources/more-handlers.ts";
import { OfferBudget } from "../rules/from-correction.ts";
import { StreamRuleMonitor } from "../rules/stream.ts";
import { EMPTY_RULE_SET, type RuleSet } from "../rules/types.ts";
import { SKILLS_KEY } from "../skills/tool.ts";
import { invalidateIndex } from "../tools/index.ts";
import { TOOL_NAMES_KEY } from "../tools/reroute.ts";
import { RULES_KEY } from "../tools/rule.ts";
import { AGENTS_KEY, BUILTIN_AGENTS, type AgentDefinition } from "../tools/task.ts";
import type { Tool } from "../types.ts";
import { loadCapabilities, loadRules } from "./session-setup.ts";

/**
 * 最多留多少份折叠内容。
 *
 * 三十份的量级已经远超「模型会回头去看」的范围，而它挡住的是另一件事：一个跑了一天、
 * 搜了几百次的会话，把每一次的完整输出都留在内存里。
 */
const MAX_ARTIFACTS = 30;

export class SessionCapabilities {
	tools: Tool[] = [];
	skills: Skill[] = [];
	skillDiagnostics: SkillDiagnostic[] = [];
	plugins: Plugin[] = [];
	pluginDiagnostics: PluginDiagnostic[] = [];
	mcpStatuses: McpServerStatus[] = [];
	agents: AgentDefinition[] = [...BUILTIN_AGENTS];
	/** Discovered rules, already sorted into always-apply, rulebook and stream buckets. */
	rules: RuleSet = EMPTY_RULE_SET;
	/**
	 * 这次加载实际读过的目录。
	 *
	 * 热重载监听的就是这份名单——不是「所有可能放技能的地方」，而是「这台机器上真的放了东西
	 * 的地方」。前者是几十个 watcher，其中大多数指向不存在的目录。
	 */
	watched: string[] = [];
	/**
	 * Watches the stream for the rules that have conditions.
	 *
	 * Lives here rather than being built per turn because repeat policy counts turns: a monitor
	 * rebuilt every turn would let a `once` rule fire on every one of them.
	 */
	ruleMonitor = new StreamRuleMonitor([]);

	/**
	 * The session's address space: `skill://`, `rule://`, `scratch://`, `lyra://`.
	 *
	 * One per session, never a module singleton. A sub-agent has its own skill set, and a shared
	 * router would resolve `skill://x` against whichever session touched it last — a bug that only
	 * shows up under concurrency and looks like a skill occasionally holding someone else's text.
	 */
	readonly resources = buildRouter();

	/**
	 * Third-party extensions, each in its own worker.
	 *
	 * Session-scoped like everything else here, and disposed with the session — a worker left
	 * running is a thread nobody owns. Empty until `load` finds extension directories, so a session
	 * with none pays nothing.
	 */
	readonly extensions = new ExtensionHost();

	/**
	 * How many times this session may still offer to turn a correction into a rule.
	 *
	 * Session-scoped, and deliberately not persisted: "you have said no twice" is a fact about a
	 * conversation, not about a person. Somebody who dismissed two offers on Monday should not find
	 * the feature permanently gone on Tuesday.
	 */
	readonly correctionBudget = new OfferBudget();

	/**
	 * 被剪枝折叠掉的大块输出，按 id 存着，`artifact://` 从这里取。
	 *
	 * 跟会话一起活在内存里，也跟会话一起消失。落盘是另一个决定：那些内容动辄几十万字符，
	 * 而它们的用处几乎全部集中在产生它的那一个回合之后的几分钟里。
	 */
	readonly artifacts = new Map<string, Artifact>();

	/** Shared scratch space for tools that need to remember something across calls. */
	readonly state = new Map<string, unknown>();
	readonly mcp = new McpManager();

	/**
	 * Tools that only exist on a particular host — the desktop app contributes browser automation
	 * backed by a real BrowserWindow, which the platform-agnostic core cannot build.
	 *
	 * Assigned in the body rather than declared as a parameter property: Node's type stripping
	 * runs the source as-is and cannot rewrite one into a field.
	 */
	private readonly extraTools: Tool[];

	constructor(extraTools: Tool[] = []) {
		this.extraTools = extraTools;
	}

	/** Discover everything again. Safe to call after the settings change. */
	async load(cwd: string, settings: Settings): Promise<void> {
		const loaded = await loadCapabilities(cwd, settings, this.mcp, this.extraTools);
		this.plugins = loaded.plugins;
		this.pluginDiagnostics = loaded.pluginDiagnostics;
		this.skills = loaded.skills;
		this.skillDiagnostics = loaded.skillDiagnostics;
		this.agents = loaded.agents;
		this.rules = loaded.rules;
		this.ruleMonitor = new StreamRuleMonitor(loaded.rules.stream);
		this.mcpStatuses = loaded.mcpStatuses;
		this.tools = loaded.tools;
		/*
		 * Extensions load after everything else, because they can only affect what already exists.
		 *
		 * Failures here are diagnostics rather than exceptions: a broken extension must not stop a
		 * session from starting, which is the same reason a broken skill does not.
		 */
		for (const dir of await extensionDirs(cwd)) await this.extensions.load(dir).catch(() => false);
		// Two tools read these back rather than taking them as arguments.
		this.state.set(SKILLS_KEY, this.skills);
		this.state.set(AGENTS_KEY, this.agents);
		this.state.set(RULES_KEY, this.rules);
		/*
		 * `bash` 的改道靠这个 key 知道「建议的工具在不在」。
		 *
		 * 开关关了就不填——`rerouteShellCommand` 见到 undefined 一律放行。用「不填」而不是
		 * 「填个空集」：空集会让每条 `cat` 都去查一次表然后放行，而不填是一次 map miss。
		 */
		if (settings.rerouteShellCommands !== false) this.state.set(TOOL_NAMES_KEY, new Set(this.tools.map((tool) => tool.name)));
		else this.state.delete(TOOL_NAMES_KEY);
		this.state.set(ARTIFACTS_KEY, this.artifacts);
		/*
		 * `plugin://` 和 `mcp://` 的数据源。
		 *
		 * 放进 state 而不是交给路由：路由每个会话建一次，而这两样每次 `load` 都会变——
		 * 装了一个插件、开了一台服务器之后，地址该指向新的那份。
		 */
		this.state.set(PLUGINS_KEY, this.plugins);
		this.state.set(MCP_KEY, {
			resources: () => this.mcp.allResources(),
			read: (server: string, uri: string) => this.mcp.readResource(server, uri),
		} satisfies McpLookup);
		this.watched = loaded.watched;
	}

	/**
	 * Re-read the rules and nothing else, for a rule written while this session is running.
	 *
	 * The monitor is rebuilt, which resets what has fired — a `once` rule that already fired may
	 * fire once more. That is the honest trade: the alternative is carrying counters for rules that
	 * may no longer exist, and a rule saved thirty seconds ago has not used up its one turn yet.
	 */
	async reloadRules(cwd: string, settings: Settings): Promise<void> {
		this.rules = await loadRules(cwd, settings, this.plugins);
		this.ruleMonitor = new StreamRuleMonitor(this.rules.stream);
		this.state.set(RULES_KEY, this.rules);
	}

	/**
	 * 剪枝往这里存原文，换回一个 `artifact://` 地址。
	 *
	 * 有上限：折叠下来的东西每一份都是几十万字符，一个跑了一天的会话能攒出几百兆。超过之后
	 * 丢最旧的——最近折叠的那几份才是模型可能回头去看的，而一天前那次搜索的完整输出，
	 * 它早就不记得自己搜过了。
	 */
	keepArtifact(tool: string, content: string): string {
		const id = `a${(this.artifactSeq += 1).toString(36)}`;
		this.artifacts.set(id, { id, tool, content, at: Date.now() });
		while (this.artifacts.size > MAX_ARTIFACTS) {
			const oldest = this.artifacts.keys().next().value;
			if (oldest === undefined) break;
			this.artifacts.delete(oldest);
		}
		return `artifact://${id}`;
	}

	private artifactSeq = 0;

	/** Drop the cached symbol index so the next lookup re-reads it from disk. */
	invalidateSymbolIndex(): void {
		invalidateIndex(this.state);
	}

	async dispose(): Promise<void> {
		await this.mcp.closeAll();
		await this.extensions.dispose().catch(() => {});
		/*
		 * Language servers are hundreds of megabytes each and outlive the session that started them
		 * unless something kills them. The manager is created lazily by the `lsp` tool and parked in
		 * this state map, so this is the only place that knows whether there is one to stop.
		 */
		const codeIntel = this.state.get(CODE_INTEL_KEY);
		if (codeIntel instanceof CodeIntelManager) await codeIntel.dispose().catch(() => {});
	}
}

/** A router with the shipped schemes on it. */
function buildRouter(): ResourceRouter {
	const router = new ResourceRouter();
	for (const handler of BUILTIN_RESOURCES) router.register(handler);
	return router;
}

/**
 * Where extensions live: `<cwd>/.lyra/extensions/*` and `~/.lyra/extensions/*`.
 *
 * One directory per extension, each with its own `extension.json`. Missing directories are the
 * normal case and are not reported — most projects have none.
 */
async function extensionDirs(cwd: string): Promise<string[]> {
	const { readdir } = await import("node:fs/promises");
	const { join } = await import("node:path");
	const roots = [join(cwd, ".lyra", "extensions"), join(lyraHome(), "extensions")];
	const found: string[] = [];
	for (const root of roots) {
		const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
		for (const entry of entries) if (entry.isDirectory()) found.push(join(root, entry.name));
	}
	return found;
}
