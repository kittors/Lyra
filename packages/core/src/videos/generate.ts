/**
 * Film with a video model, through whichever task API its provider has, and keep what comes back.
 *
 * Submit, then poll until the task ends, then fetch the file into `session-media`. Which API is
 * planned in `protocol.ts`; a submit refused with "no such endpoint" moves on to the next, and the one
 * that took the task is remembered for the run (the rule `images/generate.ts` keeps for pictures) — a
 * refused request costs nothing, a second accepted one would cost a second video, so nothing else
 * moves it on.
 *
 * A poll that fails is not a failed video: the task is still running upstream, already paid for, and
 * a network blip between two polls says nothing about it. Only a run of failures, a task the provider
 * reports failed, or the time limit ends the wait.
 */

import { classifyFailure, type Failure, FailureError, failureOf } from "../ai/failure.ts";
import { fetchWithRetry, RetryBudget } from "../ai/retry.ts";
import { endpointMissing } from "../images/generate.ts";
import { quotaGuard } from "../images/quota.ts";
import { persistSessionVideo, sessionMediaPath } from "../session/payload.ts";
import type { ModelConfig, ProviderConfig } from "../types/provider.ts";
import { arkVideos } from "./ark.ts";
import { dashscopeVideos } from "./dashscope.ts";
import { mp4Facts } from "./mp4.ts";
import { openaiVideos } from "./openai.ts";
import { videoApiPlan } from "./protocol.ts";
import type { SavedVideo, VideoCallOptions, VideoOutput, VideoRequest, VideoResult, VideoWireApi } from "./types.ts";
import { veoVideos } from "./veo.ts";
import type { Poll, Submitted, VideoWire, WireCall } from "./wire.ts";
import { xaiVideos } from "./xai.ts";

const WIRES: Record<VideoWireApi, VideoWire> = { xai: xaiVideos, ark: arkVideos, openai: openaiVideos, veo: veoVideos, dashscope: dashscopeVideos };

const learned = new Map<string, VideoWireApi>();

/** Forget the APIs learned so far. For tests. */
export function resetVideoRoutes(): void {
	learned.clear();
}

/** Long enough for thirty seconds of 1080p on a busy pool; past it the person hears, rather than waits. */
const TIMEOUT_MS = 20 * 60_000;
/** Polls failing one after another before the wait is given up — about half a minute of a dead line. */
const POLL_FAILURES = 6;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason ?? new Error("Aborted"));
		const timer = setTimeout(() => {
			signal?.removeEventListener("abort", stop);
			resolve();
		}, ms);
		const stop = () => {
			clearTimeout(timer);
			reject(signal?.reason ?? new Error("Aborted"));
		};
		signal?.addEventListener("abort", stop, { once: true });
	});
}

export async function generateVideo(provider: ProviderConfig, model: ModelConfig, request: VideoRequest, options: VideoCallOptions = {}): Promise<VideoResult> {
	const call: WireCall = { provider, model, fetch: quotaGuard(options.fetch ?? globalThis.fetch), signal: options.signal, retryAttempts: options.retryAttempts, onRetry: options.onRetry };
	const key = `${provider.baseUrl}\n${model.modelId}`;
	const known = learned.get(key);
	const plan = known ? [known] : videoApiPlan(provider, model);

	options.onStage?.("submitting");
	let api: VideoWireApi | undefined;
	let submitted: Submitted | undefined;
	let firstError: unknown;
	for (const candidate of plan) {
		try {
			submitted = await WIRES[candidate].submit(call, request);
			api = candidate;
			learned.set(key, candidate);
			break;
		} catch (error) {
			if (options.signal?.aborted) throw error;
			// An endpoint that is there and refused is the answer, whichever API it was.
			if (!endpointMissing(error)) throw error;
			firstError ??= error;
		}
	}
	// None had the endpoint: the first refusal names the API this model was expected on.
	if (!api || !submitted) throw firstError ?? new Error("No video API answered.");

	const wire = WIRES[api];
	const interval = options.pollIntervalMs ?? wire.interval * 1000;
	const limit = options.timeoutMs ?? TIMEOUT_MS;
	const deadline = Date.now() + limit;
	options.onStage?.("queued");
	let failedPolls = 0;
	for (let round = 0; ; round++) {
		// A short first wait: a fast model finishes a few-second clip in well under a minute.
		await sleep(round === 0 ? Math.min(interval, 3_000) : interval, options.signal);
		let poll: Poll;
		try {
			poll = await wire.poll(call, submitted.id);
			failedPolls = 0;
		} catch (error) {
			if (options.signal?.aborted) throw error;
			if (failureOf(error).kind === "fatal" || ++failedPolls >= POLL_FAILURES) throw error;
			if (Date.now() > deadline) throw new FailureError(timedOut(api, submitted.id, limit));
			continue;
		}
		if (poll.state === "failed") throw new FailureError(poll.failure);
		if (poll.state === "pending") {
			options.onStage?.(poll.stage, poll.progress);
			if (Date.now() > deadline) throw new FailureError(timedOut(api, submitted.id, limit));
			continue;
		}
		options.onStage?.("downloading");
		const videos: SavedVideo[] = [];
		for (const output of poll.outputs) videos.push(await download(call, output));
		return { videos, api, taskId: submitted.id, adjusted: submitted.adjusted };
	}
}

function timedOut(api: VideoWireApi, id: string, limit: number): Failure {
	return {
		kind: "fatal",
		summary: "等太久，视频还没生成完",
		detail: `Task ${id} (${api}) had not finished after ${Math.round(limit / 60_000)} minutes. It may still finish upstream; it was not cancelled.`,
		fingerprint: `video-timeout:${api}`,
		retryLimit: 0,
	};
}

/**
 * The finished file, streamed into `session-media`.
 *
 * The key goes only where the API said it is needed — the content endpoint, Google's file URI. A
 * signed CDN link is fetched bare: the key, and any header the provider was configured with, have no
 * business reaching a third host.
 */
async function download(call: WireCall, output: VideoOutput): Promise<SavedVideo> {
	const key = call.provider.apiKey;
	const auth: Record<string, string> = output.auth === "bearer" ? { authorization: `Bearer ${key}`, ...call.provider.headers } : output.auth === "goog" ? { "x-goog-api-key": key, ...call.provider.headers } : {};
	const response = await fetchWithRetry(call.fetch, output.url, { method: "GET", headers: auth, signal: call.signal, redirect: "follow" }, { budget: new RetryBudget(undefined, 3), signal: call.signal });
	if (!response.body) throw new FailureError(classifyFailure({ from: "stream", message: "The video download had no body." }));
	const saved = await persistSessionVideo(response.body as unknown as AsyncIterable<Uint8Array>, response.headers.get("content-type"));
	const facts = saved.mimeType === "video/webm" ? null : await mp4Facts(sessionMediaPath(saved.name));
	return { media: saved.name, mimeType: saved.mimeType, bytes: saved.bytes, width: facts?.width, height: facts?.height, seconds: facts?.seconds ?? output.seconds };
}
