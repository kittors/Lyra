/**
 * Drawing through the OpenAI Images API: `/v1/images/generations`, and `/v1/images/edits` when there
 * are pictures to work from.
 *
 * The common denominator: OpenAI's own image models, and the relays that put Gemini, Flux or Seedream
 * behind the same two endpoints. A chat-only host answers 404 here, and `generate.ts` takes that as
 * the cue to try a chat completion instead.
 */

import { joinUrl } from "../ai/endpoint.ts";
import { classifyFailure, FailureError, failureOf } from "../ai/failure.ts";
import { fetchWithRetry, RetryBudget } from "../ai/retry.ts";
import type { ModelConfig, ProviderConfig } from "../types/provider.ts";
import { sniffImageType } from "./dimensions.ts";
import { quotaGuard } from "./quota.ts";
import { editsAsJson, imageFields, jsonEditPictures, perRequestLimit } from "./shape.ts";
import type { GeneratedImage, ImageCallOptions, ImageRequest, ImageResult } from "./types.ts";

interface ImagesResponse {
	data?: { b64_json?: string; url?: string; revised_prompt?: string }[];
	usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
}

interface Batch {
	images: GeneratedImage[];
	revisedPrompt?: string;
	usage: { input: number; output: number; total: number };
}

const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

/** A picture the provider handed back as a link, fetched without our key — it points somewhere else. */
async function download(doFetch: typeof globalThis.fetch, url: string, signal?: AbortSignal): Promise<GeneratedImage> {
	if (url.startsWith("data:")) {
		const match = /^data:([^;,]+)?(?:;base64)?,(.*)$/s.exec(url);
		if (!match) throw new Error("The provider returned an unreadable data URL.");
		return { data: match[2], mimeType: match[1] || "image/png" };
	}
	const response = await doFetch(url, { signal });
	if (!response.ok) throw new FailureError(classifyFailure({ from: "status", status: response.status, body: await response.text().catch(() => "") }));
	const bytes = new Uint8Array(await response.arrayBuffer());
	return { data: Buffer.from(bytes).toString("base64"), mimeType: sniffImageType(bytes) ?? response.headers.get("content-type") ?? "image/png" };
}

/** The bytes say what they are; a relay in front of Gemini answers JPEG under an API that implies PNG. */
function fromBase64(data: string): GeneratedImage {
	return { data, mimeType: sniffImageType(Buffer.from(data.slice(0, 96), "base64")) ?? "image/png" };
}

export async function viaImagesApi(
	provider: ProviderConfig,
	model: ModelConfig,
	request: ImageRequest,
	options: ImageCallOptions,
): Promise<ImageResult> {
	const doFetch = quotaGuard(options.fetch ?? globalThis.fetch);
	const pictures = request.images ?? [];
	const edit = pictures.length > 0;
	const fields = imageFields(model.modelId, request);

	const body = (n: number): { body: string | FormData; headers: Record<string, string> } => {
		if (!edit || editsAsJson(model.modelId)) {
			const json: Record<string, unknown> = { model: model.modelId, prompt: request.prompt, n, ...fields };
			if (edit) Object.assign(json, jsonEditPictures(model.modelId, pictures.map((picture) => `data:${picture.mimeType};base64,${picture.data}`)));
			return { body: JSON.stringify(json), headers: { "content-type": "application/json" } };
		}
		/*
		 * Multipart, the only body OpenAI's own `/edits` takes. One picture goes as `image`, several as
		 * `image[]` — the single form is what older models and most relays read.
		 */
		const form = new FormData();
		for (const [key, value] of Object.entries({ model: model.modelId, prompt: request.prompt, n: String(n), ...fields })) form.append(key, value);
		for (const [index, picture] of pictures.entries()) {
			const name = picture.name ?? `image-${index + 1}.${EXTENSIONS[picture.mimeType] ?? "png"}`;
			form.append(pictures.length === 1 ? "image" : "image[]", new Blob([Buffer.from(picture.data, "base64")], { type: picture.mimeType }), name);
		}
		return { body: form, headers: {} };
	};

	const once = async (n: number): Promise<Batch> => {
		const payload = body(n);
		const response = await fetchWithRetry(
			doFetch,
			joinUrl(provider.baseUrl, edit ? "/v1/images/edits" : "/v1/images/generations"),
			{
				method: "POST",
				headers: { authorization: `Bearer ${provider.apiKey}`, ...payload.headers, ...provider.headers },
				body: payload.body,
				signal: options.signal,
			},
			{ budget: new RetryBudget(options.retryPolicy, options.retryAttempts), signal: options.signal, onRetry: options.onRetry },
		);
		// Leading blank lines are a relay's keep-alive while it waits on the upstream.
		const text = (await response.text()).trim();
		let parsed: ImagesResponse = {};
		try {
			parsed = JSON.parse(text) as ImagesResponse;
		} catch {
			throw new Error(`The provider answered with something other than JSON: ${text.slice(0, 200)}`);
		}
		const images: GeneratedImage[] = [];
		let revisedPrompt: string | undefined;
		for (const item of parsed.data ?? []) {
			if (item.b64_json) images.push(fromBase64(item.b64_json));
			else if (item.url) images.push(await download(doFetch, item.url, options.signal));
			revisedPrompt ??= item.revised_prompt;
		}
		const usage = { input: parsed.usage?.input_tokens ?? 0, output: parsed.usage?.output_tokens ?? 0, total: parsed.usage?.total_tokens ?? 0 };
		return { images, revisedPrompt, usage };
	};

	const total = Math.max(1, Math.min(4, Math.round(request.count ?? 1)));
	const limit = perRequestLimit(model.modelId);
	/*
	 * Several pictures from a one-per-request model go side by side, and each stands on its own: three
	 * of four arriving is three pictures and a note, not a failed call.
	 */
	const settled = await Promise.allSettled(limit >= total ? [once(total)] : Array.from({ length: total }, () => once(1)));
	const batches = settled.flatMap((entry) => (entry.status === "fulfilled" ? [entry.value] : []));
	const failures = settled.flatMap((entry) => (entry.status === "rejected" ? [failureOf(entry.reason).summary] : []));
	const images = batches.flatMap((batch) => batch.images);
	if (images.length === 0) {
		const rejected = settled.find((entry) => entry.status === "rejected");
		if (rejected?.status === "rejected") throw rejected.reason;
		throw new Error("The provider answered without an image.");
	}
	const usage = batches.reduce((sum, batch) => ({ input: sum.input + batch.usage.input, output: sum.output + batch.usage.output, total: sum.total + batch.usage.total }), { input: 0, output: 0, total: 0 });
	return {
		images,
		revisedPrompt: batches.find((batch) => batch.revisedPrompt)?.revisedPrompt,
		route: "images",
		usage: usage.total || usage.output ? usage : undefined,
		failures: failures.length > 0 ? failures : undefined,
	};
}
