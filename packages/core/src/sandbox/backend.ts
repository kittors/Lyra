/**
 * Which confinement this machine can actually provide, decided by trying it.
 *
 * Selection is by platform first: macOS has Seatbelt; Linux has `bwrap` and, where that cannot run,
 * Landlock; Windows has a restricted token. Then the candidate is *probed* — really spawned, with
 * the real profile, around a command that does nothing — because the question is not "is the
 * binary there" but "does the kernel accept what we are about to ask it". `sandbox-exec` exists on
 * every macOS and can still refuse a profile; `bwrap` is often installed without the user
 * namespaces it needs.
 *
 * And when the answer is no, it is no. A backend that cannot confine reports that it cannot, and
 * the caller's choice is to run unconfined *knowingly* or not to run. The one thing that must never
 * happen is the quiet fallback: returning the original argv from a function whose whole purpose was
 * to wrap it, so a command runs with full access under a UI that says it is sandboxed.
 *
 * Which is exactly why every supported platform has to have a backend that works. The Windows
 * runner never started (see `runner-entry.ts`), and a stock Ubuntu has no usable `bwrap` (see
 * `linux/landlock.ts`) — on both, "fail closed" meant the default permission mode ran nothing.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { landlockAbi } from "./linux/landlock.ts";
import {
	bwrapArgs,
	canonicalPath,
	seatbeltArgs,
	type SandboxEnforcement,
	type SandboxNetwork,
	type SandboxPolicy,
} from "./policy.ts";
import { SANDBOX_RUNNER_FLAG } from "./runner-flag.ts";
import { tempWriteSid, workspaceWriteSid } from "./windows/identity.ts";

export { SANDBOX_RUNNER_FLAG } from "./runner-flag.ts";

/** Where the platform's confinement comes from, or `none` when it has none we can use. */
export type Runner = "seatbelt" | "bwrap" | "landlock" | "windows-acl" | "none";

export interface Confinement {
	/** The command to spawn instead of the original. */
	command: string;
	/** Arguments that go before the wrapped command. */
	args: string[];
	runner: Exclude<Runner, "none">;
	enforcement: SandboxEnforcement;
	/** Extra environment the wrapper needs. Only our own runners have any. */
	env?: Record<string, string>;
}

/**
 * How long a probe may take before it counts as a failure.
 *
 * A probe runs `true` inside the sandbox, so it is milliseconds when it works — a few hundred for
 * our own runners, which start the app's runtime first. This bound is for the case where it does
 * not work: a runner that hangs waiting on something must not hang the app's first command. Note
 * that `spawnSync` treats `timeout: 0` as *no timeout*, which is why this is a constant and not a
 * caller-supplied number that could arrive as zero.
 */
const PROBE_TIMEOUT_MS = 8_000;

/** Seams for the tests: they must be able to have a platform, and a verdict, that this host lacks. */
export interface BackendHooks {
	platform?: NodeJS.Platform;
	probe?: (runner: Exclude<Runner, "none">) => boolean;
	/** The `sandbox-exec` to invoke, so a test can point at a script that says no. */
	seatbeltExec?: string;
	/** The runners to consider, in order — so a test can ask for Landlock on a host that has `bwrap`. */
	runners?: readonly Exclude<Runner, "none">[];
}

/** Which runners each platform could use, in preference order. */
const PLATFORM_RUNNERS: Partial<Record<NodeJS.Platform, readonly Exclude<Runner, "none">[]>> = {
	darwin: ["seatbelt"],
	/*
	 * `bwrap` first where it works: it is the only one that can deny the network while leaving
	 * loopback open, and it confines the command in a mount namespace rather than by rule.
	 * Landlock is what works everywhere else.
	 */
	linux: ["bwrap", "landlock"],
	win32: ["windows-acl"],
};

/**
 * What a runner promises when it is selected.
 *
 * `full` means it governs every file effect the mode names. The honest answer is not always that,
 * and a caller that needs the absolute boundary has to be able to tell the difference.
 */
function enforcementOf(runner: Exclude<Runner, "none">): SandboxEnforcement {
	/*
	 * Partial, and the reasons are structural rather than unfinished work.
	 *
	 * `WRITE_RESTRICTED` needs Everyone in its restricting list or the process dies during loader
	 * initialisation — so any object whose DACL grants Everyone write access stays writable. And
	 * NTFS hard links can alias a file inside the granted tree to a path outside it. Both are
	 * documented boundaries of the mechanism, not gaps that a better implementation closes.
	 */
	if (runner === "windows-acl") return "partial";
	// Below ABI 3 Landlock does not govern `truncate(2)` by path.
	if (runner === "landlock") return landlockAbi() >= 3 ? "full" : "partial";
	return "full";
}

