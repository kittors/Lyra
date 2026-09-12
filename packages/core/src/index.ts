export { DEFAULT_RETRY_POLICY, DEFAULT_RETRY_RULE, normalizeRetryPolicy, policyDelay, type RetryPolicy, type RetryPolicySource, type RetryRule, type RetryFailure } from "./config/retry-policy.ts";
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
	type CompactionRequest,
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
export { getSandbox, useSandbox, LocalSandbox, primeCommandPath } from "./sandbox/index.ts";
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
	TrajectoryReader,
	replaySession,
	SOURCE_LABEL,
	SOURCE_ORDER,
	type Entry as TrajectoryEntry,
	type ForkResult,
	type Source as TrajectorySourceKind,
	type TrajectoryFilter,
	type TrajectoryChanges,
} from "./trajectory/index.ts";
export { nextTask, useScheduler } from "./runtime/scheduling.ts";
export { isDue, nextRunAt } from "./config/schedule.ts";
export { migratePreviousHome, type MigrationResult } from "./session/migrate-home.ts";
export { prepareTurn, useTurnPipeline, type TurnContext, type TurnMiddleware } from "./runtime/turn.ts";
export { registeredSkills, useSkillRegistry } from "./skills/registry.ts";
export { backgroundJobs, type BackgroundJob } from "./tools/background-jobs.ts";
export { loadCapabilityPlugins, type LoadedCapabilityPlugins } from "./plugins/capability.ts";
export { API_FORMATS, getProvider, streamAssistant, useLlmRegistry } from "./ai/index.ts";
export type { AgentEvent, AgentEventSink, CommandRun, QueuedTask } from "./agent/events.ts";
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
	type UiLocale,
	UI_LOCALES,
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
export type { ContextBreakdown, ContextSegment, ContextSegmentKey, MemoryFileItem } from "./runtime/context.ts";
export { estimateTokens } from "./tokens.ts";
export { computeCost, costAtRates, selectPricingRates, type SelectedPricingRates } from "./utils/pricing.ts";
export { hooksFor, makeAfterToolCall, makeBeforeToolCall, runHook } from "./runtime/hooks.ts";
export type { SessionStatus } from "./runtime/reporting.ts";
export { AgentSession, type AgentSessionOptions,  } from "./runtime/session.ts";
export { SideChat, restoredSideChatMessages, type SideChatOptions, type SideChatState, type SideChatEvent, type SideChatUpdate } from "./runtime/sidechat.ts";
export {
	lyraHome,
	projectIdFor,
	SessionStore,
	type SessionMeta,
	type SessionRecord,
} from "./session/store.ts";
export { builtinCommandsFor, BUILTIN_COMMANDS, type BuiltinCommand, type CommandAction } from "./commands/builtin.ts";
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
	isUnparsable,
	parseFrontmatter,
	SKILLS_KEY,
	skillTool,
	type Skill,
	type SkillDiagnostic,
} from "./skills/index.ts";
/*
 * 工具与平台这两处从 `export *` 改成点名。
 *
 * `export *` 的代价不是体积，是「加一个导出不需要经过任何人」——而这个文件是根入口，进来的东西
 * 会被渲染进程当成公共 API 用，而渲染进程从根入口取**值**会把整条 `node:fs` 链拉进浏览器包
 * （见 `.dependency-cruiser.cjs` 里那条规则，以及它注明的「先看到过一整屏空白」）。点名之后，
 * 往外开一个口子是一次要写进 diff 的动作。
 *
 * `./types.ts` 留着 `export *`，它不是同一件事：那个文件自己就是类型模型的门（三行转出三个
 * 类型文件），而类型在编译期就擦掉了，不可能被误当成值拉进包里。
 */
export {
	builtinTools,
	READ_ONLY_TOOL_NAMES,
	staticTools,
	useToolRegistry,
	askUserTool,
	bashOutputTool,
	bashTool,
	isReadOnlyCommand,
	formatDiff,
	editTool,
	globToRegExp,
	globTool,
	grepTool,
	invalidateIndex,
	symbolTool,
	lsTool,
	recallTool,
	displayPath,
	resolveWorkspacePath,
	hasRead,
	markRead,
	readTool,
	AGENTS_KEY,
	BUILTIN_AGENTS,
	taskTool,
	previewTool,
	readTodos,
	todoTool,
	TODOS_KEY,
	ruleTool,
	RULES_KEY,
	htmlToText,
	webFetchTool,
	webSearchTool,
	writeTool,
	type AgentDefinition,
	type DiffHunk,
	type DiffLine,
	type FileDiff,
} from "./tools/index.ts";
export { home, systemShell, within, withinOrIs } from "./platform.ts";
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
export { collectAgents, collectRules, collectSkills, type RuleEntry } from "./runtime/session-setup.ts";
export { FOREIGN_USER_SOURCES } from "./capability/providers/foreign.ts";
export {
	approveSkill,
	managedSkillsDir,
	pendingSkills,
	proposeSkill,
	rejectSkill,
	type SkillCandidate,
} from "./runtime/managed-skills.ts";
export {
	resolveModelThinkingOptions,
	resolveReasoningEffort,
	STANDARD_3_LEVEL_OPTIONS,
	STANDARD_5_LEVEL_OPTIONS,
	GPT_5_6_STANDARD_OPTIONS,
	GPT_5_6_SOL_OPTIONS,
	GPT_6_ASTRA_OPTIONS,
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
export { BUILTIN_RULES } from "./rules/builtin.ts";
export { FOREIGN_CONFIGS_NOTICE, foreignConfigsIn, markNoticed, noticed, type ForeignConfigLine } from "./runtime/foreign-configs.ts";
export { layerOverrides, loadProjectLayer, projectConfigPath, type LayerOverride } from "./config/layers.ts";
export { extensionDirs } from "./runtime/session-capabilities.ts";
export { validateManifest, type ExtensionDiagnostic, type ExtensionEventStats, type ExtensionStats } from "./extensions/types.ts";
export { annotateInjected, EXTRACTED_KEY, projectInjectedPath, readInjected, userInjectedPath } from "./runtime/memory-injected.ts";
export { readLessons } from "./runtime/project-memory.ts";
export { readExtractedMemory } from "./runtime/memory-extract.ts";
export { projectMemoryDir } from "./runtime/project-memory.ts";
export { computeDiff } from "./tools/diff.ts";

export { readFileChange, undoFileChanges, undoFileChangeBatches, type RecordedChange } from "./tools/file-changes.ts";
export { AgentDefinitionStore } from "./agents/definition-store.ts";
export type { AgentDraft, AgentDefinitionRecord, AgentDefinitionSave } from "./agents/definition-document.ts";
