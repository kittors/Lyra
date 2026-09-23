/**
 * Confining a command's writes on Linux with Landlock — no namespaces, no privileges, no helper.
 *
 * `bwrap` was the only Linux backend, and on the machines people actually use it is usually not
 * there to use. Measured on a stock Ubuntu 24.04 (kernel 6.8): no `bwrap` installed, and
 * `apparmor_restrict_unprivileged_userns=1`, which denies the user namespace `bwrap` needs even
 * where it is installed. The sandbox is fail-closed by design, so on that machine the default
 * permission mode refused every command with "no sandbox backend" — the most common Linux desktop,
 * and nothing ran.
 *
 * Landlock is in the kernel's default LSM list on Ubuntu, Fedora and Debian, and an unprivileged
 * process may apply it to itself. It answers the question this sandbox asks — which directories
 * may be written — and the answer is inherited by every child and cannot be dropped. So this file
 * is a runner in the same shape as the Windows one: the backend spawns it in front of the shell,
 * it restricts itself, starts the command with the same stdio, and exits with the command's status.
 *
 * What it governs: every write-type filesystem right the running kernel knows (`handled`), allowed
 * back only beneath the writable roots the policy names. Reads and execution are not handled, and
 * so are unrestricted — the same promise Seatbelt's `(deny file-write*)` makes. Device files stay
 * writable in every mode (`/dev/null` above all, which a shell cannot run without), and creating or
 * deleting nodes in `/dev` does not.
 *
 * The network: Landlock (ABI 4, Linux 6.7) can refuse TCP `connect`, but only by port, never by
 * address — so unlike `bwrap --unshare-net` it cannot leave loopback open. A denied network here
 * denies local TCP too, and older kernels cannot deny it at all, in which case the probe says so and
 * nothing is claimed.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { writableRoots, type SandboxNetwork } from "../policy.ts";
import { libc } from "./libc.ts";

// syscall numbers: asm-generic, the same on x86_64 and aarch64 — added in 5.13, after the tables merged.
const SYS_LANDLOCK_CREATE_RULESET = 444;
const SYS_LANDLOCK_ADD_RULE = 445;
const SYS_LANDLOCK_RESTRICT_SELF = 446;
const LANDLOCK_CREATE_RULESET_VERSION = 1;
const LANDLOCK_RULE_PATH_BENEATH = 1;
const PR_SET_NO_NEW_PRIVS = 38;
// fcntl.h: the generic values, which x86_64 and aarch64 both use.
const O_PATH = 0o10000000;
const O_CLOEXEC = 0o2000000;

/** `LANDLOCK_ACCESS_FS_*` from `linux/landlock.h`, by the ABI that introduced them. */
const FS = {
	WRITE_FILE: 1n << 1n,
	REMOVE_DIR: 1n << 4n,
	REMOVE_FILE: 1n << 5n,
	MAKE_CHAR: 1n << 6n,
	MAKE_DIR: 1n << 7n,
	MAKE_REG: 1n << 8n,
	MAKE_SOCK: 1n << 9n,
	MAKE_FIFO: 1n << 10n,
	MAKE_BLOCK: 1n << 11n,
	MAKE_SYM: 1n << 12n,
	/** ABI 2: moving or linking a file into another directory. */
	REFER: 1n << 13n,
	/** ABI 3: `truncate(2)` by path. */
	TRUNCATE: 1n << 14n,
} as const;
/** `LANDLOCK_ACCESS_NET_CONNECT_TCP`, ABI 4. */
const NET_CONNECT_TCP = 1n << 1n;

/**
 * The write-type rights this kernel can govern, which is what the ruleset handles.
 *
 * Handling a right the kernel does not know is `EINVAL`; not handling one it does know leaves it
 * unrestricted. So the set follows the ABI exactly. Below ABI 2 a file cannot be moved between
 * directories at all under Landlock — even inside the workspace — which is why the runner refuses
 * ABI 1 rather than confine that badly; below ABI 3 `truncate` by path is not governed, which is
 * why `enforcement` reports that kernel as partial.
 */
