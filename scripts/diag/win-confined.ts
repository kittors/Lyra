// TEMPORARY diagnosis — confined commands under a PowerShell parent: DLL init, language mode, error format.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalSandbox } from "../../packages/core/src/sandbox/local.ts";
import { commandShell, systemShell, type CommandShell } from "../../packages/core/src/platform.ts";

const ws = mkdtempSync(join(tmpdir(), "lyra-diag-"));
console.log("confined shell", commandShell("workspace-write").file, "| system shell", systemShell().file);

const pwsh7 = commandShell("workspace-write");
const cmd: CommandShell = { file: "C:\\Windows\\System32\\cmd.exe", kind: "posix", label: "cmd", args: (c) => ["/d", "/c", c] };
const ps51: CommandShell = { ...pwsh7, file: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe", label: "Windows PowerShell 5.1" };

function run(shell: CommandShell, command: string, mode: "read-only" | "workspace-write"): Promise<string> {
	return new Promise((resolve) => {
		const child = new LocalSandbox().run(command, { cwd: ws, mode, shell });
		let out = "";
		child.onOutput((chunk) => (out += chunk));
		child.onExit((code) => resolve(`exit ${code} (0x${((code ?? 0) >>> 0).toString(16)}) ${JSON.stringify(out.trim().slice(0, 300))}`));
		child.onError((error) => resolve(`error ${error.message}`));
	});
}

const probe = "Write-Output $ExecutionContext.SessionState.LanguageMode; Write-Output 中文; Write-Error boom; Write-Output after";
for (const mode of ["read-only", "workspace-write"] as const) {
	console.log(`[${mode}] cmd  : ${await run(cmd, "echo hi", mode)}`);
	console.log(`[${mode}] pwsh7: ${await run(pwsh7, probe, mode)}`);
	console.log(`[${mode}] ps5.1: ${await run(ps51, probe, mode)}`);
}
