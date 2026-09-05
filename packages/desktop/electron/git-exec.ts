/**
 * Running git.
 *
 * One place that shells out, so every caller gets the same buffer limit and the same shape of
 * answer: reads return stdout and let a failure throw, writes report success as a value. Git says a
 * great deal on stderr that is not an error, so the exit code is what decides.
 */

import { execFile } from "node:child_process";
import { delimiter } from "node:path";
import { promisify } from "node:util";

import { explainGitFailure } from "./git-errors.ts";

const execFileAsync = promisify(execFile);

/**
 * The variables that tell git to work somewhere other than `cwd`.
 *
 * Every one of these outranks the directory a process is started in. `GIT_DIR=…` alone is enough
 * to make `git rev-parse --is-inside-work-tree` answer about a completely different repository, or
 * refuse to answer at all — and the answer the window drew from that was 「不是 Git 仓库」 about a
 * project with a perfectly good `.git` in it.
 *
 * They arrive by inheritance. Anything that starts Lyra from inside a git operation passes them
 * down: a `git` hook, `git rebase --exec`, a terminal still holding them from an earlier command.
 * The app never sets them and never wants them, so they are dropped rather than trusted — the
 * directory is the whole of what these calls mean to ask about.
 */
const REDIRECTING = [
	"GIT_DIR",
	"GIT_WORK_TREE",
	"GIT_COMMON_DIR",
	"GIT_INDEX_FILE",
	"GIT_OBJECT_DIRECTORY",
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_NAMESPACE",
	"GIT_CEILING_DIRECTORIES",
	"GIT_PREFIX",
];

/**
 * Where git is likely to be, for a process that was not started from a shell.
 *
 * A GUI-launched app on macOS inherits `/usr/bin:/bin:/usr/sbin:/sbin` and nothing else — none of
 * the login shell's additions. `git` from Homebrew or MacPorts is then simply not on the path, and
 * the spawn fails with ENOENT, which reads exactly like a directory that is not a repository.
 * Appended rather than prepended, so a path the user did set still wins.
 */
const LIKELY_PATHS = ["/usr/local/bin", "/opt/homebrew/bin", "/opt/local/bin", "/usr/bin", "/bin"];

/** The environment git should run in, given the one this process was handed. */
export function gitEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const env = { ...base };
	for (const name of REDIRECTING) delete env[name];

	// Windows env variables are case-insensitive and typically named `Path` rather than `PATH`.
	// A spread object `{ ...process.env }` loses the case-insensitive proxy, so find whichever key was used.
	const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
	const path = env[pathKey] ?? "";

	// POSIX-style search paths are only relevant on non-Windows platforms.
	if (process.platform !== "win32") {
		const known = new Set(path.split(delimiter).filter(Boolean));
		const missing = LIKELY_PATHS.filter((dir) => !known.has(dir));
		if (missing.length > 0) env[pathKey] = [path, ...missing].filter(Boolean).join(delimiter);
	}

	return env;
}

/**
 * Remote operations run inside the app, where there is nowhere appropriate to ask for credentials.
 *
 * Git's terminal switch does not cover credential helpers: on Windows, Git Credential Manager may
 * open its own window before Git falls back to a terminal prompt. Both switches are required so a
 * fetch fails promptly instead of leaving an orphaned credentials dialog behind after its timeout.
 */
export function remoteGitEnvironment(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	return { ...gitEnvironment(base), GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "0" };
}

/**
 * Built once. `process.env` does not change under us, and rebuilding it per call would put this
 * work on the path of every `git show` in a two-hundred-file diff.
 */
const GIT_ENV = gitEnvironment(process.env);
const REMOTE_GIT_ENV = remoteGitEnvironment(process.env);

export const MAX_FILES = 200;
export const MAX_BLOB_BYTES = 400_000;

/**
 * How many per-file reads may be outstanding at once.
 *
 * Every one of them is a `git show` — a process spawn — or a working-tree read, so this bounds
 * processes as much as descriptors. Unbounded over `MAX_FILES` would put two hundred git processes
 * on the machine at the same instant, trading a slow panel for a stalled laptop; one at a time is
 * what the three callers below all used to do, and it is a full round trip per file with nothing
 * else in flight. Eight keeps the spawn latency and the disk overlapped without being felt
 * elsewhere.
 */
const FILE_CONCURRENCY = 8;

/**
 * `Promise.all` with a ceiling, results in the order they went in.
 *
 * Shared rather than written three times because all three callers — the working-tree diff, the
 * ref-to-ref diff, and counting untracked files for status — have exactly the same shape: a list
 * of paths, one independent read each, and a wait that was almost entirely latency.
 */
