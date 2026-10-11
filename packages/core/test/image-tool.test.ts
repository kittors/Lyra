/**
 * `image_generate` from the model's side: what it can point at, what it is told back, and what the
 * window is handed to draw.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { classifyFailure, FailureError } from "../src/ai/failure.ts";
import { RECENT_IMAGES_KEY } from "../src/images/recent.ts";
import type { ImageGenerationDetails, ImageHost, ImageRequest, ImageResult, ImageTarget } from "../src/images/types.ts";
import { sessionMediaPath } from "../src/session/payload.ts";
import { imageTool } from "../src/tools/image.ts";
import type { ToolContext, ToolResult } from "../src/types.ts";

const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

let home = "";
let workspace = "";
const previousHome = process.env.LYRA_HOME;

before(async () => {
	home = await mkdtemp(join(tmpdir(), "lyra-image-tool-"));
	workspace = join(home, "project");
	await mkdir(workspace, { recursive: true });
	process.env.LYRA_HOME = join(home, ".lyra");
});

after(async () => {
	if (previousHome === undefined) delete process.env.LYRA_HOME;
	else process.env.LYRA_HOME = previousHome;
	await rm(home, { recursive: true, force: true });
});

const target: ImageTarget = {
	provider: { id: "relay", name: "Relay", baseUrl: "https://relay.example", api: "openai-responses", apiKey: "k", enabled: true, models: [] },
	model: { id: "relay/gemini-3.1-flash-image", providerId: "relay", modelId: "gemini-3.1-flash-image", name: "gemini-3.1-flash-image", contextWindow: 0, maxOutputTokens: 0, supportsThinking: false, supportsImages: true, supportsTools: false },
};

function fakeHost(draw: (request: ImageRequest) => Promise<ImageResult> | ImageResult, pictures: ImageHost["pictures"] = () => []): ImageHost & { requests: ImageRequest[] } {
	const requests: ImageRequest[] = [];
	return {
		requests,
		resolve: (asked) => (asked && asked !== target.model.modelId ? { problem: `No image model called "${asked}" is configured.` } : target),
		generate: async (_, request) => {
			requests.push(request);
			return draw(request);
		},
		pictures,
	};
}

function context(images: ImageHost | undefined, progress: ToolResult[] = []): ToolContext {
	return { cwd: workspace, sessionId: "s1", state: new Map(), images, onProgress: (partial) => progress.push(partial) };
}

const drawn = (): ImageResult => ({ images: [{ data: PNG, mimeType: "image/png" }], route: "images" });

test("a drawing is saved as session media, reported to the model, and handed to the window", async () => {
	const progress: ToolResult[] = [];
	const ctx = context(fakeHost(drawn), progress);
	const result = await imageTool.execute({ prompt: "a paper boat", aspect_ratio: "16:9" }, ctx);
	assert.equal(result.isError, undefined);

	const details = result.details as ImageGenerationDetails;
	assert.equal(details.status, "done");
	assert.equal(details.aspectRatio, "16:9");
	assert.equal(details.images?.length, 1);
	const picture = details.images?.[0];
	assert.ok(picture && existsSync(sessionMediaPath(picture.media)), "the pixels are a file under session-media");
	assert.deepEqual([picture.width, picture.height], [1, 1]);

	const text = result.content[0].type === "text" ? result.content[0].text : "";
	assert.match(text, /Drew 1 image with gemini-3\.1-flash-image \(1×1\)/);
	assert.ok(text.includes(picture.media), "the model is told where it went, so it can edit it later");

	assert.equal((progress[0]?.details as ImageGenerationDetails | undefined)?.status, "running", "the card can start before the picture exists");
	assert.deepEqual(ctx.state.get(RECENT_IMAGES_KEY), [{ media: picture.media, mimeType: "image/png" }], "#1 now means this picture");
});

test("#1 is the newest picture in the conversation, and #N past the end says how many there are", async () => {
	const host = fakeHost(drawn, () => [{ data: PNG, mimeType: "image/png" }]);
	await imageTool.execute({ prompt: "make it blue", images: ["#1"] }, context(host));
	assert.equal(host.requests[0].images?.[0].data, PNG);

	const missing = await imageTool.execute({ prompt: "make it blue", images: ["#3"] }, context(host));
	assert.equal(missing.isError, true);
	assert.match(missing.content[0].type === "text" ? missing.content[0].text : "", /has 1 image \(#1 is the newest\)/);
});

test("a picture in the workspace goes in by path; something that is not a picture is refused", async () => {
	await writeFile(join(workspace, "logo.png"), Buffer.from(PNG, "base64"));
	await writeFile(join(workspace, "notes.txt"), "hello");
	const host = fakeHost(drawn);
	const ok = await imageTool.execute({ prompt: "restyle", images: ["logo.png"] }, context(host));
	assert.equal(ok.isError, undefined);
	assert.equal(host.requests[0].images?.[0].mimeType, "image/png");

	const refused = await imageTool.execute({ prompt: "restyle", images: ["notes.txt"] }, context(host));
	assert.match(refused.content[0].type === "text" ? refused.content[0].text : "", /not a PNG, JPEG or WebP/);
});

test("an earlier drawing can be passed back by the path the model was given", async () => {
	const ctx = context(fakeHost(drawn));
	const first = await imageTool.execute({ prompt: "a boat" }, ctx);
	const media = (first.details as ImageGenerationDetails).images?.[0].media ?? "";
	const host = fakeHost(drawn);
	const again = await imageTool.execute({ prompt: "a red sail", images: [sessionMediaPath(media)] }, context(host));
	assert.equal(again.isError, undefined, "the app's own media needs no read approval");
	assert.equal(host.requests[0].images?.[0].data, PNG);
});

test("without an image model, or with one the user did not configure, the model is told what to say", async () => {
	const none = await imageTool.execute({ prompt: "a boat" }, context(undefined));
	assert.match(none.content[0].type === "text" ? none.content[0].text : "", /No image model is configured/);

	const unknown = await imageTool.execute({ prompt: "a boat", model: "midjourney-v7" }, context(fakeHost(drawn)));
	assert.match(unknown.content[0].type === "text" ? unknown.content[0].text : "", /midjourney-v7/);
});

test("a spent quota comes back as an error the card can show and the model can repeat", async () => {
	const failure = classifyFailure({ from: "status", status: 429, body: "Your quota will reset after 1h52m45s." });
	const host = fakeHost(() => {
		throw new FailureError({ ...failure, kind: "fatal", hint: "check-billing", retryAfterMs: 6_765_000 });
	});
	const result = await imageTool.execute({ prompt: "a boat" }, context(host));
	assert.equal(result.isError, true);
	const details = result.details as ImageGenerationDetails;
	assert.equal(details.status, "error");
	assert.equal(details.error?.retryAfterMs, 6_765_000);
	assert.match(result.content[0].type === "text" ? result.content[0].text : "", /no quota left\. It resets in about 1h 53m/);
});
