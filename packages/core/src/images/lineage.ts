/**
 * What each picture `image_generate` drew in a conversation was drawn from.
 *
 * A picture edited over several turns is a chain — the dog, the dog in a hat, a girl holding the dog —
 * and every link is a call whose inputs are earlier pictures. New results name those inputs
 * (`ImageGenerationDetails.sources`). Results written before that say only `edit: true`; their inputs
 * are recovered from the call's own arguments, `#1` and `#2` resolved against the conversation as it
 * stood when the call was made, by the same rule the tool used then (`conversationPictures`).
 *
 * Pictures are known by their `session-media` name, a hash of their bytes: the same picture in a
 * forked conversation, or attached to another one and edited there, is the same picture.
 */

import { safeMediaName } from "../session/payload.ts";
import type { Message, UserMessage } from "../types/message.ts";
import { conversationPictures } from "./recent.ts";
import { IMAGE_TOOL_NAME, type ImageGenerationDetails } from "./types.ts";
import { VIDEO_TOOL_NAME, type VideoGenerationDetails } from "../videos/types.ts";

/** What the person said that led to a picture: the newest message they typed before the call. */
export interface Ask {
	text: string;
	at: number;
	/** The record it is in, for finding it in the conversation. */
	seq: number;
	/** The files that went with it, as their marks name them: the window takes the 【图片 1】 marks out of `text`. */
	attachments: { name: string; label?: string }[];
}

export interface DrawnPicture {
	media: string;
	mimeType: string;
	width?: number;
	height?: number;
	/** The record of the result, where the conversation shows the picture. */
	seq: number;
	toolCallId: string;
	/** Which of the call's pictures this is, and how many it drew. */
	index: number;
	count: number;
	/** When it arrived. */
	at: number;
	prompt: string;
	revisedPrompt?: string;
	model: { id: string; name: string; provider: string };
	aspectRatio?: string;
	quality?: string;
	durationMs?: number;
	/** A video's length, in seconds; absent on a picture (its `mimeType` says which it is). */
	seconds?: number;
	/** The pictures that went in, as given; empty for a drawing from words alone. */
	sources: string[];
	/** Inputs that cannot be traced to a picture: a workspace file named in a call from before `sources`. */
	untraced: number;
	ask?: Ask;
}

/** A picture that went into a drawing without being drawn here: an attachment, a screenshot. */
export interface GivenPicture {
	media: string;
	mimeType: string;
	/** Where it first appeared in this conversation; absent when it never did (a file named by path). */
	seq?: number;
	at: number;
	/** The message that carried it, when the person sent it. */
	ask?: Ask;
	/** The picture it is a marked-up copy of (`ImageContent.from`): where its history continues from. */
	from?: string;
}

export interface Drawings {
	drawn: DrawnPicture[];
	given: GivenPicture[];
}

/** One record of a conversation, as `SessionStore.load` hands them over: voided ones already gone. */
export interface TranscriptEntry {
	seq: number;
	message: Message;
}

/** Typed by the person — not a rule's correction, a nudge to carry on, or a report delivered back. */
function spokenByPerson(message: UserMessage): boolean {
	return !message.synthetic && !message.ruleMatch && !message.delivery?.length;
}

/** Long enough for any instruction about a picture; a pasted document is not one. */
const ASK_CHARS = 600;

function askOf(message: UserMessage, seq: number): Ask {
	const typed = message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n\n");
	return {
		text: (message.displayText ?? typed).trim().slice(0, ASK_CHARS),
		at: message.timestamp,
		seq,
		attachments: (message.attachments ?? []).map((file) => ({ name: file.name, ...(file.label ? { label: file.label } : {}) })),
	};
}

interface Call {
	refs: string[];
	/** Index of the message the call is in: what the conversation was when it was made. */
	before: number;
	ask?: Ask;
}

/**
 * The inputs of a call from before `sources` existed, from its `images` argument.
 *
 * `#n` is the n-th picture counting back from the newest, among those before the call's own message.
 * Sibling calls in the same message are not counted: they ran side by side, so none saw another's
 * picture. A path names a picture in `session-media` by its file name, a hash; any other path was a
 * workspace file that may have changed since, and is counted as untraced rather than guessed at.
 */
function traceCall(call: Call | undefined, messages: readonly Message[], edit: boolean): { sources: string[]; untraced: number } {
	if (!call) return { sources: [], untraced: edit ? 1 : 0 };
	let pictures: ReturnType<typeof conversationPictures> | null = null;
	const sources: string[] = [];
	let untraced = 0;
	for (const raw of call.refs) {
		const ref = raw.trim();
		const numbered = /^#\s*(\d+)$/.exec(ref);
		const media = numbered
			? safeMediaName(((pictures ??= conversationPictures(messages.slice(0, call.before)))[Number(numbered[1]) - 1]?.media) ?? "")
			: safeMediaName(ref);
		if (media) sources.push(media);
		else untraced++;
	}
	return { sources, untraced };
}

const MIME_OF_EXTENSION: Record<string, string> = { jpg: "image/jpeg", webp: "image/webp", mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };
const mimeOfName = (media: string): string => MIME_OF_EXTENSION[media.split(".").pop() ?? ""] ?? "image/png";

