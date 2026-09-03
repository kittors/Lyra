/**
 * The hand-written SHA-256, checked against the real one.
 *
 * It exists because the WebView has no `crypto.subtle` — the page is served over plain HTTP, which
 * is not a secure context — and pulling in a native module for one hash means keeping its version
 * in step with whatever Expo Go ships. Sixty lines of arithmetic instead, which is only acceptable
 * if it is actually right.
 *
 * `node:crypto` is the oracle. The interesting inputs are the ones near the padding boundaries: a
 * block is 64 bytes and the padding needs 9 of them, so 55, 56 and 64 bytes are where an
 * off-by-one first shows, and every one of them looks fine on a short string.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { roomFor, sha256Hex } from "../src/sha256.ts";

const expected = (text: string) => createHash("sha256").update(text).digest("hex");

test("the empty string", () => {
	// The one vector everybody knows, and the one that catches a padding routine that assumes input.
	assert.equal(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
	assert.equal(sha256Hex(""), expected(""));
});

test("the published vectors", () => {
	assert.equal(sha256Hex("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
	assert.equal(
		sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"),
		"248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
	);
});

test("every length across a block boundary", () => {
	/*
	 * 55 is the last that fits with its padding in one block, 56 forces a second, and 64 is exactly
	 * one block of message. An implementation can be wrong at precisely these three and right
	 * everywhere else — which is how it passes a casual test and then fails on a real token.
	 */
	for (let length = 0; length <= 130; length++) {
		const input = "a".repeat(length);
		assert.equal(sha256Hex(input), expected(input), `长度 ${length} 的输入对不上`);
	}
});

test("a pairing token, which is what this is actually for", () => {
	const token = "1111111111111111111111111111abcd";
	assert.equal(sha256Hex(token), expected(token));
	assert.equal(roomFor(token), expected(token), "房间号就是令牌的摘要");
	assert.match(roomFor(token), /^[a-f0-9]{64}$/, "中转要求 64 位小写十六进制");
});

test("tokens that differ by one character land in different rooms", () => {
	// Otherwise two people pairing at the same time could collide into one room, and the relay only
	// holds two.
	assert.notEqual(roomFor("token-a"), roomFor("token-b"));
	assert.notEqual(roomFor("1111111111111111111111111111abcd"), roomFor("1111111111111111111111111111abce"));
});

test("non-ASCII is hashed as UTF-8, the same as everywhere else", () => {
	// A token is generated as hex, but nothing stops someone typing one in by hand.
	for (const text of ["中文", "🙂", "café", "日本語のトークン"]) {
		assert.equal(sha256Hex(text), expected(text), `${text} 的摘要对不上`);
	}
});

test("a long input still matches", () => {
	// Many blocks, to exercise the message schedule rather than just the first round.
	const long = "lyra-".repeat(500);
	assert.equal(sha256Hex(long), expected(long));
});
