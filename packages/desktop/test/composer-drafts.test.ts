import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { useApp } from "../src/store/index.ts";

describe("composer drafts per session / blank context", () => {
	it("saves and restores drafts per session and blank key", () => {
		const state = useApp.getState();

		// 1. Start with no drafts
		assert.deepEqual(state.drafts, {});

		// 2. Set draft for a blank scratch session
		state.setDraft("new:scratch:general", { text: "draft in scratch", attachments: [] });
		assert.equal(useApp.getState().drafts["new:scratch:general"]?.text, "draft in scratch");

		// 3. Set draft for a project blank session
		state.setDraft("new:project:/path/to/repo", { text: "draft in project", attachments: [] });
		assert.equal(useApp.getState().drafts["new:project:/path/to/repo"]?.text, "draft in project");

		// 4. Set draft for an existing session
		state.setDraft("session-123", { text: "draft in session-123", attachments: [] });
		assert.equal(useApp.getState().drafts["session-123"]?.text, "draft in session-123");

		// 5. Scratch draft is intact
		assert.equal(useApp.getState().drafts["new:scratch:general"]?.text, "draft in scratch");

		// 6. Clearing a draft deletes its key
		state.setDraft("new:scratch:general", null);
		assert.equal(useApp.getState().drafts["new:scratch:general"], undefined);
		assert.equal(useApp.getState().drafts["session-123"]?.text, "draft in session-123");
	});
});
