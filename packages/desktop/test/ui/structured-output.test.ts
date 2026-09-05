/**
 * A sub-agent's structured reply, drawn by its shape and never as JSON (16 §6.1).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import { StructuredOutput } from "../../src/features/subagents/StructuredOutput.tsx";
import { click, mount } from "../helpers/mount.ts";

test("the verify agent's reply: a flag, a sentence, a command, a table of failures", async () => {
	const view = await mount(
		h(StructuredOutput, {
			output: {
				passed: false,
				summary: "node --test: 3 passed, 1 failed",
				command: "node --test test/*.test.ts",
				failures: [{ name: "adds", location: "test/math.test.ts:12", message: "expected 4, got 5" }],
			},
		}),
	);
	assert.ok(!view.text().includes("{"), `no braces: ${view.text()}`);
	assert.equal(view.find("[data-field=passed]").dataset.kind, "flag");
	assert.match(view.find("[data-field=passed]").textContent ?? "", /否/);
	assert.equal(view.find("[data-field=failures]").dataset.kind, "table");
	const headers = view.all("[data-field=failures] th").map((th) => th.textContent);
	assert.deepEqual(headers, ["name", "location", "message"]);
	assert.match(view.find("[data-field=failures] td:nth-child(2)").className, /font-mono/, "a location is drawn as a path");
	await view.unmount();
});

test("findings are grouped by severity, worst first; the plan agent's lists are lists", async () => {
	const view = await mount(
		h(StructuredOutput, {
			output: {
				findings: [
					{ severity: "low", file: "a.ts", line: 3, why: "nit" },
					{ severity: "high", file: "b.ts", line: 9, why: "leak" },
					{ severity: "low", file: "c.ts", line: 1, why: "style" },
				],
				steps: [{ what: "改导出", files: ["src/a.ts", "src/b.ts"] }],
				risks: ["调用点漏改"],
				unknowns: [],
			},
		}),
	);
	assert.equal(view.find("[data-field=findings]").dataset.kind, "grouped");
	assert.deepEqual(
		view.all<HTMLElement>("[data-severity]").map((group) => [group.dataset.severity, group.querySelectorAll("tbody tr").length]),
		[
			["high", 1],
			["low", 2],
		],
	);
	assert.equal(view.find("[data-field=risks]").dataset.kind, "list");
	assert.match(view.find("[data-field=risks]").textContent ?? "", /调用点漏改/);
	assert.match(view.find("[data-field=unknowns]").textContent ?? "", /无/, "an empty list says so instead of vanishing");
	assert.match(view.find("[data-field=steps] td:nth-child(2)").textContent ?? "", /src\/a\.ts、src\/b\.ts/);
	await view.unmount();
});

test("a long text folds, and unfolds on request", async () => {
	const report = "第一行\n".repeat(40);
	const view = await mount(h(StructuredOutput, { output: { report } }));
	assert.equal(view.find("[data-field=report]").dataset.kind, "long-text");
	assert.equal(view.all("pre").length, 0, "folded by default");
	await click(view.find("[data-field=report] button"));
	assert.equal(view.all("pre").length, 1);
	await view.unmount();
});
