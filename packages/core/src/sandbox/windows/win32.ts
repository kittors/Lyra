/**
 * The Win32 calls the restricted-token sandbox makes, and the buffer work around them.
 *
 * Loaded lazily and only on Windows. `koffi` is a real native module, and opening `advapi32.dll`
 * from a macOS process is not a mistake worth risking at import time when the whole module is
 * unreachable there anyway.
 *
 * Every binding is `__stdcall`, which is what the Win32 ABI uses on x86 and what koffi ignores
 * harmlessly on x64 — spelling it out keeps the declarations honest on both. Pointers come back
 * from koffi as BigInt addresses; the helpers below are the only place that is allowed to matter.
 *
 * Nothing here interprets a failure. Every call is checked and every failure throws with the API
 * name and the Win32 code, because the one behaviour this file must never have is continuing after
 * a call that did not do what it was asked — that is how a process ends up running with the full
 * token while everything upstream believes it is confined.
 */

import * as abi from "./abi.ts";

/** A native pointer as koffi hands it back. */
export type Ptr = bigint;

export interface Win32 {
	openProcess(access: number, inherit: number, pid: number): Ptr | null;
	openProcessToken(process: Ptr, access: number, tokenOut: Buffer): number;
	closeHandle(handle: Ptr): number;
	getLastError(): number;
	formatMessageW(flags: number, source: Ptr | null, id: number, lang: number, buffer: Buffer, size: number, args: Ptr | null): number;
	localFree(memory: Ptr): Ptr | null;
	convertStringSidToSidW(sid: string, sidOut: Buffer): number;
	createWellKnownSid(type: number, domain: Ptr | null, sid: Buffer, size: Buffer): number;
	isValidSid(sid: Ptr | Buffer): number;
	getLengthSid(sid: Ptr): number;
	copySid(length: number, destination: Buffer, source: Ptr): number;
	getTokenInformation(token: Ptr, cls: number, info: Buffer | null, length: number, needed: Buffer): number;
	setTokenInformation(token: Ptr, cls: number, info: Buffer, length: number): number;
	createRestrictedToken(
		token: Ptr,
		flags: number,
		disableCount: number,
		disable: Buffer | null,
		deleteCount: number,
		remove: Buffer | null,
		restrictCount: number,
		restrict: Buffer | null,
		tokenOut: Buffer,
	): number;
	setEntriesInAclW(count: number, entries: Buffer, oldAcl: Ptr | null, newAcl: Buffer): number;
	setNamedSecurityInfoW(
		name: string,
		type: number,
		info: number,
		owner: Ptr | null,
		group: Ptr | null,
		dacl: Ptr | null,
		sacl: Ptr | null,
	): number;
	getNamedSecurityInfoW(
		name: string,
		type: number,
		info: number,
		owner: Buffer | null,
		group: Buffer | null,
		dacl: Buffer,
		sacl: Buffer | null,
		descriptor: Buffer,
	): number;
	createProcessAsUserW(
		token: Ptr,
		applicationName: string | null,
		commandLine: Buffer,
		processAttributes: Ptr | null,
		threadAttributes: Ptr | null,
		inheritHandles: number,
		creationFlags: number,
		environment: Ptr | null,
		currentDirectory: string | null,
		startupInfo: Buffer,
		processInformation: Buffer,
	): number;
	waitForSingleObject(handle: Ptr, ms: number): number;
	getExitCodeProcess(handle: Ptr, codeOut: Buffer): number;
	getStdHandle(which: number): Ptr;
	terminateProcess(handle: Ptr, code: number): number;
}

let cached: Win32 | null = null;

/**
 * Bind the Win32 entry points, once.
 *
 * Throws on a non-Windows platform rather than returning something inert: a caller that reached
 * here on macOS has a bug, and a null return would let it keep going.
 */
