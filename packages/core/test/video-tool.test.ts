/**
 * `video_generate` from the model's side: what it can point at, what it is told back, and what the
 * window is handed to show.
 */

import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { FailureError } from "../src/ai/failure.ts";
import { videoTool } from "../src/tools/video.ts";
import type { ToolContext, ToolResult } from "../src/types.ts";
import type { VideoGenerationDetails, VideoHost, VideoRequest, VideoResult, VideoTarget } from "../src/videos/types.ts";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
let home = "";
const previousHome = process.env.LYRA_HOME;

before(async () => {
	home = await mkdtemp(join(tmpdir(), "lyra-video-tool-"));
	process.env.LYRA_HOME = join(home, ".lyra");
});

after(async () => {
	if (previousHome === undefined) delete process.env.LYRA_HOME;
	else process.env.LYRA_HOME = previousHome;
	await rm(home, { recursive: true, force: true });
});

const target = (supportsImages = true): VideoTarget => ({
	provider: { id: "relay", name: "Relay", baseUrl: "https://relay.example", api: "openai-responses", apiKey: "k", enabled: true, models: [] },
	model: { id: "relay/grok-imagine-video-1.5", providerId: "relay", modelId: "grok-imagine-video-1.5", name: "grok-imagine-video-1.5", contextWindow: 0, maxOutputTokens: 0, supportsThinking: false, supportsImages, supportsTools: false },
});

const made = (): VideoResult => ({
	videos: [{ media: `${"a".repeat(40)}.mp4`, mimeType: "video/mp4", bytes: 1000, width: 1280, height: 720, seconds: 6 }],
	api: "xai",
	taskId: "req-1",
	adjusted: ["The first frame decides the shape; 9:16 does not apply."],
});

function fakeHost(film: (request: VideoRequest, index: number) => Promise<VideoResult> | VideoResult, chosen = target()): VideoHost & { requests: VideoRequest[]; adopted: string[] } {
	const requests: VideoRequest[] = [];
	const adopted: string[] = [];
	return {
		requests,
		adopted,
		resolve: () => chosen,
		generate: async (_, request, options) => {
			requests.push(request);
			options?.onStage?.("running", 50);
			return film(request, requests.length - 1);
		},
		pictures: () => [{ data: PNG, mimeType: "image/png" }],
		names: () => ["grok-imagine-video-1.5", "doubao-seedance-2-5-260628"],
		adopt: (picked) => void adopted.push(picked.model.id),
	};
}

const context = (videos: VideoHost | undefined, progress: ToolResult[] = []): ToolContext => ({ cwd: home, sessionId: "s1", state: new Map(), videos, onProgress: (partial) => progress.push(partial) });
const textOf = (result: ToolResult) => result.content.map((part) => (part.type === "text" ? part.text : "")).join("\n");

test("a video is made, reported with its size and what could not go as asked, and handed to the window", async () => {
	const progress: ToolResult[] = [];
	const host = fakeHost(made);
	const result = await videoTool.execute({ prompt: "the fox runs", image: "#1", aspect_ratio: "9:16", duration: 6, resolution: "720p", model: "grok-imagine-video-1.5" }, context(host, progress));
	assert.equal(result.isError, undefined);
	assert.equal(host.requests[0].image?.data, PNG, "#1 is the conversation's newest picture");
	assert.equal(host.requests[0].duration, 6);
	const said = textOf(result);
	assert.match(said, /Made 1 video with grok-imagine-video-1\.5 \(1280×720, 6s\)/);
	assert.match(said, /Not exactly as asked: The first frame decides the shape/);
	assert.doesNotMatch(said, /did not keep to/, "a first frame's shape is not held against the model");
	const details = result.details as VideoGenerationDetails;
	assert.equal(details.status, "done");
	assert.equal(details.videos?.[0].media, `${"a".repeat(40)}.mp4`);
	assert.equal(details.sources?.length, 1);
	assert.equal(details.shapeHint, 1);
	assert.deepEqual(host.adopted, ["relay/grok-imagine-video-1.5"]);
	const stages = progress.map((partial) => (partial.details as VideoGenerationDetails).stage);
	assert.deepEqual(stages, ["submitting", "running"]);
	assert.equal((progress[1].details as VideoGenerationDetails).progress, 50);
});

test("two asked for and one refused: the one that came is kept, the other counted", async () => {
	const host = fakeHost((_, index) => {
		if (index === 1) throw new FailureError({ kind: "fatal", summary: "生成失败", fingerprint: "x" });
		return made();
	});
	const result = await videoTool.execute({ prompt: "waves", count: 2 }, context(host));
	assert.equal(result.isError, undefined);
	assert.match(textOf(result), /1 of 2 did not arrive: 生成失败/);
	assert.deepEqual(host.adopted, [], "nothing was named, nothing moves");
});

test("none made: the failure in words the model can pass on; a spent quota says so", async () => {
	const host = fakeHost(() => {
		throw new FailureError({ kind: "fatal", summary: "额度不足", hint: "check-billing", retryAfterMs: 3_600_000, fingerprint: "q" });
	});
	const result = await videoTool.execute({ prompt: "waves", model: "grok-imagine-video-1.5" }, context(host));
	assert.equal(result.isError, true);
	assert.match(textOf(result), /has no quota left\. It resets in about 1h/);
	assert.equal((result.details as VideoGenerationDetails).status, "error");
	assert.deepEqual(host.adopted, [], "a model that did not deliver is not adopted");
});

test("a model without picture input is not sent a first frame; no video model at all is said plainly", async () => {
	const host = fakeHost(made, target(false));
	const blind = await videoTool.execute({ prompt: "move", image: "#1" }, context(host));
	assert.equal(blind.isError, true);
	assert.equal(host.requests.length, 0);
	assert.match(textOf(blind), /without picture input/);

	const none = await videoTool.execute({ prompt: "move" }, context(undefined));
	assert.match(textOf(none), /No video model is configured/);
});

test("a task that is gone or past its time is marked as such, for the card to say in its own words", async () => {
	const lost = fakeHost(() => {
		throw new FailureError({ kind: "fatal", summary: "生成任务找不到了", fingerprint: "lost:r", retryLimit: 0 });
	});
	const gone = await videoTool.execute({ prompt: "waves" }, context(lost));
	assert.equal((gone.details as VideoGenerationDetails).error?.reason, "lost");

	const slow = fakeHost(() => {
		throw new FailureError({ kind: "fatal", summary: "等太久，视频还没生成完", fingerprint: "video-timeout:xai", retryLimit: 0 });
	});
	const late = await videoTool.execute({ prompt: "waves" }, context(slow));
	assert.equal((late.details as VideoGenerationDetails).error?.reason, "timeout");
});
