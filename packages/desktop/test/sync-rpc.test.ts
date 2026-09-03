/**
 * What the phone is allowed to ask the desktop to do.
 *
 * This list is the security boundary. Whoever holds the pairing token can call anything on it, so
 * what is *absent* matters more than what is present: a shell, arbitrary file writes, the screen.
 * A test that only checked the allowed calls would pass just as happily on a list that allowed
 * everything, so most of what follows is about the omissions.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { allowedMethods, callRpc, RPC, type RpcDeps } from "../electron/sync-rpc.ts";
import { DEFAULT_SETTINGS } from "@lyra/core";

/** Deps that record what was asked of them, so a call can be traced without a real session. */
function deps(overrides: Partial<RpcDeps> = {}): RpcDeps {
	return {
		store: () => ({ listSessions: async () => [], load: async () => null }) as never,
		settings: () => DEFAULT_SETTINGS,
		saveSettings: async () => {},
		workspaceInfo: async (path) => ({ path }),
		live: () => undefined,
		activate: async () => null,
		getOrCreate: async () => {
			throw new Error("not needed");
		},
		snapshot: async () => ({}),
		touch: () => {},
		...overrides,
	};
}

test("a method not on the list does not exist for the phone", async () => {
	const result = await callRpc(deps(), "terminal.attach", ["x"]);
	assert.deepEqual(result, { ok: false, error: "method-not-allowed" });
});

test("the things that would hand over the machine are all absent", () => {
	/*
	 * Each of these is a way to reach past the app and into the computer: a shell, the filesystem,
	 * the display, the update channel. The pairing token is a phone-shaped secret — it lives in a
	 * device that gets lost — and none of this should ride on it.
	 */
	const allowed = new Set(allowedMethods());
	for (const method of [
		"terminal.attach",
		"terminal.write",
		"files.write",
		"files.read",
		"files.bytes",
		"screenshot.start",
		"system.openPath",
		"system.openExternal",
		"plugins.install",
		"updates.install",
		"forge.add",
		"git.commit",
		"sync.rotateToken",
	]) {
		assert.ok(!allowed.has(method), `${method} 不该在白名单里`);
	}
});

test("what a phone is actually for is on the list", () => {
	const allowed = new Set(allowedMethods());
	for (const method of [
		"settings.get",
		"sessions.list",
		"sessions.transcript",
		"agent.prompt",
		"agent.abort",
		"agent.approve",
	]) {
		assert.ok(allowed.has(method), `${method} 应该可用`);
	}
});

test("approving a tool call is allowed, because that is the point of having a phone", () => {
	// A turn stops and waits for a decision; being able to make it from the other room is most of
	// why this feature exists. It grants only what the desktop was already about to ask for.
	assert.ok(allowedMethods().includes("agent.approve"));
});

test("a handler that throws is an answer, not a dropped connection", async () => {
	const result = await callRpc(
		deps({
			store: () =>
				({
					listSessions: async () => {
						throw new Error("磁盘读不了");
					},
				}) as never,
		}),
		"sessions.list",
		[],
	);
	// The phone holds one long-lived connection; a failed call must not cost it that and the
	// resync that follows.
	assert.equal(result.ok, false);
	assert.match(String(result.error), /磁盘读不了/);
});

test("a successful call carries the value back, and null rather than undefined", async () => {
	const listed = await callRpc(deps(), "sessions.list", []);
	assert.deepEqual(listed, { ok: true, value: [] });

	// `undefined` does not survive JSON, and a caller reading `value` would see the key vanish.
	const nothing = await callRpc(deps({ live: () => undefined }), "agent.abort", ["s1"]);
	assert.deepEqual(nothing, { ok: true, value: null });
});

test("arguments that are not strings do not reach the session layer as such", async () => {
	// The body arrives from the network: a caller can send anything, including objects where a
	// session id is expected.
	let asked: unknown = "untouched";
	await callRpc(
		deps({
			live: (id) => {
				asked = id;
				return undefined;
			},
		}),
		"agent.abort",
		[{ evil: true }],
	);
	assert.equal(asked, "", "非字符串的 sessionId 被折成空串，而不是原样传下去");
});

test("a call with no arguments at all does not throw", async () => {
	// `args` is whatever was in the body; an empty array is the honest reading of a missing one.
	const result = await callRpc(deps(), "agent.abort", []);
	assert.equal(result.ok, true);
});

test("every handler is reachable through callRpc", async () => {
	// A method in the table but unreachable would be a hole in this file's own coverage.
	for (const method of Object.keys(RPC)) {
		const result = await callRpc(deps(), method, ["", "", ""]);
		assert.notEqual(result.error, "method-not-allowed", `${method} 应当可达`);
	}
});
