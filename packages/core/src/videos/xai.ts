/**
 * xAI's video API — `grok-imagine-video`, directly or through a relay that passes it on (CliRelay).
 *
 * `POST /v1/videos/generations` answers `{request_id}`; `GET /v1/videos/{id}` answers `pending`, then
 * `done` with `video.url` — a temporary link, fetched without the key. A relay may forget the task the
 * moment it has reported `done` once (CliRelay does), so the first `done` is read in full right there.
 */

import { parseRatio } from "../images/shape.ts";
import { endpoints } from "./protocol.ts";
import type { VideoRequest } from "./types.ts";
import { bearer, dataUrl, lostTask, nearestRatio, number, type Poll, read, requestJson, type Submitted, taskFailure, text, type VideoWire, type WireCall } from "./wire.ts";
import { FailureError } from "../ai/failure.ts";

const RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3", "21:9", "5:2"] as const;

export const xaiVideos: VideoWire = {
	interval: 5,

	async submit(call: WireCall, request: VideoRequest): Promise<Submitted> {
		const adjusted: string[] = [];
		const body: Record<string, unknown> = { model: call.model.modelId, prompt: request.prompt };
		if (request.duration !== undefined) {
			const seconds = Math.min(15, Math.max(1, Math.round(request.duration)));
			if (seconds !== request.duration) adjusted.push(`xAI makes 1 to 15 seconds; ${seconds} was asked for instead of ${request.duration}.`);
			body.duration = seconds;
		}
		const ratio = parseRatio(request.aspectRatio);
		if (request.aspectRatio && ratio) {
			if (request.image) adjusted.push(`The first frame decides the shape; ${request.aspectRatio} does not apply.`);
			else {
				const near = nearestRatio(request.aspectRatio, ratio, RATIOS, "xAI");
				if (near.note) adjusted.push(near.note);
				body.aspect_ratio = near.value;
			}
		}
		if (request.resolution) {
			// The first grok-imagine-video stops at 720p; 1.5 and its lite line go to 1080p.
			const classic = /^grok-imagine-video$/i.test(call.model.modelId.split("/").at(-1) ?? "");
			body.resolution = classic && request.resolution === "1080p" ? "720p" : request.resolution;
			if (body.resolution !== request.resolution) adjusted.push(`${call.model.modelId} stops at 720p.`);
		}
		if (request.audio === false) body.generate_audio = false;
		if (request.image) body.image = { url: dataUrl(request.image) };
		if (request.lastImage) body.last_frame = { url: dataUrl(request.lastImage) };
		if (request.references?.length) body.reference_images = request.references.map((picture) => ({ url: dataUrl(picture) }));
		if (request.negativePrompt) adjusted.push("xAI takes no negative prompt; it was left out.");

		const answer = await requestJson(call, endpoints.xai.submit(call.provider.baseUrl), { method: "POST", headers: bearer(call), body: JSON.stringify(body) });
		const id = text(answer.request_id) ?? text(answer.id);
		if (!id) throw new FailureError(taskFailure(undefined, `No request id in the answer: ${JSON.stringify(answer).slice(0, 200)}`, "提交失败"));
		return { id, adjusted };
	},

	async poll(call: WireCall, id: string): Promise<Poll> {
		let answer: Record<string, unknown>;
		try {
			answer = await requestJson(call, endpoints.xai.poll(call.provider.baseUrl, id), { method: "GET", headers: bearer(call) });
		} catch (error) {
			if (error instanceof FailureError && error.failure.hint === "check-model") return { state: "failed", failure: lostTask(`The provider no longer knows video request ${id}: it expired, or a relay restarted.`) };
			throw error;
		}
		const status = text(answer.status)?.toLowerCase();
		if (status === "done") {
			const url = text(read(answer, "video", "url")) ?? text(answer.url);
			if (read(answer, "video", "respect_moderation") === false) return { state: "failed", failure: taskFailure("moderation", "The video was filtered by moderation.", "内容被服务商拒绝") };
			if (!url) return { state: "failed", failure: taskFailure(undefined, "Finished without a video link.", "没有拿到视频") };
			return { state: "done", outputs: [{ url, seconds: number(read(answer, "video", "duration")) }] };
		}
		if (status === "failed") return { state: "failed", failure: taskFailure(text(read(answer, "error", "code")), text(read(answer, "error", "message")), "生成失败") };
		if (status === "expired") return { state: "failed", failure: lostTask(`Video request ${id} expired before it finished.`) };
		return { state: "pending", stage: "running" };
	},
};
