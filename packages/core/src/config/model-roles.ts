/**
 * Naming models by what they are for, so an agent definition does not have to name one.
 *
 * The problem this solves is portability. A sub-agent that says `model: anthropic/claude-haiku-4-5`
 * works on the machine it was written on and nowhere else — the person who installs it from a
 * registry has a different set of providers, and what they get is a dispatch that fails or, worse,
 * silently falls back to whatever the session was using. So a definition says `@fast` and each
 * machine decides what fast means.
 *
 * Four roles, not omp's nine. `commit`, `vision` and `tiny` are too narrow to earn a name; `plan`
 * and `task` are covered by `deep` and `default`. Past four, "which role is this call" becomes its
 * own judgement to maintain, and the wrong answer is invisible.
 */

import type { ModelConfig, ProviderConfig } from "../types.ts";
import type { Settings } from "./settings.ts";
/*
 * 从 `models.ts` 而不是 `settings.ts`。
 *
 * 这个文件是设置页的模型角色那一段要用的，而那段代码跑在渲染器里。`settings.ts` 顶上就是
 * `node:fs`——从它那里导入一个值，会把整条依赖链拉进浏览器包，窗口一片空白。
 * 这也是 `@lyra/core/model-roles` 这个子入口存在的原因：它自己就是浏览器安全的。
 */
import { resolveModel } from "./models.ts";

export { availableModels } from "./models.ts";

export type ModelRole = "default" | "fast" | "deep" | "review";

export const MODEL_ROLES: ModelRole[] = ["default", "fast", "deep", "review"];

export const ROLE_DESCRIPTIONS: Record<ModelRole, string> = {
	default: "日常对话与大部分工作",
	fast: "子代理扇出、分类、补全——便宜且快比聪明更要紧的场合",
	deep: "复杂推理与规划",
	/*
	 * `review` is the one worth a sentence. Pointing it at a different model family is the whole
	 * point of having it: a model's blind spots correlate with its own output, so asking Claude to
	 * review what Claude wrote gets agreement rather than review.
	 *
	 * 纯文本，没有 markdown：这几句话现在直接显示在设置页的行里，`**` 会原样露出来。
	 * 强调靠语序，不靠星号。
	 */
	review: "最好指到另一个模型家族——同家族模型的盲点是相关的，让它审自己写的代码，它会同意自己",
};

/** `@fast`, `@deep:high`, or a plain model id. */
export interface ParsedModelRef {
	/** The role, when the reference named one. */
	role?: ModelRole;
	/** A concrete model id, when it did not. */
	id?: string;
	/** A `:high` suffix asking for a thinking level. */
	thinking?: string;
}

export function parseModelRef(ref: string): ParsedModelRef {
	const trimmed = ref.trim();
	if (!trimmed.startsWith("@")) {
		/*
		 * A plain id may also carry `:high`, but a model id can legitimately contain a colon
		 * (`kimi-k3:256k` is one this machine has), so only a known thinking level is taken as a
		 * suffix. Guessing wrong here turns a valid model into one that cannot be found.
		 */
		const match = /^(.*):(off|low|medium|high)$/.exec(trimmed);
		return match ? { id: match[1], thinking: match[2] } : { id: trimmed };
	}
	const body = trimmed.slice(1);
	const [name, thinking] = body.split(":");
	return MODEL_ROLES.includes(name as ModelRole) ? { role: name as ModelRole, thinking } : { id: body, thinking };
}

export interface RoleResolution {
	provider: ProviderConfig;
	model: ModelConfig;
	thinking?: string;
	/** Which entry in the list answered, for diagnostics. */
	via: string;
}

/**
 * Resolve a reference — or a priority list of them — to something that exists here.
 *
 * The list is what makes a shared agent definition portable: `["@fast", "anthropic/claude-haiku-4-5"]`
 * says "whatever this machine calls fast, and failing that, this specific model". Falling through
 * to the session's own model at the end means a definition naming three models none of which are
 * configured still runs, rather than failing on a preference.
 */
export function resolveModelRef(
	settings: Settings,
	ref: string | string[] | undefined,
	fallback: { provider: ProviderConfig; model: ModelConfig },
): RoleResolution {
	const refs = ref === undefined ? [] : Array.isArray(ref) ? ref : [ref];

	for (const candidate of refs) {
		const parsed = parseModelRef(candidate);
		const id = parsed.role ? settings.modelRoles?.[parsed.role] : parsed.id;
		if (!id) continue;
		const found = resolveModel(settings, id);
		if (found) return { ...found, thinking: parsed.thinking, via: candidate };
	}

	return { ...fallback, via: "会话当前的模型" };
}

/**
 * Whether a role points somewhere real, for the settings page.
 *
 * A role configured to a model that has since been removed is worse than an empty one: the agents
 * that use it fall through to the session's model and behave differently from what the page shows.
 */
export function roleStatus(settings: Settings): { role: ModelRole; id?: string; resolves: boolean }[] {
	return MODEL_ROLES.map((role) => {
		const id = settings.modelRoles?.[role];
		return { role, id, resolves: id ? resolveModel(settings, id) !== null : false };
	});
}
