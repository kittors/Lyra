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

import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
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
 *
 * This is the shell for a command that runs unconfined. A confined one on Windows runs in
 * PowerShell instead — see `commandShell`.
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
	/*
	 * `NormalView`: PowerShell 7 shows an error as its message alone, and the message is in the
	 * system's language on a Windows PowerShell. The classic view adds the `CategoryInfo` and
	 * `FullyQualifiedErrorId` lines, whose identifiers are never translated — the one part of a
	 * refusal that reads the same on every Windows (see `looksDenied`), and a line and column besides.
	 */
	const prelude =
		"$ProgressPreference='SilentlyContinue';" +
		"$ErrorView='NormalView';" +
		"[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;" +
		"$OutputEncoding=[System.Text.Encoding]::UTF8;";
	return {
		file,
		kind: "powershell",
		label,
		args: (command) => {
			const script = `${prelude}\n${command}`;
			const encoded = Buffer.from(script, "utf16le").toString("base64");
			const flags = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"];
			return encoded.length <= MAX_ENCODED_COMMAND ? [...flags, "-EncodedCommand", encoded] : [...flags, "-File", scriptFile(script)];
		},
	};
}

/**
 * The longest `-EncodedCommand` passed on the command line itself.
 *
 * A Windows command line holds 32,767 characters, and base64 of UTF-16 spends about 2.7 of them on
 * each character of the command — so anything past roughly twelve thousand characters did not start
 * at all: `spawn ENAMETOOLONG`, for a `node -e` with a long script in it, or a file written out in a
 * here-string. A confined command pays for the runner's own arguments on the same line as well.
 * Past this, the command goes in a script file instead.
 */
const MAX_ENCODED_COMMAND = 24_000;

/**
 * A command too long for the command line, written where PowerShell can run it with `-File`.
 *
 * With a byte-order mark, which is what makes Windows PowerShell 5.1 read the file as UTF-8 rather
 * than in the console's code page. The last line keeps `-Command`'s exit status: `-File` reports 0
 * after a failed last command, where `-Command` reports failure. Named by content, so running the
 * same long command again reuses its file; under the temp directory, which the sandbox lets every
 * mode read.
 */
function scriptFile(script: string): string {
	const body = `${script}\nif (-not $?) { exit $(if ($LASTEXITCODE) { $LASTEXITCODE } else { 1 }) }\n`;
	const file = join(tmpdir(), `lyra-command-${createHash("sha256").update(body).digest("hex").slice(0, 16)}.ps1`);
	writeFileSync(file, `\uFEFF${body}`, "utf8");
	return file;
}

function windowsShell(): CommandShell {
	const bash = gitBash();
	if (bash) return posix(bash, "Git Bash");
	return windowsPowerShell();
}

/** PowerShell 7 where it is installed, and otherwise the Windows PowerShell 5.1 every Windows has. */
function windowsPowerShell(): CommandShell {
	const pwsh = onPath("pwsh.exe") ?? [join(process.env.ProgramFiles ?? "C:\\Program Files", "PowerShell", "7", "pwsh.exe")].find(existsSync);
	if (pwsh) return powershell(pwsh, "PowerShell 7");
	const root = process.env.SystemRoot ?? "C:\\Windows";
	const legacy = join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
	return powershell(existsSync(legacy) ? legacy : "powershell.exe", "Windows PowerShell 5.1");
}

/** How far a command is confined — the vocabulary of `sandbox/policy.ts`, spelled out to keep this file a leaf. */
type Confinement = "read-only" | "workspace-write" | "danger-full-access";

/**
 * The shell a command runs in, given how it is confined.
 *
 * `systemShell` everywhere but one place: a confined command on Windows runs in PowerShell. Git
 * Bash cannot start under the restricted token that confines it. Every MSYS2 program — bash, and
 * the `sh` Git runs hooks with — creates a private signal pipe for itself as it starts, with a DACL
 * naming only the user, Administrators and SYSTEM, and then opens it for writing. A write-restricted
 * token passes a write only through its restricting SIDs, and the user's own SID cannot be one of
 * them without granting the whole profile back: so bash died on its first line, `couldn't create
 * signal pipe, Win32 error 5`, before running anything. There is no granting around it — the pipe is
 * made by bash itself, after the privileges are gone. PowerShell is an ordinary Win32 process and
 * runs confined exactly as it should: writes inside the workspace, refused outside it.
 *
 * Chosen by the mode a session *announces* — the one its system prompt names the shell for — and
 * not by what one call was escalated to: an escalated command is still the command the model wrote,
 * in the grammar it was told to write in.
 *
 * `LYRA_SHELL` is honoured here only when it names a PowerShell; one that names Git Bash would
 * fail on every command.
 */
export function commandShell(mode?: Confinement): CommandShell {
	if (process.platform !== "win32" || mode === undefined || mode === "danger-full-access") return systemShell();
	if (confinedShell && confinedFor === shellKey()) return confinedShell;
	confinedFor = shellKey();
	const override = process.env.LYRA_SHELL?.trim();
	const chosen = override && existsSync(override) ? shellAt(override) : undefined;
	confinedShell = chosen?.kind === "powershell" ? chosen : windowsPowerShell();
	return confinedShell;
}

let confinedShell: CommandShell | undefined;
let confinedFor: string | undefined;

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
 * Both, wherever the shell may be PowerShell: the rules that read commands for risk and for reads
 * were written for bash, and a line that means one thing to bash and another to PowerShell has to
 * be judged by whichever reading finds more. That is every Windows — its confined modes run
 * PowerShell and full access runs Git Bash (`commandShell`), and a verdict about a command must not
 * hang on which of the two happens to run it — and anywhere `LYRA_SHELL` picked a PowerShell.
 * Elsewhere, bash's reading alone.
 */
export function commandDialects(): ("posix" | "powershell")[] {
	return process.platform === "win32" ? ["posix", "powershell"] : dialectsOf(systemShell());
}

/**
 * The grammars to judge a command in when it is known which shell runs it: bash's always, because
 * the rules were written for it, and PowerShell's as well when that is the shell.
 */
export function dialectsOf(shell: Pick<CommandShell, "kind">): ("posix" | "powershell")[] {
	return shell.kind === "powershell" ? ["posix", "powershell"] : ["posix"];
}

/** Forget the chosen shells, for tests that change the environment they were chosen from. */
export function resetSystemShell(): void {
	cachedShell = undefined;
	cachedFor = undefined;
	confinedShell = undefined;
	confinedFor = undefined;
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
