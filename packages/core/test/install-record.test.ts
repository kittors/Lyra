/**
 * Whether a bundle is behind what its registry now offers.
 *
 * The interesting cases are all refusals. An update badge that cannot be cleared is worse than no
 * badge at all: pressing the button beside it reinstalls the same bytes and the badge comes back,
 * so the page is now lying about something the user cannot fix.
 *
 * The version strings here are the real ones from the live catalogue, because they are the reason
 * the comparison is ordered the way it is — `0.0.0` and `0.0.0-30bf9a1` are what most of it
 * actually publishes.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { isOutdated, type InstallRecord } from "../src/plugins/install-record.ts";

function installed(fields: Partial<InstallRecord> = {}): InstallRecord {
	return { id: "waza", installedAt: "2026-08-01T00:00:00.000Z", ...fields };
}

test("a moved commit is an update", () => {
	assert.equal(isOutdated(installed({ commit: "aaa" }), { commit: "bbb" }), true);
});

test("the same commit is not", () => {
	assert.equal(isOutdated(installed({ commit: "aaa" }), { commit: "aaa" }), false);
});

test("the commit decides even when the version disagrees with it", () => {
	// A registry that rebuilt the same commit and stamped a new version string has not moved.
	assert.equal(isOutdated(installed({ commit: "aaa", version: "1.0.0" }), { commit: "aaa", version: "1.0.1" }), false);
});

test("the archive hash is used when there is no commit on both sides", () => {
	assert.equal(isOutdated(installed({ sha256: "aa" }), { sha256: "bb" }), true);
	assert.equal(isOutdated(installed({ sha256: "aa" }), { sha256: "aa" }), false);
});

test("versions are compared only when neither better signal is available", () => {
	assert.equal(isOutdated(installed({ version: "0.3.7" }), { version: "0.3.8" }), true);
	assert.equal(isOutdated(installed({ version: "0.3.7" }), { version: "0.3.7" }), false);
});

test("a version that never moves never claims an update", () => {
	// `anthropic-skills` publishes 0.0.0 and always has. Comparing for order would be no better;
	// there is simply no information in the field.
	assert.equal(isOutdated(installed({ version: "0.0.0" }), { version: "0.0.0" }), false);
});

test("a registry offering an older build still counts as different", () => {
	/*
	 * Deliberate: the question is "does what you have match what is on offer", not "is yours
	 * older". A registry that rolled back is offering the rollback, and no ordering could answer
	 * this anyway — `2026.7.4` and `0.3.7` are both live in this catalogue.
	 */
	assert.equal(isOutdated(installed({ version: "0.3.8" }), { version: "0.3.7" }), true);
});

test("a bundle with no record claims nothing", () => {
	// Anything installed before the ledger existed, and anything the user dropped in themselves.
	assert.equal(isOutdated(undefined, { commit: "bbb", version: "9.9.9" }), false);
});

test("an entry with nothing comparable claims nothing", () => {
	assert.equal(isOutdated(installed({ commit: "aaa" }), null), false);
	assert.equal(isOutdated(installed({ commit: "aaa" }), {}), false);
	assert.equal(isOutdated(installed(), { commit: "bbb" }), false);
});

test("one side having a field the other lacks falls through rather than guessing", () => {
	// Installed knows its commit, the registry only publishes a version: comparing those two is
	// not a comparison. Falls to `version`, which the record does not have, so nothing is claimed.
	assert.equal(isOutdated(installed({ commit: "aaa" }), { version: "1.0.0" }), false);
	// And the reverse, which is what a registry that started publishing commits looks like on the
	// first visit after an upgrade. Falls to version, where both sides agree.
	assert.equal(isOutdated(installed({ version: "1.0.0" }), { commit: "bbb", version: "1.0.0" }), false);
});

test("一个大仓库里的子目录：仓库动了、它的版本没动，不算更新", () => {
	// 默认市场的 MCP 包装都在同一个仓库里：别的包装一改，这一个的提交也跟着变。
	const record = installed({ commit: "aaa", version: "4.1.1" });
	assert.equal(isOutdated(record, { commit: "bbb", version: "4.1.1", path: "plugins/context7" }), false);
	assert.equal(isOutdated(record, { commit: "bbb", version: "4.1.2", path: "plugins/context7" }), true, "版本动了就是更新");
	// 由提交派生出来的版本号还是那个提交，照旧按提交判断。
	assert.equal(isOutdated(installed({ commit: "aaa", version: "0.0.0-aaa1234" }), { commit: "bbb", version: "0.0.0-aaa1234", path: "skills" }), true);
	// 整个仓库就是这一个包：提交就是它自己的，照旧按提交。
	assert.equal(isOutdated(record, { commit: "bbb", version: "4.1.1" }), true);
});