/**
 * Which runners can keep the network half of a policy.
 *
 * The Windows runner works by restricting the process token's access to file objects, which is a
 * statement about the filesystem and nothing else — there is no network in it. So a policy that
 * denies the network is refused there rather than partly applied: this file's own rule is that the
 * one thing a sandbox must never do is run the command anyway while the UI says it is confined,
 * and "the writes are confined and the sockets are not" is exactly that, one axis down.
 *
 * Landlock can, from ABI 4 — and its probe is run with the network denied, so a kernel that
 * cannot is found out there rather than here.
 */
const ENFORCES_NETWORK: Record<Exclude<Runner, "none">, boolean> = {
	seatbelt: true,
	bwrap: true,
	landlock: true,
	"windows-acl": false,
};

// ---------------------------------------------------------------------------------------------
// Our own runner process
// ---------------------------------------------------------------------------------------------

/**
 * The script our runners are started from — see `runner-entry.ts`.
 *
 * The desktop bundles it as `sandbox-runner.js` next to the main bundle and says so at startup;
 * everything that runs from source (the CLI, the tests) uses the TypeScript file beside this one.
 * Built from this file's own location rather than written as a `new URL(…, import.meta.url)`
 * literal, which a bundler would take for an asset and copy — without the modules it imports.
 */
let runnerEntry: string | undefined;

export function useSandboxRunner(entry: string | undefined): void {
	runnerEntry = entry;
	resetProbeCache();
}

function sandboxRunnerEntry(): string {
	return runnerEntry ?? join(dirname(fileURLToPath(import.meta.url)), "runner-entry.ts");
}

/**
 * This process's runtime, run as Node, running the runner.
 *
 * `process.execPath` with `ELECTRON_RUN_AS_NODE` is the supported way to get a Node process out
 * of an Electron app without shipping a second runtime; under plain Node the variable does
 * nothing. The script goes first and the marker flag after it, because in Node mode anything in
 * front of the script is read as an option of Node's own.
 */
function runnerArgv(runner: "landlock" | "windows-acl", policy: SandboxPolicy): { command: string; args: string[]; env: Record<string, string> } {
	const entry = sandboxRunnerEntry();
	const args = [...(entry.endsWith(".ts") ? ["--experimental-strip-types", "--no-warnings"] : []), entry, SANDBOX_RUNNER_FLAG];
	const workspace = canonicalPath(policy.workspaceRoot);
	args.push("--workspace", workspace, "--mode", policy.mode);
	if (runner === "windows-acl" && policy.mode === "workspace-write") {
		args.push("--write-sid", workspaceWriteSid(workspace));
		const temp = privateTemp(workspace);
		args.push("--temp", temp, "--temp-sid", tempWriteSid(temp));
	}
	if (runner === "landlock" && policy.network === "deny") args.push("--network", "deny");
	args.push("--");
	return { command: process.execPath, args, env: { ELECTRON_RUN_AS_NODE: "1" } };
}

/**
 * A temp directory of the workspace's own, for the Windows runner — see its `runConfined`.
 *
 * Keyed by the workspace so its grant is as narrow as the workspace's: one project's commands
 * cannot write another project's temp files.
 */
function privateTemp(workspace: string): string {
	const key = createHash("sha256").update(workspace.toLowerCase(), "utf8").digest("hex").slice(0, 16);
	return join(canonicalPath(tmpdir()), "lyra-sandbox", key);
}

// ---------------------------------------------------------------------------------------------
// Probing and selecting
// ---------------------------------------------------------------------------------------------

/**
 * Really run something trivial under the real profile.
 *
 * `read-only` is the strictest profile the runner will ever be handed, so a runner that accepts
 * it accepts the rest. `true` is the command because it exists everywhere, writes nothing, and its
 * exit code is unambiguous — `cmd.exe /c exit 0` being Windows' spelling of it.
 */
