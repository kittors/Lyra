export {
	APPROVAL,
	COMPACTION,
	Context,
	DEFAULT_PLUGINS,
	EVENTS,
	LLM,
	LOOP,
	SANDBOX,
	SCHEDULER,
	SESSION,
	SKILLS,
	STORAGE,
	TOOLS,
	createContext,
	type ApprovalPolicy,
	type ApprovalVerdict,
	type CompactionStrategy,
	type LlmRegistry,
	type Plugin as CapabilityPlugin,
	type Sandbox,
	type SandboxProcess,
	type SkillRegistry,
	type TaskScheduler,
	type TurnPipeline,
	type ToolRegistry,
} from "./kernel/index.ts";
export { getSandbox, useSandbox, LocalSandbox } from "./sandbox/index.ts";
export { WINDOWS_RUNNER_FLAG, runSandboxRunner, workspaceWriteSid, tempWriteSid } from "./sandbox/index.ts";
export {
	registerSearchProvider,
	resetSearchProviders,
	search,
	searchProviders,
	selectSearchProvider,
	SearchError,
	type SearchProvider,
	type SearchRequest,
	type SearchResult,
	type SearchSource,
} from "./search/index.ts";
export { duckDuckGoProvider, DUCKDUCKGO_PROVIDER_ID } from "./search/duckduckgo.ts";
export { instantAnswerProvider, INSTANT_PROVIDER_ID } from "./search/instant.ts";
export { keyedSearchProvider, BRAVE_PROVIDER_ID, EXA_PROVIDER_ID, TAVILY_PROVIDER_ID } from "./search/keyed.ts";
export { approvalPolicy, useApprovalPolicy } from "./runtime/approval-policy.ts";
export type { SessionStorage } from "./session/storage.ts";
export {
	countBySource,
	filterTrajectory,
	forkSession,
	matchRanges,
	messagesUpTo,
	readTrajectory,
	replaySession,
	SOURCE_LABEL,
	SOURCE_ORDER,
	type Entry as TrajectoryEntry,
	type ForkResult,
	type Source as TrajectorySourceKind,
	type TrajectoryFilter,
} from "./trajectory/index.ts";
export { nextTask, useScheduler } from "./runtime/scheduling.ts";
export { isDue, nextRunAt } from "./config/schedule.ts";
export { migratePreviousHome, type MigrationResult } from "./session/migrate-home.ts";
export { prepareTurn, useTurnPipeline, type TurnContext, type TurnMiddleware } from "./runtime/turn.ts";
export { registeredSkills, useSkillRegistry } from "./skills/registry.ts";
export { loadCapabilityPlugins, type LoadedCapabilityPlugins } from "./plugins/capability.ts";
export { API_FORMATS, getProvider, streamAssistant, useLlmRegistry } from "./ai/index.ts";
export type { AgentEvent, AgentEventSink, QueuedTask } from "./agent/events.ts";
export type { TodoItem } from "./tools/todo.ts";
export { runAgent, type AgentRunConfig, type AgentRunResult } from "./agent/loop.ts";
export { errorResult, textResult } from "./agent/tool-run.ts";
export { runTurn, useAgentLoop, type AgentLoop } from "./agent/runner.ts";
export { runTool, useToolPipeline, type ToolCall, type ToolMiddleware } from "./agent/tool-pipeline.ts";
export {
	availableModels,
	DEFAULT_APPEARANCE,
	DEFAULT_SCREENSHOT_SETTINGS,
	DEFAULT_SETTINGS,
	DEFAULT_FORMATTING,
	loadSettings,
	migrateSecrets,
	resolveModel,
	saveSettings,
	settingsPath,
	type AppearanceSettings,
	type FormattingSettings,
	type HookConfig,
	type PermissionMode,
	type ScheduledTask,
	type ProjectEntry,
	type ScreenshotSettings,
	type Settings,
} from "./config/settings.ts";
/**
 * The credential store, for the desktop's own secrets.
 *
 * Exported from the root because the main process is the only thing that touches it — the renderer
 * never sees a token, which is the point of it living behind IPC.
 */
