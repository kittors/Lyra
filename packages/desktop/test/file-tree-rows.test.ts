/**
 * How the file tree arranges itself, as rules rather than as a rendering.
 *
 * The one that matters most is the one that says nothing changed: a project with a single source
 * folder — almost every project — must draw exactly what it always drew, straight into that
 * folder's contents with no row naming the folder itself. Multi-folder support that quietly added
 * a level of nesting to everyone's tree would be a regression dressed as a feature.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import type { FileEntry } from "../electron/ipc-types.ts";
import { treeRows } from "../src/features/files/useFileTree.ts";

const APP = "/Users/x/app";
const API = "/Users/x/api";

function file(dir: string, name: string): FileEntry {
	return { name, path: `${dir}/${name}`, isDirectory: false, size: 1 };
}

function dir(parent: string, name: string): FileEntry {
	return { name, path: `${parent}/${name}`, isDirectory: true, size: 0 };
}

const children: Record<string, FileEntry[]> = {
	[APP]: [dir(APP, "src"), file(APP, "README.md")],
	[`${APP}/src`]: [file(`${APP}/src`, "index.ts")],
	[API]: [dir(API, "src"), file(API, "server.ts")],
	[`${API}/src`]: [file(`${API}/src`, "routes.ts")],
};

function rows(over: Partial<Parameters<typeof treeRows>[0]> = {}) {
	return treeRows({ roots: [APP], scope: null, children, expanded: new Set(), filter: "", ...over });
}

function shown(list: ReturnType<typeof treeRows>) {
	return list.map(({ entry, depth }) => `${"  ".repeat(depth)}${entry.name}`);
}

// ---------------------------------------------------------------- one folder, unchanged

test("one source folder opens straight into its contents", () => {
	assert.deepEqual(shown(rows()), ["src", "README.md"]);
});

test("one source folder still nests what you open", () => {
	assert.deepEqual(shown(rows({ expanded: new Set([`${APP}/src`]) })), ["src", "  index.ts", "README.md"]);
});

test("nothing loaded yet is no rows, not a row saying so", () => {
	assert.deepEqual(rows({ roots: [] }), []);
	assert.deepEqual(rows({ children: {} }), []);
});

// ---------------------------------------------------------------- several folders

test("several source folders each get a row, in the order they are configured", () => {
	assert.deepEqual(shown(rows({ roots: [APP, API] })), ["app", "api"]);
});

test("an opened source folder shows its contents one level in", () => {
	assert.deepEqual(shown(rows({ roots: [APP, API], expanded: new Set([APP]) })), ["app", "  src", "  README.md", "api"]);
});

test("the source folder rows are directories, so they can be opened", () => {
	const [first] = rows({ roots: [APP, API] });
	assert.equal(first.entry.isDirectory, true);
	assert.equal(first.entry.path, APP, "the row has to carry the absolute path, or opening it loads nothing");
});

// ---------------------------------------------------------------- filtering

test("a filter reaches into every source folder without either being opened first", () => {
	assert.deepEqual(shown(rows({ roots: [APP, API], filter: "routes" })), ["api", "  src", "    routes.ts"]);
});

/*
 * A folder with nothing matching under it does not get a row.
 *
 * The same rule `walk` applies one level down. Keeping the row would mean typing a name and
 * getting back every source folder you have, each of them empty.
 */
test("a source folder with no match is left out entirely", () => {
	assert.deepEqual(shown(rows({ roots: [APP, API], filter: "README" })), ["app", "  README.md"]);
});

test("a filter matching nothing anywhere gives no rows", () => {
	assert.deepEqual(rows({ roots: [APP, API], filter: "nothing-like-this" }), []);
});

// ---------------------------------------------------------------- 在此文件夹中搜索

/*
 * A scope replaces the roots rather than filtering them.
 *
 * 在此文件夹中搜索 answers "only inside this one", and the row naming that folder is already drawn
 * above the tree by `FileTree`. Drawing it again at the top of the list would be saying it twice.
 */
test("a scope narrows to one folder and opens straight into it", () => {
	assert.deepEqual(shown(rows({ roots: [APP, API], scope: API })), ["src", "server.ts"]);
});
