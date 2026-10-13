/**
 * Drawing through a chat completion that is asked for image output.
 *
 * The route for hosts that never grew an Images API — OpenRouter, and the Gemini models that write and
 * draw on endpoints that only speak chat. The request is an ordinary user turn with
 * `modalities: ["image", "text"]`; the picture comes back in one of three places depending on who
 * translated the upstream answer, and all three are read.
 */

import { joinUrl } from "../ai/endpoint.ts";
import { classifyFailure, FailureError } from "../ai/failure.ts";
import { fetchWithRetry, RetryBudget } from "../ai/retry.ts";
import type { ModelConfig, ProviderConfig } from "../types/provider.ts";
import { quotaGuard } from "./quota.ts";
import { parseRatio } from "./shape.ts";
import type { GeneratedImage, ImageCallOptions, ImageRequest, ImageResult } from "./types.ts";

interface ChatPart {
	type?: string;
	text?: string;
	image_url?: { url?: string } | string;
	b64_json?: string;
	inline_data?: { mime_type?: string; data?: string };
}

interface ChatResponse {
	choices?: { message?: { content?: string | ChatPart[] | null; images?: ChatPart[] } }[];
	usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/*
 * Built per use rather than shared: a global regex carries `lastIndex` from one call to the next, and
 * `matchAll` starts from it — a second answer was searched from where the first one's picture ended.
 */
const dataUrls = () => /data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)/gi;
const MARKDOWN_LINK = /!\[[^\]]*\]\((https?:\/\/[^\s)]+)\)/g;

function fromDataUrl(url: string): GeneratedImage | null {
	const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(url.trim());
	return match ? { mimeType: match[1].toLowerCase(), data: match[2].replace(/\s+/g, "") } : null;
}

/**
 * Every picture in one answer, wherever the translator put it.
 *
 * `message.images` is OpenRouter's shape and what most relays copied; a content array with
 * `image_url` parts is the multimodal-content shape; and a plain string with a markdown data URL in it
 * is what a relay that only knows text does with an inline image.
 */
function picturesIn(response: ChatResponse): { images: GeneratedImage[]; links: string[]; text: string } {
	const images: GeneratedImage[] = [];
	const links: string[] = [];
	let text = "";
	const take = (part: ChatPart) => {
		const url = typeof part.image_url === "string" ? part.image_url : part.image_url?.url;
		if (url) {
			const inline = fromDataUrl(url);
			if (inline) images.push(inline);
			else if (/^https?:/.test(url)) links.push(url);
		} else if (part.b64_json) images.push({ data: part.b64_json, mimeType: "image/png" });
		else if (part.inline_data?.data) images.push({ data: part.inline_data.data, mimeType: part.inline_data.mime_type ?? "image/png" });
		else if (part.text) text += part.text;
	};
	for (const choice of response.choices ?? []) {
		const message = choice.message;
		for (const part of message?.images ?? []) take(part);
		const content = message?.content;
		if (Array.isArray(content)) for (const part of content) take(part);
		else if (typeof content === "string") {
			for (const match of content.matchAll(dataUrls())) images.push({ mimeType: match[1].toLowerCase(), data: match[2].replace(/\s+/g, "") });
			for (const match of content.matchAll(MARKDOWN_LINK)) links.push(match[1]);
			text += content.replace(/!\[[^\]]*\]\([^)]*\)/g, "").trim();
		}
	}
	return { images, links, text };
}

export async function viaChatCompletions(
	provider: ProviderConfig,
	model: ModelConfig,
	request: ImageRequest,
	options: ImageCallOptions,
): Promise<ImageResult> {
	const doFetch = quotaGuard(options.fetch ?? globalThis.fetch);
	const parsed = parseRatio(request.aspectRatio);
	const ratio = parsed ? `${parsed.width}:${parsed.height}` : undefined;
	/*
	 * The shape asked for twice: as `image_config` for the hosts that read it (OpenRouter's field, which
	 * CliRelay passes to Gemini verbatim), and in words for the ones that only see the prompt — a chat
	 * endpoint has no field every host agrees on. Detail travels as `image_size`, Gemini's own spelling.
	 */
	const imageSize = request.quality === "max" ? "4K" : request.quality === "high" ? "2K" : undefined;
	const imageConfig = { ...(ratio ? { aspect_ratio: ratio } : {}), ...(imageSize ? { image_size: imageSize } : {}) };
	const prompt = ratio ? `${request.prompt}\n\nAspect ratio: ${ratio}.` : request.prompt;
	const content = [
		{ type: "text", text: prompt },
		...(request.images ?? []).map((picture) => ({ type: "image_url", image_url: { url: `data:${picture.mimeType};base64,${picture.data}` } })),
	];
	const body = {
		model: model.modelId,
		messages: [{ role: "user", content }],
		modalities: ["image", "text"],
		stream: false,
		...(Object.keys(imageConfig).length > 0 ? { image_config: imageConfig } : {}),
	};

	const budget = new RetryBudget(options.retryPolicy, options.retryAttempts);
	const images: GeneratedImage[] = [];
	let note = "";
	const usage = { input: 0, output: 0, total: 0 };
	const total = Math.max(1, Math.min(4, Math.round(request.count ?? 1)));
	// One picture per completion: `n` on chat is a count of alternative answers, and few hosts honour it.
	for (let round = 0; round < total; round++) {
		const response = await fetchWithRetry(
			doFetch,
			joinUrl(provider.baseUrl, "/v1/chat/completions"),
			{
				method: "POST",
				headers: { "content-type": "application/json", authorization: `Bearer ${provider.apiKey}`, ...provider.headers },
				body: JSON.stringify(body),
				signal: options.signal,
			},
			{ budget, signal: options.signal, onRetry: options.onRetry },
		);
		const parsed = (await response.json().catch(() => ({}))) as ChatResponse;
		const found = picturesIn(parsed);
		images.push(...found.images);
		for (const link of found.links) {
			const fetched = await doFetch(link, { signal: options.signal }).catch(() => null);
			if (!fetched?.ok) continue;
			const bytes = Buffer.from(await fetched.arrayBuffer());
			images.push({ data: bytes.toString("base64"), mimeType: fetched.headers.get("content-type") ?? "image/png" });
		}
		note ||= found.text;
		usage.input += parsed.usage?.prompt_tokens ?? 0;
		usage.output += parsed.usage?.completion_tokens ?? 0;
		usage.total += parsed.usage?.total_tokens ?? 0;
	}
	if (images.length === 0) {
		/*
		 * Words instead of a picture are usually the model refusing. Classified like any reply that ended
		 * without what was asked for, so a refusal on content is final — the card and the model are told
		 * it was refused — and anything else stays worth another try.
		 */
		throw new FailureError(
			classifyFailure({
				from: "stream",
				message: note ? `The model answered in words instead of drawing: ${note.slice(0, 300)}` : "The model answered without an image.",
				streamed: note,
			}),
		);
	}
	return { images, route: "chat", usage: usage.total ? usage : undefined };
}
