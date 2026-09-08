import type { RetryPolicySource } from "../config/retry-policy.ts";
import type { Failure } from "../ai/failure.ts";
/**
 * Models, providers, and the stream a request comes back as.
 *
 * Lyra speaks two wire formats and no others. Everything above this line is expressed in the
 * neutral message shape; everything below it is a provider's own idea of a request.
 */

import type { AssistantMessage, Message } from "./message.ts";
import type { ToolSpec } from "./tool.ts";

// ---------------------------------------------------------------------------
// Models & providers
// ---------------------------------------------------------------------------

/**
 * Wire formats Lyra speaks. Chat Completions is deliberately excluded: the product
 * targets Responses and Anthropic Messages only.
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
