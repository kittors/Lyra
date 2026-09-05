/**
 * Everything a session has to load before it can do anything.
 *
 * Plugins, skills, sub-agent definitions, MCP servers and the tools they contribute. Separate from
 * the session because it is a pure "read the world and report what is there" step — which is what
 * makes it possible to re-run after settings change without touching anything else.
 *
 * Precedence used to be the theme here, and now it is not. Which directories are read and who wins
 * a name collision belong to `capability/`, where the rule is written once instead of once per
 * loader — five copies of "most specific wins" had drifted apart in exactly the ways you would
 * expect, and one of them had the comparison backwards. What is left in this file is assembly.
 */

import { join } from "node:path";
import { homedir } from "node:os";
import { createRegistry, type CapabilityRegistry } from "../capability/index.ts";
import { pluginProvider } from "../capability/providers/plugins.ts";
import type { Settings } from "../config/settings.ts";
import { McpManager, type McpServerStatus } from "../mcp/client.ts";
import { loadPlugins, type Plugin, type PluginDiagnostic } from "../plugins/loader.ts";
import { type Skill, type SkillDiagnostic } from "../skills/loader.ts";
import { registeredSkills } from "../skills/registry.ts";
import type { Rule, RuleSet } from "../rules/types.ts";
import { conditionSource } from "../rules/condition.ts";
import { lyraHome } from "../session/store.ts";
import { builtinTools } from "../tools/index.ts";
import type { AgentDefinition } from "../tools/task.ts";
import type { Tool } from "../types.ts";

export interface LoadedCapabilities {
	plugins: Plugin[];
	pluginDiagnostics: PluginDiagnostic[];
	skills: Skill[];
	skillDiagnostics: SkillDiagnostic[];
	agents: AgentDefinition[];
	mcpStatuses: McpServerStatus[];
	tools: Tool[];
	rules: RuleSet;
	/** 这次加载实际读过的目录，用来建立监听。 */
	watched: string[];
}

/**
 * Every skill this project can use, in precedence order, with the diagnostics from reading them.
 *
 * Its own function because two things need the same answer and must not compute it twice: the
 * session, which hands the list to the model, and the composer's slash menu, which offers the same
 * skills to the user. A menu built from a second, slightly different walk of the same directories
 * is a menu that offers something the agent does not have.
 *
 * Precedence, most specific first: a loose skill in the project beats a bundled one of the same
 * name — dropping a directory next to a plugin is how you override it — and both beat one provided
 * by code, because what the user put on disk is the most specific statement of intent in the room.
 */
export async function collectSkills(
	cwd: string,
	plugins: { enabled: boolean; skills: Skill[] }[],
	settings?: Pick<Settings, "capabilityPreferences">,
): Promise<{ skills: Skill[]; diagnostics: SkillDiagnostic[]; shadowed: ShadowedSkill[] }> {
	const result = await sessionRegistry(plugins).load<Skill>("skill", { cwd, preferred: preferredSources(settings) });
	/*
	 * The losers, for the settings page.
	 *
	 * "Why is the skill I wrote not running" is the question that page exists to answer, and it
	 * cannot be answered from the winners alone — a shadowed skill is absent from the list, which
	 * looks exactly like one that failed to load or was never found.
	 */
	const shadowed = result.all
		.filter((item): item is typeof item & { shadowedBy: NonNullable<typeof item.shadowedBy> } => item.shadowedBy !== undefined)
		.map((item) => ({
			name: item.name,
			path: item.provenance.path,
			by: item.shadowedBy.path,
			byLabel: item.shadowedBy.providerLabel,
		}));
	/*
	 * `severity` 要带过去。设置页按它把「没加载」和「加载了但描述太短」分成两段——剥掉它，
	 * 一条 warning 就混进「N 个技能未能加载」那句话里，而那句话数的正是没加载的。
	 */
	return {
		skills: result.items,
		diagnostics: result.diagnostics.map((d) => ({ path: d.path, message: d.message, ...(d.severity === "warning" ? { severity: "warning" as const } : {}) })),
		shadowed,
	};
}

/** 一条规则在设置页里该说清楚的全部。 */
export interface RuleEntry {
	name: string;
	description?: string;
	path: string;
	/** 来源在人话里叫什么：「项目」「个人」「Cursor」「内置」…… */
	sourceLabel: string;
	/** 常驻 / 规则库 / 流规则——决定它什么时候花上下文。 */
	bucket: "always" | "book" | "stream";
	/**
	 * 流规则的触发条件，按它编译成的样子给出。
	 *
	 * 计划里点名说了：写错的正则是这套系统最大的挫败来源。一条不触发的规则跟一条不存在的规则
	 * 在界面上长得一模一样，而看见 `/:\s*any\b/i` 这个东西本身，是唯一能让人发现自己写错了的
	 * 办法——所以这里给的是**编译后**的源文本，包括那些内联标志。
	 */
	condition?: string[];
	/** 关掉了没有。`disabledRules` 按名字记，所以同名的一起关。 */
	disabled: boolean;
	/** 被同名的哪一条盖掉了。设置页要回答的正是「我写的规则为什么没生效」。 */
	shadowedBy?: { path: string; label: string };
}

