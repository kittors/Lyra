/**
 * The environment a command should run with, on a machine where the app was launched from an icon.
 *
 * A GUI-launched app on macOS inherits `/usr/bin:/bin:/usr/sbin:/sbin` from launchd and nothing
 * else. `git` and `python3` live there; `node`, `npm`, `npx`, `pnpm`, `yarn`, `corepack` and `bun`
 * do not. Neither does anything a version manager installs — fnm, nvm, volta, asdf all put their
 * shims somewhere under `$HOME` and announce them from a shell startup file.
 *
 * Spawning through `$SHELL -c` does not recover them. That is a non-interactive, non-login shell:
 * zsh reads `~/.zshenv` and stops, so the `export PATH=…` that almost everybody keeps in `~/.zshrc`
 * never runs. The command then fails with `command not found` for a tool the user can run in their
 * own terminal without thinking about it, which reads as the app being broken rather than as an
 * environment that was never assembled.
 *
 * This was not hypothetical. In one user's session history `pnpm` was not found 50 times, `node` 25
 * and `corkscrew` 23 — the last of those being an ssh `ProxyCommand`, so every SSH git operation
 * failed too. In the same history, 15% of all commands the model wrote began by exporting `PATH`
 * itself: it had learned to patch around this one call at a time.
 *
 * `PATH` was the loudest symptom of a wider gap: everything else those startup files export was
 * missing too. `https_proxy` — without which, behind the proxies common in China, `git push`, `npm
 * install` and `curl` time out while the same commands work in the user's terminal — and
 * `SSH_AUTH_SOCK` for 1Password's or another agent, `LANG`, `JAVA_HOME`, `GOPATH`. So the shell is
 * asked once for its whole environment, the way a terminal would start it, and the answer is kept.
 *
 * On Linux the same launch looks different, which is why "is this a GUI launch" is no longer read
 * off `PATH`: a desktop session hands its apps `/usr/local/bin`, `/usr/games` and `/snap/bin` as
 * well as the system four, so that test said "a shell built this" and never asked — and nvm's node,
 * configured in `~/.bashrc` like everywhere else, was `command not found` in every session.
 *
 * `electron/git-exec.ts` solved the `PATH` half for the built-in git panel by appending a list of
 * likely directories. That list is the fallback here, because a list cannot know where fnm put
 * tonight's node, and asking the shell can.
 */

import { spawn } from "node:child_process";
import { basename, delimiter } from "node:path";
import { home, loginShell } from "../platform.ts";

/**
 * What launchd hands a GUI process, and the whole of it.
 *
 * A `PATH` with nothing outside this set is one that no shell startup file has contributed to,
 * which is the signal that the app was double-clicked rather than started from a terminal.
 */
const SYSTEM_ONLY = new Set(["/usr/bin", "/bin", "/usr/sbin", "/sbin"]);

/**
 * Where tools are, for when the shell cannot be asked.
 *
 * The first three are `git-exec.ts`'s list, which is the one already shipping. The rest are the
 * default install locations of the package managers that this failure is actually about — a
 * fallback that cannot run `pnpm` is not much of a fallback.
 */
const LIKELY = [
	"/usr/local/bin",
	"/opt/homebrew/bin",
	"/opt/local/bin",
	`${home()}/.local/bin`,
	`${home()}/Library/pnpm`,
	`${home()}/.local/share/pnpm`,
	`${home()}/.pnpm`,
	`${home()}/.bun/bin`,
	`${home()}/.cargo/bin`,
	`${home()}/.volta/bin`,
	`${home()}/.nvm/current/bin`,
	`${home()}/.asdf/shims`,
];

/**
 * The guesses, readable from outside, so a test can ask whether this host is one they cover.
 *
 * "The fallback can find pnpm" is only a question worth asking where pnpm is installed somewhere a
 * person would install it. CI puts it under a scratch directory of the runner's own making —
 * `/home/runner/setup-pnpm/node_modules/.bin` — and a list of the places people keep tools has no
 * reason to know that one. Without this the test could only be written as "skip when it fails",
 * which is not a test; with it, the skip states what is actually missing.
 */
export const FALLBACK_DIRS: readonly string[] = LIKELY;

/**
 * Wraps the answer so it survives a talkative startup file.
 *
 * An interactive shell is within its rights to print things — a greeting, a version notice, an
 * `oh-my-zsh` update prompt — and all of it lands on the same stdout. Reading the whole output as
 * the answer produced a `PATH` with a MOTD in it. Bracketing means the answer is found rather than
 * assumed.
 */
const MARK = "__LYRA_ENV__";

/**
 * Long enough for a heavy `~/.zshrc`, short enough that the fallback takes over on a wedged one.
 *
 * Measured on an idle machine at 326ms for a login+interactive zsh with the usual plugins, and at
 * 1.2–2.1s for the same shell on a busy one. Nothing waits on this — see `primeCommandPath` — so
 * the timeout is only about when to stop hoping.
 */
const ASK_TIMEOUT_MS = 5_000;

