/**
 * Reading a pairing code, including the strings that are not one.
 *
 * A camera is handed whatever is in frame. Half of what this function sees will be someone else's
 * QR code, a URL on a poster, or a partial read of the right code — and the difference between
 * refusing those and half-accepting them is the difference between "对准二维码再试一次" and a
 * connection that fails minutes later with a network error.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePairingCode } from "../src/pairing.ts";

const ok = (raw: string) => {
	const result = parsePairingCode(raw);
	assert.equal(result.ok, true, `期望能解析：${raw}`);
	if (!result.ok) throw new Error("unreachable");
	return result.connection;
};

const rejected = (raw: string) => {
	const result = parsePairingCode(raw);
	assert.equal(result.ok, false, `期望被拒绝：${raw}`);
	if (result.ok) throw new Error("unreachable");
	return result.reason;
};

test("a LAN code is plain http on the port it names", () => {
	assert.deepEqual(ok("lyra://pair?host=192.168.1.188&port=4517&token=abc"), {
		host: "192.168.1.188",
		port: 4517,
		token: "abc",
		tls: false,
	});
});

test("tls=1 makes it https", () => {
	const conn = ok("lyra://pair?host=lyra.example.com&port=443&tls=1&token=abc");
	assert.equal(conn.tls, true);
	assert.equal(conn.port, 443);
});

test("a relay code carries the socket, and says it is a relay", () => {
	const conn = ok(`lyra://pair?relay=${encodeURIComponent("wss://relay.example.com:9000")}&token=abc`);
	assert.deepEqual(conn, { host: "relay.example.com", port: 9000, token: "abc", tls: true, relay: true });
});

test("a relay with no port takes the one its scheme implies", () => {
	assert.equal(ok(`lyra://pair?relay=${encodeURIComponent("wss://relay.example.com")}&token=abc`).port, 443);
	assert.equal(ok(`lyra://pair?relay=${encodeURIComponent("ws://10.0.0.5")}&token=abc`).port, 80);
});

test("whitespace around the code is what a clipboard adds, not an error", () => {
	assert.equal(ok("  lyra://pair?host=10.0.0.5&port=4517&token=abc\n").host, "10.0.0.5");
});

test("an upper-cased scheme still reads, because some scanners do that", () => {
	assert.equal(ok("LYRA://PAIR?host=10.0.0.5&port=4517&token=abc").host, "10.0.0.5");
});

test("an escaped token comes back as it was written", () => {
	assert.equal(ok("lyra://pair?host=10.0.0.5&port=4517&token=a%26b%3Dc").token, "a&b=c");
});

test("somebody else's QR code is refused, in words worth reading", () => {
	assert.match(rejected("https://example.com/promo"), /不是 Lyra/);
	assert.match(rejected("WIFI:S:home;T:WPA;P:hunter2;;"), /不是 Lyra/);
	assert.match(rejected(""), /没有读到/);
});

test("a code missing the parts that matter is refused rather than half-used", () => {
	// Each of these would otherwise become a connection that fails later, somewhere less obvious.
	assert.match(rejected("lyra://pair?host=10.0.0.5&port=4517"), /没有令牌/);
	assert.match(rejected("lyra://pair?token=abc"), /没有地址/);
	assert.match(rejected("lyra://pair?host=10.0.0.5&port=0&token=abc"), /端口/);
	assert.match(rejected("lyra://pair?host=10.0.0.5&port=99999&token=abc"), /端口/);
});

test("a malformed relay endpoint is refused with its own reason", () => {
	assert.match(rejected("lyra://pair?relay=not-a-url&token=abc"), /中转/);
});

test("a missing port defaults to the one the desktop listens on", () => {
	assert.equal(ok("lyra://pair?host=10.0.0.5&token=abc").port, 4517);
});
