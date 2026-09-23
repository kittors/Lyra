/**
 * Finding a program on PATH the way the platform itself would, without running a program to ask.
 *
 * This used to be done three ways: `which`/`where` in `open-targets.ts`, a hand-rolled loop in
 * `format-external.ts`, and not at all in the terminal. Each had its own gap. `which` is not
 * installed on a minimal Arch system, so no editor or terminal was ever offered there. The loop
 * joined `gofmt` onto each directory and asked whether that file existed — on Windows it is
 * `gofmt.exe`, so every formatter read as 「未安装」 however it had been installed.
 *
 * No Electron and no shell here, and the platform is a parameter: the Windows rules are the ones
 * that break, and they have to be checkable on the machines the tests actually run on.
 */

import { accessSync, constants, lstatSync, statSync } from "node:fs";
import { posix, win32 } from "node:path";

export interface FindExecutableOptions {
	platform?: string;
	env?: NodeJS.ProcessEnv;
	/** Searched after PATH, for the places a GUI launch's PATH is known to leave out. */
	extraDirs?: string[];
	/** Whether a path is a program this platform can run. The file system, unless a test says otherwise. */
	isExecutable?: (path: string) => boolean;
}

/** What Windows assumes when `PATHEXT` is not set at all. */
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

/**
 * An environment variable, spelled the way this platform spells it.
 *
 * Windows treats `Path` and `PATH` as one variable, and `process.env` hides that with a
 * case-insensitive proxy — which a copy (`{ ...process.env }`) or a test's plain object does not
 * have. A Git Bash launch hands over `PATH`, Explorer hands over `Path`, and both have to work.
 */
export function envValue(env: NodeJS.ProcessEnv, name: string, platform: string): string | undefined {
	if (env[name] !== undefined || platform !== "win32") return env[name];
	const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
	return key === undefined ? undefined : env[key];
}

/**
 * The file names a command may have on disk.
 *
 * Windows runs `ruff` by trying `ruff.com`, `ruff.exe`, `ruff.bat` and `ruff.cmd` in `PATHEXT`
 * order, and never runs a bare `ruff` even if one exists. A name that already carries one of those
 * extensions is taken as written — `code.cmd` means that file and nothing else.
 */
export function candidateNames(command: string, platform: string, env: NodeJS.ProcessEnv): string[] {
	if (platform !== "win32") return [command];
	const extensions = (envValue(env, "PATHEXT", platform) || DEFAULT_PATHEXT)
		.split(";")
		.map((extension) => extension.trim().toLowerCase())
		.filter((extension) => extension.startsWith("."));
	const lower = command.toLowerCase();
	if (extensions.some((extension) => lower.endsWith(extension))) return [command];
	return extensions.map((extension) => `${command}${extension}`);
}

/**
 * The directories to look in, PATH first and in its own order.
 *
 * Windows allows an entry to be quoted (`"C:\Program Files\Go\bin"`), and the quotes are not part
 * of the directory. Duplicates are dropped rather than searched twice — the extra directories
 * usually overlap with a PATH that already had them.
 */
export function searchDirs(platform: string, env: NodeJS.ProcessEnv, extraDirs: string[] = []): string[] {
	const delimiter = platform === "win32" ? win32.delimiter : posix.delimiter;
	const fromPath = (envValue(env, "PATH", platform) ?? "")
		.split(delimiter)
		.map((dir) => (platform === "win32" ? dir.trim().replace(/^"(.*)"$/, "$1") : dir))
		.filter(Boolean);
	return [...new Set([...fromPath, ...extraDirs.filter(Boolean)])];
}

/**
 * Whether this path is something the platform will run.
 *
 * On Windows `stat` is not enough: the App Execution Aliases in `WindowsApps` — `wt.exe`,
 * `python.exe` from the Store — are reparse points that `stat` cannot follow and fails on, while
 * `lstat` sees them fine. Everywhere else the execute bit decides, as it does for the shell.
 */
function onDisk(platform: string): (path: string) => boolean {
	if (platform === "win32") {
		return (path) => {
			try {
				return statSync(path).isFile();
			} catch {
				try {
					return !lstatSync(path).isDirectory();
				} catch {
					return false;
				}
			}
		};
	}
	return (path) => {
		try {
			if (!statSync(path).isFile()) return false;
			accessSync(path, constants.X_OK);
			return true;
		} catch {
			return false;
		}
	};
}

/**
 * The full path of `command`, or null when this machine does not have it.
 *
 * A command that is already a path — it contains a separator — is checked where it is rather than
 * searched for, with the same extension rules applied to it.
 */
export function findExecutable(command: string, options: FindExecutableOptions = {}): string | null {
	const platform = options.platform ?? process.platform;
	const env = options.env ?? process.env;
	const runnable = options.isExecutable ?? onDisk(platform);
	const path = platform === "win32" ? win32 : posix;
	const names = candidateNames(command, platform, env);

	const isPath = platform === "win32" ? /[\\/]/.test(command) : command.includes("/");
	if (isPath) return names.find((name) => runnable(name)) ?? null;

	for (const dir of searchDirs(platform, env, options.extraDirs)) {
		for (const name of names) {
			const candidate = path.join(dir, name);
			if (runnable(candidate)) return candidate;
		}
	}
	return null;
}
