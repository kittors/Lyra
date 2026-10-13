/**
 * What the model editor stores for 「用途」: only what disagrees with the model's name, so a model
 * nobody overrode keeps following the naming rule as it improves (`mediaKind`).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { mediaKind } from "@lyra/core/image-models";
import { outputOverrides } from "../src/lib/model-output.ts";

test("agreeing with the name stores nothing; disagreeing stores the one switch that makes it so", () => {
	assert.deepEqual(outputOverrides("grok-imagine-video-1.5", "video"), { imageOutput: undefined, videoOutput: undefined });
	assert.deepEqual(outputOverrides("gpt-5", "chat"), { imageOutput: undefined, videoOutput: undefined });
	assert.deepEqual(outputOverrides("house-director", "video"), { imageOutput: undefined, videoOutput: true });
	assert.deepEqual(outputOverrides("house-artist", "image"), { imageOutput: true, videoOutput: undefined });
	assert.deepEqual(outputOverrides("grok-imagine-video-1.5", "chat"), { imageOutput: undefined, videoOutput: false });
	assert.deepEqual(outputOverrides("gemini-3.1-flash-image", "chat"), { imageOutput: false, videoOutput: undefined });
});

test("whatever is stored, the model reads back as the kind that was chosen", () => {
	for (const id of ["grok-imagine-video-1.5", "gemini-3.1-flash-image", "gpt-5", "house-thing"]) {
		for (const purpose of ["chat", "image", "video"] as const) {
			const stored = outputOverrides(id, purpose);
			assert.equal(mediaKind({ modelId: id, ...stored }) ?? "chat", purpose, `${id} as ${purpose}`);
		}
	}
});
