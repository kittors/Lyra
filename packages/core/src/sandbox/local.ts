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
import { commandEnv } from "./login-path.ts";
import type { SandboxMode, SandboxNetwork } from "./policy.ts";

/**
 * Set in the child's environment, because nobody is there to answer a prompt.
 *
 * A pager waiting for a keypress hangs the turn, and colour codes reach the model as noise it has
 * to read past. `TERM=dumb` is what tells most programs both at once.
 *
 * The rest are the other ways a command waits for a person who is not there:
 *
 * - `GIT_EDITOR=true`: `git merge`, `git commit --amend` and `git rebase --continue` open an editor
 *   for the message. With `core.editor = code --wait` that was a VS Code window appearing and the
 *   command waiting on it until the timeout killed it. `true` accepts the message git prepared.
 * - `GIT_TERMINAL_PROMPT=0`: an HTTPS remote without a credential fails at once instead of asking.
 * - `AWS_PAGER`: the AWS CLI pipes every result through `less` unless told not to.
 * - `DEBIAN_FRONTEND`: `apt` asks its questions on a terminal that does not exist.
 * - `PYTHONIOENCODING`: Python writes to a pipe in the locale's code page, which on a Chinese
 *   Windows is GBK — and arrives here as mojibake.
 */
const QUIET_ENV = {
	TERM: "dumb",
	NO_COLOR: "1",
	GIT_PAGER: "cat",
	PAGER: "cat",
	GIT_EDITOR: "true",
	GIT_TERMINAL_PROMPT: "0",
	AWS_PAGER: "",
	DEBIAN_FRONTEND: "noninteractive",
	PYTHONIOENCODING: "utf-8",
};

/**
 * How long to keep reading after the shell itself has exited.
 *
 * `npm run dev &` without a redirect leaves the dev server holding the shell's stdout. The pipe
 * never closes, so `close` never fires, and the command that already finished waited out its whole
 * timeout — after which the timeout killed the server too, which was the one thing the `&` was for.
 * Measured before this existed: `sleep 5 & echo started` took 5010 ms to report `started`.
 *
 * The shell's own exit is the command finishing. Output already written arrives within a few
 * milliseconds of it; anything later belongs to whatever was sent to the background.
 */
const DRAIN_AFTER_EXIT_MS = 250;

