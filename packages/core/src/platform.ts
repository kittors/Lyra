/**
 * The handful of things that are not the same on every platform.
 *
 * Each of these was, until recently, written inline wherever it was needed — and each inline copy
 * was written for Unix, because that is what the machine under the keyboard was. None of them are
 * hard; they are simply invisible on the platform you develop on, and they stay invisible until
 * something runs somewhere else. When the release workflow first built on Windows, six of them
 * failed at once.
 *
 * So they live here, once, with the reason attached. The rule for adding to this file: if the
 * answer depends on `process.platform`, or on a separator, or on which environment variable a
 * concept happens to be spelled with, it belongs here rather than at the call site.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative, win32 } from "node:path";

export interface CommandShell {
	/** The executable to spawn. */
	file: string;
	/** The grammar a command line is written in. Git Bash is `posix`: it is bash. */
	kind: "posix" | "powershell";
	/** What to call it when telling the model or a person which shell this is. */
	label: string;
	/** The arguments that make `file` run one command line and exit. */
	args(command: string): string[];
}

/**
 * The shell the agent's commands run in.
 *
 * **Unix.** The user's own shell when it is bash or zsh, because that is the one their tools are
 * set up for; bash otherwise. Commands are written by a model, and models write bash: a `$SHELL` of
 * fish, nushell, xonsh or tcsh turned every `export A=1`, every `$(…)` and every `for … do … done`
 * into a syntax error, on the machines where people are most likely to have changed their shell.
 * The previous fallback — `/bin/bash` — is also not a path on a minimal Linux, where it was
 * `spawn /bin/bash ENOENT` for every command; `/bin/sh` is the last resort.
 *
 * zsh runs with `NOMATCH` off. A glob that matches nothing is an error in zsh and a literal in bash,
 * so `ls *.log 2>/dev/null`, `pip install foo[dev]` and `curl https://x/?a=b` all died with
 * `no matches found` before the command even started — each one a bash idiom a model writes without
 * thinking. With the option off, zsh does what bash does.
 *
 * **Windows.** Git Bash first, then PowerShell 7, then Windows PowerShell. This used to be
 * PowerShell alone, chosen on the grounds that it "understands the `&&` … that models write" and
 * that the embedded terminal starts it. The first half is true only of PowerShell 7: the one every
 * Windows actually has is 5.1, where `cd x && npm i` is a parse error — so the commonest shape of
 * command a model writes failed outright. The second half does not carry over: the terminal is for
 * a person, who picks their own shell; this is for a model, whose commands are bash whatever the
 * platform. Git for Windows is what brings `git` to almost every developer's Windows, and it brings
 * bash with it. When it is missing, the model is told which PowerShell it has, so it can write for it.
 *
 * `LYRA_SHELL` overrides all of this, for a bash or zsh or PowerShell installed where none of the
 * searches look.
 */
export function systemShell(): CommandShell {
	if (cachedShell && cachedFor === shellKey()) return cachedShell;
	cachedFor = shellKey();
	cachedShell = pickShell();
	return cachedShell;
}

let cachedShell: CommandShell | undefined;
let cachedFor: string | undefined;
/** The inputs the answer depends on, so a changed environment (a test, a settings change) is re-read. */
const shellKey = () => `${process.platform}\0${process.env.LYRA_SHELL ?? ""}\0${process.env.SHELL ?? ""}`;

function pickShell(): CommandShell {
	const override = process.env.LYRA_SHELL?.trim();
	if (override && existsSync(override)) {
		const shell = shellAt(override);
		if (shell) return shell;
	}
	if (process.platform === "win32") return windowsShell();

	const login = process.env.SHELL;
	if (login && existsSync(login)) {
		const shell = shellAt(login);
		if (shell) return shell;
	}
	for (const candidate of ["/bin/bash", "/usr/bin/bash", "/usr/local/bin/bash", "/opt/homebrew/bin/bash", "/run/current-system/sw/bin/bash"]) {
		if (existsSync(candidate)) return posix(candidate, "bash");
	}
	return posix("/bin/sh", "sh");
}

