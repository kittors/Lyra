/**
 * The parts of letting Git Bash run confined that are plain data: a SID's string form, which
 * sections are this user's MSYS region, and reading an NT object directory listing.
 *
 * The rest — opening `\BaseNamedObjects`, granting on the section — only means anything on a real
 * Windows, and is exercised there by `sandbox-windows.test.ts`.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { directoryEntries, isUserRegion, sidString } from "../src/sandbox/windows/msys.ts";

test("a SID's string form, the way Windows writes it", () => {
	// S-1-5-21-3699639565-2515463329-295617607-500: revision 1, authority 5, five sub-authorities.
	const sid = Buffer.alloc(8 + 5 * 4);
	sid.writeUInt8(1, 0);
	sid.writeUInt8(5, 1);
	sid.writeUIntBE(5, 2, 6);
	[21, 3699639565, 2515463329, 295617607, 500].forEach((part, index) => sid.writeUInt32LE(part, 8 + index * 4));
	assert.equal(sidString(sid), "S-1-5-21-3699639565-2515463329-295617607-500");

	// An authority that does not fit in 32 bits is written in hex.
	const wide = Buffer.alloc(12);
	wide.writeUInt8(1, 0);
	wide.writeUInt8(1, 1);
	wide.writeUIntBE(0x0100_0000_0000, 2, 6);
	wide.writeUInt32LE(7, 8);
	assert.equal(sidString(wide), "S-1-0x010000000000-7");
});

test("only this user's `<SID>.<version>` sections are the MSYS user region", () => {
	const user = "S-1-5-21-1-2-3-1001";
	assert.ok(isUserRegion("S-1-5-21-1-2-3-1001.1", user));
	assert.ok(isUserRegion("s-1-5-21-1-2-3-1001.12", user), "object names compare case-insensitively");
	assert.ok(!isUserRegion("S-1-5-21-1-2-3-10011.1", user), "another user whose SID starts the same");
	assert.ok(!isUserRegion("S-1-5-21-1-2-3-1001.", user));
	assert.ok(!isUserRegion("S-1-5-21-1-2-3-1001.1x", user));
	assert.ok(!isUserRegion("shared.5", user));
	assert.ok(!isUserRegion("cygpid.1234", user));
});

test("an object directory listing: records until the empty one, strings further into the same buffer", () => {
	const base = 0x7000_0000n;
	const buffer = Buffer.alloc(512);
	let heap = 256;
	const put = (text: string) => {
		const at = heap;
		heap += buffer.write(text, at, "utf16le");
		return { pointer: base + BigInt(at), length: Buffer.byteLength(text, "utf16le") };
	};
	const record = (index: number, name: string, type: string) => {
		const at = index * 32;
		const n = put(name);
		const t = put(type);
		buffer.writeUInt16LE(n.length, at);
		buffer.writeUInt16LE(n.length, at + 2);
		buffer.writeBigUInt64LE(n.pointer, at + 8);
		buffer.writeUInt16LE(t.length, at + 16);
		buffer.writeUInt16LE(t.length, at + 18);
		buffer.writeBigUInt64LE(t.pointer, at + 24);
	};
	record(0, "msys-2.0S5-3e0f5ab1cf4d8a2e", "Directory");
	record(1, "S-1-5-21-1-2-3-1001.1", "Section");
	// Record 2 is left zeroed: the terminator. Anything after it is not part of this listing.
	record(3, "stale", "Section");

	assert.deepEqual(directoryEntries(buffer, base), [
		{ name: "msys-2.0S5-3e0f5ab1cf4d8a2e", type: "Directory" },
		{ name: "S-1-5-21-1-2-3-1001.1", type: "Section" },
	]);
});
