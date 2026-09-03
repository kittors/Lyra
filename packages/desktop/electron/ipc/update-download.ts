/**
 * Fetching an update, in a way that survives the window that started it.
 *
 * What this replaces was a single `await` inside an IPC handler: the whole download lived in that
 * call's closure, reported progress to the one sender that asked for it, and existed only for as
 * long as nobody looked away. Three things followed from that, and all three were things people do:
 *
 *   - closing the dialog had to be forbidden mid-download, because there would have been nothing
 *     left to report to — so a 130MB fetch held the screen hostage
 *   - pausing was not expressible at all
 *   - a hundred megabytes in, anything that interrupted it started again from zero
 *
 * So the download is a thing with a state, and the state lives here rather than in a window. A
 * window subscribes to it and draws it; several windows draw the same one; a window that closes and
 * comes back asks what is happening and is told. The dialog becomes a view of a fact instead of the
 * only place the fact exists.
 *
 * Resuming is a `Range` request against the bytes already on disk, which is what makes pausing
 * worth offering rather than a politer word for cancelling. A server that ignores the header
 * answers 200 instead of 206, and then the file starts over — correct either way, and slower on the
 * servers that deserve it.
 */

import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { parseChecksums, sha256, verify, type Verdict } from "../update-checksum.ts";

/**
 * Where a download is, as one value.
 *
 * `received`/`total` ride along on every phase that has them, including the ones that are not
 * moving: a paused download that could not say how far it got would force the window to remember
 * a number the main process already knows, which is the arrangement this file exists to end.
 */
export type DownloadPhase =
	| { at: "idle" }
	| { at: "downloading"; received: number; total: number }
	| { at: "paused"; received: number; total: number }
	/** Downloaded; unpacking or handing to the OS. Which ending it has is not known yet. */
	| { at: "preparing"; received: number; total: number }
	/** Done. `relaunch` distinguishes an update we can swap in from an installer the OS now has. */
	| { at: "ready"; relaunch: boolean }
	| { at: "failed"; error: string; received: number; total: number };

/**
 * What a partial file and a response say to do with them.
 *
 * Split out because it is the one piece of resuming that is a decision rather than plumbing, and
 * because getting it wrong is silent in the worst way: appending to a 200 produces a file of the
 * right length made of the wrong bytes — a hundred megabytes of head followed by the whole thing
 * again — which then fails a size check with a message about the size.
 */
export function resumePlan(
	have: number,
	status: number,
): { append: boolean; from: number } | { error: string } {
	// Nothing on disk: an ordinary download, whatever the server thought we were asking.
	if (have === 0) return { append: false, from: 0 };
	// 206 means the range was honoured, so what arrives continues what we have.
	if (status === 206) return { append: true, from: have };
	// 200 means it was ignored and this is the whole file again. Start over rather than concatenate.
	if (status === 200) return { append: false, from: 0 };
	/*
	 * 416 is "you asked past the end", which here means the partial file is at least as long as the
	 * asset. That is not resumable and not trustworthy — most likely the release was rebuilt under
	 * the same name — so the partial goes and the caller starts again.
	 */
	if (status === 416) return { error: "已下载的部分和这个版本对不上" };
	return { error: `下载失败：${status}` };
}

/** How a caller is told about every change, including the ones it did not ask for. */
export type Watcher = (phase: DownloadPhase) => void;

export interface DownloadTarget {
	url: string;
	/** Final path. The partial is this plus `.part`, so a complete file is never a partial one. */
	file: string;
	/** What the release says the finished file weighs, for the check on the way out. */
	size: number;
	/** Sent as `User-Agent`; GitHub is happier with one and it identifies the client in logs. */
	agent: string;
	/**
	 * Where the release published its `SHA256SUMS`, when it published one.
	 *
	 * Null for releases cut before that step existed. The download then completes and refuses to
	 * install rather than installing unverified: this is the one file the application downloads that
	 * ends in code being run, and "we could not check" is not a reason to skip checking.
	 */
	checksums: string | null;
}

/**
 * One download, startable, pausable and resumable.
 *
 * Deliberately a class, in a codebase that mostly is not: there is exactly one of these alive at a
 * time and it is a genuine state machine with a socket attached. Written as functions over a module
 * variable it would be the same thing with the state harder to find.
 */