/** Login shells whose `-l -i -c` and single-quoting this knows how to speak. */
const ASKABLE = new Set(["bash", "zsh", "sh", "dash", "ksh", "fish"]);

/**
 * Variables that describe the shell that answered, or this app, rather than the user.
 *
 * `PWD` and `SHLVL` are the answering shell's own state; the terminal ones would tell a command it
 * runs in iTerm when it runs in nothing; `ELECTRON_RUN_AS_NODE` is how the question was asked, and
 * left in, every Electron-based CLI the agent ran — VS Code's `code` among them — would start as a
 * bare Node instead.
 */
const NOT_THE_USERS = new Set([
	"PWD", "OLDPWD", "SHLVL", "_", "PS1", "PS2", "PS3", "PS4", "PROMPT", "RPROMPT", "COLUMNS", "LINES",
	"TERM", "COLORTERM", "WINDOWID", "STY", "SHELL_SESSION_ID", "ZSH_EXECUTION_STRING",
	"ELECTRON_RUN_AS_NODE", "ELECTRON_NO_ATTACH_CONSOLE",
]);
const NOT_THE_USERS_PREFIX = /^(TERM_|ITERM_|TMUX|KITTY_|WEZTERM_|ALACRITTY_|VTE_|GHOSTTY_)/;

/** Has any shell startup file contributed to this `PATH`? */
function assembledByAShell(path: string): boolean {
	return path.split(delimiter).filter(Boolean).some((dir) => !SYSTEM_ONLY.has(dir));
}

/** POSIX single-quoting, which fish reads the same way for anything without a backslash in it. */
const quote = (text: string) => `'${text.replace(/'/g, "'\\''")}'`;

/**
 * Ask the user's login shell for the environment it would give a terminal.
 *
 * `-l` for the login files, `-i` for `~/.zshrc` — both, because which of the two a person keeps
 * their settings in is a matter of habit and neither is rare. Measured on one machine: `-lc` found
 * Homebrew only, `-lic` found Homebrew *and* fnm's current node.
 *
 * The shell runs this process's own binary as Node to print `process.env` as JSON, which survives
 * values with newlines in them — `env` output does not — and needs no `printf` in fish.
 *
 * `stdin` is `/dev/null` rather than a pipe: a startup file that reads a line — asking about an
 * update, say — would otherwise wait on a pipe nobody is ever going to write to, and take the
 * timeout with it every time.
 */
async function askShell(): Promise<Record<string, string> | undefined> {
	const shell = loginShell();
	if (!ASKABLE.has(basename(shell))) return undefined;
	const script = `process.stdout.write(${JSON.stringify(MARK)}+JSON.stringify(process.env)+${JSON.stringify(MARK)})`;
	const command = `${quote(process.execPath)} -e ${quote(script)}`;
	for (const flags of [["-l", "-i", "-c"], ["-l", "-c"]]) {
		const stdout = await capture(shell, [...flags, command]);
		const answer = stdout?.split(MARK)[1];
		if (!answer) continue;
		try {
			const env = JSON.parse(answer) as Record<string, string>;
			if (typeof env.PATH === "string" && env.PATH.includes(delimiter)) return env;
		} catch {
			// A startup file that printed our mark itself. Try the simpler flags.
		}
	}
	return undefined;
}

/** Run one shell to completion and return its stdout, or undefined on any failure or timeout. */
function capture(file: string, args: string[]): Promise<string | undefined> {
	return new Promise((resolve) => {
		let stdout = "";
		let done = false;
		const finish = (value: string | undefined) => {
			if (done) return;
			done = true;
			clearTimeout(timer);
			resolve(value);
		};
		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(file, args, {
				stdio: ["ignore", "pipe", "ignore"],
				env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
				windowsHide: true,
			});
		} catch {
			resolve(undefined);
			return;
		}
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			finish(undefined);
		}, ASK_TIMEOUT_MS);
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
		child.on("error", () => finish(undefined));
		// A startup file that exits non-zero after exporting everything is still an answer.
		child.on("close", () => finish(stdout));
	});
}

/**
 * Directories from `extra` that `path` does not already have, in order, each of them once.
 *
 * `extra` arrives with duplicates of its own: a login+interactive shell runs `~/.zprofile` and
 * `~/.zshrc`, and a `PATH="$HOME/bin:$PATH"` in both — which is the ordinary way people write it —
 * produces every directory twice. One real machine answered with 45 entries of which 32 were
 * distinct. Nothing breaks, but every failed lookup then walks thirteen directories it has already
 * been told about.
 */
function missingFrom(path: string, extra: string[]): string[] {
	const known = new Set(path.split(delimiter).filter(Boolean));
	const out: string[] = [];
	for (const dir of extra) {
		if (!dir || known.has(dir)) continue;
		known.add(dir);
		out.push(dir);
	}
	return out;
}

/**
 * Appended, never substituted.
 *
 * The system directories are how `git` and `python3` are found at all, and a shell that answers
 * with a `PATH` missing one of them — or an answer that never arrives — must not be able to take
 * them away. Whatever else happens, the command is no worse off than it was.
 */
