/**
 * Volcano Ark's content-generation tasks — Seedance (`doubao-seedance-2-5-260628` and the 2.0 / 1.x
 * lines), directly or through the relays that copy Ark's paths.
 *
 * `POST …/contents/generations/tasks` with the prompt and pictures as `content` parts, each picture
 * with a `role`: `first_frame`, `last_frame`, or `reference_image`. Frames and references are separate
 * kinds of task that Ark does not mix, and with a first frame the shape must be `adaptive` — the
 * picture decides it. `GET …/tasks/{id}` goes `queued` → `running` → `succeeded` with
 * `content.video_url`, a link good for a day and fetched without the key.
 */

import { FailureError } from "../ai/failure.ts";
import { parseRatio } from "../images/shape.ts";
import { endpoints } from "./protocol.ts";
import type { VideoRequest } from "./types.ts";
import { bearer, dataUrl, lostTask, nearestRatio, number, type Poll, read, requestJson, type Submitted, taskFailure, text, type VideoWire, type WireCall } from "./wire.ts";

const RATIOS = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9"] as const;

/** Seconds each line takes: 2.5 goes to thirty, 2.0 to fifteen; older lines are given what they are given. */
function durationRange(modelId: string): [number, number] {
	if (/seedance-2-5|seedance-?2\.5/i.test(modelId)) return [4, 30];
	if (/seedance-2-0|seedance-?2\.0|seedance-2-/i.test(modelId)) return [4, 15];
	return [2, 12];
}

export const arkVideos: VideoWire = {
	interval: 8,

	async submit(call: WireCall, request: VideoRequest): Promise<Submitted> {
		const adjusted: string[] = [];
		const content: Record<string, unknown>[] = [{ type: "text", text: request.prompt }];
		const framed = Boolean(request.image || request.lastImage);
		if (request.image) content.push({ type: "image_url", image_url: { url: dataUrl(request.image) }, role: "first_frame" });
		if (request.lastImage) {
			if (!request.image) adjusted.push("A last frame needs a first frame on Seedance; the last frame was left out.");
			else content.push({ type: "image_url", image_url: { url: dataUrl(request.lastImage) }, role: "last_frame" });
		}
		if (request.references?.length) {
			if (framed) adjusted.push("Seedance does not mix first/last frames with reference pictures; the references were left out.");
			else for (const picture of request.references) content.push({ type: "image_url", image_url: { url: dataUrl(picture) }, role: "reference_image" });
		}
		const body: Record<string, unknown> = { model: call.model.modelId, content };
		const ratio = parseRatio(request.aspectRatio);
		if (request.image) {
			body.ratio = "adaptive";
			if (request.aspectRatio && ratio) adjusted.push(`The first frame decides the shape; ${request.aspectRatio} does not apply.`);
		} else if (request.aspectRatio && ratio) {
			const near = nearestRatio(request.aspectRatio, ratio, RATIOS, "Seedance");
			if (near.note) adjusted.push(near.note);
			body.ratio = near.value;
		}
		if (request.duration !== undefined) {
			const [low, high] = durationRange(call.model.modelId);
			const seconds = Math.min(high, Math.max(low, Math.round(request.duration)));
			if (seconds !== request.duration) adjusted.push(`${call.model.modelId} makes ${low} to ${high} seconds; ${seconds} was asked for instead of ${request.duration}.`);
			body.duration = seconds;
		}
		if (request.resolution) body.resolution = request.resolution;
		if (request.audio !== undefined) body.generate_audio = request.audio;
		if (request.negativePrompt) adjusted.push("Seedance takes no negative prompt; say what to avoid in the prompt instead.");

		const answer = await requestJson(call, endpoints.ark.tasks(call.provider.baseUrl), { method: "POST", headers: bearer(call), body: JSON.stringify(body) });
		const id = text(answer.id) ?? text(answer.task_id);
		if (!id) throw new FailureError(taskFailure(text(read(answer, "error", "code")), text(read(answer, "error", "message")) ?? `No task id in the answer: ${JSON.stringify(answer).slice(0, 200)}`, "提交失败"));
		return { id, adjusted };
	},

	async poll(call: WireCall, id: string): Promise<Poll> {
		let answer: Record<string, unknown>;
		try {
			answer = await requestJson(call, `${endpoints.ark.tasks(call.provider.baseUrl)}/${encodeURIComponent(id)}`, { method: "GET", headers: bearer(call) });
		} catch (error) {
			if (error instanceof FailureError && error.failure.hint === "check-model") return { state: "failed", failure: lostTask(`Ark no longer knows task ${id}: tasks are kept for seven days.`) };
			throw error;
		}
		const status = text(answer.status)?.toLowerCase();
		if (status === "succeeded") {
			const url = text(read(answer, "content", "video_url"));
			if (!url) return { state: "failed", failure: taskFailure(undefined, "Finished without a video link.", "没有拿到视频") };
			return { state: "done", outputs: [{ url, seconds: number(answer.duration) }] };
		}
		if (status === "failed") return { state: "failed", failure: taskFailure(text(read(answer, "error", "code")), text(read(answer, "error", "message")), "生成失败") };
		if (status === "cancelled" || status === "expired") return { state: "failed", failure: lostTask(`Ark task ${id} was ${status} before it finished.`) };
		return { state: "pending", stage: status === "queued" ? "queued" : "running" };
	},
};
