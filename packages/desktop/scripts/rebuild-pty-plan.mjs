/**
 * The decisions `rebuild-pty.mjs` makes, apart from the compiling — so they can be tested.
 *
 * Two of them went wrong on Windows. The script ran `execFileSync("npx", …)`, and `npx` there is
 * `npx.cmd`, which Node refuses to start without a shell: every attempt failed with ENOENT and the
 * install ended on a warning that the terminal would not work. And it was compiling something that
 * did not need compiling at all.
 */

import { join, posix, win32 } from "node:path";

/**
 * The prebuilt node-pty binaries to use instead of compiling, or null.
 *
 * node-pty 1.x is N-API (it depends on `node-addon-api`), so its prebuilds are not tied to one
 * Node ABI — the same `conpty.node` loads in Node and in Electron. Its loader (`lib/utils.js`)
 * tries `build/Release`, then `build/Debug`, then `prebuilds/<platform>-<arch>`; with no `build/`
 * directory the prebuild is what loads.
 *
 * Windows only, deliberately. macOS ships prebuilds too and they would load, but compiling there
 * works and has for every release; this changes the platform where compiling never worked, not
 * the ones where it does. Linux has no prebuilds at all.
 */
export function usablePrebuild({ platform, arch, ptyDir, pkg, exists }) {
	if (platform !== "win32") return null;
	if (!pkg?.dependencies?.["node-addon-api"]) return null;
	// The host's own `join`: this runs on the machine it is deciding for, and `ptyDir` is a real path.
	const dir = join(ptyDir, "prebuilds", `${platform}-${arch}`);
	// The three modules node-pty loads on Windows: ConPTY, its console-list helper, and winpty.
	const wanted = ["conpty.node", "conpty_console_list.node", "pty.node"];
	return wanted.every((file) => exists(join(dir, file))) ? dir : null;
}

/**
 * node-gyp's JavaScript entry point, found without going through a shim.
 *
 * In order: what npm hands its lifecycle scripts (`npm_config_node_gyp`); the copy
 * `@electron/rebuild` depends on, which the lockfile pins; the copy inside npm itself, beside the
 * Node that is running. The first that exists wins.
 */
export function nodeGypEntry({ env, execPath, platform, fromRebuild, exists }) {
	// Spelled in the platform's own path rules: Node's directory on Windows is `C:\…`, and the host's
	// `dirname` would read that whole string as one file name.
	const path = platform === "win32" ? win32 : posix;
	const npmBundled =
		platform === "win32"
			? path.join(path.dirname(execPath), "node_modules", "npm", "node_modules", "node-gyp", "bin", "node-gyp.js")
			: path.join(path.dirname(execPath), "..", "lib", "node_modules", "npm", "node_modules", "node-gyp", "bin", "node-gyp.js");
	const candidates = [env.npm_config_node_gyp, safely(fromRebuild), npmBundled];
	return candidates.find((candidate) => typeof candidate === "string" && candidate.endsWith(".js") && exists(candidate)) ?? null;
}

function safely(find) {
	try {
		return find();
	} catch {
		return null;
	}
}

/**
 * How to run node-gyp: its script under this Node, which needs no shim on any platform.
 *
 * With no script found, `npx` remains the last resort where it is a real executable. On Windows
 * it is `npx.cmd`, and there is nothing to fall back to — the caller reports that instead.
 */
export function gypInvocation({ entry, execPath, platform, args }) {
	if (entry) return { file: execPath, args: [entry, ...args] };
	if (platform === "win32") return null;
	return { file: "npx", args: ["--yes", "node-gyp", ...args] };
}