/** The shell at a path, if it is one this module knows how to drive. */
function shellAt(file: string): CommandShell | undefined {
	const name = basename(file).toLowerCase().replace(/\.exe$/, "");
	if (name === "bash") return posix(file, process.platform === "win32" ? "Git Bash" : "bash");
	if (name === "zsh") {
		return { file, kind: "posix", label: "zsh", args: (command) => ["+o", "nomatch", "-c", command] };
	}
	if (name === "sh" || name === "dash" || name === "ksh") return posix(file, name);
	if (name === "pwsh") return powershell(file, "PowerShell 7");
	if (name === "powershell") return powershell(file, "Windows PowerShell 5.1");
	return undefined;
}

function posix(file: string, label: string): CommandShell {
	return { file, kind: "posix", label, args: (command) => ["-c", command] };
}

/**
 * Run through PowerShell with the command encoded, and output forced to UTF-8.
 *
 * `-EncodedCommand` because a command line with quotes in it does not survive the trip through
 * `CreateProcess` into `-Command` intact — Windows has no argv, only a string each program splits
 * its own way. Base64 of UTF-16 has no quotes to lose.
 *
 * The prelude: PowerShell writes to a pipe in the console's code page (936 on a Chinese Windows),
 * which arrives here as mojibake, and a progress bar in a non-interactive session is emitted as
 * CLIXML noise on stderr. `-NoProfile` because a profile is somebody's interactive setup, slow to
 * load and free to print; `Bypass` because under the default policy `.\build.ps1` is refused.
 */
function powershell(file: string, label: string): CommandShell {
	const prelude =
		"$ProgressPreference='SilentlyContinue';" +
		"[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;" +
		"$OutputEncoding=[System.Text.Encoding]::UTF8;";
	return {
		file,
		kind: "powershell",
		label,
		args: (command) => [
			"-NoLogo",
			"-NoProfile",
			"-NonInteractive",
			"-ExecutionPolicy",
			"Bypass",
			"-EncodedCommand",
			Buffer.from(`${prelude}\n${command}`, "utf16le").toString("base64"),
		],
	};
}

function windowsShell(): CommandShell {
	const bash = gitBash();
	if (bash) return posix(bash, "Git Bash");
	const pwsh = onPath("pwsh.exe") ?? [join(process.env.ProgramFiles ?? "C:\\Program Files", "PowerShell", "7", "pwsh.exe")].find(existsSync);
	if (pwsh) return powershell(pwsh, "PowerShell 7");
	const root = process.env.SystemRoot ?? "C:\\Windows";
	const legacy = join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
	return powershell(existsSync(legacy) ? legacy : "powershell.exe", "Windows PowerShell 5.1");
}

/**
 * Git for Windows' `bin\bash.exe`, found the way a person would find it.
 *
 * From `git.exe` on the `PATH` first, because that is the installation this machine actually uses;
 * then the places the installers put it. `bin\bash.exe` rather than `usr\bin\bash.exe`: the former
 * is the launcher that puts Git's own tools on the `PATH` before starting bash.
 *
 * Never `System32\bash.exe` or a `WindowsApps` alias. Those are WSL: a Linux machine with its own
 * filesystem, where the workspace path means nothing and every command would run somewhere else.
 */
