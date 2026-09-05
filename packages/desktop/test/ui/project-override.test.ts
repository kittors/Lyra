/**
 * The project layer, said out loud on the page it affects (14 §3).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import { brief, LayerCard, OverrideNotice } from "../../src/features/settings/ProjectOverrideNotice.tsx";
import { mount } from "../helpers/mount.ts";

const VIEW = {
	path: "/repo/.lyra/config.json",
	exists: true,
	refused: ["mcpServers"],
	overrides: [
		{ key: "disabledRules", kind: "array" as const, project: ["verify-before-yield"], global: ["no-force-push"] },
		{ key: "approval.bash", kind: "scalar" as const, project: "allow", global: "prompt" },
	],
};

test("a page shows only the keys it owns, with the global value marked as not applying", async () => {
	const view = await mount(h(OverrideNotice, { view: VIEW, keys: ["disabledRules", "enabledForeignUserRules"] }));
	assert.equal(view.all("[data-project-override-key]").length, 1);
	const row = view.find("[data-project-override-key]");
	assert.equal(row.dataset.projectOverrideKey, "disabledRules");
	assert.match(row.textContent ?? "", /\["no-force-push"\].*不生效.*整体替换.*\["verify-before-yield"\]/);
	assert.match(view.find("[data-project-override-path]").textContent ?? "", /config\.json$/);
	await view.unmount();
});

test("a nested scalar is matched by its top-level key, and a refused key is explained", async () => {
	const approval = await mount(h(OverrideNotice, { view: VIEW, keys: ["approval"] }));
	assert.match(approval.find("[data-project-override-key]").textContent ?? "", /approval\.bash.*"prompt".*覆盖为.*"allow"/);
	await approval.unmount();

	const mcp = await mount(h(OverrideNotice, { view: VIEW, keys: ["mcpServers"] }));
	assert.equal(mcp.all("[data-project-override-key]").length, 0);
	assert.match(mcp.find("[data-project-refused-key]").textContent ?? "", /mcpServers.*不允许放在仓库里/);
	await mcp.unmount();
});

test("a page whose keys the project does not touch shows nothing", async () => {
	const view = await mount(h(OverrideNotice, { view: VIEW, keys: ["hooks"] }));
	assert.equal(view.text(), "");
	await view.unmount();
});

test("the general page lists everything, project value above the global one it displaced", async () => {
	const view = await mount(h(LayerCard, { view: VIEW }));
	assert.equal(view.all("[data-project-layer-key]").length, 2);
	assert.match(view.text(), /项目值 \["verify-before-yield"\].*全局值 \["no-force-push"\].*⚠ 被项目值整体替换，不生效/);
	assert.equal(view.all("[data-project-layer-refused]").length, 1);
	await view.unmount();
});

test("values are shown as written, cut short rather than dumped", () => {
	assert.equal(brief(["a", "b"]), '["a","b"]');
	assert.equal(brief("x".repeat(200)).length, 96);
	assert.ok(brief("x".repeat(200)).endsWith("…"));
});