/**
 * 这个项目现在有哪些规则，包括被盖掉的和被关掉的。
 *
 * 跟 `loadRules` 分开，因为要的东西不同：会话要的是**生效的那些**（关掉的已经过滤掉了），
 * 而这一份要的是**全部**——一条被关掉的规则从会话的角度不存在，而设置页正是那个把它打开的
 * 地方；一条被同名文件盖掉的规则，从列表里消失跟从没写过一模一样。
 */
export async function collectRules(
	cwd: string,
	settings: Settings,
	plugins: Plugin[],
): Promise<{ rules: RuleEntry[]; diagnostics: { path: string; message: string }[] }> {
	const result = await sessionRegistry(plugins).load<Rule>("rule", { cwd, enabledUserSources: foreignUserSources(settings), preferred: preferredSources(settings) });
	const off = new Set(settings.disabledRules ?? []);

	return {
		rules: result.all.map((item) => ({
			name: item.name,
			description: item.description,
			path: item.provenance.path,
			sourceLabel: item.provenance.providerLabel,
			bucket: item.bucket,
			// As the file spells it, so the page can show it and try it — not `/todo/i`.
			condition: item.conditions?.map(conditionSource),
			disabled: off.has(item.name),
			shadowedBy: item.shadowedBy ? { path: item.shadowedBy.path, label: item.shadowedBy.providerLabel } : undefined,
		})),
		diagnostics: result.diagnostics.map((d) => ({ path: d.path, message: d.message })),
	};
}

/**
 * 用户勾了哪些外部工具的个人规则。
 *
 * 三个读规则的入口共用一份答案。少传一处的后果不是报错，是那条入口安静地读不到用户级目录
 * ——而这正是这个开关此前的状态：能力层认得它，没有任何产品代码传过它。
 */
function foreignUserSources(settings: Settings): ReadonlySet<string> {
	return new Set(settings.enabledForeignUserRules ?? []);
}

/**
 * 「改用那个」写下的偏好：`kind:name` → 该赢的那个文件。
 *
 * 跟 `foreignUserSources` 一样，每个读能力的入口都要传——少传一处，那处就安静地按默认优先级来，
 * 而设置页上明明写着「已改用」。
 */
function preferredSources(settings: Pick<Settings, "capabilityPreferences"> | undefined): ReadonlyMap<string, string> {
	return new Map(Object.entries(settings?.capabilityPreferences ?? {}));
}

/** A skill that was found and lost, with what beat it. */
export interface ShadowedSkill {
	name: string;
	/** Where the losing copy is. */
	path: string;
	/** Where the winning copy is. */
	by: string;
	/** Which source the winner came from, in words. */
	byLabel: string;
}

/**
 * A registry for this session, with the plugin provider bound to what this session loaded.
 *
 * Built per call rather than held in a module because what it supplies is session state: two
 * windows on two projects have different plugins enabled, and a shared registry would give one
 * window the other's.
 */
function sessionRegistry(plugins: { enabled: boolean; skills: Skill[] }[]): CapabilityRegistry {
	const registry = createRegistry({ home: lyraHome(), userHome: homedir() });
	registry.register(
		pluginProvider(
			plugins.filter((plugin) => plugin.enabled).flatMap((plugin) => plugin.skills),
			registeredSkills(),
		),
	);
	return registry;
}

/**
 * The rules alone, for when one is written while a session is running.
 *
 * Saving a rule from a correction has to make it apply. A rule that only takes effect after a
 * restart is indistinguishable from one that was not saved — and the whole promise of the offer is
 * that next time the mistake is about to happen, something stops it.
 *
 * Reloading everything would do it too, and would also reconnect every MCP server and reload every
 * extension worker as a side effect of writing one small markdown file.
 */
export async function loadRules(cwd: string, settings: Settings, plugins: Plugin[]): Promise<RuleSet> {
	const result = await sessionRegistry(plugins).load<Rule>("rule", { cwd, enabledUserSources: foreignUserSources(settings), preferred: preferredSources(settings) });
	return groupRules(result.items, settings.disabledRules ?? [], result.diagnostics);
}

