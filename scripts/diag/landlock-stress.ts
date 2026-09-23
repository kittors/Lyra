// TEMPORARY diagnosis — see .github/workflows/diag-landlock.yml. Runs each variant many times, tallies how it ended.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const COUNT = Number(process.env.STRESS_COUNT ?? 300);
const PARALLEL = Number(process.env.STRESS_PARALLEL ?? 8);

// The runner as the desktop ships it: one bundled .mjs, no type stripping. Beside the source so `koffi` resolves.
const esbuildDir = readdirSync(join(root, "node_modules/.pnpm")).find((name) => name.startsWith("esbuild@"));
const bundled = join(root, "packages/core/src/sandbox/diag-runner.mjs");
const build = spawnSync(
	join(root, "node_modules/.pnpm", esbuildDir ?? "", "node_modules/esbuild/bin/esbuild"),
	[join(root, "packages/core/src/sandbox/runner-entry.ts"), "--bundle", "--platform=node", "--format=esm", "--external:koffi", `--outfile=${bundled}`],
	{ stdio: "inherit" },
);
if (build.status !== 0) console.log("esbuild failed; runner-js will fail too");

const entry = join(root, "packages/core/src/sandbox/runner-entry.ts");
const variant = join(root, "scripts/diag/landlock-variant.ts");
const ts = ["--experimental-strip-types", "--no-warnings"];

function runner(file: string, extra: string[], ws: string): string[] {
	return [...extra, file, "--lyra-sandbox-runner", "--workspace", ws, "--mode", "workspace-write", "--", "/bin/bash", "-c", "echo hi > f.txt && cat f.txt"];
}

const variants: Record<string, (ws: string) => string[]> = {
	plain: (ws) => [...ts, variant, "plain", ws],
	koffi: (ws) => [...ts, variant, "koffi", ws],
	ruleset: (ws) => [...ts, variant, "ruleset", ws],
	restrict: (ws) => [...ts, variant, "restrict", ws],
	"restrict-fixed": (ws) => [...ts, variant, "restrict-fixed", ws],
	"runner-ts": (ws) => runner(entry, ts, ws),
	"runner-js": (ws) => runner(bundled, [], ws),
};

async function stress(label: string, argv: (ws: string) => string[]): Promise<void> {
	const tally = new Map<string, number>();
	const examples: string[] = [];
	let started = 0;
	const started0 = Date.now();
	const one = (): Promise<void> =>
		new Promise((done) => {
			const ws = mkdtempSync(join(tmpdir(), "ll-"));
			const child = spawn(process.execPath, argv(ws), { cwd: ws, stdio: ["ignore", "pipe", "pipe"] });
			let out = "";
			child.stdout.on("data", (chunk) => (out += chunk));
			child.stderr.on("data", (chunk) => (out += chunk));
			child.on("close", (code, signal) => {
				const key = signal ?? (out.trim() === "hi" ? `exit ${code} ok` : `exit ${code} out=${JSON.stringify(out.slice(0, 120))}`);
				tally.set(key, (tally.get(key) ?? 0) + 1);
				if (signal && examples.length < 3) examples.push(`${signal}: ${JSON.stringify(out.slice(0, 300))}`);
				done();
			});
		});
	const lane = async () => {
		while (started < COUNT) {
			started++;
			await one();
		}
	};
	await Promise.all(Array.from({ length: PARALLEL }, lane));
	console.log(`${label.padEnd(15)} ${((Date.now() - started0) / 1000).toFixed(1)}s ${JSON.stringify(Object.fromEntries(tally))}`);
	for (const example of examples) console.log(`    ${example}`);
}

const only = process.env.STRESS_ONLY;
for (const [label, argv] of Object.entries(variants)) if (!only || only === label) await stress(label, argv);
