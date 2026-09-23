/**
 * How this Linux copy was installed, and what putting an update in place means for each kind.
 *
 * The updater used to treat Linux as one thing: pick the AppImage (a .deb install got one too),
 * hand it to `shell.openPath` — `xdg-open`, which does not run AppImages; GNOME says 「无法打开」 —
 * and leave it in the update cache. Run by hand, the new copy lost the single-instance lock to the
 * old one and exited at once. Nothing ever replaced `$APPIMAGE` or `/opt/Lyra`.
 *
 * Now each kind has its own ending, and each of them finishes the job:
 *
 *   appimage   the new file is staged beside `$APPIMAGE` and renamed over it, then the app relaunches
 *              on that path — the same staged swap macOS does with its bundle
 *   deb        `pkexec apt-get install` of the downloaded .deb (the system's own password prompt),
 *              then a relaunch into the installed binary
 *   rpm        no in-app path: nothing is published as .rpm, so the release page is what is offered
 *   unmanaged  a tarball, a source build: nothing this app can safely replace — the release page
 *
 * No Electron here; the caller supplies how to ask the package managers and runs the commands.
 */

import { chmod, copyFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export type LinuxInstall = { kind: "appimage"; path: string } | { kind: "deb" } | { kind: "rpm" } | { kind: "unmanaged" };

export async function detectLinuxInstall(from: {
	env: NodeJS.ProcessEnv;
	execPath: string;
	packaged: boolean;
	/** Whether this package manager owns the file: `dpkg-query -S`, `rpm -qf`. */
	owns: (manager: "dpkg" | "rpm", path: string) => Promise<boolean>;
}): Promise<LinuxInstall> {
	/*
	 * The AppImage runtime sets APPIMAGE to the file that was launched — not the temporary mount
	 * `execPath` points into, which is gone once this process exits.
	 */
	const appImage = from.env.APPIMAGE?.trim();
	if (appImage) return { kind: "appimage", path: appImage };
	if (!from.packaged) return { kind: "unmanaged" };
	if (await from.owns("dpkg", from.execPath)) return { kind: "deb" };
	if (await from.owns("rpm", from.execPath)) return { kind: "rpm" };
	return { kind: "unmanaged" };
}

/**
 * Where the new AppImage waits for the restart: hidden, beside the one it replaces.
 *
 * Beside it, not in the update cache, because the swap has to be a `rename` — atomic, and only
 * possible within one filesystem. Copying over the running file instead would leave a
 * half-written AppImage if anything interrupted it, and that is the file the next launch runs.
 */
export function stagedAppImagePath(target: string): string {
	return join(dirname(target), `.${basename(target)}.update`);
}

/**
 * Copy the download next to `$APPIMAGE` and make it executable. Throws when that directory cannot
 * be written — an AppImage kept in `/opt` or on read-only storage — which the caller reports before
 * anyone presses restart.
 */
export async function stageAppImage(downloaded: string, target: string): Promise<string> {
	const staged = stagedAppImagePath(target);
	await rm(staged, { force: true });
	await copyFile(downloaded, staged);
	await chmod(staged, 0o755);
	return staged;
}

/**
 * Put the staged file in place of the running one.
 *
 * Safe while it runs: the AppImage runtime has the old file open, and a rename replaces the
 * directory entry, not the inode it is reading from.
 */
export async function swapAppImage(staged: string, target: string): Promise<void> {
	await rename(staged, target);
}

/**
 * The command that installs a downloaded .deb, or null when there is no way to ask for rights.
 *
 * `pkexec` is the desktop's own password prompt (polkit), the same one the software centre uses —
 * this is the path electron-updater's DebUpdater takes too. `apt-get install ./file.deb` rather
 * than `dpkg -i`: a new release that adds a dependency would leave dpkg half-configured, where apt
 * installs it. The path is absolute, which is how apt tells a file from a package name.
 */
export function debInstallCommand(file: string, find: (command: string) => string | null): { file: string; args: string[] } | null {
	const pkexec = find("pkexec");
	if (!pkexec) return null;
	const apt = find("apt-get");
	if (apt) return { file: pkexec, args: [apt, "install", "-y", file] };
	const dpkg = find("dpkg");
	return dpkg ? { file: pkexec, args: [dpkg, "-i", file] } : null;
}
