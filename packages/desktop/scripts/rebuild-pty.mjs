/**
 * Rebuild node-pty against Electron's ABI.
 *
 * node-pty is a native addon, and npm installs it compiled for the Node that ran the install —
 * a different ABI from the Electron that has to load it. Without this step the app throws
 * NODE_MODULE_VERSION on boot, and the terminal panel is the least of what breaks.
 *
 * node-gyp directly rather than `@electron/rebuild`: the latter failed to fetch headers here,
 * and this is the same thing with one moving part instead of several. It is run as a script by
 * this Node rather than through `npx`, which on Windows is `npx.cmd` and cannot be started without
 * a shell — see `rebuild-pty-plan.mjs`, which also decides when there is nothing to compile.
 *
 * Never fatal. A checkout without a network, or on a machine with no toolchain, should still
 * end up with a working app minus the terminal — not a failed install.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { gypInvocation, nodeGypEntry, usablePrebuild } from "./rebuild-pty-plan.mjs";

const require = createRequire(import.meta.url);

const COMMAND_LINE_TOOLS = "/Library/Developer/CommandLineTools";
const HEADER_MIRRORS = [
	"https://electronjs.org/headers",
	// Same files, different host. electronjs.org timed out on a macOS dry-run runner.
	"https://artifacts.electronjs.org/headers/dist",
];

try {
	const electron = require("electron/package.json").version;
	const ptyDir = dirname(require.resolve("node-pty/package.json"));
	const ptyPackage = JSON.parse(readFileSync(join(ptyDir, "package.json"), "utf8"));

	/*
	 * Nothing to compile where node-pty's own N-API prebuild will load.
	 *
	 * `build/` goes, because node-pty's loader prefers it over the prebuild: a `pnpm package` leaves
	 * it compiled for the last architecture packaged — arm64, on an x64 machine — and this script is
	 * what `package.mjs` runs afterwards to put the machine's own copy back.
	 */
	const prebuilt = usablePrebuild({ platform: process.platform, arch: process.arch, ptyDir, pkg: ptyPackage, exists: existsSync });
	if (prebuilt) {
		rmSync(join(ptyDir, "build"), { recursive: true, force: true });
		console.log(`node-pty: using its N-API prebuild in ${prebuilt}; nothing to compile.`);
		process.exit(0);
	}

	const entry = nodeGypEntry({
		env: process.env,
		execPath: process.execPath,
		platform: process.platform,
		fromRebuild: () => createRequire(require.resolve("@electron/rebuild")).resolve("node-gyp/bin/node-gyp.js"),
		exists: existsSync,
	});

	const build = (env, distUrl) => {
		const plan = gypInvocation({
			entry,
			execPath: process.execPath,
			platform: process.platform,
			args: ["rebuild", `--target=${electron}`, `--arch=${process.arch}`, `--dist-url=${distUrl}`],
		});
		if (!plan) throw new Error("没有找到 node-gyp（npm 自带的、@electron/rebuild 依赖的都不在）");
		return execFileSync(plan.file, plan.args, { cwd: ptyDir, stdio: "inherit", env });
	};

	const buildWithMirrors = (env) => {
		let last;
		const attempts = [HEADER_MIRRORS[0], HEADER_MIRRORS[0], HEADER_MIRRORS[1]];
		for (const [index, distUrl] of attempts.entries()) {
			try {
				build(env, distUrl);
				return;
			} catch (error) {
				last = error;
				console.warn(
					`\n[pty] ${distUrl} attempt ${index + 1} failed: ${error instanceof Error ? error.message : String(error)}\n`,
				);
			}
		}
		throw last;
	};

	try {
		buildWithMirrors(process.env);
	} catch (first) {
		/*
		 * 再用命令行工具那份工具链试一次。
		 *
		 * `xcode-select` 指着完整的 Xcode、而它的许可协议没人同意过时，**任何**编译都不会开始：
		 * clang 张口就是 "You have not agreed to the Xcode license agreements" 然后退出。同意它
		 * 要 sudo，而这里只是想编一个 native addon——那件事只需要命令行工具，从来不需要完整的 Xcode。
		 *
		 * 顺序是「先按原样试，失败了才回退」而不是上来就指过去：许可已经同意的机器该用它本来在用的
		 * 工具链，那才是 CI 和大多数人的情形，这一段在那里连跑都不会跑。
		 *
		 * 失败在这里不是终点——外面那层 catch 仍然接着，编不出来就是没有终端面板，不是装不上。
		 */
		if (process.platform !== "darwin" || !existsSync(COMMAND_LINE_TOOLS) || process.env.DEVELOPER_DIR === COMMAND_LINE_TOOLS) throw first;
		console.warn(`\n[pty] 默认工具链编不动，改用 ${COMMAND_LINE_TOOLS} 重试一次\n`);
		buildWithMirrors({ ...process.env, DEVELOPER_DIR: COMMAND_LINE_TOOLS });
	}
	console.log(`node-pty rebuilt for Electron ${electron}.`);
} catch (error) {
	console.warn(
		`\nCould not rebuild node-pty for Electron: ${error instanceof Error ? error.message : String(error)}\n` +
			"The app will run; the terminal panel will not. Re-run `pnpm --filter @lyra/desktop rebuild:pty` once the build tools are available.\n",
	);
}
