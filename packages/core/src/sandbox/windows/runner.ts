/**
 * The wrapper that runs in place of the command, on Windows.
 *
 * macOS and Linux confine a command by putting a program in front of it — `sandbox-exec -p … --`,
 * `bwrap --ro-bind / / --`. Windows has no such program: confinement there means building a token
 * and calling `CreateProcessAsUserW` yourself, which is a great deal of FFI to be doing in the
 * middle of an Electron main process that also has to stream the output.
 *
 * So this file *is* that program. The seam spawns it exactly the way it spawns the other two
 * runners, it does the Win32 work, and it runs the real command with the caller's own stdio
 * handles inherited — bytes go straight through, and everything upstream keeps treating this as an
 * ordinary child process. Its exit code is the child's.
 *
 * The argv contract, which the backend builds:
 *
 *     <node> runner.js --workspace <dir> --mode <read-only|workspace-write>
 *                      [--write-sid <S-1-4-…>] -- <command...>
 *
 * Failure contract: anything that goes wrong here prints `windows-acl-run: <detail>` and exits
 * 127, and the command is **never** run unconfined. That prefix is what the backend matches on, so
 * a failure to confine is distinguishable from a command that merely failed.
 */

import * as abi from "./abi.ts";
import { buildCommandLine } from "./identity.ts";
import {
	createRestrictedToken,
	extendDefaultDacl,
	findLogonSid,
	grantWrite,
	openOwnToken,
	sidFromString,
	worldSid,
} from "./restrict.ts";
import { fail, isNull, readPtr, uint32Slot, win32, type Ptr, type Win32 } from "./win32.ts";

interface Args {
	workspace: string;
	mode: "read-only" | "workspace-write";
	writeSid?: string;
	command: string[];
}

/** Read the argv contract, refusing anything that does not match it exactly. */
export function parseArgs(argv: readonly string[]): Args {
	const separator = argv.indexOf("--");
	if (separator === -1) throw new Error("缺少 `--`：它后面才是要运行的命令");
	const command = argv.slice(separator + 1);
	if (command.length === 0) throw new Error("`--` 后面没有命令");

	const options = new Map<string, string>();
	for (let index = 0; index < separator; index += 2) {
		const flag = argv[index];
		if (!flag.startsWith("--")) throw new Error(`认不出的参数：${flag}`);
		const value = argv[index + 1];
		if (value === undefined) throw new Error(`${flag} 后面缺少值`);
		/*
		 * A value never starts with `--`.
		 *
		 * Without this, `--workspace --mode read-only` reads `--mode` as the workspace path and
		 * carries on. It happens to fail later here, but only by luck of the ordering: a pairing
		 * mistake should be refused where it is made, not caught downstream by a different rule.
		 */
		if (value.startsWith("--")) throw new Error(`${flag} 后面缺少值（读到的是另一个参数 ${value}）`);
		options.set(flag.slice(2), value);
	}

	const workspace = options.get("workspace");
	const mode = options.get("mode");
	if (!workspace) throw new Error("缺少 --workspace");
	if (mode !== "read-only" && mode !== "workspace-write") throw new Error(`--mode 只能是 read-only 或 workspace-write，收到 ${mode}`);

	const writeSid = options.get("write-sid");
	if (mode === "workspace-write" && !writeSid) throw new Error("workspace-write 必须带 --write-sid");
	// A capability SID from an untrusted source would be a way to name somebody else's identity.
	if (writeSid && !/^S-1-4-\d+-\d+(-\d+)?$/.test(writeSid)) throw new Error(`--write-sid 格式不对：${writeSid}`);

	return { workspace, mode, ...(writeSid ? { writeSid } : {}), command };
}

/**
 * Build the token, grant the directory, spawn the command, and return its exit code.
 *
 * Ordered so that nothing runs until confinement is in place: the grant and the token are both
 * complete before `CreateProcessAsUserW` is reached, and any failure before that point throws.
 */
