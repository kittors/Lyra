/**
 * Running a command on this machine, inside whatever confinement this machine can provide.
 *
 * Without a mode this is what it always was: the user's own shell, cwd and environment. That is
 * the right default for a tool somebody is sitting in front of, and it is what the CLI and the
 * tests get.
 *
 * With a mode, the command is wrapped — `sandbox-exec` on macOS, `bwrap` on Linux — and if this
 * host cannot provide that, the call **throws**. Not falling back is the entire point. A sandbox
 * that quietly runs the command anyway when it cannot confine it is worse than no sandbox: the UI
 * says confined, the logs say confined, and nothing is.
 */

import { execFile, spawn } from "node:child_process";
import { systemShell } from "../platform.ts";
import type { Sandbox, SandboxProcess } from "../kernel/services.ts";
import { confine } from "./backend.ts";
import { commandPath } from "./login-path.ts";
import type { SandboxMode } from "./policy.ts";

/**
 * Kept out of the child's environment.
 *
 * A pager waiting for a keypress hangs the turn, and colour codes reach the model as noise it has
 * to read past. `TERM=dumb` is what tells most programs both at once.
 */
const QUIET_ENV = { TERM: "dumb", NO_COLOR: "1", GIT_PAGER: "cat", PAGER: "cat" };

export class LocalSandbox implements Sandbox {
	run(command: string, options: { cwd: string; env?: Record<string, string>; mode?: SandboxMode }): SandboxProcess {
		const shell = systemShell();
		// Annotated: spreading `process.env` into a literal drops its index signature, and with it
		// every variable whose name is not one of the four below.
		const env: NodeJS.ProcessEnv = { ...process.env, ...QUIET_ENV, ...options.env };
		/*
		 * `PATH` is repaired here, because without it the shell below is handed launchd's four
		 * directories and every `pnpm`, `node` or `npx` in the command is a `command not found`.
		 * See `login-path.ts` for why the inherited one is wrong and how the real one is found.
		 *
		 * Assigned only when it actually changed, rather than unconditionally: Windows spells this
		 * variable `Path`, and `{ ...process.env }` loses the case-insensitive proxy that makes the
		 * two the same key. Writing `PATH` onto that object would leave the child with both, and
		 * the one that wins is not ours to predict.
		 */
		const repaired = commandPath(env.PATH);
		if (repaired !== undefined && repaired !== env.PATH) env.PATH = repaired;

		/*
		 * The wrapper takes the shell as an argument instead of `spawn`'s `shell: true`.
		 *
		 * `shell: true` asks Node to build the argv itself, which leaves no place to put
		 * `sandbox-exec -p <profile> --` in front of it. Naming the shell explicitly is the same
		 * command through one more process, and it is the only arrangement where the confinement
		 * is applied *before* the shell exists rather than around a shell that is already running.
		 */
		const wrap = options.mode ? confine({ mode: options.mode, workspaceRoot: options.cwd }) : null;
		const child = wrap
			? spawn(wrap.command, [...wrap.args, shell.file, shell.flag, command], {
					cwd: options.cwd,
					detached: process.platform !== "win32",
					windowsHide: true,
					// The Windows runner needs `ELECTRON_RUN_AS_NODE`; the others contribute nothing.
					env: { ...env, ...wrap.env },
				})
			: spawn(command, { cwd: options.cwd, shell: shell.file, env, detached: process.platform !== "win32", windowsHide: true });

		return {
			get pid() { return child.pid; },
			onOutput(listener) {
				const forward = (chunk: Buffer) => listener(chunk.toString("utf8"));
				child.stdout?.on("data", forward);
				child.stderr?.on("data", forward);
			},
			onExit(listener) {
				child.on("close", (code) => listener(code));
			},
			onError(listener) {
				child.on("error", listener);
			},
			kill(signal = "SIGKILL") {
				if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
				// A shell owns a process tree. Killing only the shell leaves its dev server running.
				if (process.platform === "win32") {
					// Windows has no POSIX SIGTERM; without /F, taskkill cannot stop console children.
					execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, (error) => {
						if (error && child.exitCode === null && child.signalCode === null) child.emit("error", error);
					});
				} else {
					try { process.kill(-child.pid, signal); }
					catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ESRCH")) throw error; }
				}
			},
		};
	}
}
