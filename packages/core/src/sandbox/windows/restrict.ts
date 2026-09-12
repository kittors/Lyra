/**
 * Building the restricted token, and granting the one directory it may write to.
 *
 * The shape of the thing: a `WRITE_RESTRICTED` token carries a second list of SIDs, and every
 * write it attempts must be granted by the object's DACL *and* by something in that list. Take the
 * list down to identities nobody grants anything to, then put a grant for one made-up identity on
 * one directory, and that directory is the only place the process can write.
 *
 * The made-up identity is a capability SID derived from the workspace path (`identity.ts`). It
 * exists nowhere in Windows' own records — its entire meaning is the ACE we put on the directory,
 * which is exactly the property wanted: it grants precisely one thing and cannot be borrowed.
 *
 * Everything here fails closed. A token that could not be restricted is not a token to spawn with,
 * so every failure throws and the caller never gets a handle.
 */

import * as abi from "./abi.ts";
import { fail, isNull, ptrSlot, readPtr, uint32Slot, type Ptr, type Win32 } from "./win32.ts";

/** Open this process's token with the rights `CreateRestrictedToken` needs. */
export function openOwnToken(api: Win32): Ptr {
	// Through a real handle rather than the `GetCurrentProcess()` pseudo-handle: that one is a
	// constant the FFI layer cannot address.
	const processHandle = api.openProcess(abi.PROCESS_QUERY_INFORMATION, 0, process.pid);
	if (isNull(processHandle)) fail(api, "OpenProcess", `pid ${process.pid}`);

	const slot = ptrSlot();
	const opened = api.openProcessToken(
		processHandle!,
		abi.TOKEN_QUERY | abi.TOKEN_DUPLICATE | abi.TOKEN_ADJUST_DEFAULT | abi.TOKEN_ASSIGN_PRIMARY,
		slot,
	);
	if (opened === 0) {
		const code = api.getLastError();
		api.closeHandle(processHandle!);
		fail(api, "OpenProcessToken", `pid ${process.pid}`, code);
	}
	api.closeHandle(processHandle!);
	const token = readPtr(slot);
	if (token === null) fail(api, "OpenProcessToken", "拿到的是空令牌句柄");
	return token;
}

/**
 * The logon session SID out of the token's groups.
 *
 * Needed because per-logon objects — the window station, the desktop — are granted to it, and a
 * token that cannot reach them produces a process that dies during loader initialisation.
 */
export function findLogonSid(api: Win32, token: Ptr): Buffer {
	const needed = uint32Slot();
	// Expected to fail with ERROR_INSUFFICIENT_BUFFER; the point is the size it writes back.
	api.getTokenInformation(token, abi.TokenGroups, null, 0, needed);
	const size = needed.readUInt32LE(0);
	if (size === 0) fail(api, "GetTokenInformation", "TokenGroups 大小查询");
	if (size < abi.TOKEN_GROUPS_OFFSET) fail(api, "GetTokenInformation", `TokenGroups 大小不合理：${size}`);

	const groups = Buffer.alloc(size);
	if (api.getTokenInformation(token, abi.TokenGroups, groups, groups.length, needed) === 0) {
		fail(api, "GetTokenInformation", "TokenGroups");
	}

	const count = groups.readUInt32LE(0);
	for (let index = 0; index < count; index++) {
		const base = abi.TOKEN_GROUPS_OFFSET + index * abi.SID_AND_ATTRIBUTES_SIZE;
		const sid = readPtr(groups, base);
		const attributes = groups.readUInt32LE(base + 8);
		// `>>> 0` because SE_GROUP_LOGON_ID has bit 31 set and JS bitwise ops are signed.
		if (sid === null || ((attributes & abi.SE_GROUP_LOGON_ID) >>> 0) !== (abi.SE_GROUP_LOGON_ID >>> 0)) continue;

		const length = api.getLengthSid(sid);
		if (length === 0) fail(api, "GetLengthSid", `登录 SID（第 ${index} 组）`);
		const copy = Buffer.alloc(length);
		if (api.copySid(length, copy, sid) === 0) fail(api, "CopySid", `登录 SID（第 ${index} 组）`);
		return copy;
	}
	throw new Error(`令牌的 ${count} 个组里没有登录 SID，受限令牌建不出来`);
}

