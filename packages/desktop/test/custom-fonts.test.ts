import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, link, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { CustomFontStore } from "../electron/custom-fonts.ts";
import { MAX_FONT_SIZE, validateFont } from "../electron/font-validation.ts";
import { hasCode } from "../electron/custom-font-files.ts";
import type { ImportedFont } from "../shared/custom-fonts.ts";
import { fontFixture } from "./helpers/font-fixtures.ts";

async function fixture(t: TestContext) {
	const root = await realpath(await mkdtemp(join(tmpdir(), "lyra-custom-fonts-")));
	t.after(() => rm(root, { recursive: true, force: true }));
	const userData = join(root, "profile");
	await mkdir(userData);
	const store = new CustomFontStore(userData);
	async function source(name = "Example.ttf", bytes = fontFixture("ttf")) {
		const path = join(root, name);
		await writeFile(path, bytes);
		return path;
	}
	return { root, userData, store, source };
}

async function fileSymlink(t: TestContext, target: string, path: string): Promise<boolean> {
	try {
		await symlink(target, path, "file");
		return true;
	} catch (error) {
		if (process.platform !== "win32" || (!hasCode(error, "EPERM") && !hasCode(error, "EACCES"))) throw error;
		t.skip("File symlinks require Windows developer mode or elevated privileges");
		return false;
	}
}

const formats: ImportedFont["format"][] = ["ttf", "otf", "woff", "woff2"];
for (const format of formats) {
	test(`imports ${format}, persists its name and restores list/read after restart`, async (t) => {
		const { userData, store, source } = await fixture(t);
		assert.deepEqual(await store.list(), []);
		const bytes = fontFixture(format);
		const path = await source(`My font.${format.toUpperCase()}`, bytes);
		const imported = await store.importFile(path);
		const id = createHash("sha256").update(bytes).digest("hex");
		assert.deepEqual(imported, {
			id, name: "My font", family: `Lyra Imported ${id}`, format, size: bytes.length,
			data: `data:font/${format};base64,${bytes.toString("base64")}`,
		});
		await rm(path);
		const restarted = new CustomFontStore(userData);
		assert.deepEqual(await restarted.read(id), imported);
		assert.deepEqual(await restarted.list(), [{ id, name: imported.name, family: imported.family, format, size: bytes.length }]);
		assert.deepEqual(await readdir(join(userData, "fonts")), [id]);
	});
}

test("content deduplication preserves the first name across instances and concurrent imports", async (t) => {
	const { userData, store, source } = await fixture(t);
	const firstPath = await source("First.ttf");
	const secondPath = await source("Second.ttf");
	const other = new CustomFontStore(userData);
	const imported = await Promise.all(Array.from({ length: 12 }, (_, index) =>
		(index % 2 ? store : other).importFile(index % 2 ? firstPath : secondPath)));
	for (const font of imported) assert.deepEqual(font, imported[0]);
	assert.deepEqual(await store.importFile(firstPath), imported[0]);
	assert.deepEqual(await store.importFile(secondPath), imported[0]);
	assert.equal((await store.list()).length, 1);
	assert.deepEqual(await readdir(join(userData, "fonts")), [imported[0].id]);
});

test("distinct concurrent imports publish complete independent entries", async (t) => {
	const { store, source } = await fixture(t);
	const paths = await Promise.all(formats.map((format) => source(`Font.${format}`, fontFixture(format))));
	const imported = await Promise.all(paths.map((path) => store.importFile(path)));
	assert.equal((await store.list()).length, formats.length);
	for (const font of imported) assert.deepEqual(await store.read(font.id), font);
});

test("rejects empty, oversized, disguised and unsupported files without creating entries", async (t) => {
	const { store, source } = await fixture(t);
	const invalid = [
		await source("Empty.ttf", Buffer.alloc(0)),
		await source("Text.ttf", Buffer.from("not a font")),
		await source("Disguised.otf", fontFixture("ttf")),
		await source("Font.txt", fontFixture("ttf")),
	];
	for (const path of invalid) await assert.rejects(store.importFile(path));
	const large = await source("Large.ttf");
	const file = await open(large, "r+");
	try { await file.truncate(MAX_FONT_SIZE + 1); } finally { await file.close(); }
	await assert.rejects(store.importFile(large), /size/iu);
	assert.deepEqual(await store.list(), []);
});

test("accepts exactly 32 MiB and rejects one extra byte", () => {
	const bytes = Buffer.alloc(MAX_FONT_SIZE);
	fontFixture("ttf").copy(bytes);
	assert.equal(validateFont(bytes, "ttf"), "ttf");
	assert.throws(() => validateFont(Buffer.alloc(MAX_FONT_SIZE + 1), "ttf"), /32 MiB/iu);
});

