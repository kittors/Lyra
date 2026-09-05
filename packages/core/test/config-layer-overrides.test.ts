/**
 * 「被项目值整体替换，不生效」：哪些键要在设置页上说出来（14 §3）。
 *
 * 数组整体替换是对的选择（追加语义没法表达「去掉一项」），也是 omp 文档里叫「最常见的意外」的
 * 那条。GUI 相对配置文件的优势就在这：能把被替换的全局值摆出来，而不是在文档里警告。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { layerOverrides, mergeLayer } from "../src/config/layers.ts";

test("an array set by the project replaces the global one, and both sides are reported", () => {
	const out = layerOverrides({ disabledRules: ["no-force-push"], alwaysAllow: ["bash"] }, { disabledRules: ["verify-before-yield"] });
	assert.deepEqual(out, [{ key: "disabledRules", kind: "array", project: ["verify-before-yield"], global: ["no-force-push"] }]);
});

test("objects merge, so only the leaves inside them are overrides — with dotted keys", () => {
	const global = { approval: { bash: "prompt", read: "allow" } };
	const project = { approval: { bash: "allow" } };
	assert.deepEqual(layerOverrides(global, project), [{ key: "approval.bash", kind: "scalar", project: "allow", global: "prompt" }]);
	assert.deepEqual(mergeLayer(global, project), { approval: { bash: "allow", read: "allow" } }, "and the merge itself keeps `read`");
});

test("a key the global layer never set, or set to the same value, is not an override", () => {
	assert.deepEqual(layerOverrides({}, { disabledRules: ["x"] }), [], "nothing was lost");
	assert.deepEqual(layerOverrides({ disabledRules: ["x"] }, { disabledRules: ["x"] }), [], "nothing changed");
	assert.deepEqual(layerOverrides({ thinking: "off" }, { thinking: undefined }), [], "undefined is absence");
});

test("a scalar counts too — a project setting permissionMode silently wins over the page", () => {
	assert.deepEqual(layerOverrides({ permissionMode: "prompt" }, { permissionMode: "full" }), [
		{ key: "permissionMode", kind: "scalar", project: "full", global: "prompt" },
	]);
});