export class UpdateDownload {
	private phase: DownloadPhase = { at: "idle" };
	private watchers = new Set<Watcher>();
	/** Live only while bytes are moving; `abort()` on it is how pausing and cancelling both work. */
	private aborter: AbortController | null = null;
	/**
	 * Set immediately before an abort that means "pause", and read by the catch that follows.
	 *
	 * An aborted stream and a network that dropped are the same exception, and they are not the same
	 * event: one is the user's decision and must leave the partial file where it is, the other is a
	 * failure the window should be told about. Nothing in the error distinguishes them, so the
	 * intent is recorded on the way in.
	 */
	private pausing = false;
	/*
	 * Assigned in the body rather than declared as a parameter property.
	 *
	 * `node --test --experimental-strip-types` runs these files by deleting the types and nothing
	 * else, and `constructor(private target: …)` is the one TypeScript spelling that *emits* code —
	 * so stripping it leaves a constructor that assigns nothing. Node refuses it outright rather
	 * than producing that, which is the right call and is why this is written the long way.
	 */
	private target: DownloadTarget;
	/**
	 * The run in flight, so `pause` can wait for it to actually stop.
	 *
	 * Aborting a stream and observing the phase that follows are two different moments: the abort
	 * rejects a pipeline, the rejection unwinds into the catch, and only there does the phase become
	 * `paused`. A `pause()` that returned before that happened would leave the caller reading
	 * `downloading` from a download that is already stopping — and the button drawn from it would
	 * say the wrong thing until the next event, which for a paused download never comes.
	 */
	private running: Promise<DownloadPhase> | null = null;

	constructor(target: DownloadTarget) {
		this.target = target;
	}

	/** Whether this is still the download the caller means; a new version needs a new one. */
	get url(): string {
		return this.target.url;
	}

	get state(): DownloadPhase {
		return this.phase;
	}

	watch(watcher: Watcher): () => void {
		this.watchers.add(watcher);
		// Told at once, so a window that just opened does not wait for the next chunk to learn where
		// things stand — and a paused download, which produces no further events, is drawn at all.
		watcher(this.phase);
		return () => this.watchers.delete(watcher);
	}

	private set(phase: DownloadPhase): void {
		this.phase = phase;
		for (const watcher of this.watchers) watcher(phase);
	}

	/** The partial, which is where a paused download's bytes wait. */
	private get partial(): string {
		return `${this.target.file}.part`;
	}

	/**
	 * Compare the downloaded bytes against the release's own digest.
	 *
	 * Fetched here rather than alongside the release metadata because this is the moment it is
	 * needed, and because a checksum file fetched much earlier would have to be carried through the
	 * pause/resume machinery for no benefit — it is a few hundred bytes.
	 */
	private async check(): Promise<Verdict> {
		if (!this.target.checksums) {
			return {
				ok: false,
				reason: "no-checksums",
				message: "这个版本没有发布校验文件，无法确认安装包完整。请到发布页手动下载。",
			};
		}

		let text: string;
		try {
			const response = await fetch(this.target.checksums, { headers: { "User-Agent": this.target.agent } });
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			text = await response.text();
		} catch (error) {
			// A digest we could not fetch is not a digest that failed; say which, or the report will
			// be "the update is corrupt" for what is actually a network problem.
			return {
				ok: false,
				reason: "no-checksums",
				message: `没能取到校验文件（${error instanceof Error ? error.message : String(error)}），这次不安装。`,
			};
		}

		return verify(parseChecksums(text), basename(this.target.file), await sha256(this.partial));
	}

	/**
	 * How many bytes are on disk, asked more than once when the answer is zero.
	 *
	 * The size is the authority — a counter in memory would survive an abort that the file did not,
	 * and resuming from it would `Range` past bytes that were never written. But on Windows the
	 * directory entry lags the write: `stat` right after aborting a stream reports the size from
	 * before the last flush, and often reports 0.
	 *
	 * Belt and braces rather than the fix. The reason `pausing keeps what came down` was failing on
	 * Windows turned out to be the write stream being destroyed with data still buffered — see the
	 * note beside `pipeline`. This retry was written first, on the theory that `stat` was lagging,
	 * and it did not help: the bytes genuinely were not there.
	 *
	 * Kept because the lag is real even though it was not this, and re-reading an answer of zero
	 * costs nothing on the path where it is already zero.
	 */
	private async have(): Promise<number> {
		for (let attempt = 0; attempt < 5; attempt++) {
			const size = (await stat(this.partial).catch(() => null))?.size ?? 0;
			if (size > 0) return size;
			await new Promise((resolve) => setTimeout(resolve, 10));
		}
		return 0;
	}

	/**
	 * Start, or carry on from where a pause left off.
	 *
	 * Returns when the bytes are down — not when the update is installed, which is the caller's next
	 * step and a different kind of failure. Calling it while it is already running does nothing,
	 * because two writers appending to one file is the one way to corrupt it that no checksum here
	 * would catch until the very end.
	 */
	async start(): Promise<DownloadPhase> {
		// The run in flight is the answer, not a second one. Two writers appending to one file is the
		// single corruption no length check would catch — the result is exactly the right size.
		if (this.running) return this.running;
		if (this.phase.at === "preparing") return this.phase;

		this.running = this.run().finally(() => {
			this.running = null;
		});
		return this.running;
	}