test("rejects signature-only headers, missing tables, invalid ranges and bad compression", () => {
	for (const format of formats) {
		const bytes = fontFixture(format);
		assert.throws(() => validateFont(bytes.subarray(0, format === "ttf" || format === "otf" ? 12 : 48), format), /Invalid font/iu);
		const badSignature = Buffer.from(bytes);
		badSignature.fill(0, 0, 4);
		assert.throws(() => validateFont(badSignature, format), /Invalid font/iu);
	}
	const missing = fontFixture("ttf");
	missing.write("xxxx", 12, "ascii");
	assert.throws(() => validateFont(missing, "ttf"), /Invalid font/iu);
	const range = fontFixture("ttf");
	range.writeUInt32BE(0xfffffff0, 20);
	assert.throws(() => validateFont(range, "ttf"), /Invalid font/iu);
	const overlap = fontFixture("ttf");
	overlap.writeUInt32BE(overlap.readUInt32BE(20), 36);
	assert.throws(() => validateFont(overlap, "ttf"), /Invalid font/iu);
	const woff = fontFixture("woff");
	woff.writeUInt32BE(MAX_FONT_SIZE + 1, 56);
	assert.throws(() => validateFont(woff, "woff"), /Invalid font/iu);
	const woff2 = fontFixture("woff2");
	woff2.fill(0xff, 48 + woff2.readUInt16BE(12) * 2);
	assert.throws(() => validateFont(woff2, "woff2"), /Invalid font/iu);
});

test("only hash ids are accepted; paths and unknown ids cannot read arbitrary files", async (t) => {
	const { root, store, source } = await fixture(t);
	const path = await source();
	for (const id of ["", "..", "../Example.ttf", path, "a".repeat(63), "A".repeat(64), `a/${"b".repeat(64)}`, "\0"]) {
		await assert.rejects(store.read(id), /Invalid imported font id/u);
	}
	await assert.rejects(store.read("0".repeat(64)), { code: "ENOENT" });
	await assert.rejects(store.importFile("Example.ttf"), /path/iu);
	await assert.rejects(store.importFile(root), /regular file/iu);
});

test("rejects selected file symlinks and hard links", async (t) => {
	const { root, store, source } = await fixture(t);
	const original = await source();
	const linked = join(root, "Linked.ttf");
	await link(original, linked);
	await assert.rejects(store.importFile(linked), /regular file/iu);
	await rm(linked);
	if (!await fileSymlink(t, original, linked)) return;
	await assert.rejects(store.importFile(linked), /symbolic links/iu);
});

test("rejects linked source ancestors and linked storage roots", async (t) => {
	const { root, userData, store, source } = await fixture(t);
	const path = await source();
	const outside = join(root, "outside");
	await mkdir(outside);
	await copyFile(path, join(outside, "Example.ttf"));
	const linked = join(root, "linked");
	await symlink(outside, linked, process.platform === "win32" ? "junction" : "dir");
	await assert.rejects(store.importFile(join(linked, "Example.ttf")), /symbolic links/iu);
	await symlink(outside, join(userData, "fonts"), process.platform === "win32" ? "junction" : "dir");
	await assert.rejects(store.list(), /Unsafe font directory/u);
	await assert.rejects(store.importFile(path), /Unsafe font directory/u);
	assert.deepEqual(await readdir(outside), ["Example.ttf"]);
});

test("rejects linked stored entries without touching the target", async (t) => {
	const { root, userData, store, source } = await fixture(t);
	const font = await store.importFile(await source());
	const entry = join(userData, "fonts", font.id);
	const outside = join(root, "moved-entry");
	await rename(entry, outside);
	await symlink(outside, entry, process.platform === "win32" ? "junction" : "dir");
	await assert.rejects(store.read(font.id), /Unsafe font directory/u);
	await assert.rejects(store.list(), /unsafe/iu);
	await assert.rejects(store.importFile(await source()), /Unsafe font directory/u);
	assert.equal((await readFile(join(outside, "font.bin"))).length, font.size);
});

test("rejects linked stored resources and metadata", async (t) => {
	const { root, userData, store, source } = await fixture(t);
	const font = await store.importFile(await source());
	for (const name of ["font.bin", "metadata.json"]) {
		const path = join(userData, "fonts", font.id, name);
		const outside = join(root, name);
		await rename(path, outside);
		if (!await fileSymlink(t, outside, path)) return;
		await assert.rejects(store.read(font.id), /regular file/iu);
		await rm(path);
		await rename(outside, path);
	}
});

test("rejects damaged metadata and resources instead of silently replacing them", async (t) => {
	const { userData, store, source } = await fixture(t);
	const path = await source();
	const font = await store.importFile(path);
	const directory = join(userData, "fonts", font.id);
	const metadataPath = join(directory, "metadata.json");
	const original = await readFile(metadataPath);
	await writeFile(metadataPath, JSON.stringify({ ...font, family: "Other family", data: "ignored" }));
	await assert.rejects(store.read(font.id), /metadata/iu);
	await assert.rejects(store.importFile(path), /metadata/iu);
	await writeFile(metadataPath, original);
	const bytes = fontFixture("ttf");
	bytes[bytes.length - 1] ^= 1;
	await writeFile(join(directory, "font.bin"), bytes);
	await assert.rejects(store.read(font.id), /integrity/iu);
	await rm(join(directory, "font.bin"));
	await assert.rejects(store.importFile(path), /incomplete/iu);
});

test("ignores unpublished transactions after a restart", async (t) => {
	const { userData, store } = await fixture(t);
	assert.deepEqual(await store.list(), []);
	const pending = join(userData, "fonts", ".import-interrupted");
	await mkdir(pending);
	await writeFile(join(pending, "font.bin"), fontFixture("ttf"));
	assert.deepEqual(await new CustomFontStore(userData).list(), []);
	assert.deepEqual(await readdir(pending), ["font.bin"]);
});
