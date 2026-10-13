/**
 * Filming through each task API a video model may sit behind, against fake hosts: what is sent, how
 * the wait is followed, where the file comes from and with what key, and when a task is given up on.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, beforeEach, test } from "node:test";
import { failureOf } from "../src/ai/failure.ts";
import { sessionMediaPath } from "../src/session/payload.ts";
import type { ModelConfig, ProviderConfig } from "../src/types/provider.ts";
import { generateVideo, resetVideoRoutes } from "../src/videos/generate.ts";
import { factsIn } from "../src/videos/mp4.ts";
import { videoApiPlan } from "../src/videos/protocol.ts";
import type { VideoStage } from "../src/videos/types.ts";

let home = "";
const previousHome = process.env.LYRA_HOME;

before(async () => {
	home = await mkdtemp(join(tmpdir(), "lyra-video-"));
	process.env.LYRA_HOME = join(home, ".lyra");
});

after(async () => {
	if (previousHome === undefined) delete process.env.LYRA_HOME;
	else process.env.LYRA_HOME = previousHome;
	await rm(home, { recursive: true, force: true });
});

beforeEach(() => resetVideoRoutes());

function box(type: string, ...payload: Buffer[]): Buffer {
	const body = Buffer.concat(payload);
	const head = Buffer.alloc(8);
	head.writeUInt32BE(8 + body.length);
	head.write(type, 4, "latin1");
	return Buffer.concat([head, body]);
}

/** A tiny MP4: `ftyp`, the frames, then `moov` last — the order a file not prepared for streaming has. */
function mp4(width: number, height: number, seconds: number): Buffer {
	const mvhd = Buffer.alloc(96);
	mvhd.writeUInt32BE(1000, 12);
	mvhd.writeUInt32BE(seconds * 1000, 16);
	const tkhd = Buffer.alloc(84);
	tkhd.writeUInt32BE(width * 65536, 76);
	tkhd.writeUInt32BE(height * 65536, 80);
	const audio = box("trak", box("tkhd", Buffer.alloc(84)));
	return Buffer.concat([box("ftyp", Buffer.from("isom"), Buffer.alloc(4), Buffer.from("isomiso2mp41")), box("mdat", Buffer.alloc(64, 7)), box("moov", box("mvhd", mvhd), audio, box("trak", box("tkhd", tkhd)))]);
}

const CLIP = mp4(1280, 720, 6);
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

interface Seen {
	method: string;
	url: string;
	headers: Headers;
	json?: Record<string, unknown>;
	form?: FormData;
}

function host(reply: (seen: Seen, index: number) => Response | Promise<Response>) {
	const seen: Seen[] = [];
	const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
		const body = init?.body;
		const entry: Seen = { method: init?.method ?? "GET", url: String(input), headers: new Headers(init?.headers) };
		if (typeof body === "string") entry.json = JSON.parse(body) as Record<string, unknown>;
		else if (body instanceof FormData) entry.form = body;
		seen.push(entry);
		return reply(entry, seen.length - 1);
	}) as typeof globalThis.fetch;
	return { seen, fetch };
}

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const video = () => new Response(new Uint8Array(CLIP), { status: 200, headers: { "content-type": "application/octet-stream" } });

const provider = (baseUrl: string, name = "Relay"): ProviderConfig => ({ id: "p", name, baseUrl, api: "openai-responses", apiKey: "sk-test", enabled: true, models: [] });
const model = (modelId: string, extra: Partial<ModelConfig> = {}): ModelConfig => ({
	id: `p/${modelId}`,
	providerId: "p",
	modelId,
	name: modelId,
	contextWindow: 0,
	maxOutputTokens: 0,
	supportsThinking: false,
	supportsImages: true,
	supportsTools: false,
	...extra,
});
const fast = { pollIntervalMs: 1, retryAttempts: 1 };

