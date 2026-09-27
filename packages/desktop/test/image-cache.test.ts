/**
 * The market's icons, kept on disk between launches.
 *
 * What matters is what a later launch gets back: the same picture, whether it is old enough to be
 * fetched again behind the answer, and that the directory does not grow without end.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { diskImageStore } from "../electron/image-cache.ts";

const PICTURE = "data:image/webp;base64,UklGRg==";

async function scratch(): Promise<string> {
	return mkdtemp(join(tmpdir(), "lyra-image-cache-"));
}

test("a kept picture comes back on the next launch, and is not stale while it is new", async () => {
	const dir = await scratch();
	try {
		await diskImageStore(dir).write("https://market/v1/icon/context7", PICTURE);
		const later = diskImageStore(dir);
		assert.deepEqual(await later.read("https://market/v1/icon/context7"), { value: PICTURE, stale: false });
		assert.equal(await later.read("https://market/v1/icon/unknown"), null);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("a picture fetched more than an hour ago is still answered, and marked for fetching again", async () => {
	const dir = await scratch();
	try {
		const store = diskImageStore(dir, () => Date.now() + 2 * 60 * 60 * 1000);
		await store.write("https://market/v1/icon/exa", PICTURE);
		assert.deepEqual(await store.read("https://market/v1/icon/exa"), { value: PICTURE, stale: true });
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("a file that is not a picture is not answered as one", async () => {
	const dir = await scratch();
	try {
		const store = diskImageStore(dir);
		await store.write("https://market/v1/icon/x", PICTURE);
		const [name] = await readdir(dir);
		await writeFile(join(dir, name!), "<html>not a picture</html>");
		assert.equal(await store.read("https://market/v1/icon/x"), null);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("past the limit, the pictures fetched longest ago are the ones dropped", async () => {
	const dir = await scratch();
	try {
		const store = diskImageStore(dir, Date.now, 3);
		for (const id of ["a", "b", "c", "d"]) await store.write(`https://market/v1/icon/${id}`, PICTURE);
		// Two of them fetched ten days ago.
		const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
		for (const id of ["a", "b"]) await utimes(fileOf(dir, `https://market/v1/icon/${id}`), old, old);
		// Enough further writes that the store looks at its size again.
		for (let i = 0; i < 25; i++) await store.write(`https://market/v1/icon/e${i}`, PICTURE);

		assert.equal(await store.read("https://market/v1/icon/a"), null, "the oldest went first");
		assert.equal(await store.read("https://market/v1/icon/b"), null);
		assert.ok((await readdir(dir)).length < 29, "and the directory was cut back");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

/** Where the store keeps a URL's picture — the same naming as `diskImageStore`. */
function fileOf(dir: string, url: string): string {
	return join(dir, createHash("sha256").update(url).digest("hex").slice(0, 32));
}
