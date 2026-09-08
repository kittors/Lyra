/**
 * Which sandbox the tools use.
 *
 * Bound by the host at boot, exactly as the model and tool registries are. Everything that runs a
 * command asks here rather than importing a spawn, so replacing the sandbox is one line in a plugin
 * instead of a search through the tools.
 *
 * The fallback matters: core is used by tests and by the CLI, neither of which builds a kernel, and
 * a seam that only works once a plugin has been loaded is a seam that breaks the simple cases.
 */

import type { Sandbox } from "../kernel/services.ts";
import { LocalSandbox } from "./local.ts";

const BUILT_IN = new LocalSandbox();
let bound: Sandbox | null = null;

export function useSandbox(next: Sandbox | null): void {
	bound = next;
}

export function getSandbox(): Sandbox {
	return bound ?? BUILT_IN;
}

export { LocalSandbox } from "./local.ts";
export { primeCommandPath } from "./login-path.ts";
export { sandboxModeFor } from "./mode-for.ts";
export { confine, looksDenied, selectRunner, resetProbeCache, SandboxUnavailableError, WINDOWS_RUNNER_FLAG } from "./backend.ts";
export { main as runSandboxRunner } from "./windows/runner.ts";
export { workspaceWriteSid, tempWriteSid, quoteArg, buildCommandLine } from "./windows/identity.ts";
export type { Confinement, Runner } from "./backend.ts";
export {
	bwrapArgs,
	canonicalPath,
	seatbeltArgs,
	writableRoots,
	type ConfinedSandboxMode,
	type SandboxEnforcement,
	type SandboxMode,
	type SandboxPolicy,
} from "./policy.ts";
