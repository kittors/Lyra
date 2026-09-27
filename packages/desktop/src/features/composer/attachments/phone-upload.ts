/**
 * On a phone, the files that should not ride inside the prompt go to the desktop as uploads.
 *
 * The composer reads every attachment into memory and puts its bytes into the prompt, which is right
 * on the desktop — the file is already on that disk, and the prompt goes over IPC. On a phone the
 * prompt goes over the network as one message, so a 100 MB log became a 1.3 GB WebView heap and a
 * frame the desktop refused, and anything a phone could not extract (a PDF, an archive, a video) was
 * read whole just to be attached by name. Now those are streamed to the desktop a slice at a time by
 * the bridge (`files.upload`, see `mobile/src/bridge-wire.ts`) and the prompt carries the upload's
 * id; the desktop swaps it for the path it wrote, and the agent reads the file from there.
 *
 * What stays inline is what the model is better off seeing directly and what is cheap to carry: an
 * image small enough to look at, a short text. See docs/adr/0029-sync-link-streams-large-data.md.
 */

import { bridge, onPhone } from "../../../services/index.ts";
import type { FileKind } from "./file-kind.ts";
import { translate } from "../../../i18n/translate.ts";
import { addUpload, deliverLate, removeUpload, updateUpload } from "./uploads.ts";

/** An image this size or smaller is sent as pixels the model can look at, as before. */
const INLINE_IMAGE_BYTES = 4 * 1024 * 1024;
/** A text file this size or smaller is pasted into the prompt, as before. */
const INLINE_TEXT_BYTES = 256 * 1024;
/**
 * With a phone app too old to upload, nothing larger than this is read at all.
 *
 * Reading it would put the whole file — and then its base64, and then the message around it — in
 * the WebView's memory, which is how the phone crashed; the message would not have survived the
 * link anyway.
 */
export const LEGACY_READ_LIMIT = 16 * 1024 * 1024;

interface UploadedAttachment {
	/** The desktop's id for the file; the prompt names it and the desktop resolves it. */
	upload: string;
	/** Where the desktop put it, for the stub that tells the model where to read. */
	path: string;
	mimeType: string;
}

export type PhoneUploadOutcome =
	| { kind: "uploaded"; file: UploadedAttachment }
	/** Not a phone, or a file that stays inline: read it the usual way. */
	| { kind: "inline" }
	/** A phone app that cannot upload: read it the usual way if it is small enough. */
	| { kind: "unsupported" }
	/** Stopped from the composer while it travelled, or given up on after it failed. Nothing is attached. */
	| { kind: "cancelled" }
	| { kind: "failed"; reason: string };

/** Whether this file should leave the phone as an upload rather than inside the prompt. */
export function wantsUpload(size: number, kind: FileKind, readableAsText: boolean): boolean {
	if (kind === "image") return size > INLINE_IMAGE_BYTES;
	if (readableAsText) return size > INLINE_TEXT_BYTES;
	// Documents, archives, video: the phone cannot extract them, the desktop's tools can read them.
	return true;
}

/**
 * Upload `file` if this is a phone and the file should not go inline.
 *
 * Awaited by the composer before the attachment appears: a prompt must not name an upload the
 * desktop does not have yet. While it travels it is listed in `uploads.ts` under `owner` — the
 * composer that asked — with its progress and a way to stop it; `PhoneUploads` draws the list.
 *
 * A failure answers `failed` as it always did, but the card stays, turned into the error with 重试:
 * an upload that died half way on a train is sent again from where the file already is, rather than
 * picked all over again. One that lands on a retry is handed to its composer late (`deliverLate`).
 */
export function uploadFromPhone(file: File, kind: FileKind, readableAsText: boolean, owner = ""): Promise<PhoneUploadOutcome> {
	if (!onPhone() || !wantsUpload(file.size, kind, readableAsText)) return Promise.resolve({ kind: "inline" });
	/*
	 * Asked by calling, not by looking: the phone's bridge answers any name it does not know with a
	 * function that resolves to null, so an older app "has" `upload` too — and saying null is exactly
	 * how it says it cannot.
	 */
	const upload = bridge.files.upload;
	if (typeof upload !== "function") return Promise.resolve({ kind: "unsupported" });

	return new Promise((resolve) => {
		/** Whether the composer has had its answer; after that, a success can only arrive late. */
		let answered = false;
		const answer = (outcome: PhoneUploadOutcome) => {
			if (answered) return;
			answered = true;
			resolve(outcome);
		};
		const key = addUpload({ owner, name: file.name, kind, done: 0, total: file.size, state: "uploading", cancel: () => {} });
		const fail = (reason: string) => {
			updateUpload(key, {
				state: "failed",
				error: reason,
				retry: () => void attempt(),
				cancel: () => removeUpload(key),
			});
			answer({ kind: "failed", reason });
		};

		const attempt = async () => {
			const controller = new AbortController();
			updateUpload(key, {
				state: "uploading",
				done: 0,
				total: file.size,
				error: undefined,
				retry: undefined,
				cancel: () => {
					controller.abort();
					removeUpload(key);
					answer({ kind: "cancelled" });
				},
			});
			try {
				const result = await upload(file, {
					name: file.name,
					signal: controller.signal,
					onProgress: (transfer) => updateUpload(key, { done: transfer.done, total: transfer.total || file.size }),
				});
				if (controller.signal.aborted) return;
				if (!result || typeof result.id !== "string" || typeof result.path !== "string") {
					if (answered) {
						// Took uploads on the first try and not now: the desktop on the other end changed.
						fail(translate("phone.uploadRefused"));
						return;
					}
					removeUpload(key);
					answer({ kind: "unsupported" });
					return;
				}
				removeUpload(key);
				const arrived = { upload: result.id, path: result.path, mimeType: result.mimeType || file.type || "application/octet-stream" };
				if (answered) deliverLate(owner, { name: file.name, kind, ...arrived });
				else answer({ kind: "uploaded", file: arrived });
			} catch (error) {
				// Stopped on purpose: `cancel` has already answered.
				if (controller.signal.aborted) return;
				fail(error instanceof Error ? error.message : String(error));
			}
		};
		void attempt();
	});
}
