import assert from "node:assert/strict";
import { test } from "node:test";
import { savedTerminal, useTerminals } from "../../src/store/terminals.ts";

test("opening and selecting a shell in one tile leaves the other tile on its shell", () => {
	window.localStorage.clear();
	useTerminals.setState({ tabs: [], active: "", activeByScope: {} });
	const state = useTerminals.getState();
	state.add({ id: "shell-a", title: "A" }, "a");
	state.add({ id: "shell-b", title: "B" }, "b");
	state.add({ id: "shell-b2", title: "B2" }, "b");
	assert.deepEqual(useTerminals.getState().activeByScope, { a: "shell-a", b: "shell-b2" });
	state.select("shell-b", "b");
	assert.equal(useTerminals.getState().activeByScope.a, "shell-a");
	assert.equal(savedTerminal("b"), "shell-b");
	state.remove("shell-b");
	assert.deepEqual(useTerminals.getState().activeByScope, { a: "shell-a", b: "" });
	state.sync([{ id: "shell-b2", title: "B2" }]);
	assert.equal(useTerminals.getState().activeByScope.a, undefined);
});
