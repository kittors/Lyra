// TEMPORARY diagnosis — see .github/workflows/diag-landlock.yml. Run real commands through the Windows runner and print what happened.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { confine, resetProbeCache } from "../../packages/core/src/sandbox/backend.ts";
import { systemShell } from "../../packages/core/src/platform.ts";

const shell = systemShell();
console.log("shell:", shell.label, shell.file);
const ws = mkdtempSync(join(tmpdir(), "lyra-win-"));
writeFileSync(join(ws, "readme.txt"), "hello from the workspace\n");
const outside = join(homedir(), `lyra-outside-${process.pid}.txt`);

const commands = [
	"echo plain",
	"cat readme.txt",
	"echo x > inside.txt && cat inside.txt",
	`echo x > '${outside.replaceAll("\\", "/")}'; echo "exit=$?"`,
	"cat > note.txt <<'EOF'\nheredoc line\nEOF\ncat note.txt",
	'f=$(mktemp) && echo t > "$f" && cat "$f" && rm "$f"',
	"mkdir -p a/b && echo m > a/b/f && mv a/b/f a/g && cat a/g",
	"echo piped | tr a-z A-Z",
	"git --version && git init -q repo && cd repo && git status --short && echo git-ok",
	"node -e \"console.log('node', process.version)\"",
	"ls -la | head -5",
	"(echo b; echo a) | sort | uniq && echo \"year $(date +%Y)\"",
	"sleep 5 & kill $! ; wait $! ; echo \"killed=$?\"",
	"timeout 2 sleep 5; echo \"timeout=$?\"",
];

for (const mode of ["read-only", "workspace-write"] as const) {
	resetProbeCache();
	let wrap;
	try {
		wrap = confine({ mode, workspaceRoot: ws }, { platform: "win32" });
	} catch (error) {
		console.log(`[${mode}] confine threw: ${error instanceof Error ? error.message : String(error)}`);
		continue;
	}
	if (!wrap) {
		console.log(`[${mode}] not wrapped`);
		continue;
	}
	console.log(`[${mode}] runner ${wrap.runner}: ${wrap.command} ${wrap.args.join(" ")}`);
	const usrBash = join(shell.file, "..", "..", "usr", "bin", "bash.exe");
	const direct: string[][] = [
		["cmd.exe", "/d", "/c", "echo cmd-plain"],
		["cmd.exe", "/d", "/c", "echo x> inside-cmd.txt && type inside-cmd.txt"],
		["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "Write-Output ps-plain; Set-Content -Path ps.txt -Value 1; Get-Content ps.txt"],
		[usrBash, "-c", "echo usr-bash; echo x > inside-usr.txt; cat inside-usr.txt"],
	];
	for (const argv of direct) {
		const started = Date.now();
		const result = spawnSync(wrap.command, [...wrap.args, ...argv], { cwd: ws, env: { ...process.env, ...wrap.env }, encoding: "utf8", windowsHide: true, timeout: 60_000 });
		const out = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().replaceAll("\n", "\n      ");
		console.log(`  [${mode}] ${JSON.stringify(argv.join(" ").slice(0, 70))} → status ${result.status} ${Date.now() - started}ms${result.error ? ` error ${result.error.message}` : ""}\n      ${out}`);
	}
	for (const command of commands) {
		const started = Date.now();
		const result = spawnSync(wrap.command, [...wrap.args, shell.file, ...shell.args(command)], {
			cwd: ws,
			env: { ...process.env, ...wrap.env },
			encoding: "utf8",
			windowsHide: true,
			timeout: 60_000,
		});
		const out = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim().replaceAll("\n", "\n      ");
		console.log(`  [${mode}] ${JSON.stringify(command.slice(0, 60))} → status ${result.status} signal ${result.signal} ${Date.now() - started}ms${result.error ? ` error ${result.error.message}` : ""}\n      ${out}`);
	}
}