export async function mapLimit<T, R>(items: T[], run: (item: T) => Promise<R>): Promise<R[]> {
	const out = Array.from<R>({ length: items.length });
	let next = 0;
	const workers = Array.from({ length: Math.min(FILE_CONCURRENCY, items.length) }, async () => {
		for (let i = next++; i < items.length; i = next++) out[i] = await run(items[i]);
	});
	await Promise.all(workers);
	return out;
}

export async function git(cwd: string, args: string[]): Promise<string> {
	const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 32 * 1024 * 1024, env: GIT_ENV });
	return stdout;
}

/**
 * The same, without deciding that the answer is text.
 *
 * `git show HEAD:logo.png` answers with a PNG. Decoded as UTF-8 it becomes mojibake that looks
 * enough like text to be diffed, counted and displayed — which is exactly what the review panel
 * used to do with every deleted image. Whether bytes are text is the caller's question, and it
 * cannot ask it once the bytes have already been mangled into a string.
 */
export async function gitBuffer(cwd: string, args: string[]): Promise<Buffer> {
	const { stdout } = await execFileAsync("git", args, {
		cwd,
		maxBuffer: 32 * 1024 * 1024,
		encoding: "buffer",
		env: GIT_ENV,
	});
	return stdout;
}

/**
 * Run git for its effect, reporting whether it worked.
 *
 * The message matters here in a way it does not for reads: "not a git repository", "would be
 * overwritten by merge" and "no upstream" are what people actually hit, and a bare "failed" tells
 * them none of it.
 */
export async function run(cwd: string, args: string[]): Promise<{ ok: boolean; error?: string }> {
	try {
		await git(cwd, args);
		return { ok: true };
	} catch (error) {
		const detail = error as { stderr?: string; stdout?: string; message?: string };
		const text = (detail.stderr || detail.stdout || detail.message || "").trim();
		return { ok: false, error: text.split("\n").slice(0, 3).join("\n") || "操作失败" };
	}
}

export interface RemoteResult {
	ok: boolean;
	error?: string;
	/** The caller stopped it. Not a failure, and nothing should be said about it. */
	cancelled?: boolean;
	/** Killed for taking too long. Distinguished because git leaves nothing on stderr when it is. */
	timedOut?: boolean;
}

/**
 * Run a git command that talks to a remote.
 *
 * Separate from `run` because everything about it is different once a network is involved.
 *
 * **It has to be able to stop.** `run` has no timeout, which is correct for reading the index and
 * wrong for `fetch`: a host that neither answers nor refuses holds the process until TCP gives up,
 * and the panel disables its other buttons while one of these is in flight. Without a bound, and
 * without a way to cancel, that is a panel someone is locked inside.
 *
 * **It must not wait for a person.** `GIT_TERMINAL_PROMPT=0` turns git's own prompt into an
 * immediate failure with a clear reason, while `GCM_INTERACTIVE=0` prevents Git Credential Manager
 * from opening a separate GUI prompt first. The latter matters on Windows because killing the git
 * process on timeout does not necessarily close the credential helper it launched.
 *
 * Deliberately does not set `GIT_ASKPASS`. Pointing it at a helper that answers with nothing makes
 * git complete an authentication attempt using an empty username, and the failure changes from
 * "there was nowhere to ask you" to "your credentials were rejected" — the same red bar, now naming
 * the wrong cause.
 */
export async function runRemote(
	cwd: string,
	args: string[],
	{ timeoutMs, signal }: { timeoutMs: number; signal?: AbortSignal },
): Promise<RemoteResult> {
	try {
		await execFileAsync("git", args, {
			cwd,
			maxBuffer: 32 * 1024 * 1024,
			env: REMOTE_GIT_ENV,
			timeout: timeoutMs,
			signal,
		});
		return { ok: true };
	} catch (error) {
		const detail = error as { stderr?: string; message?: string; killed?: boolean; name?: string };
		/*
		 * Three ways to end, and they are told apart by the error rather than by the output.
		 *
		 * Cancelled first: an aborted child is also a killed child, so asking `killed` first would
		 * report every cancellation as a timeout.
		 */
		if (detail.name === "AbortError") return { ok: false, cancelled: true };
		/*
		 * A timeout kills the process, so stderr is empty and `message` is `Command failed: git …`.
		 * Left to the generic path that string becomes the error the panel shows, which says what
		 * was run and nothing about what went wrong.
		 */
		if (detail.killed) return { ok: false, timedOut: true, error: "连接远端超时" };
		return { ok: false, error: explainGitFailure(detail.stderr ?? detail.message ?? "") };
	}
}
