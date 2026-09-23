/**
 * Running a `.cmd` or `.bat` on Windows, which Node will not do on its own.
 *
 * Since the fix for CVE-2024-27980, `spawn`/`execFile` refuse a batch file unless a shell is asked
 * for, and throw EINVAL. VS Code and Cursor put `code.cmd`/`cursor.cmd` on PATH, npm puts a `.cmd`
 * shim there for every global tool — so 「用 VS Code 打开」 fell into its error handler every time
 * and quietly opened the file with the system default instead, and a formatter installed with
 * `npm i -g` could never run.
 *
 * `shell: true` is not the answer: Node then hands cmd.exe a line it built by joining the arguments
 * with spaces, and a folder called `a&calc` is two commands. So the line is built here, quoted and
 * escaped for cmd, and passed through untouched (`windowsVerbatimArguments`).
 *
 * The escaping is cross-spawn's (MIT, https://github.com/moxystudio/node-cross-spawn), which is
 * what npm's own ecosystem relies on for exactly this: quote each argument by the MSVCRT rules,
 * then put a caret in front of every character cmd would otherwise act on — including the quotes,
 * so cmd's own quote tracking never gets a say.
 */

import { envValue } from "./find-executable.ts";

/** Everything cmd.exe gives a meaning to on a command line. */
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

/**
 * npm's shims forward their arguments through a second cmd line (`%*`), so what reaches the tool
 * has been through cmd twice and needs escaping twice. The same rule cross-spawn applies.
 */
const NPM_SHIM = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i;

export function needsCmdShell(file: string): boolean {
	return /\.(cmd|bat)$/i.test(file);
}

function escapeCommand(command: string): string {
	return command.replace(CMD_META, "^$1");
}

function escapeArgument(argument: string, twice: boolean): string {
	/*
	 * cmd.exe cannot carry a line break inside an argument: it ends the command there. There is no
	 * escape for it, so the only safe answer is to refuse — a path never contains one, and an
	 * argument that does is not something to hand to a shell.
	 */
	if (/[\r\n]/.test(argument)) throw new Error("cmd.exe cannot pass an argument containing a line break");
	// Backslashes before a quote are doubled and the quote escaped; trailing backslashes are doubled
	// so they do not escape the closing quote. Written without backtracking (see cross-spawn #160).
	let quoted = argument.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"').replace(/(?=(\\+?)?)\1$/, "$1$1");
	quoted = `"${quoted}"`.replace(CMD_META, "^$1");
	return twice ? quoted.replace(CMD_META, "^$1") : quoted;
}

/**
 * How to start a batch file with these arguments: cmd.exe, and the one line it should run.
 *
 * `/d` skips AutoRun, so a user's cmd profile cannot change what runs; `/v:off` turns delayed
 * expansion off even where the registry turned it on, so `!name!` stays text; `/s /c "…"` strips
 * exactly the outer pair of quotes and runs the rest.
 */
export function cmdInvocation(
	file: string,
	args: string[],
	env: NodeJS.ProcessEnv,
): { file: string; args: string[]; windowsVerbatimArguments: true } {
	const twice = NPM_SHIM.test(file);
	const line = [escapeCommand(file), ...args.map((argument) => escapeArgument(argument, twice))].join(" ");
	return {
		file: envValue(env, "ComSpec", "win32") || "cmd.exe",
		args: ["/d", "/v:off", "/s", "/c", `"${line}"`],
		windowsVerbatimArguments: true,
	};
}