test("which API a model is tried on: a stored choice alone, else the address, the name, then the relay formats", () => {
	assert.deepEqual(videoApiPlan(provider("https://relay.example"), model("grok-imagine-video-1.5", { videoApi: "ark" })), ["ark"]);
	assert.deepEqual(videoApiPlan(provider("https://api.x.ai/v1"), model("grok-imagine-video-1.5")), ["xai", "openai", "ark"]);
	assert.deepEqual(videoApiPlan(provider("https://ark.cn-beijing.volces.com/api/v3"), model("doubao-seedance-2-5-260628")), ["ark", "openai", "xai"]);
	assert.deepEqual(videoApiPlan(provider("https://generativelanguage.googleapis.com/v1beta/openai"), model("veo-3.1-generate-preview")), ["veo", "openai", "xai", "ark"]);
	assert.deepEqual(videoApiPlan(provider("https://dashscope.aliyuncs.com/compatible-mode/v1"), model("wan2.7-t2v")), ["dashscope", "openai", "xai", "ark"]);
	assert.deepEqual(videoApiPlan(provider("https://relay.example"), model("grok-imagine-video-1.5")), ["xai", "openai", "ark"]);
	assert.deepEqual(videoApiPlan(provider("https://relay.example"), model("kling-v2-master")), ["openai", "xai", "ark"]);
});

test("xAI: one JSON submit, polled to done, the link fetched bare and kept as an MP4 with its own size", async () => {
	const stages: VideoStage[] = [];
	const relay = host((seen, index) => {
		if (index === 0) return json({ request_id: "req-1" });
		if (index === 1) return json({ status: "pending" });
		if (index === 2) return json({ status: "done", video: { url: "https://vidgen.x.ai/abc/video.mp4", duration: 6, respect_moderation: true }, model: "grok-imagine-video-1.5" });
		return video();
	});
	const result = await generateVideo(
		provider("https://relay.example"),
		model("grok-imagine-video-1.5"),
		{ prompt: "a fox runs", duration: 20, aspectRatio: "16:9", resolution: "720p", audio: false },
		{ ...fast, fetch: relay.fetch, onStage: (stage) => stages.push(stage) },
	);
	assert.equal(relay.seen[0].url, "https://relay.example/v1/videos/generations");
	assert.equal(relay.seen[0].headers.get("authorization"), "Bearer sk-test");
	assert.deepEqual(relay.seen[0].json, { model: "grok-imagine-video-1.5", prompt: "a fox runs", duration: 15, aspect_ratio: "16:9", resolution: "720p", generate_audio: false });
	assert.equal(relay.seen[1].url, "https://relay.example/v1/videos/req-1");
	assert.equal(relay.seen[3].url, "https://vidgen.x.ai/abc/video.mp4");
	assert.equal(relay.seen[3].headers.get("authorization"), null, "a signed link is fetched without the key");
	assert.equal(relay.seen.length, 4, "the first done is read in full; a relay that forgets the task after it is never asked again");

	assert.equal(result.api, "xai");
	assert.match(result.adjusted.join(" "), /1 to 15 seconds; 15 was asked for instead of 20/);
	const saved = result.videos[0];
	assert.match(saved.media, /^[a-f0-9]{40}\.mp4$/);
	assert.ok(existsSync(sessionMediaPath(saved.media)));
	assert.deepEqual([saved.width, saved.height, saved.seconds, saved.mimeType], [1280, 720, 6, "video/mp4"]);
	assert.deepEqual(stages, ["submitting", "queued", "running", "downloading"]);
});

test("xAI: a first frame goes as a data URL and decides the shape; a moderated result is a refusal, not a video", async () => {
	const relay = host((_, index) => (index === 0 ? json({ request_id: "r" }) : json({ status: "done", video: { url: "https://vidgen.x.ai/x.mp4", respect_moderation: false } })));
	const picture = { data: PNG, mimeType: "image/png" };
	const run = generateVideo(provider("https://api.x.ai/v1"), model("grok-imagine-video-1.5"), { prompt: "move", image: picture, aspectRatio: "9:16" }, { ...fast, fetch: relay.fetch });
	await assert.rejects(run, (error) => failureOf(error).hint === "blocked");
	assert.deepEqual(relay.seen[0].json?.image, { url: `data:image/png;base64,${PNG}` });
	assert.equal(relay.seen[0].json?.aspect_ratio, undefined);
	assert.equal(relay.seen[0].url, "https://api.x.ai/v1/videos/generations", "a base ending in /v1 is not doubled");
});

