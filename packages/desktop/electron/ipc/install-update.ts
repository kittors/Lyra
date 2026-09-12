/**
 * Putting a downloaded update in place, and coming back up on it.
 *
 * What this replaces: the downloaded file was handed to `shell.openPath`, so a macOS update opened
 * a disk image and asked the person to drag the app into Applications. That is a manual install
 * with an automatic install's wording on it — and it leaves the old copy running, so "update" ends
 * with two versions on disk and the old one still in front of you.
 *
 * An app cannot overwrite itself while it is running, so the swap happens in a small script that
 * outlives the process: it waits for this one to exit, moves the new copy into place, and launches
 * it. The old copy is moved aside rather than deleted until the new one is in place, so a failure
 * half way through leaves something that still starts.
 */

import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Where this app is installed, as a directory that can be replaced wholesale. */
export function installedAppBundle(execPath: string): string | null {
	/*
	 * A development run is not an installation, however much its path looks like one.
	 *
	 * `pnpm dev` runs Electron's own prebuilt bundle straight out of `node_modules`, and this
	 * repository renames that bundle to `Lyra.app` so the dock stops saying "Electron" — which
	 * leaves it matching the shape below exactly. The swap then replaced the *runtime* with a
	 * packaged release: `dist/Lyra.app` became a finished 0.3.0 app with its own asar, `pnpm dev`
	 * started launching that instead of the dev server, and the window came up white. Meanwhile
	 * the copy in 「应用程序」 was never touched, so it went on offering the same update.
	 *
	 * Checked here rather than only at the call site because this is the function that decides
	 * what gets moved aside, and getting it wrong costs someone their development environment.
	 */
	if (execPath.includes("/node_modules/")) return null;

	// …/Lyra.app/Contents/MacOS/Lyra → …/Lyra.app
	const marker = `${sepBundle}/Contents/MacOS/`;
	const at = execPath.indexOf(marker);
	return at === -1 ? null : execPath.slice(0, at + sepBundle.length);
}

const sepBundle = ".app";

/**
 * The script that performs the swap once this process is gone.
 *
 * Written as a file and spawned detached, because it has to survive the thing that started it. It
 * waits on the pid rather than sleeping a fixed interval: a fixed wait is either too short (the
 * bundle is still mapped and the move fails) or too long for no reason.
 *
 * `ditto` rather than `mv` for the install: it is what macOS uses for bundles, and it preserves
 * the extended attributes and symlinks that a `.app` relies on — a plain move across filesystems
 * can quietly produce a bundle that will not launch.
 */
export function swapScript(options: { pid: number; staged: string; target: string; backup: string }): string {
	const { pid, staged, target, backup } = options;
	return `#!/bin/bash
set -e

# Wait for the old app to actually be gone, not merely asked to go.
for _ in $(seq 1 100); do
  kill -0 ${pid} 2>/dev/null || break
  sleep 0.1
done

rm -rf ${JSON.stringify(backup)}
mv ${JSON.stringify(target)} ${JSON.stringify(backup)}

if ditto ${JSON.stringify(staged)} ${JSON.stringify(target)}; then
  rm -rf ${JSON.stringify(backup)}
else
  # Put the old one back: a machine with no app at all is far worse than one that did not update.
  rm -rf ${JSON.stringify(target)}
  mv ${JSON.stringify(backup)} ${JSON.stringify(target)}
fi

# Clear the quarantine flag the download left, or the first launch is a scary dialog.
xattr -dr com.apple.quarantine ${JSON.stringify(target)} 2>/dev/null || true
open ${JSON.stringify(target)}
`;
}

/**
 * Schedule the swap and return, so the caller can quit.
 *
 * Detached and with its streams released: this must not be a child whose parent's exit takes it
 * down, because the parent's exit is precisely what it is waiting for.
 */
export async function scheduleSwap(options: { staged: string; target: string }): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "lyra-swap-"));
	const script = join(dir, "swap.sh");
	await writeFile(
		script,
		swapScript({
			pid: process.pid,
			staged: options.staged,
			target: options.target,
			backup: `${options.target}.old`,
		}),
		{ mode: 0o755 },
	);

	const child = spawn("/bin/bash", [script], { detached: true, stdio: "ignore" });
	child.unref();
}
