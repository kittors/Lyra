/**
 * The `PATH` a command should run with, on a machine where the app was launched from an icon.
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
 * So the shell is asked once, the way a terminal would start it, and the answer is kept. Asking is
 * skipped entirely when the inherited `PATH` already has more than the system directories in it —
 * which is every terminal launch, and therefore the CLI and the tests.
 *
 * `electron/git-exec.ts` solved the same problem for the built-in git panel by appending a list of
 * likely directories. That list is the fallback here, because a list cannot know where fnm put
 * tonight's node, and asking the shell can.
 */

import { execFile } from "node:child_process";
import { readdirSync } from "node:fs";
import { delimiter } from "node:path";
import { promisify } from "node:util";
import { home, systemShell } from "../platform.ts";

const run = promisify(execFile);

/**
 * What launchd hands a GUI process, and the whole of it.
 *
 * A `PATH` with nothing outside this set is one that no shell startup file has contributed to,
 * which is the signal that the app was double-clicked rather than started from a terminal.
 */
const SYSTEM_ONLY = new Set(["/usr/bin", "/bin", "/usr/sbin", "/sbin"]);

/**
 * nvm's node directories under `root`, newest version first.
 *
 * `~/.nvm/current/bin` used to stand here, and nvm does not create it — that is fnm's layout and
 * n's, not nvm's. nvm installs every version under `~/.nvm/versions/node/<version>/bin` and names
 * the active one only in `$NVM_BIN`, which a GUI process does not have. `~/.nvm/alias/default` is
 * no better: it holds an alias such as `lts/*`, which resolves through two more files before it
 * becomes a version.
 *
 * So the directory is read. A list cannot know which version the user's shell would have selected
 * — that is what asking the shell is for, and its answer still wins in `commandPath` — but the
 * newest installed is the closest a guess gets, and it beats a path that was never there.
 *
 * `root` is a parameter so the test can point it at a directory it made. Reading the real `~/.nvm`
 * would prove only what the machine running the test happens to have installed.
 */
export function nvmNodeBins(root: string): string[] {
	let names: string[];
	try {
		names = readdirSync(root);
	} catch {
		// No nvm here, or no permission to look. Both mean there is nothing to add.
		return [];
	}
	const found: Array<{ dir: string; parts: [number, number, number] }> = [];
	for (const name of names) {
		const version = /^v(\d+)\.(\d+)\.(\d+)$/u.exec(name);
		if (version) found.push({ dir: `${root}/${name}/bin`, parts: [Number(version[1]), Number(version[2]), Number(version[3])] });
	}
	// Numeric, not lexicographic: v9 sorts after v24 as text, and that is the wrong node.
	found.sort((left, right) => right.parts[0] - left.parts[0] || right.parts[1] - left.parts[1] || right.parts[2] - left.parts[2]);
	return found.map((entry) => entry.dir);
}

/**
 * Where tools are, for when the shell cannot be asked.
 *
 * The first three are `git-exec.ts`'s list, which is the one already shipping. The rest are the
 * default install locations of the package managers that this failure is actually about — a
 * fallback that cannot run `pnpm` is not much of a fallback.
 *
 * Read once, at load. The one directory listing this costs is a few hundred microseconds on a
 * directory with a handful of entries, and a version installed after launch is exactly the case
 * the shell is asked about anyway.
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
	// Newest only. Every extra entry is another directory the OS walks on a lookup that misses.
	...nvmNodeBins(`${home()}/.nvm/versions/node`).slice(0, 1),
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
const MARK = "__LYRA_PATH__";

/**
 * Long enough for a heavy `~/.zshrc`, short enough that the fallback takes over on a wedged one.
 *
 * Measured on an idle machine at 326ms for a login+interactive zsh with the usual plugins, and at
 * 1.2–2.1s for the same shell on a busy one. Nothing waits on this — see `primeCommandPath` — so
 * the timeout is only about when to stop hoping.
 */
const ASK_TIMEOUT_MS = 5_000;

/** Has any shell startup file contributed to this `PATH`? */
function assembledByAShell(path: string): boolean {
	return path.split(delimiter).filter(Boolean).some((dir) => !SYSTEM_ONLY.has(dir));
}

/**
 * Ask the user's shell what `PATH` it would give a terminal.
 *
 * `-l` for the login files, `-i` for `~/.zshrc` — both, because which of the two a person keeps
 * their `PATH` in is a matter of habit and neither is rare. Measured on one machine: `-lc` found
 * Homebrew only, `-lic` found Homebrew *and* fnm's current node.
 *
 * `stdin` is `/dev/null` rather than a pipe: a startup file that reads a line — asking about an
 * update, say — would otherwise wait on a pipe nobody is ever going to write to, and take the
 * timeout with it every time.
 */
async function askShell(): Promise<string | undefined> {
	const shell = systemShell();
	for (const flags of [`-lic`, `-lc`]) {
		try {
			const { stdout } = await run(shell.file, [flags, `printf '%s%s%s' '${MARK}' "$PATH" '${MARK}'`], {
				encoding: "utf8",
				timeout: ASK_TIMEOUT_MS,
				windowsHide: true,
			});
			const answer = stdout.split(MARK)[1];
			if (answer && answer.includes(delimiter)) return answer;
		} catch {
			// A shell that will not start non-interactively, a startup file that exits non-zero, the
			// timeout. All of them mean the same thing here: try the simpler flags, then give up.
		}
	}
	return undefined;
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
/** The in-flight ask, so concurrent callers share one shell rather than starting several. */
let asking: Promise<void> | undefined;

/**
 * Start asking the shell, and resolve when it has answered.
 *
 * Separate from `commandPath` because it is the slow half, and because *nothing waits on it*.
 * Doing this synchronously is the obvious implementation and the wrong one: `execFileSync` on a
 * login+interactive zsh froze the main process for one to two seconds, which in an Electron app is
 * a window that does not repaint — trading a broken command for a hung UI.
 *
 * So the first command runs on the fallback list, and every command after it runs on the real
 * environment. Callers that want even the first one to be right — the desktop app, which has a
 * startup to spend — can call this at launch and ignore the promise.
 */
export function primeCommandPath(): Promise<void> {
	if (asking) return asking;
	if (process.platform === "win32" || assembledByAShell(process.env.PATH ?? "")) {
		return (asking = Promise.resolve());
	}
	asking = askShell().then((answer) => {
		const dirs = answer?.split(delimiter).filter(Boolean);
		if (dirs?.length) resolved = dirs;
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
	if (assembledByAShell(path)) return inherited;
	/*
	 * Self-healing: if nobody primed us, the first command starts the ask and takes the fallback,
	 * and the second one has the real answer. A missing call at startup costs one command's worth
	 * of coverage rather than the whole feature.
	 */
	void primeCommandPath();
	return extend(path, resolved ?? LIKELY);
}

/** Testing seam: forget what the shell said, so the next call asks again. */
export function forgetCommandPath(): void {
	resolved = undefined;
	asking = undefined;
}
