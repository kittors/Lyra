/**
 * What the model must know about the shell to write a command that runs in it.
 *
 * Nothing on macOS or Linux: the tool is called `bash`, and bash or zsh is what runs. On Windows it
 * is the difference between working and not — a Windows path pasted into bash loses its
 * backslashes, and in Windows PowerShell 5.1 `&&` is a parse error.
 *
 * A function of the shell rather than a rule on the `bash` tool, because which shell that is
 * depends on the session: on Windows a confined command runs in PowerShell and an unconfined one
 * in Git Bash (`commandShell`). The system prompt passes the shell it names, so the two can never
 * disagree.
 */

import type { CommandShell } from "../platform.ts";

export function shellGuidance(shell: Pick<CommandShell, "kind" | "label">): string[] {
	if (shell.kind === "powershell") {
		return [
			`Commands run in ${shell.label}, not bash: write PowerShell.` +
				(shell.label.includes("5.1") ? " `&&` and `||` do not exist in this version: separate commands with `;` and test `$?` or `$LASTEXITCODE`." : "") +
				" Environment variables are `$env:NAME`, `/dev/null` is `$null`, and `Select-String` / `Select-Object -First N` stand in for grep / head.",
		];
	}
	if (shell.label === "Git Bash") {
		return [
			"Commands run in Git Bash on Windows: write bash, and write paths with forward slashes (`C:/Users/me/app` or `/c/Users/me/app`) — a backslash is an escape character here. Windows programs run directly; reach cmd's built-ins with `cmd //c <command>`.",
		];
	}
	return [];
}