export function writeRights(abi: number): bigint {
	let rights =
		FS.WRITE_FILE | FS.REMOVE_DIR | FS.REMOVE_FILE | FS.MAKE_CHAR | FS.MAKE_DIR | FS.MAKE_REG | FS.MAKE_SOCK | FS.MAKE_FIFO | FS.MAKE_BLOCK | FS.MAKE_SYM;
	if (abi >= 2) rights |= FS.REFER;
	if (abi >= 3) rights |= FS.TRUNCATE;
	return rights;
}

/** The rights allowed back on device files: writing to one, never making or removing one. */
export function deviceRights(abi: number): bigint {
	return FS.WRITE_FILE | (abi >= 3 ? FS.TRUNCATE : 0n);
}

/** What the runner is told: the same vocabulary as the other backends. */
export interface LandlockArgs {
	workspace: string;
	mode: "read-only" | "workspace-write";
	network: SandboxNetwork;
	command: string[];
}

/** One rule: a directory (or file) and the rights allowed beneath it. */
export interface LandlockRule {
	path: string;
	rights: bigint;
}

/**
 * The rules for a policy, as data — the part worth testing on a machine without Landlock.
 *
 * `/dev/shm` is writable wherever the temp areas are, because POSIX shared memory is a temp file
 * by another name: Python's `multiprocessing` and every Chromium the agent starts need it, and a
 * sandbox that grants `/tmp` and not `/dev/shm` breaks them for no reason it could state.
 */
export function landlockRules(args: Pick<LandlockArgs, "workspace" | "mode">, abi: number): LandlockRule[] {
	const rules: LandlockRule[] = [{ path: "/dev", rights: deviceRights(abi) }];
	if (args.mode !== "workspace-write") return rules;
	for (const root of writableRoots({ mode: "workspace-write", workspaceRoot: args.workspace })) {
		rules.push({ path: root, rights: writeRights(abi) });
	}
	if (existsSync("/dev/shm")) rules.push({ path: "/dev/shm", rights: writeRights(abi) });
	return rules;
}


/**
 * The Landlock ABI this kernel offers, or 0 when it has none (not built, not enabled, not Linux).
 *
 * The version query applies nothing, so it is safe to ask from the app itself — which is how the
 * backend decides whether this runner is worth probing and how complete its enforcement is.
 */
export function landlockAbi(): number {
	if (process.platform !== "linux") return 0;
	try {
		const version = libc().syscall(SYS_LANDLOCK_CREATE_RULESET, null, 0, LANDLOCK_CREATE_RULESET_VERSION);
		return version > 0 ? version : 0;
	} catch {
		return 0;
	}
}

/** Read the argv contract, refusing anything that does not match it. */
export function parseLandlockArgs(argv: readonly string[]): LandlockArgs {
	const separator = argv.indexOf("--");
	if (separator === -1) throw new Error("缺少 `--`：它后面才是要运行的命令");
	const command = argv.slice(separator + 1);
	if (command.length === 0) throw new Error("`--` 后面没有命令");
	const options = new Map<string, string>();
	for (let index = 0; index < separator; index += 2) {
		const flag = argv[index];
		const value = argv[index + 1];
		if (!flag.startsWith("--")) throw new Error(`认不出的参数：${flag}`);
		if (value === undefined || value.startsWith("--")) throw new Error(`${flag} 后面缺少值`);
		options.set(flag.slice(2), value);
	}
	const workspace = options.get("workspace");
	const mode = options.get("mode");
	const network = options.get("network") ?? "allow";
	if (!workspace) throw new Error("缺少 --workspace");
	if (mode !== "read-only" && mode !== "workspace-write") throw new Error(`--mode 只能是 read-only 或 workspace-write，收到 ${mode}`);
	if (network !== "allow" && network !== "deny") throw new Error(`--network 只能是 allow 或 deny，收到 ${network}`);
	return { workspace, mode, network, command };
}

