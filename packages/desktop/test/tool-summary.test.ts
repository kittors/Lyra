import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeToolCall } from "../src/lib/tool-summary.ts";

test("summarizeToolCall handles missing and alias arguments without displaying 'undefined'", () => {
	// grep
	assert.equal(summarizeToolCall("grep", { pattern: "myFunc" }), 'Search "myFunc"');
	assert.equal(summarizeToolCall("grep", { query: "myFunc" }), 'Search "myFunc"');
	assert.equal(summarizeToolCall("grep", { search: "myFunc" }), 'Search "myFunc"');
	assert.equal(summarizeToolCall("grep", {}), "Search");

	// glob
	assert.equal(summarizeToolCall("glob", { pattern: "*.ts" }), "Find *.ts");
	assert.equal(summarizeToolCall("glob", { query: "*.ts" }), "Find *.ts");
	assert.equal(summarizeToolCall("glob", {}), "Find files");

	// read
	assert.equal(summarizeToolCall("read", { path: "src/index.ts" }), "Read src/index.ts");
	assert.equal(summarizeToolCall("read", { file: "src/index.ts" }), "Read src/index.ts");
	assert.equal(summarizeToolCall("read", {}), "Read file");

	// symbol
	assert.equal(summarizeToolCall("symbol", { name: "AppState" }), "Find definition of AppState");
	assert.equal(summarizeToolCall("symbol", { query: "AppState" }), "Find definition of AppState");
	assert.equal(summarizeToolCall("symbol", {}), "Find definition");

	// web_search
	assert.equal(summarizeToolCall("web_search", { query: "react hooks" }), "Search react hooks");
	assert.equal(summarizeToolCall("web_search", { pattern: "react hooks" }), "Search react hooks");
	assert.equal(summarizeToolCall("web_search", {}), "Search the web");
});
