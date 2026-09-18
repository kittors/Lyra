import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSessionImageUrl, SESSION_THUMB_EDGE, sessionImageUrl, sessionMediaUrl } from "../shared/session-image.ts";

test("session image URLs round-trip project, session, timestamp and index", () => {
	const href = sessionImageUrl("projA", "sess-1", 1_700_000_000_123, 2, SESSION_THUMB_EDGE);
	const parsed = parseSessionImageUrl(href);
	assert.deepEqual(parsed, {
		projectId: "projA",
		sessionId: "sess-1",
		timestamp: 1_700_000_000_123,
		imageIndex: 2,
		thumb: SESSION_THUMB_EDGE,
	});
	assert.equal(parseSessionImageUrl(sessionImageUrl("p", "s", 1, 0))?.thumb, null);
	assert.equal(parseSessionImageUrl("ly-media://f/not-an-image"), null);
	assert.match(sessionMediaUrl("abc.png", SESSION_THUMB_EDGE), /^ly-media:\/\/m\/abc\.png\?thumb=128$/);
});
