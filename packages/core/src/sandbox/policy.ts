/**
 * What a confined command may touch, expressed once and translated per platform.
 *
 * Everything here is pure: a mode plus a workspace root in, an allow-list or a profile string out.
 * That is deliberate — the part of a sandbox you can get wrong silently is the part that decides
 * which paths are writable, and a pure function is the part you can actually test. The impure half
 * (probing a runner, wrapping an argv) lives in `local.ts`.
 *
 * The mode governs **file effects only**, and the network is a second, independent axis. They are
 * not folded into one setting because they are not ordered the same way: a project the agent may
 * write to is also a project it usually needs `pnpm install` for, so "more file access" does not
 * imply "more network" or the reverse. Keeping them separate is what lets `workspace-write` with
 * the network denied be a coherent answer — the mode people actually want when they are running
 * something they have not read.
 *
 * Process visibility is still not in the vocabulary.
 */

import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";

/**
 * How much of the filesystem a command may change.
 *
 * `read-only` permits no writes at all beyond the sinks a shell cannot run without; the pipeline
 * a shell builds needs `/dev/null`, and denying it turns "no writes" into "no commands".
 * `workspace-write` adds the project and the temp areas. `danger-full-access` is not confined at
 * all — it is the absence of a sandbox, named so the absence has to be chosen.
 */
export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

/** The modes a backend can actually enforce. `danger-full-access` never reaches one. */
export type ConfinedSandboxMode = Exclude<SandboxMode, "danger-full-access">;

/**
 * How completely the host can keep the promise, reported rather than assumed.
 *
 * `partial` means the backend governs some of the mode's promise and not all of it. A caller that
 * needs the absolute boundary has to treat it as a different answer from `full` — which is the
 * whole reason it is a value and not a boolean.
 */
export type SandboxEnforcement = "full" | "partial";

/**
 * Whether a confined command may reach the network, other than this machine.
 *
 * `deny` is what makes the command classifier's remaining gaps survivable. That classifier is a
 * blacklist over command text, so it will always miss a spelling — but almost everything it is
 * trying to prevent needs a socket to matter: uploading a file, fetching a script to run, pushing
 * to a remote. Denying the socket is one rule instead of an unbounded number of patterns, and it
 * is enforced by the kernel rather than by a regular expression that has to have been right.
 *
 * Loopback is deliberately not included in the denial. The agent starts dev servers and then
 * checks them, and a policy that stops it reading `http://localhost:5173` would be turned off on
 * the first afternoon.
 */
export type SandboxNetwork = "allow" | "deny";

export interface SandboxPolicy {
	mode: SandboxMode;
	/** Absolute path `workspace-write` may write under. Canonicalised here, not by the caller. */
	workspaceRoot: string;
	/** Defaults to `allow`, so a policy written before this axis existed means what it did. */
	network?: SandboxNetwork;
}

/**
 * The path the enforcement layer will actually compare against.
 *
 * `/tmp` is a symlink to `/private/tmp` on macOS, and a Seatbelt filter matches the resolved path.
 * Granting the spelling the caller used would grant a path no process ever reports being in — the
 * grant would be there in the profile and mean nothing at runtime.
 *
 * `realpathSync.native` rather than the JavaScript one: the JS implementation collapses `..`
 * lexically before resolving a symlink in front of it, so `link/..` can resolve somewhere the
 * kernel would never go. The native one walks it component by component, the way `chdir` and
 * `spawn` do.
 *
 * A path that cannot be resolved is returned as spelled. It names nothing yet, so it grants
 * nothing yet — the conservative outcome. Inventing a fallback would grant a path nobody asked for.
 */
export function canonicalPath(path: string): string {
	try {
		return realpathSync.native(path);
	} catch {
		return path;
	}
}

/**
 * The roots a confined command may write under, canonical and deduplicated.
 *
 * `/tmp` and `os.tmpdir()` are both here and are usually the same directory after canonicalisation
 * — but only usually. `TMPDIR` moves the second one per user on macOS, and a `mkstemp`-family tool
 * writes there rather than to `/tmp`. Granting one and not the other denies what the mode promises,
 * in a way that only shows up in whichever tool happens to use the other.
 *
 * A root contained by another is dropped. Two overlapping grants are not wrong, but they make the
 * generated profile say the same thing twice, and a profile that repeats itself is one nobody
 * reads carefully.
 */