const extend = (path: string, extra: string[]): string =>
	[path, ...missingFrom(path, extra)].filter(Boolean).join(delimiter);

/**
 * The directories the shell named, once it has named them.
 *
 * Stored as the shell's own answer rather than as a finished `PATH`, because the `PATH` to extend
 * is the caller's and is not necessarily this process's. Keeping the two apart means an answer
 * fetched for one can never be handed back attached to the wrong base.
 */
let resolved: string[] | undefined;
/** Everything else the shell exported, less what describes the shell itself. */
let resolvedEnv: Record<string, string> | undefined;
/** The in-flight ask, so concurrent callers share one shell rather than starting several. */
let asking: Promise<void> | undefined;
/** Whether `asking` really asked, or only decided there was no need. */
let asked = false;

/**
 * Was this process started from a terminal?
 *
 * Then its environment is the terminal's — including whatever the user exported a moment before
 * launching — and replacing it with their startup files' defaults would lose exactly that. A
 * terminal sets `TERM`; launchd and a desktop session do not.
 */
const fromTerminal = (): boolean => {
	const term = process.env.TERM;
	return Boolean((term && term !== "dumb") || process.env.TERM_PROGRAM);
};

/**
 * Start asking the shell, and resolve when it has answered.
 *
 * Separate from `commandEnv` because it is the slow half, and because *nothing waits on it*.
 * Doing this synchronously is the obvious implementation and the wrong one: `execFileSync` on a
 * login+interactive zsh froze the main process for one to two seconds, which in an Electron app is
 * a window that does not repaint — trading a broken command for a hung UI.
 *
 * So the first command runs on the fallback list, and every command after it runs on the real
 * environment. Callers that want even the first one to be right — the desktop app, which has a
 * startup to spend — call this at launch with `always`, which asks whenever the app was not started
 * from a terminal, whatever its `PATH` looks like. Without it, only a starved `PATH` is reason to
 * ask: the CLI and the tests run in a terminal and must not pay for a shell.
 */
export function primeCommandPath(options: { always?: boolean } = {}): Promise<void> {
	const wanted = process.platform !== "win32" && (options.always ? !fromTerminal() : !assembledByAShell(process.env.PATH ?? ""));
	if (asking && (asked || !wanted)) return asking;
	if (!wanted) return (asking = Promise.resolve());
	asked = true;
	asking = askShell().then((env) => {
		if (!env) return;
		const dirs = env.PATH?.split(delimiter).filter(Boolean);
		if (dirs?.length) resolved = dirs;
		const kept: Record<string, string> = {};
		for (const [key, value] of Object.entries(env)) {
			if (key === "PATH" || NOT_THE_USERS.has(key) || NOT_THE_USERS_PREFIX.test(key)) continue;
			kept[key] = value;
		}
		resolvedEnv = kept;
	});
	return asking;
}

/**
 * The `PATH` to run commands with, given the one this process was handed.
 *
 * Returns the input unchanged whenever it can — a terminal-launched app, the CLI, the tests and
 * every Windows launch all take that path, and none of them start a shell.
 */
export function commandPath(inherited: string | undefined): string | undefined {
	// Windows GUI processes read their PATH from the registry, so it is already the real one.
	if (process.platform === "win32") return inherited;
	const path = inherited ?? "";
	/*
	 * The shell's order first, because it is the user's: their terminal finds Homebrew's `git` and
	 * nvm's `node` before the system's, and a command run here should find the same ones.
	 */
	if (resolved) return extend("", [...resolved, ...path.split(delimiter)]);
	if (assembledByAShell(path)) return inherited;
	/*
	 * Self-healing: if nobody primed us, the first command starts the ask and takes the fallback,
	 * and the second one has the real answer. A missing call at startup costs one command's worth
	 * of coverage rather than the whole feature.
	 */
	void primeCommandPath();
	return extend(path, LIKELY);
}

/**
 * The environment to run a command with, given the one this process was handed.
 *
 * The login shell's variables over the inherited ones, once it has answered — so a proxy, an ssh
 * agent or a `JAVA_HOME` set in a startup file reaches the command the way it reaches the user's
 * terminal — and `PATH` from `commandPath`.
 *
 * `PATH` is assigned only when it actually changed, rather than unconditionally: Windows spells
 * this variable `Path`, and `{ ...process.env }` loses the case-insensitive proxy that makes the two
 * the same key. Writing `PATH` onto that object would leave the child with both, and the one that
 * wins is not ours to predict.
 */
export function commandEnv(inherited: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...inherited };
	if (process.platform === "win32") return env;
	if (resolvedEnv) Object.assign(env, resolvedEnv);
	const repaired = commandPath(inherited.PATH);
	if (repaired !== undefined && repaired !== env.PATH) env.PATH = repaired;
	return env;
}

/** Testing seam: forget what the shell said, so the next call asks again. */
export function forgetCommandPath(): void {
	resolved = undefined;
	resolvedEnv = undefined;
	asking = undefined;
	asked = false;
}
