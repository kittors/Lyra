/**
 * Google's Veo through the Gemini API's long-running predictions.
 *
 * `POST {v1beta}/models/{model}:predictLongRunning` with `instances` (prompt, first frame as
 * `inlineData`, `lastFrame`, up to three `referenceImages`) and `parameters`; it answers an operation
 * `name`, polled at `{v1beta}/{name}` until `done`. The video is a URI that wants the key to fetch,
 * and is kept for two days. Veo offers 16:9 and 9:16, four, six or eight seconds, and 1080p and 4K
 * only at eight; it always adds sound.
 */

import { FailureError } from "../ai/failure.ts";
import { parseRatio } from "../images/shape.ts";
import type { ImageInput } from "../images/types.ts";
import { endpoints } from "./protocol.ts";
import type { VideoRequest } from "./types.ts";
import { lostTask, nearest, nearestRatio, type Poll, read, requestJson, type Submitted, taskFailure, text, type VideoWire, type WireCall } from "./wire.ts";

const inline = (picture: ImageInput) => ({ inlineData: { mimeType: picture.mimeType, data: picture.data } });

/** Google's own header, plus the bearer a relay in front of it is more likely to check. */
function auth(call: WireCall): Record<string, string> {
	const google = /(?:^|\.)googleapis\.com$/i.test(new URL(call.provider.baseUrl).hostname);
	return google ? { "x-goog-api-key": call.provider.apiKey } : { "x-goog-api-key": call.provider.apiKey, authorization: `Bearer ${call.provider.apiKey}` };
}

export const veoVideos: VideoWire = {
	interval: 10,

	async submit(call: WireCall, request: VideoRequest): Promise<Submitted> {
		const adjusted: string[] = [];
		const instance: Record<string, unknown> = { prompt: request.prompt };
		if (request.image) instance.image = inline(request.image);
		if (request.lastImage) {
			if (!request.image) adjusted.push("A last frame needs a first frame on Veo; the last frame was left out.");
			else instance.lastFrame = inline(request.lastImage);
		}
		if (request.references?.length) {
			const kept = request.references.slice(0, 3);
			if (kept.length < request.references.length) adjusted.push(`Veo takes up to three reference pictures; the first three were used.`);
			instance.referenceImages = kept.map((picture) => ({ image: inline(picture), referenceType: "asset" }));
		}
		const parameters: Record<string, unknown> = {};
		const ratio = parseRatio(request.aspectRatio);
		if (request.aspectRatio && ratio) {
			const near = nearestRatio(request.aspectRatio, ratio, ["16:9", "9:16"], "Veo");
			if (near.note) adjusted.push(near.note);
			parameters.aspectRatio = near.value;
		}
		let seconds: number | undefined;
		if (request.duration !== undefined) {
			const near = nearest(Math.round(request.duration), [4, 6, 8], "A length of");
			if (near.note) adjusted.push(near.note);
			seconds = near.value;
		}
		if (request.resolution === "1080p") {
			parameters.resolution = "1080p";
			if (seconds !== undefined && seconds !== 8) adjusted.push("Veo makes 1080p only at 8 seconds; 8 was used.");
			seconds = 8;
		} else if (request.resolution) {
			parameters.resolution = "720p";
			if (request.resolution === "480p") adjusted.push("Veo starts at 720p; 720p was used.");
		}
		if (seconds !== undefined) parameters.durationSeconds = String(seconds);
		if (request.negativePrompt) parameters.negativePrompt = request.negativePrompt;
		if (request.audio === false) adjusted.push("Veo always adds sound.");

		const root = endpoints.veo.root(call.provider.baseUrl);
		const answer = await requestJson(call, `${root}/models/${encodeURIComponent(call.model.modelId)}:predictLongRunning`, {
			method: "POST",
			headers: auth(call),
			body: JSON.stringify({ instances: [instance], ...(Object.keys(parameters).length ? { parameters } : {}) }),
		});
		const name = text(answer.name);
		if (!name) throw new FailureError(taskFailure(text(read(answer, "error", "status")), text(read(answer, "error", "message")) ?? `No operation in the answer: ${JSON.stringify(answer).slice(0, 200)}`, "提交失败"));
		return { id: name, adjusted };
	},

	async poll(call: WireCall, name: string): Promise<Poll> {
		const root = endpoints.veo.root(call.provider.baseUrl);
		let answer: Record<string, unknown>;
		try {
			answer = await requestJson(call, `${root}/${name.replace(/^\/+/, "")}`, { method: "GET", headers: auth(call) });
		} catch (error) {
			if (error instanceof FailureError && error.failure.hint === "check-model") return { state: "failed", failure: lostTask(`Google no longer knows operation ${name}.`) };
			throw error;
		}
		if (answer.done !== true) return { state: "pending", stage: "running" };
		if (answer.error) return { state: "failed", failure: taskFailure(text(read(answer, "error", "status")), text(read(answer, "error", "message")), "生成失败") };
		const samples = read(answer, "response", "generateVideoResponse", "generatedSamples");
		const uris = Array.isArray(samples) ? samples.map((sample) => text(read(sample, "video", "uri"))).filter((uri): uri is string => Boolean(uri)) : [];
		if (uris.length === 0) {
			const reasons = read(answer, "response", "generateVideoResponse", "raiMediaFilteredReasons");
			const why = Array.isArray(reasons) ? reasons.filter((reason) => typeof reason === "string").join("; ") : "";
			return { state: "failed", failure: taskFailure("filtered", why || "The video was filtered by safety checks.", "内容被服务商拒绝") };
		}
		return { state: "done", outputs: uris.map((url) => ({ url, auth: "goog" as const })) };
	},
};
