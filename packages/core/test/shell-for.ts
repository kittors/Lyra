/**
 * The same small commands, spelled for whichever shell runs under a mode.
 *
 * On macOS and Linux that is bash or zsh in every mode. On Windows a confined command runs in
 * PowerShell and an unconfined one in Git Bash (`commandShell`) — so a test that writes a file
 * under `workspace-write` has to write it in PowerShell there, or it tests the grammar instead of
 * the sandbox. Every command here works in Windows PowerShell 5.1 as well as 7: no `&&`.
 */

import { commandShell } from "../src/platform.ts";
import type { SandboxMode } from "../src/sandbox/policy.ts";

export function shellFor(mode: SandboxMode | undefined) {
	const powershell = commandShell(mode).kind === "powershell";
	/** A path as this shell reads it: single-quoted, and with forward slashes for a POSIX shell on Windows. */
	const quote = powershell
		? (path: string) => `'${path.replaceAll("'", "''")}'`
		: (path: string) => `'${path.replaceAll("\\", "/").replaceAll("'", "'\\''")}'`;
	return {
		powershell,
		quote,
		/** Write `text` into the file at `path`. */
		write: (path: string, text = "hi") => (powershell ? `Set-Content -LiteralPath ${quote(path)} -Value '${text}'` : `echo ${text} > ${quote(path)}`),
		/** Run `first`, then print DONE only if it succeeded. */
		thenDone: (first: string) => (powershell ? `${first}; if ($?) { 'DONE' }` : `${first} && echo DONE`),
		/** A write to the null device, which every mode has to allow. */
		discard: powershell ? "'hi' > $null" : "echo hi > /dev/null",
		/** Read the start of the file at `path`, printing nothing. */
		read: (path: string) => (powershell ? `Get-Content -LiteralPath ${quote(path)} -TotalCount 1 > $null` : `head -c 4 ${quote(path)} > /dev/null`),
		/** Make a directory, parents included. */
		mkdir: (path: string) => (powershell ? `New-Item -ItemType Directory -Force -Path ${quote(path)} > $null` : `mkdir -p ${quote(path)}`),
	};
}