/** Everyone (`S-1-1-0`), which the restricting list cannot do without. */
export function worldSid(api: Win32): Buffer {
	const sid = Buffer.alloc(abi.SECURITY_MAX_SID_SIZE);
	const size = uint32Slot(abi.SECURITY_MAX_SID_SIZE);
	if (api.createWellKnownSid(abi.WinWorldSid, null, sid, size) === 0) fail(api, "CreateWellKnownSid", "Everyone");
	return sid;
}

/** Turn `S-1-4-x-y` into a SID. The pointer is `LocalAlloc`ed and must be freed. */
export function sidFromString(api: Win32, sddl: string): Ptr {
	const slot = ptrSlot();
	if (api.convertStringSidToSidW(sddl, slot) === 0) fail(api, "ConvertStringSidToSidW", sddl);
	const sid = readPtr(slot);
	if (sid === null) fail(api, "ConvertStringSidToSidW", `${sddl} 转出来是空的`);
	return sid;
}

/** One `EXPLICIT_ACCESS_W`, built by hand because its layout is fixed and small. */
function explicitAccess(sid: Ptr | Buffer, mode: number, permissions: number): Buffer {
	const entry = Buffer.alloc(abi.EXPLICIT_ACCESS_W_SIZE);
	entry.writeUInt32LE(permissions, 0);
	entry.writeUInt32LE(mode, 4);
	entry.writeUInt32LE(abi.SUB_CONTAINERS_AND_OBJECTS_INHERIT, 8);
	// TRUSTEE_W: pMultipleTrustee (null), MultipleTrusteeOperation, TrusteeForm, TrusteeType, ptstrName.
	entry.writeUInt32LE(abi.NO_MULTIPLE_TRUSTEE, abi.TRUSTEE_W_OFFSET + 8);
	entry.writeUInt32LE(abi.TRUSTEE_IS_SID, abi.TRUSTEE_W_OFFSET + 12);
	entry.writeUInt32LE(abi.TRUSTEE_IS_UNKNOWN, abi.TRUSTEE_W_OFFSET + 16);
	const address = Buffer.isBuffer(sid) ? bufferAddress(sid) : sid;
	entry.writeBigUInt64LE(address, abi.TRUSTEE_W_PTSTRNAME_OFFSET);
	return entry;
}

/**
 * The address of a Buffer's bytes.
 *
 * koffi passes Buffers by pointer, but a struct that *embeds* a pointer needs the address written
 * into it. `koffi.address` is the supported way to ask for one.
 */
function bufferAddress(buffer: Buffer): bigint {
	// eslint-disable-next-line
	const koffi = require("koffi") as typeof import("koffi");
	// eslint-disable-next-line
	return BigInt((koffi as any).address(buffer));
}

/**
 * Put a write grant for one capability SID on one directory, inheritable.
 *
 * Idempotent in the way that matters: `SetEntriesInAclW` merges, so running it again on a
 * directory that already carries the ACE leaves an equivalent DACL. The grant stands after the
 * process exits — it names an identity that only this workspace's tokens carry, so leaving it is
 * not leaving access lying around, and re-propagating a large tree on every launch would be a
 * visible cost for no gain.
 */
export function grantWrite(api: Win32, directory: string, capabilitySid: Ptr): void {
	const daclSlot = ptrSlot();
	const descriptorSlot = ptrSlot();
	const read = api.getNamedSecurityInfoW(
		directory,
		abi.SE_FILE_OBJECT,
		abi.DACL_SECURITY_INFORMATION,
		null,
		null,
		daclSlot,
		null,
		descriptorSlot,
	);
	if (read !== abi.ERROR_SUCCESS) fail(api, "GetNamedSecurityInfoW", directory, read);

	const oldDacl = readPtr(daclSlot);
	const descriptor = readPtr(descriptorSlot);
	const merged = ptrSlot();
	const result = api.setEntriesInAclW(1, explicitAccess(capabilitySid, abi.GRANT_ACCESS, abi.GRANT_MASK), oldDacl, merged);
	if (result !== abi.ERROR_SUCCESS) {
		if (descriptor !== null) api.localFree(descriptor);
		fail(api, "SetEntriesInAclW", directory, result);
	}
	const newDacl = readPtr(merged);
	if (newDacl === null) {
		if (descriptor !== null) api.localFree(descriptor);
		fail(api, "SetEntriesInAclW", `${directory} 合并出空 DACL`, result);
	}

	const applied = api.setNamedSecurityInfoW(
		directory,
		abi.SE_FILE_OBJECT,
		abi.DACL_SECURITY_INFORMATION,
		null,
		null,
		newDacl,
		null,
	);
	api.localFree(newDacl);
	if (descriptor !== null) api.localFree(descriptor);
	if (applied !== abi.ERROR_SUCCESS) fail(api, "SetNamedSecurityInfoW", directory, applied);
}

