/**
 * The market's index, kept on disk between launches.
 *
 * Three rules, and the third is the one that matters most. The page, opening for the first time in a
 * launch, may be answered with the copy kept from the last one — marked `stale`, so it knows to ask
 * again. Every good fetch replaces that copy. And the update check is never answered from it: an
 * install decided from a catalogue that may be a day old is an install nobody asked for.
 */

import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, mock, test } from "node:test";

let home = "";
let online = true;

before(async () => {
	home = await mkdtemp(join(tmpdir(), "lyra-index-kept-"));
	process.env.LYRA_HOME = home;
	mock.method(globalThis, "fetch", async () => {
		if (!online) throw new TypeError("fetch failed");
		return new Response(JSON.stringify({ name: "Test market", plugins: [{ id: "context7", name: "Context7", repository: "https://github.com/upstash/context7" }] }), {
			headers: { "content-type": "application/json" },
		});
	});
});

after(async () => {
	mock.restoreAll();
	await rm(home, { recursive: true, force: true });
});

/** A fresh copy of the module: what a new launch starts with — nothing in memory, the disk as it was left. */
async function launch(n: number): Promise<typeof import("../electron/plugin-index.ts")> {
	return import(`../electron/plugin-index.ts?launch=${n}`);
}

const URL = "https://market.test/v1/index";

/** Until the kept copy is on disk. */
async function settled(): Promise<void> {
	for (let i = 0; i < 50; i++) {
		if ((await readdir(join(home, "cache", "registries")).catch(() => [])).length > 0) return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error("the index was never kept");
}

test("a first fetch answers fresh and leaves a copy for the next launch", async () => {
	online = true;
	const first = await launch(1);
	const answer = await first.readRegistry(URL, false, undefined, true);
	assert.ok(answer.ok);
	assert.equal(answer.ok && answer.stale, undefined, "straight from the network, not stale");
	// The copy is written behind the answer; a real next launch is seconds away, this one is not.
	await settled();

	online = false;
	const next = await launch(2);
	const kept = await next.readRegistry(URL, false, undefined, true);
	assert.ok(kept.ok, "the next launch has something to show without the network");
	assert.equal(kept.ok && kept.stale, true);
	assert.deepEqual(kept.ok && kept.registry.entries.map((entry) => entry.id), ["context7"]);
});

test("the update check is never answered from the kept copy", async () => {
	online = false;
	const later = await launch(3);
	const answer = await later.readRegistry(URL);
	assert.equal(answer.ok, false, "offline, with nothing fetched this launch, the check reports the failure");
});

test("a page that asks for the fresh copy after the kept one gets it from the network", async () => {
	online = true;
	const later = await launch(4);
	const kept = await later.readRegistry(URL, false, undefined, true);
	assert.equal(kept.ok && kept.stale, true);
	const fresh = await later.readRegistry(URL, false, undefined, false);
	assert.ok(fresh.ok);
	assert.equal(fresh.ok && fresh.stale, undefined);
});
