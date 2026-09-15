/**
 * Rebuild node-pty against Electron's ABI.
 *
 * node-pty is a native addon, and npm installs it compiled for the Node that ran the install —
 * a different ABI from the Electron that has to load it. Without this step the app throws
 * NODE_MODULE_VERSION on boot, and the terminal panel is the least of what breaks.
 *
 * node-gyp directly rather than `@electron/rebuild`: the latter failed to fetch headers here,
 * and this is the same thing with one moving part instead of several.
 *
 * Never fatal. A checkout without a network, or on a machine with no toolchain, should still
 * end up with a working app minus the terminal — not a failed install.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";

const require = createRequire(import.meta.url);

const COMMAND_LINE_TOOLS = "/Library/Developer/CommandLineTools";

try {
	const electron = require("electron/package.json").version;
	const ptyDir = dirname(require.resolve("node-pty/package.json"));

	const build = (env) =>
		execFileSync(
			"npx",
			[
				"--yes",
				"node-gyp",
				"rebuild",
				`--target=${electron}`,
				`--arch=${process.arch}`,
				"--dist-url=https://electronjs.org/headers",
			],
			{ cwd: ptyDir, stdio: "inherit", env },
		);

	try {
		build(process.env);
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
		build({ ...process.env, DEVELOPER_DIR: COMMAND_LINE_TOOLS });
	}
	console.log(`node-pty rebuilt for Electron ${electron}.`);
} catch (error) {
	console.warn(
		`\nCould not rebuild node-pty for Electron: ${error instanceof Error ? error.message : String(error)}\n` +
			"The app will run; the terminal panel will not. Re-run `pnpm --filter @lyra/desktop rebuild:pty` once the build tools are available.\n",
	);
}
