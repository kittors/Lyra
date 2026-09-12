/**
 * OpenAI Chat Completions API adapter (`POST /v1/chat/completions`).
 */

import { toChatCompletionsMessages, toChatCompletionsTools } from "./openai-chat-completions-request.ts";
import { sanitizeToolPairing } from "./sanitize-history.ts";
import type {
	AssistantMessage,
	LlmContext,
	ModelConfig,
	Provider,
	ProviderConfig,
	RequestOptions,
	StopReason,
	StreamEvent,
	ToolCallContent,
} from "../types.ts";
import { addUsage, emptyUsage } from "../types.ts";
import { computeCost } from "../utils/pricing.ts";
import { classifyFailure, FailureError } from "./failure.ts";
import { RetryBudget, fetchWithRetry, retryStream, toolCallId } from "./retry.ts";
import { argumentFragment, parseToolArguments, readSseWithIdleTimeout, STREAM_IDLE_TIMEOUT_MS } from "../utils/sse.ts";
import { failedStreamEvent, joinUrl } from "./endpoint.ts";
import { resolveReasoningEffort } from "./thinking-options.ts";
import { reasoningReplay, withReasoningRetry, type ReasoningReplay } from "./reasoning-compat.ts";
import { droppedParams, learnDroppedParam } from "./request-params-compat.ts";

export const openaiChatCompletionsProvider: Provider = {
	api: "openai-chat-completions",
	stream: streamChatCompletions,
};

// ---------------------------------------------------------------------------
// 撞一次学一次：这个端点把输出上限写在哪个键上
// ---------------------------------------------------------------------------

/**
 * 输出上限该写在哪个键上——这条只能靠撞出来。
 *
 * 和 `reasoning-compat.ts`、`request-params-compat.ts` 同一个路子，理由也同一个：**我们手上没有普查
 * 表**。oh-my-pi 靠一整个规则库按厂商、主机名、模型家族把这件事查出来（轴在
 * `packages/catalog/src/compat/axes.ts:102`，七组用 `max_tokens` 的端点列在
 * `packages/catalog/src/compat/resolve.ts:397-403`），那是几百个端点的实测积累，抄不过来也维护不起。
 *
 * 能抄的是另一样东西：**这种 400 的错误串自带诊断**——它直接点名该用哪个字段。所以默认保持这条链现在
 * 发的那个键（不动任何现在能用的端点），撞上那句话就学到结论、换个键重发一次。
 *
 * 采样参数和 `tool_choice` 那两条轴**不在这里**，在 `request-params-compat.ts`——那是三条链共用的一份，
 * 两条链各写一份同样的正则是纯负债。这里只留「换字段名」这一条，因为它不是「撤掉一个参数」，撤不掉：
 * 输出上限必须发，只是键名有两种。
 *
 * 记在内存里，不落盘，理由见 `reasoning-compat.ts` 顶部：进程重启后重新学一次的代价是一次自愈的重发，
 * 换来的是不必为它做设置迁移，也不必担心一条学错的结论永久粘在用户的配置里。
 */
export type MaxTokensField = "max_tokens" | "max_completion_tokens";

/** 学到的结论：`${providerId} ${modelId}` → 用哪个键。键的拼法跟另外几条轴对齐。 */
const learned = new Map<string, MaxTokensField>();

const key = (providerId: string, modelId: string) => `${providerId} ${modelId}`;

/** 这个模型该用哪个键。没撞过之前就是这条链一直在发的那个。 */
export function maxTokensField(providerId: string, modelId: string): MaxTokensField {
	return learned.get(key(providerId, modelId)) ?? "max_tokens";
}

/** 测试用：把学到的都忘掉。 */
export function resetChatCompletionsCompat(): void {
	learned.clear();
}

/**
 * 「用另一个字段名」——端点自己点名了。
 *
 * OpenAI 官方对 o 系列和 gpt-5.x 的原话（走 `/v1/chat/completions` 时）：
 *
 *     Unsupported parameter: 'max_tokens' is not supported with this model.
 *     Use 'max_completion_tokens' instead.
 *
 * 抓的是后半句里被点名的那个字段。双向都认：万一学过头了、端点反过来说要 `max_tokens`，同一条规则能把
 * 它送回来，不会卡在错的那一格上。
 */