export function writableRoots(policy: SandboxPolicy): string[] {
	if (policy.mode !== "workspace-write") return [];
	const canonical = [...new Set([policy.workspaceRoot, "/tmp", tmpdir()].map(canonicalPath))];
	return canonical.filter((root) => !canonical.some((other) => other !== root && contains(other, root)));
}

/** Whether `parent` contains `child`, comparing whole path segments so `/a/bc` is not under `/a/b`. */
function contains(parent: string, child: string): boolean {
	if (parent === child) return false;
	const base = parent.endsWith("/") ? parent : `${parent}/`;
	return child.startsWith(base);
}

/**
 * One path as an SBPL string literal.
 *
 * The escaping is the security boundary, not a formatting detail. A profile is a string the kernel
 * parses, so a directory named `foo"` would end the literal early and the rest of the path would
 * be read as more profile — which is a grant nobody wrote. Backslash first, or escaping the quote
 * would then have its own backslash escaped.
 */
function sbplString(path: string): string {
	return `"${path.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/**
 * The macOS Seatbelt profile for a policy, as arguments to `sandbox-exec`.
 *
 * `(allow default)` and then one denial, rather than denying everything and allowing back what is
 * needed. A default-deny profile has to enumerate every syscall family a shell touches — dyld,
 * mach ports, the terminal — and each one it misses is a command that mysteriously fails. The
 * promise of this vocabulary is file *effects*; denying `file-write*` is that promise, exactly.
 *
 * `/dev/null` is granted under every mode because a shell redirects to it constantly and a
 * `read-only` sandbox that cannot run `command 2>/dev/null` is not read-only, it is broken.
 */
export function seatbeltArgs(policy: SandboxPolicy): string[] {
	const forms = [
		"(version 1)",
		"(allow default)",
		"(deny file-write*)",
		`(allow file-write* (literal ${sbplString("/dev/null")}))`,
	];
	const roots = writableRoots(policy);
	if (roots.length > 0) {
		forms.push(`(allow file-write* ${roots.map((root) => `(subpath ${sbplString(root)})`).join(" ")})`);
	}
	/*
	 * `network-outbound` and `network-bind` by name, not `network*`, and the order matters.
	 *
	 * Measured on macOS 25, because the shapes are not interchangeable. `(deny network*)` with
	 * loopback allowed back makes an external connection *hang* until the caller's own timeout —
	 * five seconds of nothing per blocked command, which reads as a network problem rather than a
	 * decision. Denying `network-outbound` specifically and allowing loopback back fails in 15ms
	 * with `Couldn't connect to server`, which is a command that is over and can be reported.
	 *
	 * `network-bind` for the local side so a dev server can still listen; the agent starting one
	 * and then reading it is the case this whole exception exists for.
	 */
	if (policy.network === "deny") {
		forms.push(
			"(deny network-outbound)",
			`(allow network-outbound (remote ip ${sbplString("localhost:*")}))`,
			`(allow network-bind (local ip ${sbplString("localhost:*")}))`,
		);
	}
	return ["-p", forms.join(" ")];
}

/**
 * The Linux `bwrap` arguments for a policy.
 *
 * The whole filesystem is bound read-only and the writable roots are bound back over it, which is
 * the mount-namespace way of saying the same thing the Seatbelt profile says. `--die-with-parent`
 * so a killed turn does not leave the wrapped command running, and `--dev`/`--proc` because a
 * namespace without them is missing the two things almost every program expects to exist.
 *
 * `--unshare-net` only when the network axis asks for it, never as part of a file mode. A network
 * namespace of its own comes with a loopback interface and nothing else, which is the same answer
 * the Seatbelt profile gives by a different route: this machine yes, anywhere else no.
 */
export function bwrapArgs(policy: SandboxPolicy): string[] {
	const args = ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--die-with-parent"];
	for (const root of writableRoots(policy)) args.push("--bind", root, root);
	if (policy.network === "deny") args.push("--unshare-net");
	return args;
}
