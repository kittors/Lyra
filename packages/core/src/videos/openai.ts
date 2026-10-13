/**
 * The `/v1/videos` format — OpenAI's own until it closed on 2026-09-24, and still the one relays such
 * as new-api use to carry Kling, Wan, Jimeng, Vidu and the rest behind a single shape.
 *
 * `POST /v1/videos` as a form: `prompt`, `model`, `seconds` (a string), `size` (`WxH`) and an optional
 * `input_reference` file for the first frame, which has to agree with `size` — so with a first frame
 * the size is taken from the picture's own shape. `GET /v1/videos/{id}` reports `status` and often
 * `progress`; the finished file is at `/v1/videos/{id}/content`, behind the key, unless the relay
 * hands a link of its own.
 */

import { FailureError } from "../ai/failure.ts";
import { imageDimensions } from "../images/dimensions.ts";
import { parseRatio } from "../images/shape.ts";
import { endpoints } from "./protocol.ts";
import type { VideoRequest } from "./types.ts";
import { bearer, frameSize, lostTask, number, type Poll, read, requestJson, type Submitted, taskFailure, text, type VideoWire, type WireCall } from "./wire.ts";

const EXTENSIONS: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

export const openaiVideos: VideoWire = {
	interval: 5,

	async submit(call: WireCall, request: VideoRequest): Promise<Submitted> {
		const adjusted: string[] = [];
		const form = new FormData();
		form.append("model", call.model.modelId);
		form.append("prompt", request.prompt);
		if (request.duration !== undefined) form.append("seconds", String(Math.max(1, Math.round(request.duration))));
		const shape = request.image ? imageDimensions(Buffer.from(request.image.data, "base64")) : null;
		const size = frameSize(shape ? { width: shape.width, height: shape.height } : parseRatio(request.aspectRatio), request.resolution);
		if (request.aspectRatio || request.resolution || shape) form.append("size", `${size.width}x${size.height}`);
		if (shape && request.aspectRatio) adjusted.push(`The first frame decides the shape; ${request.aspectRatio} does not apply.`);
		if (request.image) {
			const ext = EXTENSIONS[request.image.mimeType] ?? "png";
			form.append("input_reference", new Blob([Buffer.from(request.image.data, "base64")], { type: request.image.mimeType }), `first-frame.${ext}`);
		}
		if (request.lastImage) adjusted.push("This format has no last frame; it was left out.");
		if (request.references?.length) adjusted.push("This format takes one picture, the first frame; the reference pictures were left out.");
		if (request.audio === false) adjusted.push("This format has no switch for sound; the model's default was used.");
		if (request.negativePrompt) adjusted.push("This format takes no negative prompt; it was left out.");

		const answer = await requestJson(call, endpoints.openai.submit(call.provider.baseUrl), { method: "POST", headers: bearer(call), body: form });
		const id = text(answer.id) ?? text(answer.task_id);
		if (!id) throw new FailureError(taskFailure(text(read(answer, "error", "code")), text(read(answer, "error", "message")) ?? `No video id in the answer: ${JSON.stringify(answer).slice(0, 200)}`, "提交失败"));
		return { id, adjusted };
	},

	async poll(call: WireCall, id: string): Promise<Poll> {
		let answer: Record<string, unknown>;
		try {
			answer = await requestJson(call, endpoints.openai.poll(call.provider.baseUrl, id), { method: "GET", headers: bearer(call) });
		} catch (error) {
			if (error instanceof FailureError && error.failure.hint === "check-model") return { state: "failed", failure: lostTask(`The provider no longer knows video ${id}: it expired.`) };
			throw error;
		}
		const status = text(answer.status)?.toLowerCase();
		const progress = number(answer.progress);
		if (status === "completed" || status === "succeeded" || status === "success") {
			// A relay that hosts the file elsewhere says where; otherwise the content endpoint serves it, behind the key.
			const link = text(answer.url) ?? text(read(answer, "video", "url"));
			const sameHost = link && new URL(link, call.provider.baseUrl).host === new URL(call.provider.baseUrl).host;
			const outputs = link ? [{ url: link, ...(sameHost ? { auth: "bearer" as const } : {}) }] : [{ url: endpoints.openai.content(call.provider.baseUrl, id), auth: "bearer" as const }];
			return { state: "done", outputs: outputs.map((output) => ({ ...output, seconds: number(answer.seconds) })) };
		}
		if (status === "failed" || status === "failure") return { state: "failed", failure: taskFailure(text(read(answer, "error", "code")), text(read(answer, "error", "message")) ?? text(answer.fail_reason), "生成失败") };
		if (status === "cancelled" || status === "canceled" || status === "expired") return { state: "failed", failure: lostTask(`Video ${id} was ${status} before it finished.`) };
		return { state: "pending", stage: status === "queued" || status === "pending" || status === "submitted" ? "queued" : "running", ...(progress !== undefined ? { progress } : {}) };
	},
};