const USE_FIELD_INSTEAD = /use\s+["'`]?(max_tokens|max_completion_tokens)["'`]?\s+instead/i;

/**
 * 后半句被中转裁掉时的兜底：只剩「`max_tokens` 不支持」。
 *
 * 推断，未验证——没有实测样本。认它的理由是这一句里已经没有别的可做：我们只会发这两个字段名之一，说
 * `max_tokens` 不支持就只剩另一个可试。要求「不支持」紧跟在字段名后面（40 字以内、不跨句号），免得把
 * 一段顺口提到 `max_tokens` 的长错误也算进来。
 */
const MAX_TOKENS_UNSUPPORTED = /["'`]?max_tokens["'`]?[^.]{0,40}?(is not supported|not supported|unsupported|unrecognized|unknown)/i;

/**
 * 从一次失败里学点东西。返回「结论变了，值得换个形状重发一次」。
 *
 * 签名对上 `withReasoningRetry` 的 `alsoLearn`，而且**排在推理那条梯子前面**看——理由见那个参数的注释：
 * 指向明确的轴先看，误判的机会小得多。这里两条的指向再明确不过，错误串里点着字段名。
 *
 * 两个学习器都要问，**不能用 `||` 短路**：一句话可以同时点名两样（`max_tokens` 该换名、`temperature`
 * 不该发），短路会漏掉后一条，然后下一次重发再撞一遍同一句话。
 */
export function learnChatCompletionsCompat(providerId: string, modelId: string, error: string): boolean {
	const learnedField = learnMaxTokensField(providerId, modelId, error);
	/*
	 * 共用的那份参数轴（`request-params-compat.ts`）也来看一眼。
	 *
	 * 它管四个参数，而这条链只读其中三个。`include-encrypted` 是 Responses 专属的 `include` 数组，这条链
	 * 压根不发，所以学到它**不算**「值得重发」——重发的请求体会和刚被拒的那份一模一样，白烧一次钱。
	 *
	 * `reasoning-off` 起初也在排除之列，因为这条链关思考时什么都不发。后来实测发现「什么都不发」在
	 * DeepSeek 上根本关不掉思考（见上面 `reasoning_effort` 那段的七种写法对照），改成了明说
	 * `reasoning_effort: "none"`——于是这条链开始读它了，白名单必须跟着加。前提变了，判断就得跟着变。
	 *
	 * `droppedParams` 返回的是内部那个 Set 的引用，不是副本，所以要先抄一份快照再去学。
	 */
	const before = new Set(droppedParams(providerId, modelId));
	learnDroppedParam(providerId, modelId, error);
	const after = droppedParams(providerId, modelId);
	const readHere = ["sampling", "tool-choice", "reasoning-off"] as const;
	const droppedHere = readHere.some((param) => after.has(param) && !before.has(param));
	return learnedField || droppedHere;
}

/** 换字段名这一条。双向都认，理由见 `USE_FIELD_INSTEAD`。 */
function learnMaxTokensField(providerId: string, modelId: string, error: string): boolean {
	const id = key(providerId, modelId);
	const now = learned.get(id) ?? "max_tokens";
	const wanted = error.match(USE_FIELD_INSTEAD)?.[1] as MaxTokensField | undefined;
	const next = wanted ?? (now === "max_tokens" && MAX_TOKENS_UNSUPPORTED.test(error) ? "max_completion_tokens" : now);
	if (next === now) return false;
	learned.set(id, next);
	return true;
}

// ---------------------------------------------------------------------------
// 入站：推理文本挂在哪个键上
// ---------------------------------------------------------------------------

/**
 * 同一件事的三个字段名，按常见程度排。
 *
 * 抄 oh-my-pi 的那一行：`const reasoningFields = ["reasoning_content", "reasoning", "reasoning_text"]`
 * （`packages/ai/src/providers/openai-completions.ts:1206`），取第一个非空（同文件 `:1210-1217`）。
 * 取第一个而不是拼起来，是因为有的宿主同一个 chunk 里给同一段推理挂两个别名——拼就重了。
 *
 * 从前这条链只读 `reasoning_content`。代价是 OpenRouter 走 chat/completions 时推理挂在 `delta.reasoning`
 * 上（oh-my-pi 给它的方言标记是 `thinking-format "openrouter"`，见
 * `packages/catalog/src/compat/rules/providers/openrouter.kdl:8`），于是界面上一个思考字都没有——不报错，
 * 只是没有。
 */
const REASONING_FIELDS = ["reasoning_content", "reasoning", "reasoning_text"] as const;

/** 这个 delta 里的推理文本，和它挂着的那个键。三个都看，取第一个非空的。 */
export function reasoningFromDelta(delta: Record<string, unknown>): { field: string; text: string } | undefined {
	for (const field of REASONING_FIELDS) {
		const value = delta[field];
		if (typeof value === "string" && value.length > 0) return { field, text: value };
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// 入站：DeepSeek 的特殊 token 泄漏
// ---------------------------------------------------------------------------

/*
 * DeepSeek 的分词器保留 token 偶尔会原样出现在可见文本里。
 *
 * 三个正则和下面那个「跨 chunk 截断」的处理都抄自 oh-my-pi
 * （`packages/ai/src/providers/openai-completions.ts:585-616`）。它那边的注释说明了来历：某些自建宿主
 * （原话点名 NVIDIA NIM）不在服务端剥这些 token，于是它们进了 `delta.content`；而结构化的 `tool_calls`
 * 照样是对的，所以要修的只是可见文本。
 *
 * 形状：两侧是全角 `｜`（U+FF5C）或 ASCII `|`，中间只允许标识符字符加 DeepSeek 分词器的 `▁`，长度设上限
 * ——三样限制都是为了不去吃普通的尖括号文本。
 *
 * **这里和 oh-my-pi 不一样的一点**：它由端点声明（`stripDeepseekSpecialTokens` 轴）才开，我们没有那张
 * 表，所以默认开。代价说清楚：让模型原样输出一个字面的 `<|endoftext|>` 时，那串字会被吃掉。换来的是
 * 泄漏的 token 不会进历史——它一旦进了历史，下一轮就会被模型当成真的控制符看。
 *
 * 只做剥离这一档。oh-my-pi 还有一层 `stream-markup-healing-pattern`（把用标记文本写出来的工具调用还原成
 * 结构化调用，五种方言），那个不做：它要认五种方言的开闭标记、要在流中判断「这段文本其实是一个调用」、
 * 判错一次就把正常回答吞成一个不存在的工具调用。剥离是纯减法，还原是猜测，两者的失败代价差一个数量级。
 */
const DEEPSEEK_TOKEN = /<(?:｜|\|)[A-Za-z0-9_.｜|▁]{1,64}(?:｜|\|)>/g;
const DEEPSEEK_TOKEN_AT_START = /^\s*<(?:｜|\|)[A-Za-z0-9_.｜|▁]{1,64}(?:｜|\|)>/;
const DEEPSEEK_TOKEN_AT_END = /<(?:｜|\|)[A-Za-z0-9_.｜|▁]{1,64}(?:｜|\|)>\s*$/;
const DEEPSEEK_OPEN_DELIMS = ["<｜", "<|"] as const;

/** 把泄漏的特殊 token 去掉。首尾被剥掉的那一个连带它旁边的空白一起去，免得留下一行空格。 */
export function stripDeepseekTokens(text: string): string {
	const stripped = text.replace(DEEPSEEK_TOKEN, "");
	if (stripped === text) return text;
	let normalized = stripped;
	if (DEEPSEEK_TOKEN_AT_START.test(text)) normalized = normalized.replace(/^\s+/u, "");
	if (DEEPSEEK_TOKEN_AT_END.test(text)) normalized = normalized.replace(/\s+$/u, "");
	return normalized;
}

/**
 * 结尾那个还没闭合的 token，扣下来等下一个 chunk。
 *
 * 一个 token 会被 SSE 切成两半（`<｜tool` / `▁calls▁begin｜>`），分开看两半都不匹配。末尾单独一个 `<`
 * 也扣着——它可能是下一个 token 的开头。扣留长度设上限，免得正文里一个孤零零的 `<｜` 让缓冲无限长。
 */
export function trailingPartialDeepseekToken(text: string): string {
	let bestIdx = -1;
	for (const delim of DEEPSEEK_OPEN_DELIMS) {
		const idx = text.lastIndexOf(delim);
		if (idx > bestIdx) bestIdx = idx;
	}
	if (bestIdx === -1) return text.endsWith("<") ? "<" : "";
	const tail = text.slice(bestIdx);
	if (tail.includes("｜>") || tail.includes("|>")) return "";
	if (tail.length > 256) return "";
	return tail;
}

// ---------------------------------------------------------------------------
// 入站：finish_reason
// ---------------------------------------------------------------------------

/**
 * `finish_reason` 说的是什么。认不出来的一律算失败，不算成功。
 *
 * 从前只认 `stop` / `tool_calls` / `length` 三个，其余留在 `pending`，最后被兜成 `stop` 或 `toolUse`
 * ——**上游中途挂掉报 `finish_reason: "error"`，我们判成功**，把截断的半截答案交给 agent loop 接着跑。
 * 用户看到的是无声截断：没有错误，没有重试，就是话说到一半。
 *
 * 映射抄 oh-my-pi 的 `mapStopReason`（`packages/ai/src/providers/openai-completions.ts:2517-2564`），
 * 连里面每一条的来历一起：
 *
 *   - 先折大小写（`:2526`）：网关顶着 Google Gemini 后端时会发原生的大写 `STOP` / `MAX_TOKENS`。
 *   - `error`（`:2541-2547`）：网关（原话点了 OpenRouter、Vercel AI Gateway）把上游模型的故障报成一个
 *     不带细节的裸 `error`，多数是临时的。
 *   - `insufficient_system_resource`（`:2548-2557`）：DeepSeek 自己的文档说这是推理系统资源不足导致的
 *     中断，属于服务端容量问题。
 *   - `content_filter`（`:2537`）：内容策略。
 *   - 认不出来的（`:2558-2562`）：一律当失败。
 *
 * 返回 `stopReason` 表示这是一个正常的结束；返回 `error` 表示要抛，抛什么由调用方交给 `failure.ts` 判。
 */
export function mapFinishReason(reason: string): { stopReason?: StopReason; error?: string } {
	switch (reason.toLowerCase()) {
		case "stop":
		case "end":
			return { stopReason: "stop" };
		case "length":
		case "max_tokens":
			return { stopReason: "length" };
		case "tool_calls":
		case "function_call":
			return { stopReason: "toolUse" };
		/*
		 * 下面三档都是抛，但落进的分类不一样，而分类决定要不要重试（见 `failure.ts`）：
		 *
		 *   - `content_filter` 的措辞会被 `FATAL_PHRASES` 里的内容策略那条抓住，判成 `fatal`——不重试。
		 *     对的：同一段历史再发一次还是同一个策略。
		 *   - 另外两档谁也不匹配，落进 `upstream`——重试。也对：它们说的都是上游一时的状况。
		 */
		case "content_filter":
			return { error: "回答被内容安全策略拦下（content_filter）" };
		case "insufficient_system_resource":
			return { error: "上游推理资源不足，这次回答被中断" };
		case "error":
		case "network_error":
			return { error: "上游报告这次生成失败" };
		default:
			return { error: `上游给了一个读不懂的结束原因：${reason}` };
	}
}

async function* streamChatCompletions(
	provider: ProviderConfig,
	model: ModelConfig,
	context: LlmContext,
	options: RequestOptions,
): AsyncGenerator<StreamEvent, AssistantMessage> {
	const startTime = Date.now();
	const partial: AssistantMessage = {
		role: "assistant",
		content: [],
		api: "openai-chat-completions",
		provider: provider.id,
		model: model.modelId,
		usage: emptyUsage(),
		stopReason: "pending",
		timestamp: startTime,
	};

	const reasoningEffort = resolveReasoningEffort(options.thinking, model);
	const thinkingEnabled = reasoningEffort !== undefined;

	/*
	 * 每次尝试重新编一遍，因为**推理形状可能在两次之间变掉**。
	 *
	 * 端点对「把推理还回去」的态度是撞出来的，不是配出来的（见 `reasoning-compat.ts`）。被顶回来的那
	 * 一次会记下结论、换个形状重发——那就必须能重新编一份请求体，而不是把第一次编好的那份再发一遍。
	 */
	const buildBody = (replay: ReasoningReplay): Record<string, unknown> => {
		const tokensField = maxTokensField(provider.id, model.id);
		const dropped = droppedParams(provider.id, model.id);
		/*
		 * 采样参数：撞过一次 400 之后就一个都不发，连 `options.temperature` 一起。
		 *
		 * 这里也是**现有那个闸漏水的地方**。`temperature` 上方挂着 `!thinkingEnabled`，意思清楚——推理模式
		 * 下不发采样参数——然后下面两行 `...model.samplingParams, ...options.samplingParams` 无条件展开，把
		 * 刚挡住的又放回来了。用户在设置里填一个 `{"temperature": 0.7}`，配上 OpenAI 的 o 系列或 gpt-5.x，
		 * 每一轮都是 400。
		 *
		 * 没有去把那个闸补严（推理模式下顺手把 samplingParams 里的采样键也剔掉），是因为那会改变一批**现在
		 * 正常工作**的端点上的行为：DeepSeek 系推理模型收 `temperature`（只是忽略它），别的宿主在推理模式下
		 * 确实按它采样。剔掉等于替用户否决一个他明确填过的值，而我手上没有证据说哪些端点该剔。
		 *
		 * 可学的那条路没有这个问题：默认一字不改，撞上那句点名 `temperature` 的 400 才全省，然后重发。
		 * 那条轴和它的证据在 `request-params-compat.ts`，三条链共用一份。
		 */
		const sampling = dropped.has("sampling") ? {} : { ...model.samplingParams, ...options.samplingParams };
		/*
		 * 学到该用 `max_completion_tokens` 之后，`max_tokens` 必须从采样参数里也清掉。
		 *
		 * 不清的话，用户手填的那个键会在下面 `...sampling` 里重新出现，两个字段同时在请求里——而顶回来我们
		 * 的那个端点正是因为不认识 `max_tokens` 才顶的，它会再顶一次，学到的结论白学。
		 */
		if (tokensField !== "max_tokens" && "max_tokens" in sampling) {
			delete (sampling as Record<string, unknown>).max_tokens;
		}
		return {
			model: model.modelId,
			messages: toChatCompletionsMessages(
				context.systemPrompt ?? "",
				sanitizeToolPairing(context.messages),
				replay,
				model,
			),
			stream: true,
			stream_options: { include_usage: true },
			/*
			 * 字段名是学出来的，不是写死的。
			 *
			 * 默认 `max_tokens`——这条链一直发的那个，绝大多数 OpenAI 兼容端点只认它。而 OpenAI 官方的 o
			 * 系列、o4-mini、gpt-5.x 走 `/v1/chat/completions` 时只认 `max_completion_tokens`，发前者是
			 * 400，每一轮都挂，裁史重试救不了（请求形状的错跟历史长度无关）。
			 *
			 * oh-my-pi 靠一张表分流（轴在 `packages/catalog/src/compat/axes.ts:102`，默认
			 * `max_completion_tokens`，只给七组端点用 `max_tokens`，见
			 * `packages/catalog/src/compat/resolve.ts:397-403、490`，落盘在
			 * `packages/ai/src/providers/openai-completions.ts:1826-1842`）。我们没有那张表，**默认反过来**：
			 * 保持现在这个，撞上才学。理由见 `MaxTokensField` 上面那段——那个 400 会直接点名正确字段。
			 */
			[tokensField]: options.maxTokens ?? model.maxOutputTokens,
			/*
			 * 没有工具的时候，`tools` 和 `tool_choice` 两个都不发——这一条一直是对的，`tool_choice` 挂在
			 * `tools` 的同一个条件里（oh-my-pi 也专门删这种组合，见 `openai-completions.ts:1783-1798`：
			 * 一个没有工具可管的 `tool_choice` 会绊倒 LiteLLM → Bedrock 那条路）。
			 *
			 * 有工具时 `tool_choice: "auto"` **默认照发**，撞上才省——那条轴在 `request-params-compat.ts`。
			 *
			 * 为什么不直接省掉它（一度真省了，又退回来了）：
			 *
			 *   - oh-my-pi 说有端点不收它——`supportsToolChoice: d.isClinePass || !d.isDirectDeepseekReasoning`
			 *     （`packages/catalog/src/compat/resolve.ts:486`，直连 DeepSeek 的推理模型那一格是 false）。
			 *   - 但本项目 2026-09-11 在用户自己那两个端点上实测发 `tool_choice: "auto"` 得 200（探针
			 *     `test/responses-params-probe.ts`，落盘 `~/.lyra/scratch/responses-params.txt`；那一轮测的是
			 *     Responses 端点，不是这条链）。
			 *
			 * 也就是说手上没有能复现这个故障的端点，而 `auto` 本来就是服务端在有 `tools` 时的默认值（OpenAI
			 * API 文档：`auto` is the default if functions are present）——收益为零。零收益不足以支撑一次默认
			 * 行为变更。
			 *
			 * **有一档这样学不到**，说清楚：oh-my-pi 还有一条
			 * `disableReasoningOnToolChoice: … isDeepseekFamily && Boolean(spec.reasoning) && !d.isOpenRouter`
			 * （同文件 `:485`），说的是 DeepSeek 家族带推理时发了 `tool_choice` 会把**推理静默关掉**。那不报
			 * 错、没有错误串，撞不出来——只能靠一张表或者一次针对 DeepSeek 的实测。这一格仍然空着。
			 */
			...(context.tools.length > 0
				? {
						tools: toChatCompletionsTools(context.tools),
						...(dropped.has("tool-choice") ? {} : { tool_choice: "auto" }),
					}
				: {}),
			/*
			 * 关思考要**明说**，不能靠不发。
			 *
			 * 这条链原本什么都不发（`resolveReasoningEffort` 在 `off` 上返回 undefined），理由是「不发在所有
			 * 端点上都不会是 400」——安全，但**关不掉**。2026-09-11 在 `api.deepseek.com/v1/chat/completions`
			 * 上量过一张表（落盘 `~/.lyra/scratch/cc-open-questions.txt`，探针
			 * `test/cc-open-questions-probe.ts`），同一个问题七种写法：
			 *
			 *     什么都不发（原来这样）      推理 45 字   ← 关不掉
			 *     reasoning_effort: "low"     推理 63 字   ← 关不掉
			 *     reasoning_effort: "minimal" 推理 39 字   ← 关不掉
			 *     enable_thinking: false      推理 57 字   ← 关不掉
			 *     reasoning: {enabled:false}  推理 48 字   ← 关不掉
			 *     thinking: {type:"disabled"} 推理  0 字
			 *     reasoning_effort: "none"    推理  0 字   ← 用这个
			 *
			 * 不发等于用服务端默认，而这个模型的服务端默认就在思考。用户在界面上关掉思考、以为省下了那笔
			 * 钱，实际上模型照想不误、推理 token 照收——不报错，不可见，只是账单不对。
			 *
			 * 这也顺带否掉了 oh-my-pi 的 `lowest-effort`（它的默认 disable mode，
			 * `packages/catalog/src/compat/resolve.ts:274`）：`low` 和 `minimal` 在这个端点上都关不掉。
			 *
			 * 发 `"none"` 的风险是有端点不认这个值（Gemini/Vertex 的原话是
			 * `none is not a valid ThinkingLevel enum value`，`effort: "none"` 也是 GPT-5.1 之后才加的），
			 * 所以它挂在可学的轴下面：撞上就退回「什么都不发」，也就是这条链原来的行为。两条 OpenAI 链现在
			 * 用的是同一条轴、同一个信号。
			 */
			...(model.supportsThinking
				? thinkingEnabled && reasoningEffort
					? { reasoning_effort: reasoningEffort }
					: dropped.has("reasoning-off")
						? {}
						: { reasoning_effort: "none" }
				: {}),
			...(options.temperature !== undefined && !thinkingEnabled && !dropped.has("sampling")
				? { temperature: options.temperature }
				: {}),
			...sampling,
		};
	};
	let body = buildBody(reasoningReplay(provider.id, model.id));

	options.onPayload?.(body);

	const doFetch = options.fetch ?? globalThis.fetch;
	let firstTokenTime: number | null = null;
	const inventedIds = new Map<number, string>();
	/** 收到过几个能看懂的事件——用来分辨「模型没话说」和「中转发来一团别的东西」。 */
	let framesSeen = 0;
	/** 前几次失败的尝试各自花掉的 token，攒着，最后加进这条消息的用量里。见 `reset`。 */
	let spentOnRetries = emptyUsage();

	const retryBudget = new RetryBudget(options.retryPolicy, options.retryAttempts);
	try {
		yield* withReasoningRetry(provider.id, model.id, () => {
			spentOnRetries = addUsage(spentOnRetries, partial.usage);
			partial.content = [];
			partial.usage = emptyUsage();
			inventedIds.clear();
			framesSeen = 0;
			firstTokenTime = null;
			/*
			 * 这条链没有工具排列这个轴：Chat Completions 协议本身就规定带 `tool_calls` 的助手消息后面必须
			 * 紧跟回答它的 tool 消息，交错是唯一合法的排法，没什么可学的。可学的是 Responses 那条链。
			 */
		}, learnChatCompletionsCompat, async function* (replay) {
			body = buildBody(replay);
			options.onPayload?.(body);
			yield* retryStream(
			async function* attempt() {
				const response = await fetchWithRetry(
					doFetch,
					/*
					 * `/v1/`，和另外两条链一样。
					 *
					 * 这一条原本是 `"/chat/completions"`，是三条链里唯一不带版本段的。`joinUrl` 只在 path
					 * 以 `/v1/` 开头时才去重 baseUrl 末尾已有的 `/v1`，所以这一条既不补、也享受不到去重：
					 * 填最自然的 `https://api.openai.com` 拼出来是
					 * `https://api.openai.com/chat/completions`，官方直接 404（`/v1/chat/completions` 才是
					 * 那个地址，不带密钥打它返回 401——路由在，只是没认证）。
					 *
					 * 于是同一份 baseUrl 在三条链里规则不一样，而且只有这一条要求填的人知道内情。宽松的
					 * 宿主两个地址都收，所以这个 bug 只在最正规的那些端点上发作。
					 */
					joinUrl(provider.baseUrl, "/v1/chat/completions"),
					{
						method: "POST",
						headers: {
							"content-type": "application/json",
							authorization: `Bearer ${provider.apiKey}`,
							...provider.headers,
						},
						body: JSON.stringify(body),
						signal: options.signal,
					},
					{
						budget: retryBudget,
						signal: options.signal,
						onRetry: options.onRetry,
					},
				);

				if (!response.ok) {
					// 带着结论抛：`fetchWithRetry` 已经判过了，上面那层不该拿一个字符串重新猜。
					const detail = await response.text().catch(() => "");
					throw new FailureError(classifyFailure({ from: "status", status: response.status, body: detail }));
				}

				yield { type: "start", partial: { ...partial } } as StreamEvent;

				let currentTextIndex = -1;
				let currentThinkingIndex = -1;
				/** 这次尝试里没能解析的帧，留一份原文，空回答时用来说明收到的到底是什么。 */
				let unparsable = "";
				/** 收到过 `[DONE]` 没有——和下面那个一起，用来分辨「说完了」和「线断了」。 */
				let sawDone = false;
				/** 收到过 `finish_reason` 没有。 */
				let sawFinish = false;
				/** `finish_reason` 说这次不算成功，那句话是什么。流走完才抛，见下面。 */
				let finishError: string | undefined;
				/** 这条流的推理 delta 是全量快照而不是增量。见 `appendReasoning`。 */
				let reasoningIsSnapshot = false;
				/** 可见文本里扣下来等下一个 chunk 的那截半个特殊 token。见 `trailingPartialDeepseekToken`。 */
				let stripBuffer = "";
				/** 这条流被空闲闸掉了吗。见 `readSseWithIdleTimeout`。 */
				const idle = { tripped: false };

				for await (const frame of readSseWithIdleTimeout(response, options.signal, STREAM_IDLE_TIMEOUT_MS, idle)) {
					if (frame.data === "[DONE]") {
						sawDone = true;
						break;
					}
					let event: Record<string, any>;
					try {
						event = JSON.parse(frame.data);
					} catch {
						if (!unparsable) unparsable = frame.data.slice(0, 500);
						continue;
					}
					framesSeen += 1;

					/*
					 * 错误也可能写在帧里，而不是状态码上。
					 *
					 * 这个适配器面对的多半是中转，而中转最爱的一种答法就是 200 加一个 `{"error":{…}}`
					 * 帧。从前没有任何一处认这种形状：`choices` 是空的，于是 `continue`，流结束时留下
					 * 一条空回答——不报错，不重试，屏幕上什么都没有。
					 */
					if (event.error && !event.choices) {
						const said = event.error?.message;
						throw new FailureError(
							classifyFailure({
								from: "stream",
								message: typeof said === "string" ? said : undefined,
								raw: JSON.stringify(event).slice(0, 4000),
								spent: partial.usage.output > 0 || partial.content.length > 0,
							}),
						);
					}

					if (event.usage) {
						partial.usage.input = event.usage.prompt_tokens ?? 0;
						partial.usage.output = event.usage.completion_tokens ?? 0;
						partial.usage.cacheRead = event.usage.prompt_tokens_details?.cached_tokens ?? 0;
						// OpenAI-compatible APIs report cached tokens inside prompt_tokens. Keep the
						// buckets disjoint or both the usage page and the price calculator count them twice.
						partial.usage.input = Math.max(0, partial.usage.input - partial.usage.cacheRead);
						partial.usage.cacheWrite = 0;
						if (typeof event.usage.completion_tokens_details?.reasoning_tokens === "number") {
							partial.usage.reasoning = event.usage.completion_tokens_details.reasoning_tokens;
						}
						partial.usage.total = partial.usage.input + partial.usage.output + partial.usage.cacheRead + partial.usage.cacheWrite;
						partial.usage = computeCost(partial.usage, model);
					}

					const choice = event.choices?.[0];
					if (!choice) continue;

					const delta = choice.delta;
					if (delta) {
						/*
						 * 推理挂在三个键之一上，不只是 `reasoning_content`。见 `reasoningFromDelta`。
						 *
						 * 从前这里写死 `delta.reasoning_content`，于是 OpenRouter 走 chat/completions 时（推理
						 * 在 `delta.reasoning`）界面上一个思考字都没有。
						 */
						const reasoning = reasoningFromDelta(delta);
						if (delta.content || reasoning || delta.tool_calls) {
							if (firstTokenTime === null) firstTokenTime = Date.now();
						}
						if (reasoning) {
							if (currentThinkingIndex === -1) {
								currentThinkingIndex = partial.content.length;
								/*
								 * 字段名记在块上，下一轮用同一个键还回去（见 `ThinkingContent.reasoningField`
								 * 和 `openai-chat-completions-request.ts` 里编码那一段）。
								 */
								partial.content.push({ type: "thinking", thinking: "", reasoningField: reasoning.field });
								yield { type: "thinking_start", index: currentThinkingIndex };
							}
							const thinkingBlock = partial.content[currentThinkingIndex];
							if (thinkingBlock && thinkingBlock.type === "thinking") {
								/*
								 * 有的端点每个 chunk 发的是**全量快照**，不是增量。
								 *
								 * MiniMax 系是这样（oh-my-pi 的轴 `reasoning-deltas-may-be-cumulative`，声明在
								 * `packages/catalog/src/compat/rules/classes/minimax.kdl:9`；处理在
								 * `packages/ai/src/providers/openai-completions.ts:1030-1046`——按 signature 记住上
								 * 一份快照，按前缀削掉已发的部分）。无条件 `+=` 会把一段推理拼成 O(n²) 的重复文本。
								 *
								 * 这一条**不需要端点知识**，形状自己会说话：一个新 delta 如果以「已经攒到的全部
								 * 推理文本」开头而且更长，它只可能是快照——增量式端点的一个 chunk 里不会重复整段
								 * 前文。
								 *
								 * 那个「恰好重复」的边界（增量式端点发来的 chunk 正好等于已攒文本）用两条闸挡住：
								 *
								 *   1. **要求严格更长**。长度相等的重复不算快照，照旧追加——那种 chunk 在增量流里
								 *      是可能的（一个短词被重复说），而在快照流里几乎不会（模型在生成，快照在长）。
								 *      代价是快照流里「内容没增长的那一帧」会被重复追加一次，接受。
								 *   2. **定性之后每一帧仍然验证前缀**。锁成快照不等于往后闭着眼削：`startsWith`
								 *      不成立就当增量追加。所以万一在一个增量流上误判了一次，损失也只是那一帧。
								 */
								const attached = thinkingBlock.thinking;
								const text = reasoning.text;
								if (!reasoningIsSnapshot && attached.length > 0 && text.length > attached.length && text.startsWith(attached)) {
									reasoningIsSnapshot = true;
								}
								const fragment = reasoningIsSnapshot && text.startsWith(attached) ? text.slice(attached.length) : text;
								if (fragment) {
									thinkingBlock.thinking += fragment;
									yield {
										type: "thinking_delta",
										index: currentThinkingIndex,
										delta: fragment,
										partial: { ...partial },
									};
								}
							}
						}

						if (delta.content) {
							/*
							 * 可见文本先过一遍特殊 token 的剥离，见 `stripDeepseekTokens`。
							 *
							 * 缓冲只在文本末尾留着半个未闭合 token 时才扣字——正常文本一个字都不延迟。扣下来的
							 * 那一小截在下一个 chunk 里接上，或者在流结束时 flush（见下面）。
							 */
							stripBuffer += delta.content;
							const held = trailingPartialDeepseekToken(stripBuffer);
							const flushable = stripBuffer.slice(0, stripBuffer.length - held.length);
							stripBuffer = held;
							const cleaned = stripDeepseekTokens(flushable);
							/*
							 * 剥过之后只剩空白的，一个字都不发。
							 *
							 * 和 oh-my-pi 同一条判断（`openai-completions.ts:1073`
							 * `if (stripped && (stripped === flushable || stripped.trim().length > 0))`）：没剥过的
							 * 原样放行（正常文本里的空格要留），剥过的要求剩下的不是纯空白——否则一个单独成 chunk
							 * 的泄漏 token 会在回答里留下一行空格，还会把上面的思考块提前关掉。
							 */
							const visible = cleaned && (cleaned === flushable || cleaned.trim().length > 0) ? cleaned : "";
							if (visible) {
								if (currentThinkingIndex !== -1) {
									yield { type: "thinking_end", index: currentThinkingIndex };
									currentThinkingIndex = -1;
								}
								if (currentTextIndex === -1) {
									currentTextIndex = partial.content.length;
									partial.content.push({ type: "text", text: "" });
									yield { type: "text_start", index: currentTextIndex };
								}
								const textBlock = partial.content[currentTextIndex];
								if (textBlock && textBlock.type === "text") {
									textBlock.text += visible;
									yield {
										type: "text_delta",
										index: currentTextIndex,
										delta: visible,
										partial: { ...partial },
									};
								}
							}
						}

						if (delta.tool_calls) {
							/*
							 * 扣着的那半截先吐掉，再关文本块。
							 *
							 * 不吐的话它会一直留到流结束，那时 `currentTextIndex` 已经是 -1，flush 会另开一个文本
							 * 块排在工具调用**后面**——一句话被搬到了它原来位置的后面。
							 */
							if (stripBuffer && currentTextIndex !== -1) {
								const tail = stripDeepseekTokens(stripBuffer);
								const textBlock = partial.content[currentTextIndex];
								if (tail && textBlock && textBlock.type === "text") {
									textBlock.text += tail;
									yield { type: "text_delta", index: currentTextIndex, delta: tail, partial: { ...partial } };
								}
							}
							stripBuffer = "";
							if (currentThinkingIndex !== -1) {
								yield { type: "thinking_end", index: currentThinkingIndex };
								currentThinkingIndex = -1;
							}
							if (currentTextIndex !== -1) {
								yield { type: "text_end", index: currentTextIndex };
								currentTextIndex = -1;
							}

							for (const tc of delta.tool_calls) {
								const tcIndex = tc.index ?? 0;
								let block = partial.content.find(
									(c): c is ToolCallContent => c.type === "toolCall" && (c as any)._tcIndex === tcIndex,
								);

								if (!block) {
									const id = toolCallId(tc.id, tcIndex, inventedIds);
									const name = tc.function?.name || "";
									const toolCallIndex = partial.content.length;
									const newBlock: ToolCallContent = {
										type: "toolCall",
										id,
										name,
										arguments: {},
										argumentsText: "",
										...({ _tcIndex: tcIndex } as any),
									};
									partial.content.push(newBlock);
									block = newBlock;
									yield { type: "toolcall_start", index: toolCallIndex, id, name };
								}

								if (tc.function?.name && !block.name) {
									block.name = tc.function.name;
								}

								if (tc.function?.arguments) {
									/*
									 * 字符串是分片，接上去；对象是**整份参数**，覆盖掉。
									 *
									 * 直接 `+` 会把对象变成 `"[object Object]"`——见 `argumentFragment`。而一个
									 * 一次性给完整对象的宿主，往往每个 delta 都重发一遍同一份；接上去会拼成两份。
									 */
									const fragment = argumentFragment(tc.function.arguments);
									block.argumentsText = typeof tc.function.arguments === "string"
										? (block.argumentsText || "") + fragment
										: fragment;
									const blockIndex = partial.content.indexOf(block);
									yield {
										type: "toolcall_delta",
										index: blockIndex >= 0 ? blockIndex : tcIndex,
										delta: fragment,
										partial: { ...partial },
									};
								}
							}
						}
					}

					if (choice.finish_reason) {
						sawFinish = true;
						/*
						 * 认不出来的结束原因是失败，不是成功。见 `mapFinishReason`。
						 *
						 * 记下来、流走完再抛，不在这里抛：这里抛会跳过下面那一轮 `thinking_end` / `text_end`，
						 * 而异常那一路会另发一份 `error` 事件带着同一个 partial——界面上就有一个永远没关上的块。
						 * oh-my-pi 在同一个位置给的理由一样（`openai-completions.ts:1407-1409`：throwing after
						 * that sweep would make the error handler emit a second text_end）。
						 */
						const mapped = mapFinishReason(String(choice.finish_reason));
						if (mapped.stopReason) partial.stopReason = mapped.stopReason;
						if (mapped.error) finishError ??= mapped.error;
					}
				}

				/*
				 * 扣着的最后那一截吐出来。
				 *
				 * 走到这里说明流结束了，缓冲里剩的东西不可能再等到下半个 token——它就是普通文本（比如一段话
				 * 正好以 `<` 结尾）。剥一遍再发，剥完是空的就算了。
				 */
				if (stripBuffer) {
					const tail = stripDeepseekTokens(stripBuffer);
					stripBuffer = "";
					if (tail && (tail.trim().length > 0 || currentTextIndex !== -1)) {
						if (currentTextIndex === -1) {
							currentTextIndex = partial.content.length;
							partial.content.push({ type: "text", text: "" });
							yield { type: "text_start", index: currentTextIndex };
						}
						const textBlock = partial.content[currentTextIndex];
						if (textBlock && textBlock.type === "text") {
							textBlock.text += tail;
							yield { type: "text_delta", index: currentTextIndex, delta: tail, partial: { ...partial } };
						}
					}
				}

				/*
				 * `finish_reason` 说这次不算成功——抛，让重试那一层按分类决定重不重试。
				 *
				 * `spent` 给真话：已经吐过字的话服务商收过钱了，界面要把这个代价说出来（见 `Failure.costIncurred`）。
				 */
				if (finishError) {
					throw new FailureError(
						classifyFailure({
							from: "stream",
							message: finishError,
							spent: partial.usage.output > 0 || partial.content.length > 0,
						}),
					);
				}

				/*
				 * 有内容，却既没有 `finish_reason` 也没有 `[DONE]`——这是线断了，不是说完了。
				 *
				 * 从前这条链没有任何这类判定：传输在中途 EOF，我们把半截答案当成正常结束交出去，`stopReason`
				 * 被下面那段兜成 `stop` 或 `toolUse`。用户看到的是无声截断。
				 *
				 * 判据抄 oh-my-pi（`packages/ai/src/providers/openai-completions.ts:1417-1422`），连它的取舍一起：
				 * 只有**两个收尾信号都没有**才算断。它的注释（同文件 `:1410-1416`）说明了为什么——有些 OpenAI
				 * 兼容宿主压根不发 `finish_reason`、只靠 `[DONE]` 收尾，所以光看 `finish_reason` 会把它们每一轮
				 * 都误判成截断。反过来，一个两样都不发、只是安静关闭连接的宿主会被我们误判；那种宿主没见过，
				 * 而且它本来就没有任何办法让人分辨「说完了」和「断了」。
				 *
				 * 没有内容的情况不走这里：那是空回答，下面那段管，错误信息说得更准。
				 */
				/*
				 * 被空闲闸掉的，按连接问题抛，排在截断之前。
				 *
				 * 挂死的流从这一侧看恰好就是「没有收尾信号」，所以不先认领的话，下面那条会把它说成截断
				 * ——两者都可重试，但说出来的原因不一样，而用户读到的就是那句话。见 Anthropic 链上同一段。
				 */
				if (idle.tripped) {
					throw new FailureError(
						classifyFailure({ from: "transport", error: new Error(`流空闲超过 ${Math.round(STREAM_IDLE_TIMEOUT_MS / 1000)} 秒`) }),
					);
				}

				if (!sawFinish && !sawDone && partial.content.length > 0) {
					throw new FailureError(
						classifyFailure({
							from: "stream",
							message: "回答只传了一半，连接就断了",
							spent: true,
						}),
					);
				}

				if (currentThinkingIndex !== -1) {
					yield { type: "thinking_end", index: currentThinkingIndex };
				}
				if (currentTextIndex !== -1) {
					yield { type: "text_end", index: currentTextIndex };
				}

				// Parse JSON args for all tool calls
				for (let i = 0; i < partial.content.length; i++) {
					const c = partial.content[i];
					if (c.type === "toolCall") {
						c.arguments = parseToolArguments(c.argumentsText || "{}") ?? {};
						delete (c as any)._tcIndex;
						yield { type: "toolcall_end", index: i, partial: { ...partial } };
					}
				}

				// 空回答也是失败，不是「模型没话说」——见 Responses 适配器里同一段的说明。
				if (partial.content.length === 0) {
					throw new FailureError(
						classifyFailure({
							from: "empty",
							why: unparsable ? "unparsable" : framesSeen === 0 ? "no-frames" : "no-content",
							body: unparsable || undefined,
						}),
					);
				}
			},
			{
				budget: retryBudget,
				signal: options.signal,
				onRetry: options.onRetry,
				reset: () => {
					// 已经花掉的 token 不清零，见 Responses 适配器里同一段。
					spentOnRetries = addUsage(spentOnRetries, partial.usage);
					partial.content = [];
					partial.usage = emptyUsage();
					inventedIds.clear();
					framesSeen = 0;
					firstTokenTime = null;
				},
			},
			);
		});
	} catch (error) {
		// 失败时这条消息长什么样，三条链一致——见 `failedStreamEvent`。
		yield failedStreamEvent(partial, {
			error,
			signal: options.signal,
			model,
			spentOnRetries,
			startTime,
			firstTokenTime,
		});
		return partial;
	}

	partial.durationMs = Math.max(1, Date.now() - startTime);
	if (firstTokenTime !== null) {
		partial.sseDurationMs = Math.max(1, Date.now() - firstTokenTime);
	}
	if (partial.stopReason === "pending") {
		const hasToolCalls = partial.content.some((c) => c.type === "toolCall");
		partial.stopReason = hasToolCalls ? "toolUse" : "stop";
	}
	// 成功了，但失败的那几次也是花过钱的——账上要有。
	partial.usage = computeCost(addUsage(partial.usage, spentOnRetries), model);

	yield { type: "done", message: partial };
	return partial;
}
