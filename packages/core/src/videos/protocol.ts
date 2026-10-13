/**
 * Which task API a video model is reached through, and where that API's endpoints are.
 *
 * Every one of them is submit → poll → fetch, and no two agree on a path, a field or a status word:
 * xAI's `/v1/videos/generations`, Volcano Ark's `contents/generations/tasks`, the `/v1/videos` that
 * relays such as new-api use for everything from Kling to Wan, Gemini's `predictLongRunning`, and
 * DashScope's `video-synthesis`. Nothing on the wire says which a host speaks. The model editor can
 * say (`ModelConfig.videoApi`); otherwise the address is read first — an official host is not
 * ambiguous — then the name, then the formats relays carry, each tried only when the one before had
 * no such endpoint (`generate.ts`).
 */

import { joinUrl } from "../ai/endpoint.ts";
import type { ModelConfig, ProviderConfig } from "../types/provider.ts";
import type { VideoWireApi } from "./types.ts";

function parts(baseUrl: string): { host: string; path: string } {
	try {
		const url = new URL(baseUrl);
		return { host: url.hostname.toLowerCase(), path: url.pathname.replace(/\/+$/, "") };
	} catch {
		return { host: "", path: "" };
	}
}

/** What the address alone says: the official hosts, and the path shapes only one API uses. */
function byAddress(baseUrl: string): VideoWireApi | undefined {
	const { host, path } = parts(baseUrl);
	if (/(?:^|\.)x\.ai$/.test(host)) return "xai";
	if (/(?:^|\.)(?:volces|volcengine|byteplusapi)\.com$/.test(host) || /\/api(?:\/[a-z]+)?\/v3$/.test(path)) return "ark";
	if (host === "generativelanguage.googleapis.com" || /\/v1beta(?:\/|$)/.test(path)) return "veo";
	if (/(?:^|\.)aliyuncs\.com$/.test(host)) return "dashscope";
	return undefined;
}

/** What the name says, for a relay whose address says nothing. Kling, Wan, Vidu, Jimeng and the rest ride `/v1/videos` there. */
function byName(modelId: string): VideoWireApi | undefined {
	const id = modelId.toLowerCase().split("/").at(-1) ?? "";
	if (id.startsWith("grok-imagine-video")) return "xai";
	if (id.includes("seedance")) return "ark";
	if (id.startsWith("veo")) return "veo";
	return undefined;
}

/**
 * The APIs to try, in order. A stored choice is the only one tried — the person said, and a guess
 * after it would be billed to them. Veo and DashScope have native paths no relay copies, so they are
 * only tried when the address or the name points at them.
 */
export function videoApiPlan(provider: Pick<ProviderConfig, "baseUrl">, model: Pick<ModelConfig, "modelId" | "videoApi">): VideoWireApi[] {
	if (model.videoApi && model.videoApi !== "auto") return [model.videoApi];
	const order: (VideoWireApi | undefined)[] = [byAddress(provider.baseUrl), byName(model.modelId), "openai", "xai", "ark"];
	return [...new Set(order.filter((api): api is VideoWireApi => api !== undefined))];
}

/** The site under a `/v1`-style base: what the APIs that do not live under `/v1` are found beside. */
function siteRoot(baseUrl: string): string {
	return baseUrl
		.replace(/\/+$/, "")
		.replace(/\/v1(?:\/.*)?$/, "")
		.replace(/\/compatible-mode$/, "")
		.replace(/\/openai$/, "");
}

export const endpoints = {
	xai: {
		submit: (base: string) => joinUrl(base, "/v1/videos/generations"),
		poll: (base: string, id: string) => joinUrl(base, `/v1/videos/${encodeURIComponent(id)}`),
	},
	openai: {
		submit: (base: string) => joinUrl(base, "/v1/videos"),
		poll: (base: string, id: string) => joinUrl(base, `/v1/videos/${encodeURIComponent(id)}`),
		content: (base: string, id: string) => joinUrl(base, `/v1/videos/${encodeURIComponent(id)}/content`),
	},
	ark: {
		/** `…/api/v3` as configured for chat, or a relay root that copies Ark's paths under it. */
		tasks: (base: string) => {
			const trimmed = base.replace(/\/+$/, "");
			return trimmed.endsWith("/v3") ? `${trimmed}/contents/generations/tasks` : `${siteRoot(trimmed)}/api/v3/contents/generations/tasks`;
		},
	},
	veo: {
		/** Gemini's native root: the OpenAI-compatible base people configure ends `/v1beta/openai`. */
		root: (base: string) => {
			const trimmed = base.replace(/\/+$/, "");
			const at = trimmed.indexOf("/v1beta");
			return at >= 0 ? trimmed.slice(0, at + "/v1beta".length) : `${siteRoot(trimmed)}/v1beta`;
		},
	},
	dashscope: {
		/** The native `/api/v1` beside the `compatible-mode/v1` people configure for chat. */
		root: (base: string) => `${siteRoot(base)}/api/v1`,
	},
};
