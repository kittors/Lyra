/**
 * What `image_generate` and `video_generate` share: reading the pictures a call points at, and saying
 * a failure in words the model can pass on truthfully.
 *
 * Out of `image.ts` once a second tool needed both — a first frame is pointed at exactly the way an
 * edit's pictures are, `#1` or a path, and a spent quota reads the same whatever was being made.
 */

import { readFile } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import { failureOf } from "../ai/failure.ts";
import { sniffImageType } from "../images/dimensions.ts";
import { parseRatio } from "../images/shape.ts";
import { loadPicture } from "../images/recent.ts";
import type { ImageInput, ImagePointer } from "../images/types.ts";
import { persistSessionImage, safeMediaName, sessionMediaHome, sessionMediaPath } from "../session/payload.ts";
import type { ToolContext } from "../types.ts";
import { authorizeRead, toAbsolute } from "./read-access.ts";

/** Bigger than any reference picture needs to be, and small enough not to time out an upload. */
const MAX_INPUT_BYTES = 20 * 1024 * 1024;
export const MAX_INPUTS = 8;

/** A file the tool made earlier is in the app's own directory, not the workspace, and needs no asking. */
function ownMedia(path: string): string | null {
	const rel = relative(sessionMediaHome(), path);
	if (!rel || rel.startsWith("..") || isAbsolute(rel)) return null;
	return safeMediaName(rel) || null;
}

/**
 * `#1`, `#2` from the conversation, or paths; a sentence for the model on the first one that fails.
 *
 * Each input also comes back as a `session-media` name — what the result records as its sources. A
 * picture that is not in `session-media` yet (a workspace file, a small inline attachment) is stored
 * there under its hash, so the gallery can still show where an edit started after the file changed.
 */
export async function picturesFor(refs: string[], ctx: ToolContext, conversation: () => ImagePointer[]): Promise<{ inputs: ImageInput[]; sources: string[] } | string> {
	if (refs.length > MAX_INPUTS) return `At most ${MAX_INPUTS} images can go into one call; ${refs.length} were given.`;
	let pictures: ImagePointer[] | null = null;
	const inputs: ImageInput[] = [];
	const sources: string[] = [];
	for (const raw of refs) {
		const ref = raw.trim();
		const numbered = /^#\s*(\d+)$/.exec(ref);
		if (numbered) {
			pictures ??= conversation();
			const index = Number(numbered[1]);
			const picture = index >= 1 ? pictures[index - 1] : undefined;
			const loaded = picture ? await loadPicture(picture) : null;
			if (!loaded) {
				return pictures.length === 0
					? `There are no images in this conversation, so "${ref}" refers to nothing. Ask the user to attach the picture.`
					: `"${ref}" is out of range: this conversation has ${pictures.length} image${pictures.length === 1 ? "" : "s"} (#1 is the newest).`;
			}
			inputs.push(loaded);
			sources.push(safeMediaName(picture?.media ?? "") || persistSessionImage(loaded.data, loaded.mimeType));
			continue;
		}
		const absolute = toAbsolute(ctx.cwd, ref);
		const media = ownMedia(absolute);
		if (!media) {
			const access = await authorizeRead(ctx, ref);
			if (!access.ok) return access.message;
		}
		const bytes = await readFile(media ? sessionMediaPath(media) : absolute).catch(() => null);
		if (!bytes) return `Could not read ${ref}.`;
		if (bytes.length > MAX_INPUT_BYTES) return `${ref} is ${Math.round(bytes.length / 1048576)}MB; images over 20MB cannot be sent.`;
		const mimeType = sniffImageType(bytes);
		if (!mimeType) return `${ref} is not a PNG, JPEG or WebP image.`;
		const data = bytes.toString("base64");
		inputs.push({ data, mimeType, name: absolute.split(/[/\\]/).pop() });
		sources.push(media ?? persistSessionImage(data, mimeType));
	}
	return { inputs, sources };
}

/** Whether a shape is clearly not the ratio asked for — more than 8% off, past any rounding to a size grid. */
export function offRatio(asked: string, width: number, height: number): boolean {
	const ratio = parseRatio(asked);
	if (!ratio) return false;
	const wanted = ratio.width / ratio.height;
	return Math.abs(width / height - wanted) / wanted > 0.08;
}

export function seconds(ms: number): string {
	return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms / 1000)}s`;
}

function wait(ms: number): string {
	const minutes = Math.round(ms / 60_000);
	if (minutes < 1) return `${Math.ceil(ms / 1000)} seconds`;
	if (minutes < 60) return `${minutes} minutes`;
	return `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`;
}

export interface RecordedFailure {
	summary: string;
	detail?: string;
	hint?: string;
	retryAfterMs?: number;
}

/** What the model is told when it did not work, so it can tell the person something true. */
export function failureText(what: "Image generation" | "Video generation", model: string, error: unknown): { text: string; error: RecordedFailure } {
	const failure = failureOf(error);
	const detail = failure.detail ?? (error instanceof Error ? error.message : String(error));
	const recorded = { summary: failure.summary, detail: detail.slice(0, 2000), hint: failure.hint, retryAfterMs: failure.retryAfterMs };
	if (failure.hint === "check-billing") {
		const when = failure.retryAfterMs ? ` It resets in about ${wait(failure.retryAfterMs)}.` : "";
		return { error: recorded, text: `${model} has no quota left.${when} Tell the user; trying again now will fail the same way.` };
	}
	if (failure.hint === "blocked") {
		return {
			error: recorded,
			text: `The provider refused this request under its content policy (${detail.slice(0, 300)}). Tell the user it was refused; the same request will be refused the same way, so don't retry it unchanged.`,
		};
	}
	if (failure.hint === "check-key") {
		return {
			error: recorded,
			text: `The provider refused ${model} for this key (${detail.slice(0, 300)}). The user may need to allow the model for the key, or use a provider address whose group includes it. Don't retry.`,
		};
	}
	return { error: recorded, text: `${what} with ${model} failed: ${failure.summary}. ${detail.slice(0, 600)}` };
}
