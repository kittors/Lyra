/**
 * Finding out whether there is a newer release, fetching it, and handing it to the installer.
 *
 * The download happens here rather than in a browser. Sending someone to a web page to find the
 * right file among four is not an update mechanism, it is an apology for not having one — and the
 * page cannot know whether they are on Apple silicon or Intel, while this can.
 *
 * What is deliberately *not* here is replacing the app in place. This build is unsigned, and an
 * updater that swaps the binary itself would be granting an unsigned download the trust the user
 * gave the copy they installed. The last step is the installer the platform already has: the disk
 * image is opened, and the user drags it across as they did the first time.
 */

import { app, BrowserWindow, ipcMain, shell } from "electron";
import { chmod, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { installedAppBundle, scheduleSwap } from "./install-update.ts";
import { downloadDir, sweepDownloads, UpdateDownload, type DownloadPhase } from "./update-download.ts";
import { pickAsset, pickChecksums, type ReleaseAsset } from "../update-asset.ts";

const execFileAsync = promisify(execFile);

/**
 * Unpack with `ditto`, not a library.
 *
 * A `.app` is a directory of symlinks, code signatures and extended attributes, and most zip
 * implementations quietly drop some of that — producing a bundle that unpacks without complaint
 * and then refuses to launch. `ditto` is what macOS itself uses, and `-x -k` is its zip mode.
 */
const unzip = (archive: string, into: string) => execFileAsync("ditto", ["-x", "-k", archive, into]);

import { isNewer } from "../../src/features/update/version.ts";

/** Where releases are published. */
const REPO = "kittors/Lyra";
/** GitHub answers in a second or so; anything longer means it is not going to. */
const TIMEOUT_MS = 8000;
/** Checked at most this often, however many times the window asks. */
const CACHE_MS = 30 * 60 * 1000;

export interface UpdateInfo {
	current: string;
	latest: string;
	available: boolean;
	/**
	 * Whether this answer came from GitHub, or is what we say when we could not ask.
	 *
	 * The two are not the same claim and were reported as the same one: a failed check returns the
	 * running version as the newest, which is indistinguishable from a successful check on an app
	 * that is up to date — so 设置 → 关于 told someone with no network that they were on the latest
	 * version. That is a wrong answer to the one question they pressed a button to ask. The badge
	 * still treats both as "nothing to announce", which is right; only the surface that was *asked*
	 * needs to know the difference.
	 */
	checked: boolean;
	/** The release body, as written. Markdown, shown as text. */
	notes: string;
	url: string;
	publishedAt: number | null;
	/** The installer for this machine, when the release has one. */
	asset: { name: string; url: string; size: number } | null;
	/**
	 * Where the release published its `SHA256SUMS`, when it published one.
	 *
	 * Null for releases cut before the workflow uploaded it. The download refuses to install in that
	 * case rather than installing something it could not check — this is the one file the app
	 * fetches that ends in code being run.
	 */
	checksums: string | null;
}

let cached: { at: number; info: UpdateInfo } | null = null;

/** An unpacked update waiting for the user to say when. Cleared once it has been used. */
let pending: { staged: string; target: string } | null = null;

/**
 * An installer already handed to the OS, on the platforms where that is the whole of installing.
 *
 * Windows and Linux end at `shell.openPath`, and what happens next is a window this app does not
 * own — one that is closed by accident often enough that "it downloaded and then nothing happened"
 * is the ordinary way for that ending to be experienced. Keeping the path is what lets the dialog
 * offer to open it again instead of leaving the file somewhere in a temp directory.
 */
let opened: string | null = null;

async function fetchLatest(current: string): Promise<UpdateInfo> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	try {
		const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
			headers: { Accept: "application/vnd.github+json", "User-Agent": `Lyra/${current}` },
			signal: controller.signal,
		});
		if (!response.ok) throw new Error(`GitHub said ${response.status}`);
		const release = (await response.json()) as {
			tag_name?: string;
			name?: string;
			body?: string;
			html_url?: string;
			published_at?: string;
			draft?: boolean;
			prerelease?: boolean;
			assets?: ReleaseAsset[];
		};

		const latest = (release.tag_name ?? release.name ?? "").replace(/^v/i, "");
		// A draft is not published and a pre-release is not for people who did not ask for one.
		const offerable = Boolean(latest) && !release.draft && !release.prerelease;
		return {
			current,
			latest: latest || current,
			available: offerable && isNewer(latest, current),
			checked: true,
			notes: (release.body ?? "").trim(),
			url: release.html_url ?? `https://github.com/${REPO}/releases/latest`,
			publishedAt: release.published_at ? Date.parse(release.published_at) : null,
			asset: pickAsset(release.assets ?? []),
			// Null for releases published before the workflow started uploading it; the download
			// then refuses rather than installing something it could not check.
			checksums: pickChecksums(release.assets ?? [])?.url ?? null,
		};
	} finally {
		clearTimeout(timer);
	}
}