/** Load skills, agents and MCP tools. Safe to call again after settings change. */
export async function loadCapabilities(
	cwd: string,
	settings: Settings,
	mcp: McpManager,
	extraTools: Tool[],
): Promise<LoadedCapabilities> {
	const loadedPlugins = await loadPlugins(
		[
			{ dir: join(cwd, ".lyra", "plugins"), source: "workspace" as const },
			{ dir: join(lyraHome(), "plugins"), source: "user" as const },
			/*
			 * Where MCP bundles live once installed. Read here as well because a bundle is sorted
			 * by its contents rather than its location — one that predates the split, or was put
			 * in by hand, is found either way, and only its `origin` cares which directory it is in.
			 */
			{ dir: join(lyraHome(), "mcp"), source: "user" as const },
		],
		settings.disabledPlugins,
	);
	const plugins = loadedPlugins.plugins;
	const pluginDiagnostics = loadedPlugins.diagnostics;

	const registry = sessionRegistry(plugins);

	const skillResult = await registry.load<Skill>("skill", { cwd, preferred: preferredSources(settings) });
	const skills = skillResult.items;
	const skillDiagnostics = skillResult.diagnostics.map((d) => ({ path: d.path, message: d.message }));

	/*
	 * Agents through the registry, which is where the precedence defect gets fixed.
	 *
	 * The old line was `[...BUILTIN_AGENTS, ...custom]` consumed with `.find()`, so a definition
	 * written to replace a built-in of the same name was found second and never used — the file
	 * loaded, appeared in listings, and did nothing. Built-ins now arrive from a provider with a
	 * priority of 1 and lose by name like anything else.
	 */
	const agentResult = await registry.load<AgentDefinition>("agent", { cwd, preferred: preferredSources(settings) });
	const agents = agentResult.items;

	/*
	 * Rules come back as one list ordered by precedence and are regrouped into the three buckets the
	 * rest of the system reads. Regrouping here rather than teaching the registry about buckets keeps
	 * the merge rules the same for every capability: a bucket is a property of a rule, not a
	 * dimension the merge has to understand.
	 */
	const ruleResult = await registry.load<Rule>("rule", { cwd, enabledUserSources: foreignUserSources(settings), preferred: preferredSources(settings) });
	const rules = groupRules(ruleResult.items, settings.disabledRules ?? [], ruleResult.diagnostics);

	/*
	 * Settings is the only place a session reads MCP servers from.
	 *
	 * Plugins used to contribute their own, which is how the same server ended up configured in
	 * two places at once — the MCP settings page could not see the plugin's copy, and the plugin
	 * could not see the user's. Installing an MCP bundle now writes into settings, so this is one
	 * list, and what is on the page is what the session connects to.
	 */
	const mcpStatuses = await mcp.connectAll(settings.mcpServers);
	const tools = [...builtinTools(), ...extraTools, ...mcp.allTools()];

	/*
	 * 实际读过的目录，交给监听器。
	 *
	 * 这份名单一直被收集着——每个 provider 都老老实实地报了 `watched`，注册表也把它们合起来了
	 * ——而 `LoadedCapabilities` 从来没带上它，所以谁也拿不到。收集原料收集了很久，工厂一直
	 * 没建。
	 *
	 * 只监听**贡献过条目的目录**，不是所有可能的位置：后者是几十个 watcher，而其中绝大多数
	 * 指向的目录在这台机器上根本不存在。
	 */
	const watched = [...new Set([...skillResult.watched, ...agentResult.watched, ...ruleResult.watched])];

	return { plugins, pluginDiagnostics, skills, skillDiagnostics, agents, mcpStatuses, tools, rules, watched };
}

/**
 * Sort merged rules back into the three buckets, honouring the user's off-switches.
 *
 * `disabledRules` is applied here rather than passed to the registry as `disabledItems` because it
 * is keyed by bare name — that is what the setting has always held and what the settings UI writes
 * — while the registry keys items as `rule:<name>`. Translating at the boundary keeps the stored
 * shape stable; a migration would be the only other option and would buy nothing.
 */
function groupRules(rules: Rule[], disabled: string[], diagnostics: { path: string; message: string; severity: string }[]): RuleSet {
	const off = new Set(disabled);
	const set: RuleSet = { always: [], book: [], stream: [], diagnostics: [] };
	for (const rule of rules) {
		if (off.has(rule.name)) continue;
		set[rule.bucket].push(rule);
	}
	set.diagnostics = diagnostics
		.filter((d) => d.severity !== "info")
		.map((d) => ({ path: d.path, message: d.message, severity: d.severity === "warning" ? "warning" : "error" }));
	return set;
}
