/**
 * What 「立即重启」 does, per kind of install, with the platform calls passed in.
 *
 * Kept apart from `ipc/updates.ts` because the order of these steps is the part that breaks, and it
 * can only be checked with the steps replaced:
 *
 *   - An AppImage is swapped before the relaunch is scheduled, or the new process runs the old file.
 *     `app.relaunch` starts the new process only after this one has exited, which is also what gets
 *     it past the single-instance lock the old one holds.
 *   - A relaunch is scheduled before `exit`, or there is nothing to start.
 *   - Windows *quits*. The NSIS installer finds a running Lyra and kills it with `Stop-Process`,
 *     which runs no `before-quit` handler: sessions not flushed, shells not ended, the sync server
 *     not stopped. Quitting as soon as the installer is confirmed running lets all of that happen.
 *
 * The others `exit`: quitting runs the window-close handlers, and on macOS the swap script is
 * waiting on this pid — see `install-update.ts`.
 */

export type PendingUpdate =
	/** macOS: an unpacked `.app` waiting to replace the installed one. */
	| { kind: "bundle"; staged: string; target: string }
	/** Linux AppImage: the new file staged beside `$APPIMAGE`. */
	| { kind: "appimage"; staged: string; target: string }
	/** Linux .deb: the downloaded package and the privileged command that installs it. */
	| { kind: "deb"; file: string; command: { file: string; args: string[] } }
	/** Windows: the NSIS installer. */
	| { kind: "installer"; file: string };

export interface FinishEffects {
	/** The running binary's path as the process started — see the .deb case. */
	execPath: string;
	swapBundle(job: { staged: string; target: string }): Promise<void>;
	swapAppImage(staged: string, target: string): Promise<void>;
	runPrivileged(command: { file: string; args: string[] }): Promise<{ code: number | null; output: string }>;
	/** `shell.openPath`: "" when the installer started, the error otherwise. */
	openInstaller(file: string): Promise<string>;
	relaunch(execPath?: string): void;
	exit(): void;
	quit(): void;
}

export type FinishResult =
	| { ok: true }
	/** The user closed the password prompt. Nothing is wrong with the download. */
	| { ok: false; reason: "dismissed"; detail: string }
	| { ok: false; reason: "failed"; detail: string };

/** The last line that says something — apt's `E: …`, pkexec's reason — rather than all of it. */
function lastWords(output: string): string {
	const lines = output
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	return lines.find((line) => line.startsWith("E:")) ?? lines.at(-1) ?? "";
}

export async function finishUpdate(job: PendingUpdate, effects: FinishEffects): Promise<FinishResult> {
	try {
		switch (job.kind) {
			case "bundle":
				await effects.swapBundle(job);
				effects.exit();
				return { ok: true };
			case "appimage":
				await effects.swapAppImage(job.staged, job.target);
				effects.relaunch(job.target);
				effects.exit();
				return { ok: true };
			case "deb": {
				const { code, output } = await effects.runPrivileged(job.command);
				// pkexec: 126 is "the user dismissed the authentication dialog".
				if (code === 126) return { ok: false, reason: "dismissed", detail: "" };
				if (code !== 0) return { ok: false, reason: "failed", detail: lastWords(output) || `exit ${code}` };
				/*
				 * By path, not "the same executable": dpkg has just replaced the file, and what the kernel
				 * reports for this process's executable is now `/opt/Lyra/Lyra (deleted)`.
				 */
				effects.relaunch(effects.execPath);
				effects.exit();
				return { ok: true };
			}
			case "installer": {
				const failure = await effects.openInstaller(job.file);
				if (failure) return { ok: false, reason: "failed", detail: failure };
				effects.quit();
				return { ok: true };
			}
		}
	} catch (error) {
		return { ok: false, reason: "failed", detail: error instanceof Error ? error.message : String(error) };
	}
}