/** Apply the policy to this process. Everything it starts afterwards inherits it, irrevocably. */
function restrictSelf(args: LandlockArgs): void {
	const api = libc();
	const abi = landlockAbi();
	if (abi < 2) throw new Error(`这个内核的 Landlock ABI 是 ${abi}，不足以约束写入（需要 2 以上）`);
	if (args.network === "deny" && abi < 4) throw new Error(`这个内核的 Landlock ABI 是 ${abi}，断不了网络（需要 4 以上）`);

	const netHandled = args.network === "deny" ? NET_CONNECT_TCP : 0n;
	const attr = Buffer.alloc(netHandled ? 16 : 8);
	attr.writeBigUInt64LE(writeRights(abi), 0);
	if (netHandled) attr.writeBigUInt64LE(netHandled, 8);
	const ruleset = api.syscall(SYS_LANDLOCK_CREATE_RULESET, attr, attr.length, 0);
	if (ruleset < 0) throw new Error(`landlock_create_ruleset 失败（errno ${api.errno()}）`);

	try {
		for (const rule of landlockRules(args, abi)) {
			const fd = api.open(rule.path, O_PATH | O_CLOEXEC);
			// A root that does not exist grants nothing yet, which is the conservative outcome.
			if (fd < 0) continue;
			try {
				// `struct landlock_path_beneath_attr` is packed: a u64 and an s32, 12 bytes.
				const beneath = Buffer.alloc(12);
				beneath.writeBigUInt64LE(rule.rights, 0);
				beneath.writeInt32LE(fd, 8);
				const added = api.syscall(SYS_LANDLOCK_ADD_RULE, ruleset, LANDLOCK_RULE_PATH_BENEATH, beneath, 0);
				if (added < 0) throw new Error(`landlock_add_rule 失败：${rule.path}（errno ${api.errno()}）`);
			} finally {
				api.close(fd);
			}
		}
		// Required of an unprivileged caller, and what stops a setuid program undoing all of this.
		if (api.prctl(PR_SET_NO_NEW_PRIVS, "unsigned long", 1, "unsigned long", 0, "unsigned long", 0, "unsigned long", 0) !== 0) {
			throw new Error(`prctl(PR_SET_NO_NEW_PRIVS) 失败（errno ${api.errno()}）`);
		}
		if (api.syscall(SYS_LANDLOCK_RESTRICT_SELF, ruleset, 0) < 0) {
			throw new Error(`landlock_restrict_self 失败（errno ${api.errno()}）`);
		}
	} finally {
		api.close(ruleset);
	}
}

/** The prefix every runner-side failure carries, so it reads apart from the command's own output. */
const LANDLOCK_FAILURE_PREFIX = "landlock-run:";

/**
 * The entry point: confine this process, then run the command under it and become its status.
 *
 * `spawnSync` from the thread that restricted itself: Landlock binds the calling thread's
 * credentials, and the child is forked from that thread. A child killed by a signal is mirrored by
 * dying of the same signal, so whoever waits on this process sees what they would have seen.
 */
export function main(argv: readonly string[]): number {
	let args: LandlockArgs;
	try {
		args = parseLandlockArgs(argv);
		restrictSelf(args);
	} catch (error) {
		process.stderr.write(`${LANDLOCK_FAILURE_PREFIX} ${error instanceof Error ? error.message : String(error)}\n`);
		return 127;
	}
	delete process.env.ELECTRON_RUN_AS_NODE;
	const result = spawnSync(args.command[0], args.command.slice(1), { stdio: "inherit" });
	if (result.error) {
		process.stderr.write(`${LANDLOCK_FAILURE_PREFIX} ${result.error.message}\n`);
		return 127;
	}
	if (result.signal) {
		process.kill(process.pid, result.signal);
		return 128;
	}
	return result.status ?? 1;
}
