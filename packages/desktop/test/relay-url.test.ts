/**
 * Reading whatever someone typed into the relay field.
 *
 * There is no picker for this — it is a text box on a settings page, filled in by hand from a
 * README, a chat message or memory. The same relay gets typed as a bare host, with a scheme, with a
 * port, with a trailing slash, and all of them mean the same thing. Getting any of them wrong is a
 * connection that silently never forms, on the one code path that exists for people who have no
 * other way to connect.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { relaySocketUrl, roomFor } from "../electron/sync-relay.ts";

test("a bare host becomes a secure socket", () => {
	/*
	 * `wss`, not `ws`. A relay is reached across the internet and what passes through it is a
	 * session transcript — defaulting to plaintext because someone left off four characters is the
	 * wrong way round.
	 */
	assert.equal(relaySocketUrl("relay.example.com"), "wss://relay.example.com");
	assert.equal(relaySocketUrl("relay.example.com:9977"), "wss://relay.example.com:9977");
});

test("a scheme someone typed is respected", () => {
	assert.equal(relaySocketUrl("wss://relay.example.com"), "wss://relay.example.com");
	assert.equal(relaySocketUrl("ws://192.168.1.9:9977"), "ws://192.168.1.9:9977");
});

test("https and http are the same two things said differently", () => {
	// People paste the address they opened in a browser to check the relay was up.
	assert.equal(relaySocketUrl("https://relay.example.com"), "wss://relay.example.com");
	assert.equal(relaySocketUrl("http://127.0.0.1:9931"), "ws://127.0.0.1:9931");
});

test("surrounding space and a trailing slash are forgiven", () => {
	// Both arrive from a copy-paste, and neither is a different address.
	assert.equal(relaySocketUrl("  wss://relay.example.com/  "), "wss://relay.example.com");
	assert.equal(relaySocketUrl("relay.example.com/"), "wss://relay.example.com");
});

test("nothing at all is not a relay", () => {
	// An empty field means "do not use one", and must not become a connection attempt to nowhere.
	assert.equal(relaySocketUrl(""), null);
	assert.equal(relaySocketUrl("   "), null);
});

test("something that is not an address is refused rather than guessed at", () => {
	for (const junk of ["://", "wss://", "ws://:9977"]) {
		assert.equal(relaySocketUrl(junk), null, `${junk} 不该被当成地址`);
	}
});

test("the room is the token's digest, and nothing else travels", () => {
	/*
	 * The relay is addressed by this and never sees the token. That is what makes a relay operator
	 * unable to join the room they are carrying — and it is also the only authentication on that
	 * path, since a relay has no way to check a token on the sync server's behalf.
	 */
	const token = "1111111111111111111111111111abcd";
	assert.match(roomFor(token), /^[a-f0-9]{64}$/);
	assert.notEqual(roomFor(token), token);
	assert.notEqual(roomFor(token), roomFor(`${token}x`));
	// Stable across calls, or the two ends would never meet.
	assert.equal(roomFor(token), roomFor(token));
});