function probeRunner(runner: Exclude<Runner, "none">, seatbeltExec: string, network: SandboxNetwork): boolean {
	const policy: SandboxPolicy = {
		mode: "read-only",
		workspaceRoot: runner === "windows-acl" ? process.cwd() : "/",
		network,
	};
	try {
		if (runner === "windows-acl" || runner === "landlock") {
			// Landlock is not worth a process when the kernel has none; that answer is free.
			if (runner === "landlock" && landlockAbi() < 2) return false;
			const wrap = runnerArgv(runner, policy);
			const command = runner === "windows-acl" ? ["cmd.exe", "/c", "exit 0"] : ["true"];
			const probe = spawnSync(wrap.command, [...wrap.args, ...command], {
				timeout: PROBE_TIMEOUT_MS,
				stdio: "ignore",
				windowsHide: true,
				env: { ...process.env, ...wrap.env },
			});
			// The runner exits 127 with its own prefix when it cannot confine; anything but a clean
			// zero means this host cannot be trusted to enforce, so it is not offered.
			return probe.status === 0;
		}
		const probe =
			runner === "seatbelt"
				? spawnSync(seatbeltExec, [...seatbeltArgs(policy), "--", "true"], {
						timeout: PROBE_TIMEOUT_MS,
						stdio: "ignore",
					})
				: spawnSync("bwrap", [...bwrapArgs(policy), "--", "true"], {
						timeout: PROBE_TIMEOUT_MS,
						stdio: "ignore",
					});
		return probe.status === 0;
	} catch {
		// Spawning the runner itself failed — it is not there, or not executable.
		return false;
	}
}

/**
 * The probe result for this process.
 *
 * Cached because probing spawns a process, and the answer cannot change while the app is running:
 * `sandbox-exec` does not appear halfway through a session. Keyed by runner so a test that injects
 * one platform does not poison another's entry.
 */
const probed = new Map<string, boolean>();

/** Forget the cached probes. For tests, which need to probe again with different hooks. */
export function resetProbeCache(): void {
	probed.clear();
}

/**
 * The runner this host can use, or `none`.
 *
 * `none` is a legitimate answer — an unsupported platform, a stripped-down container, a macOS with
 * a broken `sandbox-exec`. What the caller does about it is the caller's decision; what this
 * function must not do is pretend.
 */
export function selectRunner(hooks: BackendHooks = {}, network: SandboxNetwork = "allow"): Runner {
	const platform = hooks.platform ?? process.platform;
	const seatbeltExec = hooks.seatbeltExec ?? "/usr/bin/sandbox-exec";
	for (const runner of hooks.runners ?? PLATFORM_RUNNERS[platform] ?? []) {
		/*
		 * Probed and cached per axis, not once for both.
		 *
		 * The network forms are a separate question from the file forms — a `sandbox-exec` can
		 * accept one profile and reject another — and a single shared answer would resolve it in
		 * whichever direction happened to be asked first. Worse in one direction than the other:
		 * one shared `false` would take away file confinement from a host that has it, because
		 * this host cannot deny the network.
		 */
		const key = `${platform}:${runner}:${seatbeltExec}:${network}:${runnerEntry ?? ""}`;
		let ok = probed.get(key);
		if (ok === undefined) {
			ok = hooks.probe ? hooks.probe(runner) : probeRunner(runner, seatbeltExec, network);
			probed.set(key, ok);
		}
		if (ok) return runner;
	}
	return "none";
}

/**
 * How to spawn one command under a policy — or `null` when the policy asks for no confinement.
 *
 * Throws when confinement is asked for and cannot be provided. That is the fail-closed direction,
 * and it is the whole point: a caller that wants to run anyway can catch this and choose to, in
 * which case running unconfined was a decision somebody made rather than something that happened.
 */
export function confine(policy: SandboxPolicy, hooks: BackendHooks = {}): Confinement | null {
	/*
	 * `danger-full-access` is the absence of a sandbox — but only of the file half.
	 *
	 * A policy that names no file confinement and still denies the network is a real combination,
	 * and returning `null` for it would hand back an unwrapped command whose policy said otherwise.
	 */
	if (policy.mode === "danger-full-access" && policy.network !== "deny") return null;

	const network = policy.network ?? "allow";
	const runner = selectRunner(hooks, network);
	if (runner === "none") {
		const platform = hooks.platform ?? process.platform;
		throw new SandboxUnavailableError(
			`这台机器上没有可用的沙箱后端（平台 ${platform}），无法以「${policy.mode}」模式运行。`,
		);
	}
	if (network === "deny" && !ENFORCES_NETWORK[runner]) {
		throw new SandboxUnavailableError(
			`${runner} 后端只能约束文件写入，不能断开网络；「禁止命令联网」在这台机器上无法保证。`,
		);
	}

	if (runner === "seatbelt") {
		return {
			command: hooks.seatbeltExec ?? "/usr/bin/sandbox-exec",
			args: [...seatbeltArgs(policy), "--"],
			runner,
			enforcement: enforcementOf(runner),
		};
	}
	if (runner === "windows-acl" || runner === "landlock") {
		/*
		 * `danger-full-access` with the network denied reaches here as a file mode our runners do
		 * not know. Landlock can express it — no write rules, only the network — but the vocabulary
		 * on the wire is the two confined modes, so it is sent as the wider of them.
		 */
		const wrap = runnerArgv(runner, { ...policy, mode: policy.mode === "danger-full-access" ? "workspace-write" : policy.mode });
		return { command: wrap.command, args: wrap.args, runner, enforcement: enforcementOf(runner), env: wrap.env };
	}
	return { command: "bwrap", args: [...bwrapArgs(policy), "--"], runner, enforcement: enforcementOf(runner) };
}

