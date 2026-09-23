/**
 * Git Bash under a restricted token, next to the Git Bash the user runs unconfined.
 *
 * Every MSYS2 program — Git Bash, and the `sh` Git runs hooks with — maps one per-user shared
 * memory region, named after the user's SID (`S-1-5-21-…-1001.1`), in a directory of the runtime's
 * own under `\BaseNamedObjects`. Whichever MSYS process starts first creates it, with that
 * process's default DACL; every later one opens it for writing. A confined command's token passes
 * a write check only through its restricting SIDs, and a region the user's own Git Bash created
 * names none of them — so while any unconfined MSYS process was alive, every confined Git Bash
 * died on its first line: `fatal error - CreateFileMapping S-1-5-21-….1, Win32 error 5`.
 *
 * So before a confined command starts, the region that already exists is given an entry for the
 * logon SID, which every confined token carries. A region a confined command creates first has it
 * already — see `extendDefaultDacl`.
 *
 * What this shares, stated plainly: the region holds the user's MSYS state, the in-memory mount
 * table among it, and a confined command can now change what the user's own Git Bash sessions see
 * in it. That is the same class of opening the workspace already is — `.git/hooks`, `package.json`
 * scripts — and it is the price of Git Bash running confined at all. Nothing outside MSYS gains
 * anything: only sections named for this user, inside the MSYS/Cygwin runtime directories, are
 * touched.
 */

import * as abi from "./abi.ts";
import { bufferAddress, grantOnObject } from "./restrict.ts";
import { fail, ptrSlot, readPtr, uint32Slot, type Ptr, type Win32 } from "./win32.ts";

/**
 * A SID in its string form, from its bytes — what `ConvertSidToStringSidW` would give, without a
 * round trip through memory Windows allocated.
 *
 * `Revision`, `SubAuthorityCount`, a six-byte big-endian authority, then that many little-endian
 * DWORDs. The authority is written in decimal unless it does not fit in 32 bits, as Windows does.
 */
export function sidString(sid: Buffer): string {
	const revision = sid.readUInt8(0);
	const count = sid.readUInt8(1);
	const high = sid.readUInt16BE(2);
	const low = sid.readUInt32BE(4);
	const authority = high === 0 ? String(low) : `0x${sid.subarray(2, 8).toString("hex").toUpperCase()}`;
	const parts = [`S-${revision}-${authority}`];
	for (let index = 0; index < count; index++) parts.push(String(sid.readUInt32LE(8 + index * 4)));
	return parts.join("-");
}

/** The token's user SID, copied out. */
export function userSid(api: Win32, token: Ptr): Buffer {
	const needed = uint32Slot();
	api.getTokenInformation(token, abi.TokenUser, null, 0, needed);
	const size = needed.readUInt32LE(0);
	if (size === 0) fail(api, "GetTokenInformation", "TokenUser 大小查询");
	const info = Buffer.alloc(size);
	if (api.getTokenInformation(token, abi.TokenUser, info, info.length, needed) === 0) fail(api, "GetTokenInformation", "TokenUser");
	// TOKEN_USER is one SID_AND_ATTRIBUTES; the SID it points to lives in the same buffer.
	const sid = readPtr(info, 0);
	if (sid === null) throw new Error("令牌没有用户 SID");
	const length = api.getLengthSid(sid);
	const copy = Buffer.alloc(length);
	if (api.copySid(length, copy, sid) === 0) fail(api, "CopySid", "用户 SID");
	return copy;
}

/** The runtime's own directories: `msys-2.0S5-<key>`, `cygwin1S5-<key>`, the key being 16 hex digits. */
const RUNTIME_DIRECTORY = /^(?:msys-\d+\.\d+|cygwin\d*)S\d+-[0-9a-f]{16}$/i;

/** Whether a section in such a directory is the user region for `user`: `<SID>.<version>`. */
export function isUserRegion(name: string, user: string): boolean {
	const prefix = `${user}.`;
	return name.length > prefix.length && name.slice(0, prefix.length).toUpperCase() === prefix.toUpperCase() && /^\d+$/.test(name.slice(prefix.length));
}

/** A `UNICODE_STRING` over `text`, both kept alive for as long as Windows might read them. */
function unicodeString(text: string): Buffer {
	const characters = Buffer.from(text, "utf16le");
	const string = Buffer.alloc(abi.UNICODE_STRING_SIZE);
	string.writeUInt16LE(characters.length, 0);
	string.writeUInt16LE(characters.length, 2);
	string.writeBigUInt64LE(bufferAddress(characters), 8);
	return string;
}