/**
 * Add a full-access ACE for the capability SID to the token's *default* DACL.
 *
 * Subtle and necessary. The default DACL is what every new object the process creates gets when it
 * does not supply one of its own — including the anonymous pipes Node makes for a child's stdio.
 * The restricted token inherits the user's default DACL, which names none of the restricting SIDs,
 * so those pipes fail the second write check at creation: `ERROR_ACCESS_DENIED`, surfacing as
 * `spawn EPERM`, and every piped grandchild fails to start.
 *
 * Naming a restricting SID here lets new objects pass that check while leaving object *creation*
 * gated by the parent directory's DACL — a file outside the granted tree still cannot be made.
 */
export function extendDefaultDacl(api: Win32, token: Ptr, capabilitySid: Ptr | Buffer): void {
	const needed = uint32Slot();
	api.getTokenInformation(token, abi.TokenDefaultDacl, null, 0, needed);
	const size = needed.readUInt32LE(0);
	if (size === 0) fail(api, "GetTokenInformation", "TokenDefaultDacl 大小查询");

	const buffer = Buffer.alloc(size);
	if (api.getTokenInformation(token, abi.TokenDefaultDacl, buffer, buffer.length, needed) === 0) {
		fail(api, "GetTokenInformation", "TokenDefaultDacl");
	}
	const current = readPtr(buffer, 0);
	if (current === null) throw new Error("令牌没有默认 DACL 可以扩展");

	const merged = ptrSlot();
	const result = api.setEntriesInAclW(
		1,
		explicitAccess(capabilitySid, abi.GRANT_ACCESS, abi.FILE_ALL_ACCESS),
		current,
		merged,
	);
	if (result !== abi.ERROR_SUCCESS) fail(api, "SetEntriesInAclW", "默认 DACL 合并", result);
	const newDacl = readPtr(merged);
	if (newDacl === null) fail(api, "SetEntriesInAclW", "默认 DACL 合并结果为空", result);

	// TOKEN_DEFAULT_DACL is exactly one pointer; SetTokenInformation copies the ACL.
	const info = Buffer.alloc(8);
	info.writeBigUInt64LE(newDacl, 0);
	if (api.setTokenInformation(token, abi.TokenDefaultDacl, info, info.length) === 0) {
		const code = api.getLastError();
		api.localFree(newDacl);
		fail(api, "SetTokenInformation", "TokenDefaultDacl", code);
	}
	api.localFree(newDacl);
}

/** Pack `SID_AND_ATTRIBUTES[]`, attributes left zero as `CreateRestrictedToken` requires. */
function packSids(sids: readonly (Ptr | Buffer)[]): Buffer {
	const buffer = Buffer.alloc(abi.SID_AND_ATTRIBUTES_SIZE * sids.length);
	sids.forEach((sid, index) => {
		const address = Buffer.isBuffer(sid) ? bufferAddress(sid) : sid;
		buffer.writeBigUInt64LE(address, abi.SID_AND_ATTRIBUTES_SIZE * index);
	});
	return buffer;
}

/**
 * Build the restricted token.
 *
 * The restricting list is the sandbox — see `identity.ts` for what is in it and why Everyone has
 * to be. `DISABLE_MAX_PRIVILEGE` drops the privileges that would let a child escalate around all
 * of this, and `LUA_TOKEN` filters an administrator token down to its limited form.
 */
export function createRestrictedToken(
	api: Win32,
	source: Ptr,
	logonSid: Buffer,
	world: Buffer,
	capabilitySids: readonly Ptr[],
): Ptr {
	const restricting = packSids([logonSid, world, ...capabilitySids]);
	const slot = ptrSlot();
	const created = api.createRestrictedToken(
		source,
		abi.DISABLE_MAX_PRIVILEGE | abi.LUA_TOKEN | abi.WRITE_RESTRICTED,
		0,
		null,
		0,
		null,
		restricting.length / abi.SID_AND_ATTRIBUTES_SIZE,
		restricting,
		slot,
	);
	if (created === 0) fail(api, "CreateRestrictedToken", `${capabilitySids.length + 2} 个限制 SID`);
	const token = readPtr(slot);
	if (token === null) fail(api, "CreateRestrictedToken", "拿到的是空令牌句柄");
	return token;
}