/** The pictures a call pointed at: an edit's `images`, a video's first and last frame and references. */
function refsOf(tool: string, args: unknown): string[] {
	const given = (args ?? {}) as { images?: unknown; image?: unknown; last_image?: unknown; references?: unknown };
	const list = tool === VIDEO_TOOL_NAME ? [given.image, given.last_image, ...(Array.isArray(given.references) ? given.references : [])] : Array.isArray(given.images) ? given.images : [];
	return list.filter((ref): ref is string => typeof ref === "string" && Boolean(ref.trim()));
}

/** Every picture and video made in this conversation, oldest first, with what each was made from. */
export function drawingsIn(entries: readonly TranscriptEntry[]): Drawings {
	const messages = entries.map((entry) => entry.message);
	const calls = new Map<string, Call>();
	/** Where each picture first turned up: the person's attachment, another tool's result, a drawing. */
	const seen = new Map<string, { seq: number; at: number; mimeType: string; ask?: Ask; from?: string }>();
	const drawn: DrawnPicture[] = [];
	let ask: Ask | undefined;

	const see = (media: string | undefined, mimeType: string, seq: number, at: number, by?: Ask, from?: string) => {
		const name = safeMediaName(media ?? "");
		const source = safeMediaName(from ?? "");
		if (name && !seen.has(name)) seen.set(name, { seq, at, mimeType, ask: by, ...(source && source !== name ? { from: source } : {}) });
	};

	entries.forEach(({ seq, message }, index) => {
		// A record without a role is a damaged one; the conversation draws a placeholder for it and so does nothing here.
		if (!message || typeof message.role !== "string") return;
		if (message.role === "user") {
			const said = spokenByPerson(message) ? askOf(message, seq) : undefined;
			if (said) ask = said;
			for (const part of message.content) if (part.type === "image") see(part.media, part.mimeType, seq, message.timestamp, said, part.from);
			return;
		}
		if (message.role === "assistant") {
			for (const part of message.content) {
				if (part.type !== "toolCall" || (part.name !== IMAGE_TOOL_NAME && part.name !== VIDEO_TOOL_NAME)) continue;
				calls.set(part.id, { refs: refsOf(part.name, part.arguments), before: index, ask });
			}
			return;
		}
		for (const part of message.content) if (part.type === "image") see(part.media, part.mimeType, seq, message.timestamp);
		if (message.toolName === VIDEO_TOOL_NAME) {
			const film = message.details as Partial<VideoGenerationDetails> | undefined;
			if (film?.status !== "done" || !film.videos?.length) return;
			// Every video result records its inputs; there is no older form to trace back from.
			const sources = Array.isArray(film.sources) ? [...new Set(film.sources.map((name) => safeMediaName(name)).filter(Boolean))] : [];
			const call = calls.get(message.toolCallId);
			film.videos.forEach((video, at) => {
				const media = safeMediaName(video.media ?? "");
				if (!media) return;
				drawn.push({
					media,
					mimeType: video.mimeType || mimeOfName(media),
					width: video.width,
					height: video.height,
					seconds: video.seconds,
					seq,
					toolCallId: message.toolCallId,
					index: at,
					count: film.videos?.length ?? 1,
					at: message.timestamp,
					prompt: film.prompt ?? "",
					model: film.model ?? { id: "", name: "", provider: "" },
					aspectRatio: film.aspectRatio,
					durationMs: film.durationMs,
					sources,
					untraced: 0,
					ask: call?.ask,
				});
			});
			return;
		}
		if (message.toolName !== IMAGE_TOOL_NAME) return;
		const details = message.details as Partial<ImageGenerationDetails> | undefined;
		if (details?.status !== "done" || !details.images?.length) return;
		const call = calls.get(message.toolCallId);
		const recorded = Array.isArray(details.sources) ? details.sources.map((name) => safeMediaName(name)).filter(Boolean) : null;
		const { sources, untraced } = recorded ? { sources: recorded, untraced: 0 } : traceCall(call, messages, details.edit === true);
		const count = details.images.length;
		details.images.forEach((image, at) => {
			const media = safeMediaName(image.media ?? "");
			if (!media) return;
			see(media, image.mimeType, seq, message.timestamp);
			drawn.push({
				media,
				mimeType: image.mimeType || mimeOfName(media),
				width: image.width,
				height: image.height,
				seq,
				toolCallId: message.toolCallId,
				index: at,
				count,
				at: message.timestamp,
				prompt: details.prompt ?? "",
				revisedPrompt: details.revisedPrompt,
				model: details.model ?? { id: "", name: "", provider: "" },
				aspectRatio: details.aspectRatio,
				quality: details.quality,
				durationMs: details.durationMs,
				sources: [...new Set(sources)].filter((source) => source !== media),
				untraced,
				ask: call?.ask,
			});
		});
	});

	const drawnHere = new Set(drawn.map((picture) => picture.media));
	const given = new Map<string, GivenPicture>();
	for (const picture of drawn) {
		for (const source of picture.sources) {
			if (drawnHere.has(source) || given.has(source)) continue;
			const first = seen.get(source);
			given.set(
				source,
				first
					? { media: source, mimeType: first.mimeType || mimeOfName(source), seq: first.seq, at: first.at, ask: first.ask, ...(first.from ? { from: first.from } : {}) }
					: { media: source, mimeType: mimeOfName(source), at: picture.ask?.at ?? picture.at },
			);
		}
	}
	return { drawn, given: [...given.values()] };
}
