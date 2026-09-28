import type { RetryPolicySource } from "../config/retry-policy.ts";
import type { Failure } from "../ai/failure.ts";
/**
 * Models, providers, and the stream a request comes back as.
 *
 * Lyra speaks three wire formats and no others. Everything above this line is expressed in the
 * neutral message shape; everything below it is a provider's own idea of a request.
 */

import type { AssistantMessage, Message } from "./message.ts";
import type { ToolSpec } from "./tool.ts";

// ---------------------------------------------------------------------------
// Models & providers
// ---------------------------------------------------------------------------

/**
 * Wire formats Lyra speaks: OpenAI Responses, Anthropic Messages, and OpenAI Chat Completions — the
 * one most OpenAI-compatible services and relays speak. Each has its adapter in `ai/`, and every path
 * that sends a request (the settings page's connection test included) goes through that adapter.
 */
export type ApiFormat = "openai-responses" | "anthropic-messages" | "openai-chat-completions";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra" | (string & {});

export interface ThinkingOption {
	id: ThinkingLevel;
	label: string;
	detail: string;
	isDefault?: boolean;
	/** Required for a nonstandard effort name on the budget-based Anthropic adapter. */
	budgetTokens?: number;
}

export interface ModelPricing {
	/** USD per million tokens. */
	input: number;
	output: number;
	cacheRead?: number;
	cacheWrite?: number;
	/** Higher rates selected when one request crosses a context threshold. */
	tiers?: ModelPricingTier[];
	/** Manual values always take precedence over catalogue defaults. */
	source?: "manual" | "catalog";
	catalogProvider?: string;
	catalogVersion?: string;
	/** The exact reference entry, including when the endpoint uses a relay alias. */
	catalogModel?: string;
}

export interface ModelPricingTier {
	aboveTokens: number;
	input: number;
	output: number;
	cacheRead?: number;
	cacheWrite?: number;
}

export interface ModelConfig {
	/** Stable local id, unique across providers: `${providerId}/${modelId}`. */
	id: string;
	providerId: string;
	/** Id sent to the provider. */
	modelId: string;
	/** Label shown in the UI. */
	name: string;
	contextWindow: number;
	maxOutputTokens: number;
	supportsThinking: boolean;
	supportsImages: boolean;
	supportsTools: boolean;
	pricing?: ModelPricing;
	/** Explicit upstream identity for opaque relay aliases; never changes the wire modelId. */
	catalogRef?: { providerId: string; modelId: string };
	/** Whether limits and capabilities follow the catalogue or an intentional local override. */
	metadataSource?: "catalog" | "manual";
	/** Custom thinking options supported by this specific model. */
	thinkingOptions?: ThinkingOption[];
	/** Extra sampling parameters merged verbatim into the request body. */
	samplingParams?: Record<string, unknown>;
}

export interface ProviderConfig {
	id: string;
	name: string;
	baseUrl: string;
	api: ApiFormat;
	apiKey: string;
	enabled: boolean;
	/** Extra headers merged into every request. */
	headers?: Record<string, string>;
	models: ModelConfig[];
}

export interface RequestOptions {
	signal?: AbortSignal;
	maxTokens?: number;
	temperature?: number;
	thinking?: ThinkingLevel;
	/** Merged over `ModelConfig.samplingParams`. */
	samplingParams?: Record<string, unknown>;
	fetch?: typeof globalThis.fetch;
	/** Inspect or rewrite the outgoing body — used by the request inspector in the UI. */
	onPayload?: (payload: unknown) => void;
	/**
	 * How many times to attempt the request, including the first.
	 *
	 * Only the connection is retried, never a stream already in flight. 1 disables it.
	 */
	retryAttempts?: number;
	retryPolicy?: RetryPolicySource;
	/** Told about each wait, so the UI can say why a turn is taking longer than usual. */
	onRetry?: (info: { attempt: number; delayMs: number; reason: string; failure?: Failure }) => void;
	/**
	 * 同一段对话的请求共用的缓存键——主会话是会话 id，子代理是它自己的 id。
	 *
	 * OpenAI 按「前缀 + 这个键」把请求路由到同一台机器，前缀缓存才接得上；中转站（sub2api 之类）
	 * 按它把同一段对话钉在同一个上游账号上。没有它，号池随机分，换一个没见过这段前缀的账号就是
	 * 一次全额的冷启动。见 `ai/cache-key.ts`。
	 */
	cacheKey?: string;
}

export interface LlmContext {
	systemPrompt: string;
	messages: Message[];
	tools: ToolSpec[];
}

// ---------------------------------------------------------------------------
// Streaming events emitted by provider adapters
// ---------------------------------------------------------------------------

export type StreamEvent =
	| { type: "start"; partial: AssistantMessage }
	| { type: "text_start"; index: number }
	| { type: "text_delta"; index: number; delta: string; partial: AssistantMessage }
	| { type: "text_end"; index: number }
	| { type: "thinking_start"; index: number }
	| { type: "thinking_delta"; index: number; delta: string; partial: AssistantMessage }
	| { type: "thinking_end"; index: number }
	| { type: "toolcall_start"; index: number; id: string; name: string }
	| { type: "toolcall_delta"; index: number; delta: string; partial: AssistantMessage }
	| { type: "toolcall_end"; index: number; partial: AssistantMessage }
	| { type: "done"; message: AssistantMessage }
	| { type: "error"; error: string; message: AssistantMessage };

export interface Provider {
	readonly api: ApiFormat;
	stream(
		provider: ProviderConfig,
		model: ModelConfig,
		context: LlmContext,
		options: RequestOptions,
	): AsyncGenerator<StreamEvent, AssistantMessage>;
}