export function win32(): Win32 {
	if (cached) return cached;
	if (process.platform !== "win32") {
		throw new Error("Windows 沙箱只能在 Windows 上加载");
	}

	// Required lazily. A static import would pull a native module into every platform's bundle.
	// eslint-disable-next-line
	const koffi = require("koffi") as typeof import("koffi");
	const PVOID = koffi.pointer("void");
	const PPVOID = koffi.pointer(PVOID);

	const kernel32 = koffi.load("kernel32.dll");
	const advapi32 = koffi.load("advapi32.dll");
	const bind = (lib: ReturnType<typeof koffi.load>, name: string, result: unknown, args: unknown[]) =>
		// eslint-disable-next-line
		(lib as any).func("__stdcall", name, result, args);

	cached = {
		openProcess: bind(kernel32, "OpenProcess", PVOID, ["uint32", "int", "uint32"]),
		openProcessToken: bind(advapi32, "OpenProcessToken", "int", [PVOID, "uint32", PPVOID]),
		closeHandle: bind(kernel32, "CloseHandle", "int", [PVOID]),
		getLastError: bind(kernel32, "GetLastError", "uint32", []),
		formatMessageW: bind(kernel32, "FormatMessageW", "uint32", ["uint32", PVOID, "uint32", "uint32", PVOID, "uint32", PVOID]),
		localFree: bind(kernel32, "LocalFree", PVOID, [PVOID]),
		convertStringSidToSidW: bind(advapi32, "ConvertStringSidToSidW", "int", ["str16", PPVOID]),
		createWellKnownSid: bind(advapi32, "CreateWellKnownSid", "int", ["int", PVOID, PVOID, koffi.pointer("uint32")]),
		isValidSid: bind(advapi32, "IsValidSid", "int", [PVOID]),
		getLengthSid: bind(advapi32, "GetLengthSid", "uint32", [PVOID]),
		copySid: bind(advapi32, "CopySid", "int", ["uint32", PVOID, PVOID]),
		getTokenInformation: bind(advapi32, "GetTokenInformation", "int", [PVOID, "int", PVOID, "uint32", koffi.pointer("uint32")]),
		setTokenInformation: bind(advapi32, "SetTokenInformation", "int", [PVOID, "int", PVOID, "uint32"]),
		createRestrictedToken: bind(advapi32, "CreateRestrictedToken", "int", [
			PVOID, "uint32", "uint32", PVOID, "uint32", PVOID, "uint32", PVOID, PPVOID,
		]),
		setEntriesInAclW: bind(advapi32, "SetEntriesInAclW", "uint32", ["uint32", PVOID, PVOID, PPVOID]),
		setNamedSecurityInfoW: bind(advapi32, "SetNamedSecurityInfoW", "uint32", [
			"str16", "int", "uint32", PVOID, PVOID, PVOID, PVOID,
		]),
		getNamedSecurityInfoW: bind(advapi32, "GetNamedSecurityInfoW", "uint32", [
			"str16", "int", "uint32", PPVOID, PPVOID, PPVOID, PPVOID, PPVOID,
		]),
		createProcessAsUserW: bind(advapi32, "CreateProcessAsUserW", "int", [
			PVOID, "str16", PVOID, PVOID, PVOID, "int", "uint32", PVOID, "str16", PVOID, PVOID,
		]),
		waitForSingleObject: bind(kernel32, "WaitForSingleObject", "uint32", [PVOID, "uint32"]),
		getExitCodeProcess: bind(kernel32, "GetExitCodeProcess", "int", [PVOID, koffi.pointer("uint32")]),
		getStdHandle: bind(kernel32, "GetStdHandle", PVOID, ["int"]),
		terminateProcess: bind(kernel32, "TerminateProcess", "int", [PVOID, "uint32"]),
	} as Win32;
	return cached;
}

// ---------------------------------------------------------------------------
// Buffers, pointers, failures
// ---------------------------------------------------------------------------

/** A slot to receive one pointer. */
export function ptrSlot(): Buffer {
	return Buffer.alloc(8);
}

/** Read the pointer a call wrote into a slot, or null when it wrote nothing. */
export function readPtr(slot: Buffer, offset = 0): Ptr | null {
	const value = slot.readBigUInt64LE(offset);
	return value === 0n ? null : value;
}

/** A slot to receive one DWORD. */
export function uint32Slot(value = 0): Buffer {
	const slot = Buffer.alloc(4);
	slot.writeUInt32LE(value, 0);
	return slot;
}

/** Whether a pointer is one of the shapes that mean "nothing". */
export function isNull(value: Ptr | null | undefined): boolean {
	return value === null || value === undefined || value === 0n;
}

/**
 * The system's own words for a Win32 error code.
 *
 * Worth the extra call: `CreateRestrictedToken failed (1314)` sends somebody searching, while
 * "a required privilege is not held by the client" says what to do about it.
 */
function describeError(api: Win32, code: number): string {
	const buffer = Buffer.alloc(1024);
	const length = api.formatMessageW(
		abi.FORMAT_MESSAGE_FROM_SYSTEM | abi.FORMAT_MESSAGE_IGNORE_INSERTS,
		null,
		code,
		0,
		buffer,
		512,
		null,
	);
	if (length === 0) return `Win32 错误 ${code}`;
	return `${buffer.toString("utf16le", 0, length * 2).trim()} (${code})`;
}

/** Fail with the API that failed, what it was doing, and what Windows said about it. */
export function fail(api: Win32, apiName: string, context: string, code = api.getLastError()): never {
	throw new Error(`${apiName} 失败：${describeError(api, code)} — ${context}`);
}
