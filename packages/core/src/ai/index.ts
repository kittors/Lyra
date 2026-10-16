import type {
	ApiFormat,
	AssistantMessage,
	LlmContext,
	ModelConfig,
	Provider,
	ProviderConfig,
	RequestOptions,
	StreamEvent,
} from "../types.ts";
import { anthropicMessagesProvider } from "./anthropic-messages.ts";
import { openaiResponsesProvider } from "./openai-responses.ts";
import { openaiChatCompletionsProvider } from "./openai-chat-completions.ts";

/**
 * The adapters this module falls back to.
 *
 * The real registry is `ctx.llm`, contributed by the `llm` plugin — that is where an adapter for
 * a private or experimental API gets added without editing anything here. This map is what the
 * lookup uses when no context has been bound, which is the case in tests and in small tools that
 * have no reason to build a plugin host.
 */
const BUILT_IN: Record<ApiFormat, Provider> = {
	"anthropic-messages": anthropicMessagesProvider,
	"openai-responses": openaiResponsesProvider,
	"openai-chat-completions": openaiChatCompletionsProvider,
};

/** Set once by the host that owns the plugin context; read on every lookup. */
let registry: { get(api: string): Provider | undefined } | null = null;

/**
 * Point provider lookup at a plugin registry.
 *
 * Deliberately a binding rather than a parameter threaded through every call site: the adapter
 * in use is a property of the running application, and passing it down through the agent loop,
 * compaction and every tool that streams would say otherwise.
 */
export function useLlmRegistry(next: { get(api: string): Provider | undefined } | null): void {
	registry = next;
}

export const API_FORMATS: { value: ApiFormat; label: string; hint: string }[] = [
	{ value: "openai-responses", label: "Responses (/responses)", hint: "OpenAI Responses API" },
	{ value: "openai-chat-completions", label: "Chat Completions (/chat/completions)", hint: "OpenAI Chat Completions API" },
	{ value: "anthropic-messages", label: "Messages (/messages)", hint: "Anthropic Messages API" },
];

export function getProvider(api: ApiFormat): Provider {
	const provider = registry?.get(api) ?? BUILT_IN[api];
	if (!provider) throw new Error(`Unsupported API format: ${api}`);
	return provider;
}

/** Stream one assistant turn. Yields incremental events and returns the final message. */
export function streamAssistant(
	providerConfig: ProviderConfig,
	model: ModelConfig,
	context: LlmContext,
	options: RequestOptions = {},
): AsyncGenerator<StreamEvent, AssistantMessage> {
	return getProvider(providerConfig.api).stream(providerConfig, model, context, options);
}

export { anthropicMessagesProvider } from "./anthropic-messages.ts";
export { toAnthropicMessages } from "./anthropic-messages-request.ts";
export { openaiResponsesProvider } from "./openai-responses.ts";
export { toResponsesInput } from "./openai-responses-request.ts";
export { openaiChatCompletionsProvider } from "./openai-chat-completions.ts";
export { sanitizeChatCompletionsHistory, toChatCompletionsMessages, toChatCompletionsTools } from "./openai-chat-completions-request.ts";
export {
	DEFAULT_THINKING_OPTIONS,
	resolveModelThinkingOptions,
	resolveReasoningEffort,
	resolveThinkingOption,
	THINKING_LEVELS,
} from "./thinking-options.ts";