test("Ark: frames as content parts with roles, the shape left to the first frame, the clip from content.video_url", async () => {
	const ark = host((_, index) => {
		if (index === 0) return json({ id: "cgt-1" });
		if (index === 1) return json({ id: "cgt-1", status: "queued" });
		if (index === 2) return json({ id: "cgt-1", status: "running" });
		if (index === 3) return json({ id: "cgt-1", status: "succeeded", content: { video_url: "https://ark-cdn.example/v.mp4" }, duration: 10 });
		return video();
	});
	const picture = { data: PNG, mimeType: "image/png" };
	const result = await generateVideo(
		provider("https://ark.cn-beijing.volces.com/api/v3"),
		model("doubao-seedance-2-5-260628"),
		{ prompt: "a dancer", image: picture, lastImage: picture, references: [picture], aspectRatio: "16:9", duration: 40, resolution: "1080p", audio: true },
		{ ...fast, fetch: ark.fetch },
	);
	assert.equal(ark.seen[0].url, "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks");
	const body = ark.seen[0].json!;
	assert.deepEqual((body.content as { role?: string }[]).map((part) => part.role ?? "text"), ["text", "first_frame", "last_frame"], "references are not mixed with frames");
	assert.equal(body.ratio, "adaptive");
	assert.equal(body.duration, 30);
	assert.equal(body.resolution, "1080p");
	assert.equal(body.generate_audio, true);
	assert.equal(ark.seen[1].url, "https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/cgt-1");
	assert.equal(ark.seen[4].headers.get("authorization"), null);
	assert.equal(result.api, "ark");
	assert.match(result.adjusted.join(" "), /references were left out/);
	assert.match(result.adjusted.join(" "), /4 to 30 seconds; 30 was asked for instead of 40/);
});

test("Ark: a task the provider failed on content is a refusal, said as one", async () => {
	const ark = host((_, index) => (index === 0 ? json({ id: "t" }) : json({ id: "t", status: "failed", error: { code: "OutputVideoSensitiveContentDetected", message: "The output video may contain sensitive information." } })));
	await assert.rejects(generateVideo(provider("https://ark.cn-beijing.volces.com/api/v3"), model("doubao-seedance-2-0-260128"), { prompt: "x" }, { ...fast, fetch: ark.fetch }), (error) => failureOf(error).hint === "blocked");
});

test("OpenAI format: a form with the first frame sized to itself, progress passed on, the file from /content behind the key", async () => {
	const progress: (number | undefined)[] = [];
	const relay = host((_, index) => {
		if (index === 0) return json({ id: "video_1", status: "queued", progress: 0 });
		if (index === 1) return json({ id: "video_1", status: "in_progress", progress: 40 });
		if (index === 2) return json({ id: "video_1", status: "completed", progress: 100, seconds: "8" });
		return video();
	});
	const picture = { data: PNG, mimeType: "image/png" };
	const result = await generateVideo(provider("https://relay.example/v1"), model("kling-v2-master"), { prompt: "waves", image: picture, duration: 8, resolution: "720p" }, { ...fast, fetch: relay.fetch, onStage: (_, value) => progress.push(value) });
	const form = relay.seen[0].form!;
	assert.equal(relay.seen[0].url, "https://relay.example/v1/videos");
	assert.equal(form.get("model"), "kling-v2-master");
	assert.equal(form.get("seconds"), "8");
	assert.equal(form.get("size"), "720x720", "a square first frame makes a square size");
	assert.ok(form.get("input_reference") instanceof Blob);
	assert.equal(relay.seen[3].url, "https://relay.example/v1/videos/video_1/content");
	assert.equal(relay.seen[3].headers.get("authorization"), "Bearer sk-test", "the content endpoint is the provider's own, behind the key");
	assert.ok(progress.includes(40));
	assert.equal(result.api, "openai");
});