function gitBash(): string | undefined {
	const seen = new Set<string>();
	const candidates: string[] = [];
	for (const dir of pathDirs()) {
		if (!existsSync(win32.join(dir, "git.exe"))) continue;
		const lower = dir.toLowerCase().replace(/[\\/]+$/, "");
		let root = dir;
		if (/[\\/](mingw64|mingw32|clangarm64)[\\/]bin$/.test(lower)) root = win32.dirname(win32.dirname(dir));
		else if (/[\\/](cmd|bin)$/.test(lower)) root = win32.dirname(dir);
		candidates.push(win32.join(root, "bin", "bash.exe"));
	}
	const programFiles = [process.env.ProgramW6432, process.env.ProgramFiles, process.env["ProgramFiles(x86)"]].filter(Boolean) as string[];
	for (const base of programFiles) candidates.push(win32.join(base, "Git", "bin", "bash.exe"));
	if (process.env.LOCALAPPDATA) candidates.push(win32.join(process.env.LOCALAPPDATA, "Programs", "Git", "bin", "bash.exe"));
	candidates.push(win32.join(homedir(), "scoop", "apps", "git", "current", "bin", "bash.exe"));
	for (const candidate of candidates) {
		const key = candidate.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		if (isWslLauncher(candidate)) continue;
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

function isWslLauncher(file: string): boolean {
	const lower = file.toLowerCase();
	const root = (process.env.SystemRoot ?? "C:\\Windows").toLowerCase();
	return lower.startsWith(`${root}\\`) || lower.includes("\\windowsapps\\");
}

/** The directories on `PATH`, however this platform spells the variable. */
function pathDirs(): string[] {
	const raw = process.env.PATH ?? process.env.Path ?? "";
	return raw.split(process.platform === "win32" ? ";" : ":").filter(Boolean);
}

function onPath(file: string): string | undefined {
	for (const dir of pathDirs()) {
		const candidate = process.platform === "win32" ? win32.join(dir, file) : join(dir, file);
		if (!isWslLauncher(candidate) && existsSync(candidate)) return candidate;
	}
	return undefined;
}

/**
 * The user's login shell — the one their `PATH` and the rest of their environment is set up in.
 *
 * Not the same question as `systemShell`: a fish user's environment lives in fish's startup files
 * even though their commands run in bash. Asking bash for it would find none of it.
 */
export function loginShell(): string {
	const shell = process.env.SHELL;
	if (shell && existsSync(shell)) return shell;
	return existsSync("/bin/bash") ? "/bin/bash" : "/bin/sh";
}

/**
 * The grammars a command line should be read in, to judge it.
 *
 * Both, where the shell is PowerShell: the rules that read commands for risk and for reads were
 * written for bash, and a line that means one thing to bash and another to PowerShell has to be
 * judged by whichever reading finds more. Where the shell is bash or zsh, bash's alone.
 */
export function commandDialects(): ("posix" | "powershell")[] {
	return systemShell().kind === "powershell" ? ["posix", "powershell"] : ["posix"];
}

/** Forget the chosen shell, for tests that change the environment it was chosen from. */
export function resetSystemShell(): void {
	cachedShell = undefined;
	cachedFor = undefined;
}

/**
 * Where the user's home directory is.
 *
 * `os.homedir()` rather than `process.env.HOME`, because Windows spells it `USERPROFILE` and
 * `HOME` is usually unset there. Reading the variable directly gave `undefined`, and the code
 * around it then built paths beginning with the string "undefined".
 */
export const home = (): string => homedir();

/**
 * Is `target` inside `root` — the directory itself not counting as inside itself.
 *
 * Asked of `path`, never spelled out. The natural way to write this is
 * `` target.startsWith(`${root}/`) ``, and it is correct on Unix and quietly false on Windows for
 * every input, because the separator there is a backslash. A containment check that always answers
 * "no" does not look broken; it looks like the thing being asked about simply is not there. That
 * is how it survived: on Windows every MCP bundle was misfiled and every scratch directory looked
 * foreign, and nothing said so.
 *
 * Relative paths are never inside anything: the question only means something between two places
 * that are both pinned down.
 */
export function within(root: string, target: string): boolean {
	if (!isAbsolute(root) || !isAbsolute(target)) return false;
	const step = relative(root, target);
	return step !== "" && !step.startsWith("..") && !isAbsolute(step);
}

/** `within`, but the root counts as inside itself — for "may write here" rather than "is under". */
export const withinOrIs = (root: string, target: string): boolean =>
	root === target || within(root, target);
