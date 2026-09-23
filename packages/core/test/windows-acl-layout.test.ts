/**
 * The one struct the Windows runner builds byte by byte, checked where every machine can check it.
 *
 * `EXPLICIT_ACCESS_W` is filled in by hand and handed to `SetEntriesInAclW`, which reads it at fixed
 * x64 offsets. The SID's address was written 16 bytes early — at `ptstrName`'s offset inside the
 * trustee, taken as its offset inside the entry — so it overwrote `TrusteeForm` and left
 * `ptstrName` null. Windows said only "The parameter is incorrect", and the runner could not confine
 * a single command. Nothing but a real Windows ever called the function, so nothing else noticed.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import * as abi from "../src/sandbox/windows/abi.ts";
import { explicitAccess } from "../src/sandbox/windows/restrict.ts";

test("EXPLICIT_ACCESS_W: the SID pointer is the trustee's ptstrName, and nothing it is not", () => {
	const sid = 0x0000_7ff6_1234_5678n;
	const entry = explicitAccess(sid, abi.GRANT_ACCESS, abi.GRANT_MASK, abi.SUB_CONTAINERS_AND_OBJECTS_INHERIT);

	assert.equal(entry.length, 48, "sizeof(EXPLICIT_ACCESS_W) on x64");
	assert.equal(entry.readUInt32LE(0), abi.GRANT_MASK, "grfAccessPermissions");
	assert.equal(entry.readUInt32LE(4), abi.GRANT_ACCESS, "grfAccessMode");
	assert.equal(entry.readUInt32LE(8), abi.SUB_CONTAINERS_AND_OBJECTS_INHERIT, "grfInheritance");
	// TRUSTEE_W starts at 16: pMultipleTrustee (8), MultipleTrusteeOperation (4), TrusteeForm (4), TrusteeType (4), padding (4), ptstrName (8).
	assert.equal(entry.readBigUInt64LE(16), 0n, "pMultipleTrustee");
	assert.equal(entry.readUInt32LE(24), abi.NO_MULTIPLE_TRUSTEE, "MultipleTrusteeOperation");
	assert.equal(entry.readUInt32LE(28), abi.TRUSTEE_IS_SID, "TrusteeForm");
	assert.equal(entry.readUInt32LE(32), abi.TRUSTEE_IS_UNKNOWN, "TrusteeType");
	assert.equal(entry.readBigUInt64LE(40), sid, "ptstrName");
});

test("a default-DACL entry is not inheritable; a directory grant is", () => {
	assert.equal(explicitAccess(1n, abi.GRANT_ACCESS, abi.FILE_ALL_ACCESS, abi.NO_INHERITANCE).readUInt32LE(8), 0);
	assert.equal(explicitAccess(1n, abi.GRANT_ACCESS, abi.GRANT_MASK, abi.SUB_CONTAINERS_AND_OBJECTS_INHERIT).readUInt32LE(8), 3);
});
