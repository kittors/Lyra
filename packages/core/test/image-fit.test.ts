/**
 * Fitting one picture: the size it is scaled to, the encoding it ends up in, when it is left alone.
 *
 * The engine here is a stand-in that writes a real PNG or JPEG header for the size it was asked for
 * and pads the bytes to a size chosen by the test — the decisions in `shrink.ts` only ever look at
 * those two things, and this makes every branch reachable without a canvas.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { base64Bytes, fitDimensions, fitsAsIs, imageStyle, SAFE_IMAGE_TYPES } from "../src/images/fit.ts";
import { ENTRY_LIMITS, GIST_LIMITS, scaledNote, shrinkImage, type ShrinkTarget } from "../src/images/shrink.ts";
import { fakeEngine, jpeg, png } from "./image-helpers.ts";

const KB = 1024;
const entry = (style: ShrinkTarget["style"]): ShrinkTarget => ({ ...ENTRY_LIMITS, style });

test("fitDimensions: the long side and the area both bind, and nothing is enlarged", () => {
	assert.deepEqual(fitDimensions({ width: 3840, height: 2160 }, ENTRY_LIMITS), { width: 2000, height: 1125 });
	assert.deepEqual(fitDimensions({ width: 4032, height: 3024 }, ENTRY_LIMITS), { width: 2000, height: 1500 });
	// A square 3000×3000 is held by the 3.75 MP area before it is held by the 2000 px side.
	assert.deepEqual(fitDimensions({ width: 3000, height: 3000 }, ENTRY_LIMITS), { width: 1936, height: 1936 });
	assert.deepEqual(fitDimensions({ width: 800, height: 600 }, ENTRY_LIMITS), { width: 800, height: 600 });
	// Claude's standard tier: Anthropic's own example puts 1920×1080 at 1456×819.
	assert.deepEqual(fitDimensions({ width: 1920, height: 1080 }, { maxEdge: 1568, maxPixels: 1456 * 819 }), { width: 1456, height: 819 });
	assert.deepEqual(fitDimensions({ width: 0, height: 10 }, ENTRY_LIMITS), { width: 0, height: 0 });
});

test("fitsAsIs: a known size, inside the limits, in a type every provider takes", () => {
	const limits = { ...ENTRY_LIMITS };
	assert.equal(fitsAsIs(png(1200, 800, 300 * KB), "image/png", limits), true);
	assert.equal(fitsAsIs(png(2400, 800), "image/png", limits), false, "too wide");
	assert.equal(fitsAsIs(png(1200, 800, 5 * 1024 * KB), "image/png", limits), false, "too heavy");
	assert.equal(fitsAsIs(png(1200, 800), "image/gif", limits), false, "GIF is not taken by Gemini");
	assert.equal(fitsAsIs(new Uint8Array(64), "image/png", limits), false, "a size nothing can read is not vouched for");
	assert.equal(SAFE_IMAGE_TYPES.has("image/heic"), false);
});

test("imageStyle: a camera's formats are photos, everything a screen produces is sharp", () => {
	for (const mime of ["image/jpeg", "image/jpg", "image/heic", "image/heif", "image/avif"]) assert.equal(imageStyle(mime), "photo", mime);
	for (const mime of ["image/png", "image/gif", "image/webp", "image/bmp", "image/svg+xml"]) assert.equal(imageStyle(mime), "sharp", mime);
});

test("base64Bytes: the decoded length, padding included", () => {
	for (const text of ["", "a", "ab", "abc", "abcd", "x".repeat(1001)]) assert.equal(base64Bytes(Buffer.from(text).toString("base64")), text.length);
});

test("shrinkImage: a picture already inside every limit is not even decoded", async () => {
	const { engine, calls } = fakeEngine(() => 1);
	const input = png(1600, 900, 200 * KB);
	const out = await shrinkImage(engine, { data: input, mimeType: "image/png" }, entry("sharp"));
	assert.equal(out?.changed, false);
	assert.equal(out?.data, input);
	assert.deepEqual({ w: out?.width, h: out?.height }, { w: 1600, h: 900 });
	assert.equal(calls.decode, 0);
});

test("shrinkImage: a 4K screenshot stays a PNG when the PNG is light enough", async () => {
	const { engine, calls } = fakeEngine((size, encoding) => (encoding.type === "image/png" ? 400 * KB : 150 * KB));
	const out = await shrinkImage(engine, { data: png(3840, 2160, 6 * 1024 * KB), mimeType: "image/png" }, entry("sharp"));
	assert.equal(out?.mimeType, "image/png");
	assert.deepEqual({ w: out?.width, h: out?.height, ow: out?.original.width }, { w: 2000, h: 1125, ow: 3840 });
	assert.deepEqual(calls.encode, ["png@2000x1125"]);
	assert.equal(calls.released, 1);
});

test("shrinkImage: a heavy screenshot becomes a JPEG at the first quality that is light enough", async () => {
	const { engine, calls } = fakeEngine((_size, encoding) => (encoding.type === "image/png" ? 1500 * KB : encoding.quality >= 0.9 ? 700 * KB : 450 * KB));
	const out = await shrinkImage(engine, { data: png(3840, 2160, 7 * 1024 * KB), mimeType: "image/png" }, entry("sharp"));
	assert.equal(out?.mimeType, "image/jpeg");
	assert.deepEqual(calls.encode, ["png@2000x1125", "jpeg90@2000x1125", "jpeg80@2000x1125"]);
});

test("shrinkImage: a photo starts at JPEG q85 and never tries PNG", async () => {
	const { engine, calls } = fakeEngine(() => 300 * KB);
	const out = await shrinkImage(engine, { data: jpeg(4032, 3024, 5 * 1024 * KB), mimeType: "image/jpeg" }, entry("photo"));
	assert.equal(out?.mimeType, "image/jpeg");
	assert.deepEqual(calls.encode, ["jpeg85@2000x1500"]);
});

test("shrinkImage: when nothing reaches the soft target, the smallest under the hard one is taken", async () => {
	const { engine, calls } = fakeEngine((_size, encoding) => (encoding.type === "image/png" ? 3000 * KB : Math.round(encoding.quality * 1000) * KB));
	const out = await shrinkImage(engine, { data: png(3840, 2160, 9 * 1024 * KB), mimeType: "image/png" }, entry("sharp"));
	assert.equal(out?.mimeType, "image/jpeg");
	assert.equal(out?.data.length, 700 * KB, "q70 was the smallest");
	assert.equal(calls.encode.length, 4, "the whole ladder was tried once, at one size");
});

test("shrinkImage: past the hard limit at every quality, the picture is scaled down a quarter and tried again", async () => {
	const { engine, calls } = fakeEngine((size) => (size.width >= 2000 ? 5000 * KB : 200 * KB));
	const out = await shrinkImage(engine, { data: png(3840, 2160, 9 * 1024 * KB), mimeType: "image/png" }, entry("sharp"));
	assert.deepEqual({ w: out?.width, h: out?.height }, { w: 1500, h: 843 });
	assert.equal(calls.encode.at(-1), "png@1500x843");
});

test("shrinkImage: gives up after four scale steps rather than shrinking forever", async () => {
	const { engine, calls } = fakeEngine(() => 99 * 1024 * KB);
	assert.equal(await shrinkImage(engine, { data: png(3840, 2160, 9 * 1024 * KB), mimeType: "image/png" }, entry("sharp")), null);
	assert.equal(calls.encode.length, 5 * 4);
	assert.equal(calls.released, 1);
});

test("shrinkImage: a picture fitted once is not compressed a second time when nothing is clearly smaller", async () => {
	// What arrives in the main process after the composer fitted it: inside every limit, a little over the soft target.
	const input = jpeg(2000, 1125, 600 * KB);
	const { engine } = fakeEngine((_size, encoding) => (encoding.type === "image/png" ? 2000 * KB : 580 * KB));
	const out = await shrinkImage(engine, { data: input, mimeType: "image/jpeg" }, entry("photo"));
	assert.equal(out?.changed, false);
	assert.equal(out?.data, input);
});

test("shrinkImage: an undecodable picture (HEIC in a browser) is null, not an exception", async () => {
	const { engine } = fakeEngine(() => 1, false);
	assert.equal(await shrinkImage(engine, { data: jpeg(4032, 3024, 2 * 1024 * KB), mimeType: "image/heic" }, entry("photo")), null);
});

test("shrinkImage: a gist is small and lossy whatever the source", async () => {
	const { engine, calls } = fakeEngine(() => 40 * KB);
	const out = await shrinkImage(engine, { data: png(2000, 1125, 400 * KB), mimeType: "image/png" }, { ...GIST_LIMITS, style: "gist" });
	assert.equal(out?.mimeType, "image/jpeg");
	assert.deepEqual(calls.encode, ["jpeg60@768x432"]);
});

test("scaledNote: the sentence Claude Code and pi put under a scaled tool picture", () => {
	assert.equal(scaledNote({ width: 3840, height: 2160 }, { width: 2000, height: 1125 }), "[Image: original 3840x2160, displayed at 2000x1125. Multiply coordinates by 1.92 to map to original image.]");
});
