import assert from "node:assert/strict";
import { test } from "node:test";
import { fileLinkCaption } from "../src/lib/markdown/file-link.ts";

test("path-like labels keep the filename and put the path on the tooltip", () => {
	const long = "docs/issue/2026-09-16-2220-01-tasklist-false-paused-on-unfinished-plan.md";
	assert.deepEqual(fileLinkCaption(long, `/tmp/${long}`), {
		text: "2026-09-16-2220-01-tasklist-false-paused-on-unfinished-plan.md",
		tip: long,
	});
});

test("a human label stays on the chip", () => {
	assert.deepEqual(fileLinkCaption("实现说明", "/project/docs/result.md"), {
		text: "实现说明",
		tip: "/project/docs/result.md",
	});
});

test("a bare filename is left alone", () => {
	assert.deepEqual(fileLinkCaption("README.md", "/project/README.md"), {
		text: "README.md",
		tip: "README.md",
	});
});
