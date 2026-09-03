/**
 * Version ordering.
 *
 * The claim: newer is newer, including the two cases a string comparison gets wrong — 0.10 against
 * 0.9, and a pre-release against the release it leads to.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { compareVersions, isNewer, parseVersion } from "../src/features/update/version.ts";

test("ordinary ordering", () => {
	assert.equal(isNewer("0.2.0", "0.1.0"), true);
	assert.equal(isNewer("0.1.0", "0.2.0"), false);
	assert.equal(isNewer("0.1.0", "0.1.0"), false, "the same version is not an update");
	assert.equal(isNewer("1.0.0", "0.9.9"), true);
});

test("double digits, which a string comparison gets backwards", () => {
	assert.equal(isNewer("0.10.0", "0.9.0"), true, "0.10 is after 0.9");
	assert.equal(isNewer("0.9.0", "0.10.0"), false);
	assert.equal(isNewer("1.0.10", "1.0.9"), true);
	// …which is exactly what a string comparison would have said.
	const asStrings = ["0.10.0", "0.9.0"].sort();
	assert.deepEqual(asStrings, ["0.10.0", "0.9.0"], "string order puts 0.10 first, which is why this is compared numerically");
});

test("a missing segment is zero", () => {
	assert.equal(compareVersions("1.2", "1.2.0"), 0);
	assert.equal(isNewer("1.2.1", "1.2"), true);
});

test("a release beats the pre-releases leading to it", () => {
	assert.equal(isNewer("1.0.0", "1.0.0-beta.2"), true);
	assert.equal(isNewer("1.0.0-beta.2", "1.0.0"), false);
	assert.equal(isNewer("1.0.0-beta.2", "1.0.0-beta.1"), true, "beta.2 is after beta.1");
	assert.equal(isNewer("1.0.0-beta.10", "1.0.0-beta.9"), true, "numerically, not alphabetically");
	assert.equal(isNewer("1.0.0-rc.1", "1.0.0-beta.5"), true, "rc after beta");
});

test("release tags come as they are written", () => {
	assert.equal(isNewer("v0.2.0", "0.1.0"), true, "a leading v is a tag convention, not a version");
	assert.equal(isNewer("0.2.0+build.7", "0.1.0"), true, "build metadata does not affect ordering");
	assert.equal(compareVersions("1.0.0+a", "1.0.0+b"), 0);
});

test("nonsense compares as equal rather than as an update", () => {
	assert.equal(parseVersion("not-a-version"), null);
	assert.equal(isNewer("", "0.1.0"), false);
	assert.equal(isNewer("banana", "0.1.0"), false, "never offer an update on the strength of a parse failure");
	assert.equal(isNewer("0.2.0", ""), false);
});