	private async run(): Promise<DownloadPhase> {

		// Already complete from an earlier run: nothing to fetch, and the caller still has to install.
		const done = await stat(this.target.file).catch(() => null);
		if (done && done.size === this.target.size) {
			this.set({ at: "preparing", received: this.target.size, total: this.target.size });
			return this.phase;
		}

		const have = await this.have();
		this.set({ at: "downloading", received: have, total: this.target.size });

		const aborter = new AbortController();
		this.aborter = aborter;
		this.pausing = false;

		try {
			await mkdir(dirname(this.partial), { recursive: true });

			const response = await fetch(this.target.url, {
				signal: aborter.signal,
				headers: {
					"User-Agent": this.target.agent,
					// Only when there is something to continue; an unconditional `bytes=0-` invites a 206
					// on a fresh download and makes every response need the resume path.
					...(have > 0 ? { Range: `bytes=${have}-` } : {}),
				},
			});

			const plan = resumePlan(have, response.status);
			if ("error" in plan) {
				// A partial we cannot continue from is worse than none: it would be resumed again next
				// time and fail again in the same way.
				await rm(this.partial, { force: true });
				throw new Error(plan.error);
			}
			if (!response.body) throw new Error("下载没有返回内容");

			/*
			 * The total, preferring what this response is actually going to deliver.
			 *
			 * On a 206 `content-length` is the length of the *range*, not of the file, so adding what
			 * is already on disk is what turns it back into a total. `content-range` would say so
			 * directly, and is not always sent; the release's own size is the backstop and is the one
			 * number that was true before any of this started.
			 */
			const chunkLength = Number(response.headers.get("content-length")) || 0;
			const total = plan.append && chunkLength > 0 ? plan.from + chunkLength : chunkLength || this.target.size;

			let received = plan.from;
			this.set({ at: "downloading", received, total });

			const body = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
			body.on("data", (chunk: Buffer) => {
				received += chunk.length;
				// Emitted per chunk. The window throttles its own painting; throttling here would mean
				// the last update before a pause is a stale number left on screen.
				this.set({ at: "downloading", received, total });
			});

			/*
			 * The write stream is held so that an abort can close it rather than destroy it.
			 *
			 * `pipeline` tears both ends down when the signal fires, and tearing down a write stream
			 * discards whatever it has buffered — on Windows that was the entire pause, every time:
			 * 20,000 bytes reported as received, a `.part` of zero bytes, and a resume that started
			 * over. It looked like `stat` lagging (Windows updates a directory entry late, which is
			 * a real thing) and it was not: the bytes were never written.
			 *
			 * Closing it instead flushes what is buffered first. The `catch` is for the abort itself,
			 * which `pipeline` reports as an error on a path where it is the expected outcome.
			 */
			const sink = createWriteStream(this.partial, { flags: plan.append ? "a" : "w" });
			try {
				await pipeline(body, sink);
			} catch (error) {
				// Let go of the reader, then let the writer finish with what it already has.
				await new Promise<void>((resolve) => sink.end(() => resolve()));
				throw error;
			}

			/*
			 * A short file is a failure, not a finished download.
			 *
			 * Without this a connection cut at 90% produces a `.part` of the wrong length that is then
			 * renamed into place and unpacked, and the error surfaces as "the update package has no
			 * app in it" — which sends whoever reads it looking at the release rather than at the
			 * network.
			 */
			const written = await this.have();
			if (written !== this.target.size) {
				throw new Error(`下载不完整：拿到 ${written} 字节，应为 ${this.target.size}`);
			}

			/*
			 * The bytes, before they are put where the installer will find them.
			 *
			 * Checked on the partial rather than after the rename, so a file that fails verification
			 * never exists at the final path — there is no window in which something else could pick
			 * it up, and no leftover for a later run to resume from.
			 */
			/*
			 * Reported as `preparing` rather than as a phase of its own.
			 *
			 * Hashing a package takes a second or two, and "准备中" is a true description of it. A
			 * fourth phase would have to be handled by every switch in `update/view.ts` to buy a word
			 * the user reads once.
			 */
			this.set({ at: "preparing", received: written, total: this.target.size });
			const verdict = await this.check();
			if (!verdict.ok) {
				await rm(this.partial, { force: true });
				throw new Error(verdict.message);
			}

			await rename(this.partial, this.target.file);
			this.aborter = null;
			this.set({ at: "preparing", received: this.target.size, total: this.target.size });
			return this.phase;
		} catch (error) {
			this.aborter = null;
			const received = await this.have();
			if (this.pausing) {
				// The bytes stay on disk; this is the whole point of the partial file having a name.
				this.pausing = false;
				this.set({ at: "paused", received, total: this.target.size });
				return this.phase;
			}
			this.set({ at: "failed", error: describe(error, received), received, total: this.target.size });
			return this.phase;
		}
	}