test("Veo: Gemini's own root, its key header, the shapes it offers, and the URI fetched with the key", async () => {
	const google = host((_, index) => {
		if (index === 0) return json({ name: "models/veo-3.1-generate-preview/operations/op1" });
		if (index === 1) return json({ name: "models/veo-3.1-generate-preview/operations/op1", done: false });
		if (index === 2) return json({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://generativelanguage.googleapis.com/v1beta/files/f1:download?alt=media" } }] } } });
		return video();
	});
	const result = await generateVideo(provider("https://generativelanguage.googleapis.com/v1beta/openai/"), model("veo-3.1-generate-preview"), { prompt: "rain", aspectRatio: "4:3", duration: 5, resolution: "1080p", audio: false }, { ...fast, fetch: google.fetch });
	assert.equal(google.seen[0].url, "https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview:predictLongRunning");
	assert.equal(google.seen[0].headers.get("x-goog-api-key"), "sk-test");
	assert.equal(google.seen[0].headers.get("authorization"), null, "Google's own host takes its own header only");
	assert.deepEqual(google.seen[0].json?.parameters, { aspectRatio: "16:9", resolution: "1080p", durationSeconds: "8" });
	assert.equal(google.seen[1].url, "https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-generate-preview/operations/op1");
	assert.equal(google.seen[3].headers.get("x-goog-api-key"), "sk-test");
	assert.match(result.adjusted.join(" "), /16:9/);
	assert.match(result.adjusted.join(" "), /1080p only at 8 seconds/);
	assert.match(result.adjusted.join(" "), /always adds sound/);
});

test("DashScope: the native root beside compatible-mode, async by header, and each Wan line's own fields", async () => {
	const ali = host((_, index) => {
		if (index === 0) return json({ output: { task_id: "t1", task_status: "PENDING" }, request_id: "r" });
		if (index === 1) return json({ output: { task_id: "t1", task_status: "RUNNING" } });
		if (index === 2) return json({ output: { task_id: "t1", task_status: "SUCCEEDED", video_url: "https://dashscope-result.oss.example/x.mp4?Expires=1" } });
		return video();
	});
	await generateVideo(provider("https://dashscope.aliyuncs.com/compatible-mode/v1"), model("wan2.7-t2v"), { prompt: "a city at night", aspectRatio: "21:9", resolution: "1080p", duration: 20 }, { ...fast, fetch: ali.fetch });
	assert.equal(ali.seen[0].url, "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis");
	assert.equal(ali.seen[0].headers.get("x-dashscope-async"), "enable");
	assert.deepEqual(ali.seen[0].json?.parameters, { resolution: "1080P", ratio: "16:9", duration: 15 });
	assert.equal(ali.seen[1].url, "https://dashscope.aliyuncs.com/api/v1/tasks/t1");

	const older = host((_, index) => (index === 0 ? json({ output: { task_id: "t2" } }) : index === 1 ? json({ output: { task_status: "SUCCEEDED", video_url: "https://x.example/v.mp4" } }) : video()));
	await generateVideo(provider("https://dashscope.aliyuncs.com/compatible-mode/v1"), model("wan2.6-i2v"), { prompt: "move", image: { data: PNG, mimeType: "image/png" }, resolution: "720p" }, { ...fast, fetch: older.fetch });
	assert.equal((older.seen[0].json?.input as { img_url?: string } | undefined)?.img_url, `data:image/png;base64,${PNG}`);
	assert.deepEqual(older.seen[0].json?.parameters, { resolution: "720P" });

	const none = host(() => json({}));
	await assert.rejects(generateVideo(provider("https://dashscope.aliyuncs.com/compatible-mode/v1"), model("wan2.6-i2v"), { prompt: "move" }, { ...fast, fetch: none.fetch }), (error) => /first frame/.test(failureOf(error).detail ?? ""));
	assert.equal(none.seen.length, 0, "a model that needs a picture is not asked without one");
});

test("a relay without one API is tried on the next, only for a missing endpoint, and the one that took it is remembered", async () => {
	const relay = host((seen) => {
		if (seen.url.endsWith("/v1/videos") && seen.method === "POST") return json({ error: { message: "Invalid URL (POST /v1/videos)" } }, 404);
		if (seen.url.endsWith("/v1/videos/generations")) return json({ request_id: "r" });
		if (seen.url.endsWith("/v1/videos/r")) return json({ status: "done", video: { url: "https://cdn.example/v.mp4" } });
		return video();
	});
	const kling = model("kling-v2-master");
	const first = await generateVideo(provider("https://relay.example"), kling, { prompt: "x" }, { ...fast, fetch: relay.fetch });
	assert.equal(first.api, "xai");
	const before = relay.seen.length;
	await generateVideo(provider("https://relay.example"), kling, { prompt: "y" }, { ...fast, fetch: relay.fetch });
	assert.ok(relay.seen.slice(before).every((seen) => !seen.url.endsWith("/v1/videos") || seen.method !== "POST"), "the second goes straight to the API that worked");

	const refused = host(() => json({ error: { message: "duration must be at most 10" } }, 400));
	await assert.rejects(generateVideo(provider("https://relay.example"), model("kling-v2-1"), { prompt: "x" }, { ...fast, fetch: refused.fetch }));
	assert.equal(refused.seen.length, 1, "a refusal about the request is not taken to another API");
});

test("a spent quota ends it at once; a few failed polls do not; a task past its time is reported, not waited on", async () => {
	const spent = host(() => json({ error: { message: "You exceeded your current quota", type: "insufficient_quota" } }, 429));
	await assert.rejects(generateVideo(provider("https://api.x.ai/v1"), model("grok-imagine-video-1.5"), { prompt: "x" }, { ...fast, fetch: spent.fetch }), (error) => failureOf(error).hint === "check-billing");
	assert.equal(spent.seen.length, 1);

	const shaky = host((_, index) => {
		if (index === 0) return json({ request_id: "r" });
		if (index === 1 || index === 2) return Promise.reject(new TypeError("fetch failed"));
		if (index === 3) return json({ status: "done", video: { url: "https://cdn.example/v.mp4" } });
		return video();
	});
	const result = await generateVideo(provider("https://api.x.ai/v1"), model("grok-imagine-video-1.5"), { prompt: "x" }, { ...fast, fetch: shaky.fetch });
	assert.equal(result.videos.length, 1, "two polls lost to the network are not a failed video");

	const slow = host((_, index) => (index === 0 ? json({ request_id: "r" }) : json({ status: "pending" })));
	await assert.rejects(generateVideo(provider("https://api.x.ai/v1"), model("grok-imagine-video-1.5"), { prompt: "x" }, { ...fast, timeoutMs: 20, fetch: slow.fetch }), (error) => /等太久/.test(failureOf(error).summary));

	const lost = host((_, index) => (index === 0 ? json({ request_id: "r" }) : json({ error: { message: 'video request "r" is not known to this server; it may have expired' } }, 404)));
	await assert.rejects(generateVideo(provider("https://relay.example"), model("grok-imagine-video-1.5"), { prompt: "x" }, { ...fast, fetch: lost.fetch }), (error) => /找不到/.test(failureOf(error).summary));
});

test("pressing stop ends the wait without calling it a failure of the video", async () => {
	const controller = new AbortController();
	const slow = host((_, index) => {
		if (index === 0) return json({ request_id: "r" });
		controller.abort();
		return json({ status: "pending" });
	});
	await assert.rejects(generateVideo(provider("https://api.x.ai/v1"), model("grok-imagine-video-1.5"), { prompt: "x" }, { ...fast, fetch: slow.fetch, signal: controller.signal }));
	assert.ok(controller.signal.aborted);
});

test("an MP4's size and length come from its own moov, wherever in the file it sits", () => {
	const moov = CLIP.subarray(CLIP.indexOf("moov") + 4);
	assert.deepEqual(factsIn(Buffer.from(moov)), { seconds: 6, width: 1280, height: 720 });
});
