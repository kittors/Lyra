/**
 * Files a phone sends to this desktop, written to disk as they arrive.
 *
 * Before this a phone attached a file by reading all of it in the WebView, base64-ing it into the
 * prompt and sending the result as one frame. A 100 MB log became a 1.3 GB WebView heap and a frame
 * the desktop refused; through a relay anything over 8 MiB — or over ~128 KiB from Android, whose
 * WebView fragments large messages — cut the link. Now the file is read a slice at a time from the
 * phone's own `File` (disk-backed, never whole in memory), sent as upload parts over the same
 * socket, and appended here to `<lyra home>/uploads/<id>.part`. The prompt then carries the upload's id,
 * and `prompt-input.ts` turns it into this file's path — a path the desktop chose, so it can be
 * trusted the way a path from a phone cannot.
 *
 * Resumable: the partial file is the state. A phone that loses its link asks again with the id it
 * was given and continues from the length already on disk. Partials are dropped after a day, finished
 * uploads after thirty — a transcript that mentions one may outlive it, which is also true of any
 * attachment's path.
 */

import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, open, readdir, readFile, rename, rm, stat, statfs, writeFile, type FileHandle } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { UploadEndpoint } from "./sync-wire.ts";

/** The largest file a phone may send. Stated in the desktop's hello so the phone can refuse first. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const PARTIAL_TTL_MS = 24 * 60 * 60 * 1000;
const COMPLETE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Uploads one link may have open at once. The composer takes at most eight files. */
const MAX_ACTIVE_PER_LINK = 8;
/** Free space to leave on the disk after an upload, so a phone cannot fill it to the last byte. */
const DISK_MARGIN_BYTES = 512 * 1024 * 1024;
const ID = /^[a-f0-9]{32}$/;

interface Meta {
	name: string;
	size: number;
	mimeType: string;
	created: number;
	complete: boolean;
}

export interface UploadInfo {
	id: string;
	name: string;
	size: number;
	mimeType: string;
	path: string;
}

/** A file name that is only a file name: no directories, no control characters, never empty. */
export function safeFileName(name: unknown): string {
	const base = String(typeof name === "string" ? name : "")
		.split(/[\\/]/)
		.pop()
		// oxlint-disable-next-line no-control-regex -- control characters are exactly what this removes
		?.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_")
		.replace(/^\.+/, "")
		.trim()
		.slice(0, 200);
	return base || "upload";
}

class UploadError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.code = code;
	}
}

export class UploadStore {
	readonly root: string;
	private swept = 0;

	constructor(root: string) {
		this.root = root;
	}

	/*
	 * `<id>.json` and `<id>.part` beside the finished `<id>/<name>`, not inside it: the name is the
	 * phone's, and a file called `meta.json` must not be able to land on top of the metadata.
	 */
	private metaFile(id: string): string {
		return join(this.root, `${id}.json`);
	}

	private partFile(id: string): string {
		return join(this.root, `${id}.part`);
	}

	private finalFile(id: string, name: string): string {
		return join(this.root, id, name);
	}

	async begin(request: { name: unknown; size: unknown; mimeType: unknown; resume?: unknown }): Promise<{ id: string; offset: number; meta: Meta }> {
		const size = Number(request.size);
		if (!Number.isSafeInteger(size) || size < 0) throw new UploadError("invalid", "invalid size");
		if (size > MAX_UPLOAD_BYTES) throw new UploadError("too-large", `file exceeds ${MAX_UPLOAD_BYTES} bytes`);
		await this.sweep();
		const name = safeFileName(request.name);
		const mimeType = typeof request.mimeType === "string" && request.mimeType.length <= 200 ? request.mimeType : "application/octet-stream";

		if (typeof request.resume === "string" && ID.test(request.resume)) {
			const meta = await this.meta(request.resume);
			if (meta && meta.size === size && meta.name === name) {
				const offset = meta.complete ? size : ((await stat(this.partFile(request.resume)).catch(() => null))?.size ?? 0);
				if (offset <= size) return { id: request.resume, offset, meta };
			}
		}

		await mkdir(this.root, { recursive: true });
		const free = await statfs(this.root).then((info) => info.bavail * info.bsize).catch(() => Number.POSITIVE_INFINITY);
		if (free < size + DISK_MARGIN_BYTES) throw new UploadError("disk-full", "not enough free disk space on the desktop");
		const id = randomBytes(16).toString("hex");
		const meta: Meta = { name, size, mimeType, created: Date.now(), complete: false };
		// Metadata first: a sweep that finds a part file with no metadata beside it removes it.
		await writeFile(this.metaFile(id), JSON.stringify(meta));
		await writeFile(this.partFile(id), "");
		return { id, offset: 0, meta };
	}

