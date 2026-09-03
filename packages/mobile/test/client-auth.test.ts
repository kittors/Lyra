import assert from "node:assert/strict";
import test from "node:test";
import { SyncClient } from "../src/client.ts";

const connection = { host: "192.168.1.10", port: 4517, token: "pairing-token" };

function replaceFetch(t: test.TestContext, fetch: typeof globalThis.fetch): void {
	const original = globalThis.fetch;
	globalThis.fetch = fetch;
	t.after(() => {
		globalThis.fetch = original;
	});
}

test("verification distinguishes a rotated token from an unreachable desktop", async (t) => {
	await t.test("a successful authenticated request is verified", async (t) => {
		replaceFetch(t, async () => new Response('{"sessions":[]}'));
		assert.equal(await new SyncClient(connection).verifyStatus(), "verified");
	});

	await t.test("an authentication refusal means the stored pairing is stale", async (t) => {
		replaceFetch(t, async () => new Response("Unauthorized", { status: 401 }));
		assert.equal(await new SyncClient(connection).verifyStatus(), "unauthorized");
	});

	await t.test("a network failure remains reconnectable", async (t) => {
		replaceFetch(t, async () => {
			throw new TypeError("Network request failed");
		});
		assert.equal(await new SyncClient(connection).verifyStatus(), "unreachable");
	});
});

test("a rejected WebSocket handshake reports stale authentication instead of reconnecting forever", async (t) => {
	class RefusedSocket {
		static instances: RefusedSocket[] = [];
		readyState = 0;
		onopen: (() => void) | null = null;
		onmessage: ((event: MessageEvent) => void) | null = null;
		onclose: (() => void) | null = null;
		onerror: (() => void) | null = null;

		constructor() {
			RefusedSocket.instances.push(this);
		}

		close(): void {}
	}

	const original = globalThis.WebSocket;
	globalThis.WebSocket = RefusedSocket as unknown as typeof WebSocket;
	t.after(() => {
		globalThis.WebSocket = original;
	});
	replaceFetch(t, async () => new Response("Unauthorized", { status: 401 }));

	const states: string[] = [];
	const client = new SyncClient(connection);
	client.onStateChange((state) => states.push(state));
	client.connect();
	RefusedSocket.instances[0]?.onclose?.();
	await new Promise((resolve) => setTimeout(resolve, 10));

	assert.deepEqual(states, ["connecting", "closed", "unauthorized"]);
	assert.equal(RefusedSocket.instances.length, 1);
	client.disconnect();
});