	/**
	 * Stop moving bytes, keep the ones already down.
	 *
	 * Returns once the phase has settled, so a caller that pauses and immediately reads the state
	 * does not see `downloading`. Pausing something that is not downloading is not an error — the
	 * button that calls this is drawn from a state that may be one event out of date.
	 */
	async pause(): Promise<void> {
		if (this.phase.at !== "downloading") return;
		this.pausing = true;
		this.aborter?.abort();
		// Waited on rather than slept past: the phase settles inside the run's own catch.
		await this.running?.catch(() => {});
	}

	/** Stop and forget, partial file and all. What 取消 means, as opposed to 暂停. */
	async cancel(): Promise<void> {
		this.pausing = false;
		this.aborter?.abort();
		await this.running?.catch(() => {});
		this.aborter = null;
		// After the run has stopped, or the write stream it still holds would recreate the file.
		await rm(this.partial, { force: true }).catch(() => {});
		this.set({ at: "idle" });
	}

	/** Called by the installer once it knows which ending this had. */
	finish(relaunch: boolean): void {
		this.set({ at: "ready", relaunch });
	}

	/** Called by the installer when the step *after* the download failed. */
	fail(error: string): void {
		this.set({ at: "failed", error, received: this.target.size, total: this.target.size });
	}
}

/** Where a version's files are kept, one directory per version so two never mix. */
export function downloadDir(root: string, version: string): string {
	return join(root, `lyra-update-${version}`);
}

/**
 * The directories `downloadDir` would have made, other than the ones for `keep`.
 *
 * `keep` is plural because "the newest release" and "the version being downloaded right now" are
 * not always the same version. A release published mid-download makes them differ for as long as
 * the download lasts, and sweeping on the newest alone would then delete the directory currently
 * being written into — the one case where this tidying could destroy something someone is waiting
 * for.
 */
export function staleDownloads(entries: string[], keep: string | string[]): string[] {
	const mine = `lyra-update-`;
	const kept = new Set((Array.isArray(keep) ? keep : [keep]).map((version) => `${mine}${version}`));
	return entries.filter((name) => name.startsWith(mine) && !kept.has(name));
}

/**
 * Throw away the downloads for versions that are no longer the newest.
 *
 * Nothing did this, and it adds up quietly: every update ever fetched stayed in the temp directory,
 * installer and unpacked copy both. Eight versions had accumulated on the machine this was written
 * on — 495MB for 0.3.1 alone, since a `.zip` and the `.app` it unpacks to are each about 135MB.
 * `/tmp` is cleared by the OS eventually, on a schedule nobody knows and macOS in particular is
 * shy about, so "eventually" is doing a lot of work.
 *
 * Best-effort by design: a directory that will not delete is not worth a word to the user, and
 * certainly not worth failing an update over.
 */
export async function sweepDownloads(root: string, keep: string | string[]): Promise<void> {
	const entries = await readdir(root).catch((): string[] => []);
	for (const name of staleDownloads(entries, keep)) {
		await rm(join(root, name), { recursive: true, force: true }).catch(() => {});
	}
}

/**
 * A failure in words the person reading it can act on.
 *
 * What arrives here is written for whoever is debugging the HTTP client: undici says `terminated`
 * when a connection dies mid-body and `fetch failed` when it never opened. Neither says what
 * happened, and — more to the point — neither says the part that matters, which is that the bytes
 * already down are kept and 继续 will pick them up rather than start again. A dialog that reports
 * `terminated` on a 130MB download reads as "start over".
 *
 * Exported for the test, because the mapping is the whole of what this does.
 */
export function describe(error: unknown, received: number): string {
	const raw = error instanceof Error ? error.message : String(error);

	// Ours already, and already specific: it says how many bytes short it came.
	if (raw.startsWith("下载") || raw.startsWith("已下载")) return raw;

	const dropped = /terminated|ECONNRESET|socket hang up|aborted|other side closed/i.test(raw);
	if (dropped) {
		return received > 0 ? "下载中断了。已经下好的部分留着，继续会接着下。" : "下载中断了，可以重试。";
	}
	if (/fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT/i.test(raw)) {
		return "连不上下载地址，检查一下网络再试。";
	}
	return raw || "下载失败";
}