	/** The partial file, open for writing at any offset. */
	openPart(id: string): Promise<FileHandle> {
		return open(this.partFile(id), "r+");
	}

	async finish(id: string): Promise<UploadInfo> {
		const meta = await this.meta(id);
		if (!meta) throw new UploadError("unknown", "no such upload");
		const path = this.finalFile(id, meta.name);
		if (!meta.complete) {
			await mkdir(join(this.root, id), { recursive: true });
			await rename(this.partFile(id), path);
			await writeFile(this.metaFile(id), JSON.stringify({ ...meta, complete: true }));
		}
		return { id, name: meta.name, size: meta.size, mimeType: meta.mimeType, path };
	}

	async abort(id: string): Promise<void> {
		if (!ID.test(id)) return;
		await rm(join(this.root, id), { recursive: true, force: true });
		await rm(this.partFile(id), { force: true });
		await rm(this.metaFile(id), { force: true });
	}

	/**
	 * The finished file behind an id — or behind a path this store gave out — or null.
	 *
	 * The path form is for a sent message being edited on the phone: it carries back the path the
	 * desktop recorded when it was first sent, and that path is ours only if it is exactly a finished
	 * upload's file. Synchronous because the prompt's attachment list is validated synchronously; the
	 * read is one small JSON file. A half-written file is not something the agent should be told to read.
	 */
	pathFor(reference: unknown): string | null {
		if (typeof reference !== "string") return null;
		if (!ID.test(reference)) {
			if (!isAbsolute(reference)) return null;
			const inside = relative(this.root, reference);
			const [id, name, ...rest] = inside.split(sep);
			if (!id || !name || rest.length > 0 || !ID.test(id)) return null;
			return this.pathFor(id) === resolve(reference) ? resolve(reference) : null;
		}
		const id = reference;
		const file = this.metaFile(id);
		if (!existsSync(file)) return null;
		try {
			const meta = JSON.parse(readFileSync(file, "utf8")) as Meta;
			return meta.complete ? this.finalFile(id, meta.name) : null;
		} catch {
			return null;
		}
	}

	private async meta(id: string): Promise<Meta | null> {
		if (!ID.test(id)) return null;
		try {
			return JSON.parse(await readFile(this.metaFile(id), "utf8")) as Meta;
		} catch {
			return null;
		}
	}

	/** Drop stale partials and old finished uploads. At most hourly; on demand rather than on a timer. */
	async sweep(now = Date.now()): Promise<void> {
		if (now - this.swept < 60 * 60 * 1000) return;
		this.swept = now;
		const entries = await readdir(this.root).catch(() => [] as string[]);
		const ids = new Set(entries.map((entry) => entry.replace(/\.(json|part)$/, "")).filter((id) => ID.test(id)));
		for (const id of ids) {
			const meta = await this.meta(id);
			const age = now - (meta?.created ?? 0);
			if (!meta || age > (meta.complete ? COMPLETE_TTL_MS : PARTIAL_TTL_MS)) await this.abort(id);
		}
	}
}

function done(info: UploadInfo): Record<string, unknown> {
	return { type: "upload_done", upload: info.id, name: info.name, size: info.size, mimeType: info.mimeType, path: info.path };
}

interface Active {
	id: string;
	size: number;
	committed: number;
	handle: FileHandle | null;
	/** Writes to one upload happen one after another, so an ack always means "on disk up to here". */
	chain: Promise<void>;
}