/** Confinement was required and this host cannot provide it. Distinct so a caller can catch it. */
export class SandboxUnavailableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SandboxUnavailableError";
	}
}

/**
 * Whether the sandbox stopped this command, read out of what it printed.
 *
 * The exit code cannot answer this. A command denied a write fails the way it fails when a disk is
 * full or a path is wrong — some non-zero number that means "it did not work", with no way to tell
 * a policy decision from a bug in the command. The runners do say so on stderr, and that line is
 * the only signal there is.
 *
 * Being wrong here is cheap in one direction and not the other: a missed denial reads as an
 * ordinary failure (the model retries, gets nowhere, and says so), while a false positive would
 * offer an escalation prompt for something the sandbox never blocked. So the patterns are the ones
 * the runners actually emit, not a general net for the words "denied" or "permission".
 */
export function looksDenied(output: string, runner?: Runner): boolean {
	if (DENIAL_PATTERNS.some((pattern) => pattern.test(output))) return true;
	if (runner !== "landlock" && runner !== "windows-acl") return false;
	return output.split("\n").some((line) => GENERIC_DENIAL.test(line) && !NOT_A_DENIAL.test(line));
}

/**
 * Case-insensitive, because the shell writes this line and shells disagree.
 *
 * `bash` reports EPERM as `Operation not permitted`; `zsh` — which is the default shell on macOS,
 * and therefore what most of these commands actually run under — writes `operation not permitted`,
 * lower case, in a differently shaped line. The unit tests used bash's wording and passed; the
 * first end-to-end run under a real user's shell is what showed the other half existed.
 *
 */
const DENIAL_PATTERNS = [
	/\boperation not permitted\b/i,
	/\bsandbox-exec:/i,
	/\bdeny file-write\b/i,
	/\bbwrap:.*(?:permission denied|read-only file system)/i,
	/\bread-only file system\b/i,
];

/**
 * The words our own runners' refusals arrive in, which carry no prefix of their own.
 *
 * Landlock refuses with `EACCES` — `Permission denied` — and the Windows token with `Access is
 * denied` from native programs and `Permission denied` from Git Bash. Those are common words, so
 * they count only under the runner that produces them, and never in the two sentences ssh uses for
 * a rejected key or password, which a `git push` prints under any sandbox or none.
 */
const GENERIC_DENIAL = /\b(?:permission denied|access is denied)\b/i;
const NOT_A_DENIAL = /permission denied \(publickey|permission denied, please try again/i;

/**
 * Whether this output is what a denied *network* looks like.
 *
 * Only meaningful when the caller already knows the network was denied, and the signature says so
 * by asking for the policy rather than just the text. That is not caution about naming: a denied
 * socket is genuinely indistinguishable from being offline. Measured under a real profile on
 * macOS 25 — `curl` says `Could not resolve host` (exit 6) for a name and
 * `Couldn't connect to server` (exit 7) for an address, and a program using sockets directly gets
 * `EPERM`. Of those, only `EPERM` is unlike an ordinary network failure; the other two are
 * character-for-character what a laptop on a train prints.
 *
 * So the policy is the evidence and the text only confirms the shape. Reading the text alone would
 * mean telling the model "policy denied this" every time a flaky registry timed out, which teaches
 * it to disbelieve the marker — the one thing the marker cannot afford.
 */
export function looksNetworkDenied(output: string, network: SandboxNetwork | undefined): boolean {
	if (network !== "deny") return false;
	return NETWORK_DENIAL_PATTERNS.some((pattern) => pattern.test(output));
}

const NETWORK_DENIAL_PATTERNS = [
	/\bcould not resolve host\b/i,
	/\bcouldn't connect to server\b/i,
	/\bcould not resolve proxy\b/i,
	/\bconnect EPERM\b/i,
	/\bEPERM\b.*\bconnect\b/i,
	/\bconnect EACCES\b/i,
	/\bnetwork is unreachable\b/i,
	/\btemporary failure in name resolution\b/i,
	/\bname or service not known\b/i,
	// `git` wraps curl's line in its own, and npm/pnpm report the registry rather than the host.
	/\bunable to access\b.*\bcould not resolve\b/i,
	/\bENOTFOUND\b/,
	/\bEAI_AGAIN\b/,
];