const nothing = (current: string): UpdateInfo => ({
	current,
	latest: current,
	available: false,
	// The one field that says this is not an answer. See `UpdateInfo.checked`.
	checked: false,
	notes: "",
	url: `https://github.com/${REPO}/releases`,
	publishedAt: null,
	asset: null,
	checksums: null,
});

export function registerUpdateIpc(): void {
	ipcMain.handle("updates:check", async (_event, force?: boolean): Promise<UpdateInfo> => {
		const current = app.getVersion();

		if (!force && cached && Date.now() - cached.at < CACHE_MS && cached.info.current === current) {
			return cached.info;
		}
		try {
			const info = await fetchLatest(current);
			cached = { at: Date.now(), info };
			/*
			 * Take out whatever earlier versions left behind, now that we know which one is current.
			 *
			 * Nothing used to, and it accumulates in a way nobody sees: every update ever fetched stayed
			 * in the temp directory as both an installer and the copy it unpacked to. Eight versions had
			 * piled up on the machine this was written on, 495MB for one of them. Done here because a
			 * check is the only moment the newest version is known, and detached because a sweep that
			 * fails is not a reason to withhold an update.
			 *
			 * The version being downloaded right now is spared as well. A release published while a
			 * download is running makes it stale by this measure, and deleting the directory being
			 * written into is the one way this tidying could take something someone is waiting for.
			 */
			void sweepDownloads(tmpdir(), active ? [info.latest, active.version] : info.latest);
			return info;
		} catch {
			/*
			 * Offline, rate-limited, or the repository has no releases yet.
			 *
			 * All three mean the same thing to the window: nothing to offer. Reporting them would put
			 * an error in front of someone who never asked a question — the check is something the app
			 * does on its own, and its failure is the app's business, not theirs.
			 */
			return nothing(current);
		}
	});

	/**
	 * The download in flight, if there is one. Outlives any window that was watching it.
	 *
	 * One at a time, keyed by the version it is for: there is only ever one newest release, and a
	 * second download of a different one would be a race for the same directory. A new version
	 * replaces it — see `downloadFor`.
	 *
	 * `unwatch` is kept because superseding one is not just a matter of cancelling it. `cancel()` is
	 * asynchronous and ends by announcing `idle`; if the replacement has already started by then,
	 * that announcement lands *after* the new download's first `downloading` and wipes it from every
	 * window — a progress ring that vanishes a moment after it appeared. Unsubscribing first means
	 * the old download's dying words go nowhere, which is where they belong.
	 */
	let active: { version: string; download: UpdateDownload; unwatch: () => void } | null = null;

	/**
	 * Where the download is, as far as the whole app is concerned.
	 *
	 * Held here rather than read off `active.download` on demand, because not every phase belongs to
	 * a downloader: "there is no installer for this machine" is a failure with nothing to attach it
	 * to, and asking a downloader that was never created produces `idle` — a window that then draws
	 * nothing at all, which is exactly how a pressed button comes to look like it did nothing.
	 */
	let phase: DownloadPhase = { at: "idle" };

	/**
	 * Every open window hears every change.
	 *
	 * Not the sender that asked, which is what this used to do. A download is a fact about the app,
	 * not about the conversation that started it: closing the dialog, or the whole window on a
	 * multi-window desktop, must not orphan a 130MB fetch — and a window that opens halfway through
	 * one should be able to draw it.
	 */
	const broadcast = (next: DownloadPhase) => {
		phase = next;
		for (const window of BrowserWindow.getAllWindows()) {
			if (!window.isDestroyed()) window.webContents.send("updates:progress", next);
		}
	};

	/** The downloader for this version, reusing the one already going if it is the same version. */
	const downloadFor = (version: string): UpdateDownload | { error: string } => {
		const info = cached?.info;
		const asset = info?.asset;
		if (!asset || info?.latest !== version) return { error: "没有找到适用于这台机器的安装包" };

		if (active?.version === version) return active.download;

		// A different version supersedes whatever was going: stop it and drop its partial, or its
		// bytes sit in the temp directory until the OS clears it. Unsubscribed first — see `active`.
		active?.unwatch();
		void active?.download.cancel();

		const dir = downloadDir(tmpdir(), version);
		const download = new UpdateDownload({
			url: asset.url,
			file: join(dir, asset.name),
			size: asset.size,
			agent: `Lyra/${info.current}`,
			checksums: info.checksums ?? null,
		});
		const unwatch = download.watch(broadcast);
		active = { version, download, unwatch };
		return download;
	};

	/**
	 * Put the downloaded file to use: swap-in on macOS, hand to the OS everywhere else.
	 *
	 * Separated from fetching the bytes because they fail for unrelated reasons and only one of them
	 * is worth resuming. Runs once the download reports `preparing`, so by the time anyone presses
	 * 立即重启 there is nothing left that can go wrong except the swap itself.
	 */
	const installDownloaded = async (version: string, file: string): Promise<void> => {
		const download = active?.download;
		try {
			if (process.platform === "darwin" && file.endsWith(".zip")) {
				/*
				 * Never in development. The executable there is Electron's own bundle inside
				 * `node_modules` — renamed to `Lyra.app` by this repository, which is enough to make it
				 * look installed — so swapping it for a release replaces the runtime `pnpm dev` depends
				 * on: a white window, and a development tree that has to be reinstalled to get back.
				 */
				if (!app.isPackaged) return download?.fail("开发模式下不做就地更新");

				const target = installedAppBundle(app.getPath("exe"));
				if (!target) return download?.fail("这个副本不是从「应用程序」运行的，无法就地更新");

				const staged = join(downloadDir(tmpdir(), version), "unpacked");
				await rm(staged, { recursive: true, force: true });
				await mkdir(staged, { recursive: true });
				await unzip(file, staged);
				const bundle = join(staged, `${app.getName()}.app`);
				if (!(await stat(bundle).catch(() => null))?.isDirectory()) {
					return download?.fail("下载的更新包里没有找到应用");
				}

				pending = { staged: bundle, target };
				return download?.finish(true);
			}

			if (process.platform === "linux" && file.toLowerCase().endsWith(".appimage")) {
				// Ensure AppImage has executable permission so the OS can launch it directly
				await chmod(file, 0o755).catch(() => {});
			}

			// Windows and Linux still hand the file to the OS: those are installers, and on Linux
			// a .deb needs a privilege this process does not have.
			const err = await shell.openPath(file);
			if (err) {
				return download?.fail(`无法打开安装包: ${err}`);
			}
			// Remembered so 重新打开安装包 has something to open. The installer window is easy to
			// dismiss by accident, and without this the only way back to it is the file system.
			opened = file;
			download?.finish(false);
		} catch (error) {
			download?.fail(error instanceof Error ? error.message : "安装失败");
		}
	};

	/** What is happening right now, for a window that just opened or just came back. */
	ipcMain.handle("updates:state", (): DownloadPhase => phase);

	/**
	 * Start, or carry on from a pause.
	 *
	 * Returns as soon as the download has been asked to run, not when it finishes — the answer the
	 * caller wants arrives on `updates:progress` like every other change, so there is one path for
	 * "where is it up to" rather than two that can disagree.
	 */
	ipcMain.handle("updates:download", async (_event, version: string): Promise<DownloadPhase> => {
		const found = downloadFor(version);
		/*
		 * Announced, not just returned.
		 *
		 * The caller is a click handler that does not await this — it draws whatever `onProgress`
		 * tells it, like every other phase does. Returning the failure and nothing else meant this
		 * one path was the exception: the window stayed on `idle`, the button kept saying 下载安装,
		 * and pressing it looked like pressing a dead control. A failure nobody is told about is
		 * indistinguishable from a button that does not work.
		 */
		if ("error" in found) {
			const failed: DownloadPhase = { at: "failed", error: found.error, received: 0, total: 0 };
			broadcast(failed);
			return failed;
		}

		const reached = await found.start();
		if (reached.at === "preparing") {
			const info = cached?.info;
			if (info?.asset) await installDownloaded(version, join(downloadDir(tmpdir(), version), info.asset.name));
		}
		return phase;
	});

	ipcMain.handle("updates:pause", async (): Promise<DownloadPhase> => {
		await active?.download.pause();
		return phase;
	});

	ipcMain.handle("updates:cancel", async (): Promise<DownloadPhase> => {
		// `cancel()` announces `idle` itself when there is a download to cancel; this covers the case
		// where the phase is a failure that never had one — 取消 must clear that too, or the badge
		// keeps a red dot for a download that no longer exists.
		if (active) await active.download.cancel();
		else broadcast({ at: "idle" });
		return phase;
	});

	/**
	 * Open the installer again, on the platforms where installing is a window we do not own.
	 *
	 * The one thing `relaunch` cannot do: on Windows and Linux there is nothing staged to swap in,
	 * so 立即重启 would be a button with no work behind it — which is what it was, silently, for a
	 * release. Here the honest offer is to put the installer back on screen.
	 */
	ipcMain.handle("updates:reopen", async (): Promise<boolean> => {
		if (!opened) return false;
		const failure = await shell.openPath(opened);
		return failure === "";
	});

	/**
	 * Swap in the update and come back up on it.
	 *
	 * Separate from `download` so the person decides when: a relaunch in the middle of a turn would
	 * take the conversation with it. Nothing here can fail in a way worth reporting — the app is
	 * about to exit — so a scheduling failure simply leaves the update staged for next time.
	 */
	ipcMain.handle("updates:relaunch", async () => {
		if (!pending) return false;
		await scheduleSwap(pending);
		pending = null;
		// `exit`, not `quit`: quitting runs the window-close handlers, and one of them keeps the
		// app alive in the tray — which would leave the swap script waiting on a pid that never goes.
		app.exit(0);
		return true;
	});

	// Kept for the case where there is no installer for this platform: then the release page is the
	// only thing left to offer.
	ipcMain.handle("updates:open", async (_event, url: string) => {
		if (!url.startsWith("https://github.com/")) return false;
		await shell.openExternal(url);
		return true;
	});
}
