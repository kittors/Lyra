/**
 * Alibaba's DashScope video synthesis — Wan (`wan2.7-t2v`, `wan2.6-i2v`, `wan2.2-kf2v-flash`…).
 *
 * `POST {api/v1}/services/aigc/video-generation/video-synthesis` with `X-DashScope-Async: enable`
 * (there is no synchronous form); it answers `output.task_id`, polled at `{api/v1}/tasks/{id}` from
 * `PENDING` to `SUCCEEDED` and `output.video_url`, a link good for a day. The lines differ in what
 * they take: text-to-video since 2.7 has `resolution` + `ratio` where earlier ones had a pixel `size`,
 * image-to-video takes `img_url` (a data URL is accepted) and keeps the picture's shape, and the
 * keyframe line takes a first and a last frame.
 */

import { FailureError } from "../ai/failure.ts";
import { parseRatio } from "../images/shape.ts";
import { endpoints } from "./protocol.ts";
import type { VideoRequest } from "./types.ts";
import { bearer, dataUrl, frameSize, lostTask, nearestRatio, type Poll, read, requestJson, type Submitted, taskFailure, text, type VideoWire, type WireCall } from "./wire.ts";

const RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const;

/** `2.7` from `wan2.7-t2v`, `2.1` from `wanx2.1-i2v-plus`; 0 when the name says nothing. */
function version(modelId: string): number {
	const match = /wanx?(\d+(?:\.\d+)?)/i.exec(modelId);
	return match ? Number(match[1]) : 0;
}

function durations(modelId: string, wanted: number): { value: number; low: number; high: number } {
	const v = version(modelId);
	const [low, high] = v >= 2.6 ? [2, 15] : v >= 2.5 ? [5, 10] : v >= 2.2 ? [5, 5] : [3, 5];
	const clamped = Math.min(high, Math.max(low, Math.round(wanted)));
	// 2.5 takes five or ten, nothing between.
	const value = v >= 2.5 && v < 2.6 ? (clamped >= 8 ? 10 : 5) : clamped;
	return { value, low, high };
}

export const dashscopeVideos: VideoWire = {
	interval: 10,

	async submit(call: WireCall, request: VideoRequest): Promise<Submitted> {
		const adjusted: string[] = [];
		const id = call.model.modelId.toLowerCase();
		const keyframes = id.includes("kf2v");
		const fromImage = keyframes || id.includes("i2v");
		if (fromImage && !request.image) {
			throw new FailureError(taskFailure("missing-image", `${call.model.modelId} makes a video from a picture: give a first frame in \`image\`, or use a text-to-video model.`, "缺少首帧图片"));
		}
		if (!fromImage && request.image) {
			throw new FailureError(taskFailure("text-only", `${call.model.modelId} is a text-to-video model and takes no first frame. Use one of its image-to-video (i2v) models for that.`, "这个模型不接受首帧"));
		}
		const input: Record<string, unknown> = { prompt: request.prompt };
		if (request.negativePrompt) input.negative_prompt = request.negativePrompt;
		if (keyframes) {
			input.first_frame_url = dataUrl(request.image!);
			if (request.lastImage) input.last_frame_url = dataUrl(request.lastImage);
		} else if (fromImage) {
			input.img_url = dataUrl(request.image!);
			if (request.lastImage) adjusted.push(`${call.model.modelId} has no last frame; a keyframe (kf2v) model does. It was left out.`);
		}
		if (request.references?.length) adjusted.push("Wan's video synthesis takes no reference pictures here; they were left out.");

		const parameters: Record<string, unknown> = {};
		const resolution = request.resolution ? request.resolution.toUpperCase() : undefined;
		const ratio = parseRatio(request.aspectRatio);
		if (fromImage) {
			if (resolution) parameters.resolution = resolution;
			if (request.aspectRatio && ratio) adjusted.push(`The first frame decides the shape; ${request.aspectRatio} does not apply.`);
		} else if (version(id) >= 2.7) {
			if (resolution) parameters.resolution = resolution === "480P" ? "720P" : resolution;
			if (resolution === "480P") adjusted.push(`${call.model.modelId} starts at 720P; 720P was used.`);
			if (request.aspectRatio && ratio) {
				const near = nearestRatio(request.aspectRatio, ratio, RATIOS, call.model.modelId);
				if (near.note) adjusted.push(near.note);
				parameters.ratio = near.value;
			}
		} else if (request.aspectRatio || request.resolution) {
			// Before 2.7, text-to-video took a pixel size, written with a star.
			const size = frameSize(ratio, request.resolution ?? "720p");
			parameters.size = `${size.width}*${size.height}`;
		}
		if (request.duration !== undefined) {
			const fit = durations(id, request.duration);
			if (fit.value !== request.duration) adjusted.push(`${call.model.modelId} makes ${fit.low === fit.high ? `${fit.low}` : `${fit.low} to ${fit.high}`} seconds; ${fit.value} was used.`);
			parameters.duration = fit.value;
		}
		if (request.audio === false) {
			if (id.includes("i2v-flash")) parameters.audio = false;
			else adjusted.push(`${call.model.modelId} has no switch for sound; its default was used.`);
		}

		const root = endpoints.dashscope.root(call.provider.baseUrl);
		const answer = await requestJson(call, `${root}/services/aigc/video-generation/video-synthesis`, {
			method: "POST",
			headers: { ...bearer(call), "x-dashscope-async": "enable" },
			body: JSON.stringify({ model: call.model.modelId, input, ...(Object.keys(parameters).length ? { parameters } : {}) }),
		});
		const task = text(read(answer, "output", "task_id"));
		if (!task) throw new FailureError(taskFailure(text(answer.code), text(answer.message) ?? `No task id in the answer: ${JSON.stringify(answer).slice(0, 200)}`, "提交失败"));
		return { id: task, adjusted };
	},

	async poll(call: WireCall, task: string): Promise<Poll> {
		const root = endpoints.dashscope.root(call.provider.baseUrl);
		const answer = await requestJson(call, `${root}/tasks/${encodeURIComponent(task)}`, { method: "GET", headers: bearer(call) });
		const status = text(read(answer, "output", "task_status"))?.toUpperCase();
		if (status === "SUCCEEDED") {
			const url = text(read(answer, "output", "video_url"));
			if (!url) return { state: "failed", failure: taskFailure(undefined, "Finished without a video link.", "没有拿到视频") };
			return { state: "done", outputs: [{ url }] };
		}
		if (status === "FAILED") {
			const code = text(read(answer, "output", "code")) ?? text(answer.code);
			const message = text(read(answer, "output", "message")) ?? text(answer.message);
			return { state: "failed", failure: taskFailure(code, message, "生成失败") };
		}
		if (status === "CANCELED" || status === "UNKNOWN") return { state: "failed", failure: lostTask(`DashScope reports task ${task} as ${status}: cancelled, or older than a day.`) };
		return { state: "pending", stage: status === "PENDING" ? "queued" : "running" };
	},
};
