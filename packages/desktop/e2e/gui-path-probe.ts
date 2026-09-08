/* oxlint-disable no-console -- 探针的输出就是它的全部产物 */
/**
 * The PATH repair, in the real app, launched the way a double-click launches it.
 *
 * Not a test: it needs the app started with a deliberately crippled `PATH`, which is the one thing
 * `startApp` inherits from whoever runs it, and it reads the process tree rather than the window.
 *
 *   node --experimental-strip-types packages/desktop/e2e/gui-path-probe.ts
 *
 * The unit tests prove `primeCommandPath` works. They cannot prove anything calls it — and "the
 * code is there, the feature is not" has happened sixteen times in this repository. So this looks
 * for the one externally visible thing that call does: a login shell, spawned by the main process,
 * during startup.
 *
 * Run as a pair, because the absence is as much of a claim as the presence:
 *   - launched with launchd's PATH  → the shell is asked
 *   - launched with a real PATH     → it is not, and startup pays nothing
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { startApp } from "./app.ts";

const run = promisify(execFile);

/** What launchd hands a GUI process on macOS, and the whole of it. */
const GUI_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";

/**
 * Every descendant of `root`, by pid, with its command line.
 *
 * The shell lives for a few hundred milliseconds, so this is polled rather than sampled once — and
 * `ps` is asked for the whole tree because Electron's own helper processes sit between the main
 * process and anything it spawns.
 */
async function descendants(root: number): Promise<string[]> {
	const { stdout } = await run("ps", ["-eo", "pid=,ppid=,args="]).catch(() => ({ stdout: "" }));
	const rows = stdout
		.split("\n")
		.map((line) => line.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/))
		.filter((m): m is RegExpMatchArray => m !== null)
		.map((m) => ({ pid: Number(m[1]), ppid: Number(m[2]), args: m[3] }));

	const tree = new Set([root]);
	// Several passes: a grandchild's parent may appear after it in ps output.
	for (let i = 0; i < 4; i++) {
		for (const row of rows) if (tree.has(row.ppid)) tree.add(row.pid);
	}
	return rows.filter((r) => tree.has(r.pid) && r.pid !== root).map((r) => r.args);
}

/**
 * Watch for the login shell while the app boots, rather than after.
 *
 * The first version of this waited for `startApp` to resolve and then looked — and found nothing,
 * every time. The ask is kicked off at the top of `whenReady` and takes a few hundred milliseconds;
 * the window takes seven seconds. By the time there was a window to talk to, the shell had been
 * gone for six seconds. The probe was measuring its own latency.
 */
function watchWhileBooting(port: number, stop: () => boolean): Promise<string[]> {
	return (async () => {
		const seen = new Set<string>();
		let pid = 0;
		while (!stop()) {
			if (!pid) {
				const { stdout } = await run("pgrep", ["-f", `remote-debugging-port=${port}`]).catch(() => ({ stdout: "" }));
				pid = Number(stdout.trim().split("\n")[0]) || 0;
			}
			if (pid) {
				for (const args of await descendants(pid)) {
					// The ask is `$SHELL -lic 'printf …__LYRA_PATH__…'`; the marker is what makes it ours.
					if (args.includes("__LYRA_PATH__")) seen.add(args);
				}
			}
			await new Promise((r) => setTimeout(r, 10));
		}
		return [...seen];
	})();
}

async function boot(label: string, path: string, port: number) {
	const real = process.env.PATH;
	// startApp spreads process.env into the child, so this is how the app is made to look launched.
	process.env.PATH = path;

	let done = false;
	const watching = watchWhileBooting(port, () => done);
	const started = Date.now();
	const app = await startApp({ port });
	const bootMs = Date.now() - started;
	process.env.PATH = real;

	// A moment past the window, in case a slow shell is still going.
	await new Promise((r) => setTimeout(r, 1500));
	done = true;
	const shells = await watching;

	await app.stop();
	console.log(`\n【${label}】窗口就绪 ${bootMs}ms`);
	return { bootMs, shells };
}

async function main() {
	console.log("对照实验：应用启动时会不会去问登录 shell 要 PATH\n");

	const gui = await boot("图标启动（launchd 的 PATH）", GUI_PATH, 9331);
	console.log(`  抓到的登录 shell: ${gui.shells.length} 个`);
	for (const s of gui.shells) console.log(`    ${s.slice(0, 120)}`);
	console.log(`  ${gui.shells.length > 0 ? "✅" : "❌"} primeCommandPath 在启动时被调用了`);

	const term = await boot("终端启动（完整 PATH）", process.env.PATH ?? "", 9332);
	console.log(`  抓到的登录 shell: ${term.shells.length} 个`);
	console.log(`  ${term.shells.length === 0 ? "✅" : "❌"} PATH 已经是好的，一个 shell 都没起`);

	console.log(
		`\n启动耗时：图标启动 ${gui.bootMs}ms vs 终端启动 ${term.bootMs}ms` +
			`（问 shell 是异步的，不该拖慢窗口）`,
	);

	const ok = gui.shells.length > 0 && term.shells.length === 0;
	console.log(`\n${ok ? "✅ 接线是活的" : "❌ 接线有问题"}`);
	if (!ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
	console.error("探针失败:", error);
	process.exitCode = 1;
});