/**
 * One link's view of the store: which upload each stream id is, and the file handles it holds.
 *
 * Replies go back through the channel as text frames. Every write is acknowledged only once it is on
 * disk, and the phone keeps no more than a window unacknowledged — so a slow disk slows the phone,
 * and nothing between the two holds more than that window.
 */
export class UploadLink implements UploadEndpoint {
	private readonly store: UploadStore;
	private active = new Map<number, Active>();
	private nextSid = 1;
	/** Bumped on release, so a begin still awaiting the disk does not open a handle for a gone link. */
	private generation = 0;

	constructor(store: UploadStore) {
		this.store = store;
	}

	control(message: Record<string, unknown>, reply: (message: Record<string, unknown>) => void): void {
		if (message.type === "upload_abort") {
			const id = String(message.upload ?? "");
			for (const [sid, entry] of this.active) {
				if (entry.id !== id) continue;
				this.active.delete(sid);
				entry.chain = entry.chain.then(() => entry.handle?.close()).catch(() => {});
			}
			void this.store.abort(id);
			return;
		}
		const request = String(message.id ?? "");
		if (this.active.size >= MAX_ACTIVE_PER_LINK) {
			reply({ type: "upload_error", id: request, error: "busy", message: "too many uploads at once" });
			return;
		}
		void this.begin(message, request, reply);
	}

	private async begin(message: Record<string, unknown>, request: string, reply: (message: Record<string, unknown>) => void): Promise<void> {
		const generation = this.generation;
		try {
			const { id, offset, meta } = await this.store.begin({ name: message.name, size: message.size, mimeType: message.mimeType, resume: message.resume });
			if (generation !== this.generation) return;
			const sid = this.nextSid++;
			if (offset >= meta.size) {
				reply({ type: "upload_state", id: request, upload: id, sid, offset, size: meta.size });
				reply(done(await this.store.finish(id)));
				return;
			}
			const handle = await this.store.openPart(id);
			if (generation !== this.generation) {
				await handle.close();
				return;
			}
			this.active.set(sid, { id, size: meta.size, committed: offset, handle, chain: Promise.resolve() });
			reply({ type: "upload_state", id: request, upload: id, sid, offset, size: meta.size });
		} catch (error) {
			reply({
				type: "upload_error",
				id: request,
				error: error instanceof UploadError ? error.code : "failed",
				message: error instanceof Error ? error.message : String(error),
			});
		}
	}

	part(sid: number, offset: number, payload: Buffer, reply: (message: Record<string, unknown>) => void): void {
		const entry = this.active.get(sid);
		if (!entry) {
			reply({ type: "upload_error", sid, error: "unknown-stream", message: "upload is not open on this link" });
			return;
		}
		entry.chain = entry.chain
			.then(async () => {
				if (!entry.handle || this.active.get(sid) !== entry) return;
				if (offset !== entry.committed || entry.committed + payload.length > entry.size) {
					throw new UploadError("offset", `expected offset ${entry.committed}`);
				}
				await entry.handle.write(payload, 0, payload.length, offset);
				entry.committed += payload.length;
				reply({ type: "upload_ack", upload: entry.id, n: entry.committed });
				if (entry.committed < entry.size) return;
				await entry.handle.close();
				entry.handle = null;
				this.active.delete(sid);
				reply(done(await this.store.finish(entry.id)));
			})
			.catch((error: unknown) => {
				this.active.delete(sid);
				void entry.handle?.close().catch(() => {});
				entry.handle = null;
				reply({
					type: "upload_error",
					upload: entry.id,
					error: error instanceof UploadError ? error.code : "write",
					message: error instanceof Error ? error.message : String(error),
				});
			});
	}

	/** The link is gone or has a new peer. What is on disk stays for a resume; handles close. */
	release(): void {
		this.generation++;
		for (const entry of this.active.values()) {
			entry.chain = entry.chain.then(() => entry.handle?.close()).catch(() => {});
		}
		this.active.clear();
	}
}
