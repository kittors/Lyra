/**
 * The pairing code, which is the one string that has to be right.
 *
 * Everything about connecting a phone rides on it: get the port wrong and the scan succeeds and
 * the connection times out, get the scheme wrong and it fails at the TLS handshake with an error
 * nobody can act on. And it is the one part nobody sees — a QR code is opaque by construction, so
 * a malformed payload looks exactly like a working one right up until it does not connect.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { pairingCode, parseEndpoint, routeLabel } from "../src/features/settings/pairing.ts";

const TOKEN = "abc123";

test("a LAN route carries the address and port as typed", () => {
	assert.equal(
		pairingCode({ kind: "lan", address: "192.168.1.188", port: 4517 }, TOKEN),
		"lyra://pair?host=192.168.1.188&port=4517&token=abc123",
	);
});

test("a bare hostname is assumed to be https, on 443", () => {
	// What someone types when they have a reverse proxy: the name, nothing else. Assuming http
	// here would produce a code that fails at the proxy rather than reaching it.
	assert.equal(pairingCode({ kind: "public", url: "lyra.example.com" }, TOKEN), "lyra://pair?host=lyra.example.com&port=443&tls=1&token=abc123");
});

test("an explicit scheme and port are both kept", () => {
	assert.equal(
		pairingCode({ kind: "public", url: "http://203.0.113.9:8080" }, TOKEN),
		"lyra://pair?host=203.0.113.9&port=8080&token=abc123",
	);
});

test("a relay becomes a ws endpoint rather than a host", () => {
	// The phone does not connect *to* a relay's host the way it connects to a desktop: it dials a
	// socket and waits to be joined, so the payload names a socket rather than an origin.
	assert.equal(
		pairingCode({ kind: "relay", url: "relay.example.com" }, TOKEN),
		`lyra://pair?relay=${encodeURIComponent("wss://relay.example.com:443")}&token=abc123`,
	);
});

test("a plain-http relay is ws, not wss", () => {
	assert.equal(
		pairingCode({ kind: "relay", url: "http://10.0.0.5:9000" }, TOKEN),
		`lyra://pair?relay=${encodeURIComponent("ws://10.0.0.5:9000")}&token=abc123`,
	);
});

test("no token means no code, not a code with an empty one", () => {
	// A code that pairs to nothing is worse than no code: it scans, it looks like it worked.
	assert.equal(pairingCode({ kind: "lan", address: "192.168.1.5", port: 4517 }, null), null);
});

test("an address that cannot be parsed produces no code", () => {
	assert.equal(pairingCode({ kind: "public", url: "   " }, TOKEN), null);
	assert.equal(pairingCode({ kind: "public", url: "http://" }, TOKEN), null);
});

test("tokens and hosts are escaped, so a punctuation mark cannot end the field early", () => {
	const code = pairingCode({ kind: "lan", address: "192.168.1.5", port: 4517 }, "a&b=c d");
	assert.equal(code, "lyra://pair?host=192.168.1.5&port=4517&token=a%26b%3Dc%20d");
	// And it survives the round trip the phone actually does.
	const params = new URLSearchParams(code!.slice("lyra://pair?".length));
	assert.equal(params.get("token"), "a&b=c d");
});

test("parseEndpoint fills in the port the scheme implies", () => {
	assert.deepEqual(parseEndpoint("example.com"), { host: "example.com", port: 443, tls: true });
	assert.deepEqual(parseEndpoint("http://example.com"), { host: "example.com", port: 80, tls: false });
	assert.deepEqual(parseEndpoint("wss://example.com"), { host: "example.com", port: 443, tls: true });
	assert.deepEqual(parseEndpoint("example.com:8443"), { host: "example.com", port: 8443, tls: true });
});

test("a port outside the range is not an endpoint", () => {
	assert.equal(parseEndpoint("example.com:0"), null);
	assert.equal(parseEndpoint("example.com:70000"), null);
});

test("the label under the code says what was actually encoded", () => {
	// Read back to check a scan went where it was meant to, so it must not tidy away the parts
	// that differ — the port especially.
	assert.equal(routeLabel({ kind: "lan", address: "192.168.1.188", port: 4517 }), "192.168.1.188:4517");
	assert.equal(routeLabel({ kind: "public", url: "lyra.example.com" }), "https://lyra.example.com");
	assert.equal(routeLabel({ kind: "public", url: "http://10.0.0.5:8080" }), "http://10.0.0.5:8080");
	assert.equal(routeLabel({ kind: "relay", url: "relay.example.com:9000" }), "中转 relay.example.com:9000");
});