export { isSealed, resetVault, seal, secret, unseal } from "./config/vault.ts";
export {
	McpManager,
	type McpHttpServer,
	type McpOrigin,
	type McpServerConfig,
	type McpServerStatus,
	type McpStdioServer,
} from "./mcp/client.ts";
export {
	bundleRoot,
	fetchRegistry,
	installEntry,
	uninstallEntry,
	type BundleKind,
	type ClientId,
	type Installed,
	type Registry,
	type RegistryEntry,
} from "./plugins/registry.ts";
export {
	inspectBundle,
	loadPlugins,
	pluginSummary,
	type McpBundle,
	type Plugin,
	type PluginDiagnostic,
	type PluginInterface,
	type PluginManifest,
} from "./plugins/loader.ts";
/*
 * `isOutdated` is also published as `@lyra/core/install-record`, and the renderer must use that one.
 * Importing a *value* from this index pulls the whole of it into a browser bundle, which reaches
 * `node:fs` and blanks the window. The type is free either way.
 */
export { isOutdated, readInstalls, type InstallRecord } from "./plugins/installs.ts";
export {
	buildIndex,
	indexStats,
	loadIndex,
	saveIndex,
	searchIndex,
	type SymbolEntry,
	type SymbolIndex,
} from "./index/symbols.ts";
export { buildSystemPrompt, loadProjectInstructions } from "./prompt/system.ts";
export {
	addMemoryEntry,
	clearAllMemory,
	formatMemoryForPrompt,
	loadMemory,
	memoryPath,
	removeMemoryEntry,
	saveMemory,
	type MemoryEntry,
	type MemoryStore,
} from "./runtime/memory.ts";
export { compactIfNeeded, compactWith, useCompaction } from "./runtime/compaction.ts";
export type { ContextBreakdown, ContextSegment, ContextSegmentKey } from "./runtime/context.ts";
export { estimateTokens } from "./tokens.ts";
export { hooksFor, makeAfterToolCall, makeBeforeToolCall, runHook } from "./runtime/hooks.ts";
export type { SessionStatus } from "./runtime/reporting.ts";
export { AgentSession, type AgentSessionOptions,  } from "./runtime/session.ts";
export { SideChat, type SideChatOptions, type SideChatState } from "./runtime/sidechat.ts";
export {
	lyraHome,
	projectIdFor,
	SessionStore,
	type SessionMeta,
	type SessionRecord,
} from "./session/store.ts";
export {
	commandSources,
	loadCommands,
	type CommandDiagnostic,
	type CommandSource,
	type SlashCommand,
} from "./commands/loader.ts";
export {
	expandCommand,
	parseInvocation,
	rankCommands,
	splitArguments,
	type Invocation,
} from "./commands/expand.ts";
export {
	formatSkillCatalogue,
	formatSkillInvocation,
	loadSkills,
	parseFrontmatter,
	SKILLS_KEY,
	skillTool,
	type Skill,
	type SkillDiagnostic,
} from "./skills/index.ts";
export * from "./tools/index.ts";
export { builtinTools, useToolRegistry } from "./tools/index.ts";
export * from "./platform.ts";
export * from "./types.ts";
export {
	listPreviews,
	pruneSessionArtifacts,
	prunePreviews,
	previewsHome,
	readPreview,
	removePreviews,
	removeSessionArtifacts,
	scratchHome,
	writePreview,
	type PreviewFile,
	type PreviewRecord,
} from "./runtime/previews.ts";

export type { SubAgentDetail, SubAgentStatus, SubAgentSummary } from "./runtime/sub-agents.ts";
export { collectRules, collectSkills, type RuleEntry } from "./runtime/session-setup.ts";
export { FOREIGN_USER_SOURCES } from "./capability/providers/foreign.ts";
export {
	resolveModelThinkingOptions,
	resolveReasoningEffort,
	STANDARD_3_LEVEL_OPTIONS,
	STANDARD_5_LEVEL_OPTIONS,
	GPT_5_6_STANDARD_OPTIONS,
	GPT_5_6_SOL_OPTIONS,
	FAST_3_LEVEL_OPTIONS,
} from "./ai/thinking-options.ts";
export { lastPassAt, PASS_INTERVAL_MS, runMemoryPass, shouldRunPass } from "./runtime/memory-pass.ts";
export {
	MODEL_ROLES,
	ROLE_DESCRIPTIONS,
	parseModelRef,
	resolveModelRef,
	roleStatus,
	type ModelRole,
} from "./config/model-roles.ts";
export { renderRuleFile, type CorrectionSuggestion } from "./rules/from-correction.ts";
export { ruleDir, saveRule, type RuleDestination } from "./rules/save.ts";
