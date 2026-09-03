/**
 * Turning the sync service on, twice, which is what turning it on once actually does.
 *
 * The IPC handler writes `sync.enabled: true` and returns `startSync()`. Writing that setting is
 * itself what starts the server — the settings hook in `main.ts` watches for it — so by the time
 * the handler starts it, it is running. The second call used to tear the listener down and rebind,
 * racing its own close, and the toggle reported `EADDRINUSE` about the service it had just
 * successfully started.
 *
 * Started on a real port because that is the whole failure: it is about binding, and a fake socket
 * binds nothing.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { SyncServer } from "../electron/sync-server.ts";
import { DEFAULT_SETTINGS, type Settings } from "@lyra/core";

/** A port high enough to be unused, and its own per-run offset so two runs do not collide. */
const PORT = 45700 + (process.pid % 200);

function server() {
	let settings: Settings = { ...DEFAULT_SETTINGS, sync: { enabled: false, port: PORT, token: null } };
	return new SyncServer({
		getSettings: () => settings,
		saveSettings: async (next) => {
			settings = next;
		},
		resolveSession: async () => null,
		createSession: async () => {
			throw new Error("not needed");
		},
	} as never);
}

test("starting a running service on the same port is a no-op, not a rebind", async () => {
	const sync = server();
	try {
		const first = await sync.start(PORT, "tok");
		assert.equal(first.running, true);

		// This is the call the IPC handler makes after the settings hook has already started it.
		const second = await sync.start(PORT, "tok");
		assert.equal(second.running, true, "still running, and it did not throw EADDRINUSE getting here");
		assert.equal(second.port, PORT);
		assert.equal(second.token, "tok");
	} finally {
		await sync.stop();
	}
});

test("a null token means keep the one already in use", async () => {
	// `startSync()` passes `settings.sync.token`, which is null until the first start writes one.
	// Treating that as a change would restart the server on every call.
	const sync = server();
	try {
		const first = await sync.start(PORT, null);
		const generated = first.token;
		assert.ok(generated, "a first start invents a token");

		const second = await sync.start(PORT, null);
		assert.equal(second.token, generated, "and the second call keeps it rather than inventing another");
		assert.equal(second.running, true);
	} finally {
		await sync.stop();
	}
});

test("a different port does restart, because that is a real change", async () => {
	const sync = server();
	try {
		await sync.start(PORT, "tok");
		const moved = await sync.start(PORT + 1, "tok");
		assert.equal(moved.port, PORT + 1);
		assert.equal(moved.running, true);
	} finally {
		await sync.stop();
	}
});

test("a rotated token restarts too, so the old one stops being accepted", async () => {
	const sync = server();
	try {
		await sync.start(PORT, "old");
		const rotated = await sync.start(PORT, "new");
		assert.equal(rotated.token, "new");
		assert.equal(rotated.running, true);
	} finally {
		await sync.stop();
	}
});

test("saving the generated token cannot re-enter start and collide with itself", async () => {
	/*
	 * The real shape of the bug, which plain idempotence does not catch.
	 *
	 * A first start invents a token and persists it. Persisting settings runs the app's settings
	 * hook, and that hook starts the sync server when it sees `sync.enabled` — so the save re-enters
	 * `start` from inside `start`. With the save happening before the socket was bound, the
	 * re-entrant call saw no server, bound the port itself, and the outer call then failed on its
	 * own `listen`.
	 */
	let settings: Settings = { ...DEFAULT_SETTINGS, sync: { enabled: true, port: PORT + 5, token: null } };
	let reentered = 0;
	let sync: SyncServer;
	sync = new SyncServer({
		getSettings: () => settings,
		saveSettings: async (next) => {
			settings = next;
			// Exactly what `main.ts` does on a settings change.
			if (next.sync.enabled && !sync.running) {
				reentered++;
				await sync.start(next.sync.port, next.sync.token);
			}
		},
		resolveSession: async () => null,
		createSession: async () => {
			throw new Error("not needed");
		},
	} as never);

	try {
		const status = await sync.start(PORT + 5, null);
		assert.equal(status.running, true, "the first start survives its own settings write");
		assert.ok(status.token, "and the token it invented is the one in use");
		assert.equal(reentered, 0, "the hook found it already running, so there was nothing to re-enter");
	} finally {
		await sync.stop();
	}
});

test("stop leaves the port free for the next start", async () => {
	// The close has to have completed, not merely been asked for: an immediate restart is exactly
	// what rotating a token does.
	const sync = server();
	try {
		await sync.start(PORT, "tok");
		await sync.stop();
		const again = await sync.start(PORT, "tok");
		assert.equal(again.running, true);
	} finally {
		await sync.stop();
	}
});