export class LocalSandbox implements Sandbox {
	run(
		command: string,
		options: { cwd: string; env?: Record<string, string>; mode?: SandboxMode; network?: SandboxNetwork },
	): SandboxProcess {
		const shell = systemShell();
		/*
		 * The login environment, then the quiet settings, then whatever the caller asked for.
		 *
		 * `commandEnv` is where `PATH` — and, for an app started from an icon, everything else the
		 * user's shell startup files export — is put back. See `login-path.ts`.
		 */
		const env: NodeJS.ProcessEnv = { ...commandEnv(process.env), ...QUIET_ENV, ...options.env };

		/*
		 * The wrapper takes the shell as an argument instead of `spawn`'s `shell: true`.
		 *
		 * `shell: true` asks Node to build the argv itself, which leaves no place to put
		 * `sandbox-exec -p <profile> --` in front of it. Naming the shell explicitly is the same
		 * command through one more process, and it is the only arrangement where the confinement
		 * is applied *before* the shell exists rather than around a shell that is already running.
		 */
		/*
		 * A network denial is enough on its own to need a wrapper.
		 *
		 * `options.mode` being absent means the host composed no file confinement — which it does
		 * for the CLI and the tests — and that says nothing about the network axis. Reading only
		 * `mode` here would have let "deny the network" be configured and then not happen.
		 */
		const network = options.network ?? "allow";
		const wrap =
			options.mode || network === "deny"
				? confine({ mode: options.mode ?? "danger-full-access", workspaceRoot: options.cwd, network })
				: null;
		/*
		 * stdin is `/dev/null`, not a pipe.
		 *
		 * Nothing ever writes to the child's stdin, and nothing ever closed it either: a command that
		 * reads it — `read`, a bare `cat`, an installer asking "continue? [y/N]" — waited on a pipe
		 * nobody would write to, for the whole timeout. With nothing there it reads end-of-file at
		 * once and carries on or fails with its own message, which is the only useful outcome.
		 */
		const spawnOptions = {
			cwd: options.cwd,
			detached: process.platform !== "win32",
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"],
		};
		const child = wrap
			? // The Windows runner needs `ELECTRON_RUN_AS_NODE`; the others contribute nothing.
				spawn(wrap.command, [...wrap.args, shell.file, ...shell.args(command)], { ...spawnOptions, env: { ...env, ...wrap.env } })
			: spawn(shell.file, shell.args(command), { ...spawnOptions, env });
		/*
		 * Decoded by the stream, not chunk by chunk.
		 *
		 * `chunk.toString("utf8")` on each chunk splits any character that straddles a chunk
		 * boundary into two replacement characters. A command printing 40 000 Chinese characters
		 * came back with three `�` in it; the stream's decoder carries the partial bytes over.
		 */
		const streams = [child.stdout, child.stderr].filter((stream) => stream !== null && stream !== undefined);
		for (const stream of streams) stream.setEncoding("utf8");

		/*
		 * The exit is reported once, when the output is complete or has stopped being the command's.
		 *
		 * `close` is the normal case: the shell exited and every pipe drained. `exit` without `close`
		 * is the background-job case described at `DRAIN_AFTER_EXIT_MS`. After the grace period the
		 * exit is reported, and whatever is still holding the pipes is handed over as `lingering` —
		 * a process of its own, whose output can still be read and which can still be stopped.
		 *
		 * The grace period ends with one more pass of the event loop before anything is decided. A
		 * main process busy for longer than the grace period would otherwise fire this timer ahead
		 * of the reads still queued for output the shell wrote before it exited, and drop the tail.
		 */
		const exitListeners: Parameters<SandboxProcess["onExit"]>[0][] = [];
		let reported = false;
		let lingering = false;
		let drain: ReturnType<typeof setTimeout> | undefined;
		const report = (code: number | null, signal: NodeJS.Signals | null, rest?: SandboxProcess) => {
			if (reported) return;
			reported = true;
			if (drain) clearTimeout(drain);
			for (const listener of exitListeners) listener(code, signal, rest);
		};
		const killTree = (signal: "SIGTERM" | "SIGKILL") => {
			if (!child.pid) return;
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
		};
		/** What is left holding the pipes once the shell has gone. */
		const rest: SandboxProcess = {
			get pid() { return child.pid; },
			onOutput(listener) {
				for (const stream of streams) stream.on("data", listener);
			},
			onExit(listener) {
				let open = streams.length;
				const closed = () => { if (--open === 0) listener(null, null); };
				for (const stream of streams) stream.once("close", closed);
			},
			onError() {},
			kill(signal = "SIGKILL") {
				// The shell is gone; its process group is not, and that is what the signal is for.
				if (streams.some((stream) => !stream.closed)) killTree(signal);
			},
		};
		child.on("close", (code, signal) => report(code, signal));
		child.on("exit", (code, signal) => {
			drain = setTimeout(() => setImmediate(() => {
				if (reported) return;
				// Every stream ended: `close` is already on its way, with everything in it.
				if (streams.every((stream) => stream.readableEnded)) return;
				lingering = true;
				for (const stream of streams) {
					stream.removeAllListeners("data");
					// Drained, so a chatty job never blocks on a full pipe; unreferenced, so it never holds this process open.
					stream.resume();
					(stream as { unref?: () => void }).unref?.();
				}
				report(code, signal, rest);
			}), DRAIN_AFTER_EXIT_MS);
			drain.unref?.();
		});

		return {
			get pid() { return child.pid; },
			onOutput(listener) {
				for (const stream of streams) stream.on("data", listener);
			},
			onExit(listener) {
				exitListeners.push(listener);
			},
			onError(listener) {
				child.on("error", listener);
			},
			kill(signal = "SIGKILL") {
				if (lingering) return rest.kill(signal);
				if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
				killTree(signal);
			},
		};
	}
}
