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

import { mkdirSync } from "node:fs";
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
	/** A private temp directory the command may write, and the capability that names it. */
	temp?: string;
	tempSid?: string;
	command: string[];
}

/** `S-1-4-x-y`, or `S-1-4-x-y-1` for a temp identity — the only shapes `identity.ts` derives. */
const CAPABILITY_SID = /^S-1-4-\d+-\d+(-\d+)?$/;

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
	if (writeSid && !CAPABILITY_SID.test(writeSid)) throw new Error(`--write-sid 格式不对：${writeSid}`);

	const temp = options.get("temp");
	const tempSid = options.get("temp-sid");
	if (Boolean(temp) !== Boolean(tempSid)) throw new Error("--temp 和 --temp-sid 必须一起给");
	// A read-only command gets no temp to write either, the same as under Seatbelt and bwrap.
	if (temp && mode !== "workspace-write") throw new Error("只有 workspace-write 才有可写的临时目录");
	if (tempSid && !CAPABILITY_SID.test(tempSid)) throw new Error(`--temp-sid 格式不对：${tempSid}`);

	return { workspace, mode, ...(writeSid ? { writeSid } : {}), ...(temp && tempSid ? { temp, tempSid } : {}), command };
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
	/*
	 * The temp area, which `workspace-write` promises on every platform.
	 *
	 * Seatbelt and bwrap grant `/tmp` and `os.tmpdir()`; this backend granted the workspace alone,
	 * so a confined command could not create a temp file at all — every heredoc in Git Bash failed
	 * with `cannot create temp file for here-document`, and every tool that stages through `%TEMP%`
	 * with it. The user's own temp directory is not granted: it is shared by everything they run,
	 * and a grant there would outlive the session in every other program's files. A private one
	 * per workspace is created here, granted to its own identity, and handed to the command as its
	 * `TEMP`, `TMP` and `TMPDIR` — which is also where Git Bash mounts `/tmp`.
	 */
	if (args.temp && args.tempSid) {
		mkdirSync(args.temp, { recursive: true });
		const capability = sidFromString(api, args.tempSid);
		grantWrite(api, args.temp, capability);
		capabilities.push(capability);
		for (const name of ["TEMP", "TMP", "TMPDIR"]) process.env[name] = args.temp;
	}
	/*
	 * How this process was started is not something the command should inherit.
	 *
	 * The runner is Electron with `ELECTRON_RUN_AS_NODE=1`, and the environment block the child
	 * gets is this process's own. Left in, every Electron program the command ran — VS Code's
	 * `code` among them — would start as a bare Node instead of itself.
	 */
	delete process.env.ELECTRON_RUN_AS_NODE;

	const token = createRestrictedToken(api, source, logon, world, capabilities);
	// Without this the child cannot create its own stdio pipes; see `extendDefaultDacl` for which SID.
	extendDefaultDacl(api, token, capabilities[0] ?? logon);

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
		abi.CREATE_NO_WINDOW | abi.CREATE_UNICODE_ENVIRONMENT,
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

/**
 * One of this process's standard handles, made inheritable so the command really receives it.
 *
 * `STARTF_USESTDHANDLES` only names handle values; the child gets the handles themselves through
 * inheritance, and a handle that is not inheritable arrives as a number that means nothing there.
 * Node makes its stdio non-inheritable as it starts (`uv_disable_stdio_inheritance`), so every
 * command ran with no stdout or stderr at all: `cmd /c echo` failed with exit 1 and printed
 * nothing, and Git Bash died before it could say why. Marked here, on the runner's own handles:
 * this process starts nothing else that could pick them up by accident.
 */
function handleOf(api: Win32, which: number): bigint {
	const handle = api.getStdHandle(which);
	if (isNull(handle) || BigInt.asUintN(64, BigInt(handle)) === abi.INVALID_HANDLE_VALUE) fail(api, "GetStdHandle", `标准句柄 ${which}`);
	if (api.setHandleInformation(handle, abi.HANDLE_FLAG_INHERIT, abi.HANDLE_FLAG_INHERIT) === 0) {
		fail(api, "SetHandleInformation", `标准句柄 ${which} 设为可继承`);
	}
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
