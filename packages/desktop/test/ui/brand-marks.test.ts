/**
 * Model and code-host marks come from their vendors' files, not from drawings of them.
 *
 * Six model marks were placeholders — a speech bubble for Doubao, three bars for MiniMax, a
 * hexagon for Baichuan, all in Tailwind's palette — and two of four code hosts wore someone else's
 * mark. Each replaced mark is pinned here to its source: the start of the vendor's path, or the
 * vendor's own icon file embedded as an image where no vector is published.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { ModelIcon } from "../../src/features/models/ModelIcon.tsx";
import { ForgeBrandIcon } from "../../src/features/settings/ForgeBrandIcon.tsx";
import { mount } from "../helpers/mount.ts";

const pathsOf = (svg: Element) => [...svg.querySelectorAll("path")].map((path) => path.getAttribute("d") ?? "");

test("model marks: vectors start with the vendor's path, the rest embed the vendor's icon file", async () => {
	const view = await mount(
		h(
			"div",
			null,
			...["kimi-k2", "doubao-seed-1.6", "MiniMax-M2", "step-3", "Baichuan4", "yi-lightning"].map((model) => h(ModelIcon, { model, key: model })),
		),
	);
	const mark = (brand: string) => view.find(`[data-model-brand="${brand}"]`);

	assert.ok(pathsOf(mark("minimax")).some((d) => d.startsWith("M17.5802 3.08155C17.5802 2.35036")));
	assert.match(mark("minimax").innerHTML, /#E21680/);
	assert.ok(pathsOf(mark("stepfun")).some((d) => d.startsWith("M10,0C4.48,0,0,4.48,0,10s4.48,10")));
	assert.equal(mark("stepfun").querySelectorAll("rect").length, 5);

	// Asset imports are empty strings under test (see `helpers/assets-hooks.mjs`), so what is checked
	// is the shape: the vendor's file as an image, and nothing drawn beside it.
	for (const brand of ["doubao", "baichuan", "yi"]) {
		assert.equal(mark(brand).querySelectorAll("image").length, 1, `${brand} embeds one icon`);
		assert.equal(mark(brand).querySelectorAll("path").length, 0, `${brand} draws nothing of its own`);
	}
	// Two files for Kimi, one per theme; the light one shows unless the root is dark.
	const kimi = [...mark("kimi").querySelectorAll("image")];
	assert.equal(kimi.length, 2);
	assert.deepEqual(kimi.map((image) => image.getAttribute("class")), ["dark:hidden", "hidden dark:inline"]);

	for (const brand of ["kimi", "doubao", "minimax", "stepfun", "baichuan", "yi"]) {
		assert.ok(!/#3B82F6|#EF4444|#10B981|#F97316/i.test(mark(brand).innerHTML), `${brand} carries no placeholder palette colour`);
	}
	await view.unmount();
});

test("code-host marks: each host carries its own", async () => {
	const view = await mount(h("div", null, ...["github", "gitlab", "gitee", "gitea"].map((kind) => h("span", { key: kind, "data-kind": kind }, h(ForgeBrandIcon, { kind })))));
	const svg = (kind: string) => view.find(`[data-kind="${kind}"] svg`);

	assert.ok(pathsOf(svg("github")).some((d) => d.startsWith("M6.766 11.328c-2.063-.25")));
	assert.ok(pathsOf(svg("gitlab")).some((d) => d.startsWith("M31.462 12.779l-.045-.115")));
	assert.match(svg("gitlab").innerHTML, /#E24329/);
	assert.equal(svg("gitee").querySelector("circle")?.getAttribute("fill"), "#C71D23");
	assert.ok(pathsOf(svg("gitee")).some((d) => d.startsWith("M67.558546,39.8714292")));
	assert.ok(pathsOf(svg("gitea")).some((d) => d.startsWith("M622.7 149.8c-4.1-4.1")));
	// Gitee used to be GitHub's octocat in another colour.
	assert.ok(!pathsOf(svg("gitee")).some((d) => d.startsWith("M11.999 0C5.373 0")));
	await view.unmount();
});