function runConfined(args: Args): number {
	const api: Win32 = win32();

	const source = openOwnToken(api);
	const logon = findLogonSid(api, source);
	const world = worldSid(api);

	const capabilities: Ptr[] = [];
	if (args.mode === "workspace-write" && args.writeSid) {
		const capability = sidFromString(api, args.writeSid);
		// The directory has to carry the grant before a token restricted to it can write anything.
		grantWrite(api, args.workspace, capability);
		capabilities.push(capability);
	}

	const token = createRestrictedToken(api, source, logon, world, capabilities);
	// Without this the child cannot create its own stdio pipes; see `extendDefaultDacl`.
	extendDefaultDacl(api, token, capabilities[0] ?? world);

	return spawnUnder(api, token, args);
}

/** Run the command under the token, with our own stdio handles, and wait for it. */
function spawnUnder(api: Win32, token: Ptr, args: Args): number {
	const startupInfo = Buffer.alloc(abi.STARTUPINFOW_SIZE);
	startupInfo.writeUInt32LE(abi.STARTUPINFOW_SIZE, 0);
	startupInfo.writeUInt32LE(abi.STARTF_USESTDHANDLES, 60);
	// Inherit this process's handles: the parent is already reading them, and copying bytes through
	// here would add a buffer nobody needs between the command and the transcript.
	startupInfo.writeBigUInt64LE(handleOf(api, abi.STD_INPUT_HANDLE), 80);
	startupInfo.writeBigUInt64LE(handleOf(api, abi.STD_OUTPUT_HANDLE), 88);
	startupInfo.writeBigUInt64LE(handleOf(api, abi.STD_ERROR_HANDLE), 96);

	// CreateProcessW may modify the command line in place, so it gets a writable copy.
	const commandLine = buildCommandLine(args.command[0], args.command.slice(1));
	const buffer = Buffer.from(`${commandLine}\0`, "utf16le");
	const info = Buffer.alloc(abi.PROCESS_INFORMATION_SIZE);

	const created = api.createProcessAsUserW(
		token,
		null,
		buffer,
		null,
		null,
		1,
		0,
		// A null environment block means "inherit ours". Passing one explicitly through the FFI
		// layer is what the reference implementation found trips ERROR_INVALID_PARAMETER.
		null,
		args.workspace,
		startupInfo,
		info,
	);
	if (created === 0) fail(api, "CreateProcessAsUserW", commandLine.slice(0, 120));

	const processHandle = readPtr(info, 0);
	const threadHandle = readPtr(info, 8);
	if (processHandle === null) fail(api, "CreateProcessAsUserW", "拿到的是空进程句柄");
	if (threadHandle !== null) api.closeHandle(threadHandle);

	api.waitForSingleObject(processHandle, abi.INFINITE);
	const code = uint32Slot();
	if (api.getExitCodeProcess(processHandle, code) === 0) fail(api, "GetExitCodeProcess", "子进程退出码");
	api.closeHandle(processHandle);
	return code.readUInt32LE(0);
}

function handleOf(api: Win32, which: number): bigint {
	const handle = api.getStdHandle(which);
	if (isNull(handle)) fail(api, "GetStdHandle", `标准句柄 ${which}`);
	return handle;
}

/** The prefix every runner-side failure carries, so the backend can tell it from a command's own. */
export const RUNNER_FAILURE_PREFIX = "windows-acl-run:";

/** Exit code for a failure to confine. Never used by a confined command's own exit. */
export const RUNNER_FAILURE_EXIT = 127;

/**
 * The entry point, when this file is run as a program.
 *
 * Exported and guarded rather than executed at import: the module is also imported by the tests,
 * which have no business spawning anything.
 */
export function main(argv: readonly string[]): number {
	try {
		return runConfined(parseArgs(argv));
	} catch (error) {
		process.stderr.write(`${RUNNER_FAILURE_PREFIX} ${error instanceof Error ? error.message : String(error)}\n`);
		return RUNNER_FAILURE_EXIT;
	}
}
