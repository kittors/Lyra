import { Context } from "./context.ts";
import { approvalPlugin } from "./plugins/approval.ts";
import { compactionPlugin } from "./plugins/compaction.ts";
import { llmPlugin } from "./plugins/llm.ts";
import { loopPlugin } from "./plugins/loop.ts";
import { sandboxPlugin } from "./plugins/sandbox.ts";
import { schedulerPlugin } from "./plugins/scheduler.ts";
import { sessionPlugin } from "./plugins/session.ts";
import { skillsPlugin } from "./plugins/skills.ts";
import { storagePlugin } from "./plugins/storage.ts";
import { toolsPlugin } from "./plugins/tools.ts";

export { Context, type Disposer, type Plugin } from "./context.ts";
export { EventBus, type Dispatch, type Middleware, type Observer, type Responder } from "./events.ts";
export {
	APPROVAL,
	COMPACTION,
	EVENTS,
	LLM,
	LOOP,
	SANDBOX,
	SCHEDULER,
	SESSION,
	SKILLS,
	STORAGE,
	TOOLS,
	type ApprovalPolicy,
	type ApprovalVerdict,
	type CompactionRequest,
	type CompactionStrategy,
	type LlmRegistry,
	type Sandbox,
	type SandboxProcess,
	type SkillRegistry,
	type TaskScheduler,
	type TurnPipeline,
	type ToolRegistry,
} from "./services.ts";
export { approvalPlugin } from "./plugins/approval.ts";
export { compactionPlugin } from "./plugins/compaction.ts";
export { llmPlugin } from "./plugins/llm.ts";
export { loopPlugin } from "./plugins/loop.ts";
export { sandboxPlugin } from "./plugins/sandbox.ts";
export { schedulerPlugin } from "./plugins/scheduler.ts";
export { sessionPlugin } from "./plugins/session.ts";
export { skillsPlugin } from "./plugins/skills.ts";
export { storagePlugin } from "./plugins/storage.ts";
export { toolsPlugin } from "./plugins/tools.ts";
// The groups live with the tools rather than with the plugin that registers them: `tools/index.ts`
// reads the same four when no context is bound, and two lists is what let five tools go missing.
export { AGENT_TOOLS, FILE_TOOLS, SHELL_TOOLS, WEB_TOOLS, builtinToolGroups } from "../tools/groups.ts";

/**
 * The set that makes an ordinary Lyra.
 *
 * Listed rather than discovered, because the default configuration should be something you can
 * read. A host that wants a different shape — no shell, a remote sandbox, another model API —
 * builds its own list instead of passing flags to this one.
 */
export const DEFAULT_PLUGINS = [llmPlugin, toolsPlugin, approvalPlugin, sandboxPlugin, compactionPlugin, skillsPlugin, storagePlugin, schedulerPlugin, sessionPlugin, loopPlugin];

/**
 * Build a context with a given set of plugins.
 *
 * Order in the array does not matter: a plugin that names its dependencies waits for them, so a
 * configuration is a set of choices rather than a boot sequence.
 */
export async function createContext(plugins = DEFAULT_PLUGINS): Promise<Context> {
	const ctx = new Context();
	for (const plugin of plugins) await ctx.use(plugin);
	return ctx;
}
