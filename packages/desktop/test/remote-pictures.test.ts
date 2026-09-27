/**
 * Marks and document pictures: two kinds of remote picture, with a size cap and a lane each.
 *
 * Both rules were learned from one page. Ponytail's README lost its logo to the icon-sized cap (the
 * file is 567KB), and on a first launch the rest of its pictures waited 11.7 seconds behind the
 * market's seventy icons. The network here is a fake whose answers the test releases by hand.
 */

import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";

import { documentImage, remoteImage } from "../electron/avatars.ts";

/** Answers the test has not released yet, by URL. */
const held = new Map<string, () => void>();
const sizes = new Map<string, number>();

before(() => {
	mock.method(globalThis, "fetch", async (input: string | URL) => {
		const url = String(input);
		if (url.includes("/slow/")) await new Promise<void>((resolve) => held.set(url, resolve));
		return new Response(new Uint8Array(sizes.get(url) ?? 64), { status: 200, headers: { "content-type": "image/png" } });
	});
});

after(() => {
	for (const release of held.values()) release();
	mock.restoreAll();
});

test("a document's picture may be a banner; a mark that size is refused", async () => {
	const url = "https://pictures.test/logo.png";
	sizes.set(url, 567_655);
	assert.equal(await remoteImage(url), null, "half a megabyte is past any icon");
	const data = await documentImage(url);
	assert.ok(data?.startsWith("data:image/png;base64,"), "the same file is an ordinary README logo");

	const huge = "https://pictures.test/huge.png";
	sizes.set(huge, 6 * 1024 * 1024);
	assert.equal(await documentImage(huge), null, "but not without end");
});

test("a README's pictures do not queue behind the market's icons", async () => {
	// More icons in flight than their lane holds, none of them answering.
	const icons = Array.from({ length: 14 }, (_, index) => remoteImage(`https://icons.test/slow/${index}.png`));
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(held.size, 10, "ten icons on the wire, four waiting");

	const late = new Promise<"late">((resolve) => setTimeout(() => resolve("late"), 1000));
	const badge = await Promise.race([documentImage("https://badges.test/stars.svg"), late]);
	assert.ok(badge !== "late", "the badge arrived without waiting for a single icon");
	assert.ok(badge, "and it is a picture");

	for (const release of held.values()) release();
	await new Promise((resolve) => setTimeout(resolve, 10));
	for (const release of held.values()) release();
	assert.equal((await Promise.all(icons)).filter(Boolean).length, 14, "and the icons still all arrive");
});