/** `OBJECT_ATTRIBUTES` naming `name`, relative to `root` when there is one. */
function objectAttributes(name: string, root: Ptr | null): Buffer {
	const attributes = Buffer.alloc(abi.OBJECT_ATTRIBUTES_SIZE);
	attributes.writeUInt32LE(abi.OBJECT_ATTRIBUTES_SIZE, 0);
	attributes.writeBigUInt64LE(root ?? 0n, 8);
	attributes.writeBigUInt64LE(bufferAddress(unicodeString(name)), 16);
	attributes.writeUInt32LE(abi.OBJ_CASE_INSENSITIVE, 24);
	return attributes;
}

function openDirectory(api: Win32, name: string, root: Ptr | null): Ptr | null {
	const slot = ptrSlot();
	if (api.ntOpenDirectoryObject(slot, abi.DIRECTORY_QUERY | abi.DIRECTORY_TRAVERSE, objectAttributes(name, root)) !== 0) return null;
	return readPtr(slot);
}

/**
 * The entries of one object directory, as `OBJECT_DIRECTORY_INFORMATION` records.
 *
 * Each call fills the buffer with records — two `UNICODE_STRING`s each, the last one all zeroes —
 * whose strings point further into the same buffer; `STATUS_MORE_ENTRIES` means call again.
 */
export function directoryEntries(buffer: Buffer, base: bigint): { name: string; type: string }[] {
	const entries: { name: string; type: string }[] = [];
	const text = (pointer: bigint, length: number) => {
		const offset = Number(pointer - base);
		return offset >= 0 && offset + length <= buffer.length ? buffer.toString("utf16le", offset, offset + length) : "";
	};
	for (let at = 0; at + abi.OBJECT_DIRECTORY_INFORMATION_SIZE <= buffer.length; at += abi.OBJECT_DIRECTORY_INFORMATION_SIZE) {
		const name = buffer.readBigUInt64LE(at + 8);
		if (name === 0n) break;
		entries.push({ name: text(name, buffer.readUInt16LE(at)), type: text(buffer.readBigUInt64LE(at + 24), buffer.readUInt16LE(at + 16)) });
	}
	return entries;
}

function listDirectory(api: Win32, handle: Ptr): { name: string; type: string }[] {
	const buffer = Buffer.alloc(64 * 1024);
	const base = bufferAddress(buffer);
	const context = uint32Slot();
	const returned = uint32Slot();
	const entries: { name: string; type: string }[] = [];
	for (let round = 0, restart = 1; round < 256; round++, restart = 0) {
		const status = api.ntQueryDirectoryObject(handle, buffer, buffer.length, 0, restart, context, returned) >>> 0;
		if (status !== 0 && status !== abi.STATUS_MORE_ENTRIES) break;
		entries.push(...directoryEntries(buffer, base));
		if (status !== abi.STATUS_MORE_ENTRIES) break;
		buffer.fill(0);
	}
	return entries;
}

/**
 * Give the logon SID full access to this user's MSYS region in every MSYS/Cygwin runtime
 * directory that has one. Returns how many regions it granted on.
 *
 * Best effort by design: a machine without Git Bash has no such region, and one that cannot be
 * reached changes nothing that was working — the confined command then fails with Cygwin's own
 * message, which says exactly which region it could not open.
 */
export function shareMsysUserRegion(api: Win32, user: string, logonSid: Buffer): number {
	const root = openDirectory(api, "\\BaseNamedObjects", null);
	if (root === null) return 0;
	let granted = 0;
	try {
		for (const entry of listDirectory(api, root)) {
			if (entry.type !== "Directory" || !RUNTIME_DIRECTORY.test(entry.name)) continue;
			const directory = openDirectory(api, entry.name, root);
			if (directory === null) continue;
			try {
				for (const object of listDirectory(api, directory)) {
					if (object.type !== "Section" || !isUserRegion(object.name, user)) continue;
					const slot = ptrSlot();
					if (api.ntOpenSection(slot, abi.READ_CONTROL | abi.WRITE_DAC, objectAttributes(object.name, directory)) !== 0) continue;
					const section = readPtr(slot);
					if (section === null) continue;
					try {
						grantOnObject(api, section, logonSid, abi.SECTION_ALL_ACCESS);
						granted++;
					} catch {
						// One region that will not take the entry does not stop the others.
					} finally {
						api.closeHandle(section);
					}
				}
			} finally {
				api.closeHandle(directory);
			}
		}
	} finally {
		api.closeHandle(root);
	}
	return granted;
}
