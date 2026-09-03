/**
 * Keeping a connected phone in step with the desktop.
 *
 * The phone reads the settings once when it boots and then subscribes. The subscription end was
 * there from the start; the sending end was not — so changing the theme, the model or the
 * permission mode on the desktop left the phone showing the old one until it was restarted. Found
 * by switching the desktop to a light theme with a phone in hand and watching it stay dark.
 *
 * Run over a real socket, because "did the client actually receive it" is the entire question and a
 * fake one answers it by construction.
 */

import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import { WebSocket } from "ws";
import { SyncServer } from "../electron/sync-server.ts";
import { DEFAULT_SETTINGS, type Settings } from "@lyra/core";

/** High enough to be free, offset per run so two runs do not collide. */
const PORT = 45900 + (process.pid % 200);
const TOKEN = "1111111111111111111111111111abcd";

function server() {
	let settings: Settings = { ...DEFAULT_SETTINGS, sync: { enabled: true, port: PORT, token: TOKEN } };
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

/** A client, connected and ready, with its messages collected. */
async function connect(): Promise<{ socket: WebSocket; messages: unknown[] }> {
	const socket = new WebSocket(`ws://127.0.0.1:${PORT}/ws?token=${TOKEN}`);
	const messages: unknown[] = [];
	socket.on("message", (data) => messages.push(JSON.parse(String(data))));
	await once(socket, "open");
	return { socket, messages };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 60));

test("a settings change reaches a connected phone", async () => {
	const sync = server();
	await sync.start(PORT, TOKEN);
	const { socket, messages } = await connect();

	try {
		sync.broadcastSettings({ ...DEFAULT_SETTINGS, appearance: { theme: "light" } } as Settings);
		await settle();

		const changed = messages.find((m) => (m as { type: string }).type === "settings_changed") as {
			settings: Settings;
		};
		assert.ok(changed, "手机应当收到 settings_changed");
		assert.equal(changed.settings.appearance?.theme, "light");
	} finally {
		socket.close();
		await sync.stop();
	}
});

test("every connected phone hears it, not just the first", async () => {
	// Two devices on one desk is the case this exists for.
	const sync = server();
	await sync.start(PORT, TOKEN);
	const a = await connect();
	const b = await connect();

	try {
		sync.broadcastSettings({ ...DEFAULT_SETTINGS, permissionMode: "full" } as Settings);
		await settle();
		for (const [name, client] of [
			["第一台", a],
			["第二台", b],
		] as const) {
			assert.ok(
				client.messages.some((m) => (m as { type: string }).type === "settings_changed"),
				`${name}也应当收到`,
			);
		}
	} finally {
		a.socket.close();
		b.socket.close();
		await sync.stop();
	}
});

test("broadcasting with nobody connected is not an error", async () => {
	/*
	 * The listener is attached for the life of the process and fires on every settings change,
	 * including the ones made before a phone has ever paired.
	 */
	const sync = server();
	await sync.start(PORT, TOKEN);
	try {
		assert.doesNotThrow(() => sync.broadcastSettings(DEFAULT_SETTINGS));
	} finally {
		await sync.stop();
	}
});

test("a phone that has gone away does not hold up the ones that remain", async () => {
	// A socket closed at the far end sits in CLOSING for a while; sending to it must not throw and
	// must not stop the loop before it reaches the others.
	const sync = server();
	await sync.start(PORT, TOKEN);
	const gone = await connect();
	const here = await connect();

	try {
		gone.socket.terminate();
		sync.broadcastSettings({ ...DEFAULT_SETTINGS, thinking: "high" } as Settings);
		await settle();
		assert.ok(here.messages.some((m) => (m as { type: string }).type === "settings_changed"), "活着的那台还得收到");
	} finally {
		here.socket.close();
		await sync.stop();
	}
});
