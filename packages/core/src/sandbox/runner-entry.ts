/**
 * The program a confined command is run through, where the confinement is a process of our own.
 *
 * macOS and Linux-with-bwrap put somebody else's program in front of the command. Windows (a
 * restricted token) and Linux-with-Landlock have no such program, so this is it: the backend
 * spawns this file under the app's own runtime, with the marker flag, and it does the platform's
 * work and becomes the command's exit status.
 *
 * A file of its own because of how it has to be started. The runner used to be the app itself —
 * `Lyra.exe --lyra-sandbox-runner …` with `ELECTRON_RUN_AS_NODE=1` — and in that mode Electron is
 * Node, which reads the first argument as one of its own options: `bad option:
 * --lyra-sandbox-runner`, exit 9, every time. The probe failed, the backend reported no sandbox,
 * and on Windows the default permission mode refused every command. Node mode needs a script
 * before any flag, and this is the script. The desktop build emits it as `sandbox-runner.js`
 * beside the main bundle; from source it runs as TypeScript.
 */

import { SANDBOX_RUNNER_FLAG } from "./runner-flag.ts";
import { main as landlock } from "./linux/landlock.ts";
import { main as windows } from "./windows/runner.ts";

const at = process.argv.indexOf(SANDBOX_RUNNER_FLAG);
const argv = at === -1 ? [] : process.argv.slice(at + 1);

if (at === -1) {
	process.stderr.write(`sandbox-runner: 缺少 ${SANDBOX_RUNNER_FLAG}，不是被沙箱后端启动的\n`);
	process.exit(127);
}
if (process.platform === "win32") process.exit(windows(argv));
if (process.platform === "linux") process.exit(landlock(argv));
process.stderr.write(`sandbox-runner: 平台 ${process.platform} 不用这个 runner\n`);
process.exit(127);
