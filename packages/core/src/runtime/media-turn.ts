/**
 * What a turn settles about image and video models before it starts.
 *
 * Two things, both read from the turn's opening: a model the person `@`-named in what they just said
 * becomes the conversation's pick, and the drawing tools are told which models there are when there is
 * more than one to choose from. Out of `session-turn.ts`, which is long enough already.
 */

import { MODEL_ROLES } from "../config/model-roles.ts";
import { type MediaKind, mediaModelLabel, mediaModelRows } from "../images/models.ts";
import { type ConversationPicks, mentionedMedia } from "../images/picks.ts";
import type { Message } from "../types/message.ts";
import type { ProviderConfig } from "../types/provider.ts";
import type { Tool } from "../types/tool.ts";

/** `@` words that already mean something else, whatever models exist: built-in commands and model roles. */
const RESERVED = ["compact", "clear", "commands", ...MODEL_ROLES];

/**
 * A model `@`-named in the messages since the last reply becomes the conversation's pick, one kind at
 * a time — and only when it is the one model of its kind named there, the rule a reply naming two
 * models follows too. Written before the turn's first request, so the turn draws with it from the
 * start, whether or not the model also passes the name to the tool.
 *
 * `agents` are names `@` means an agent by (`delegation.ts`); they keep that meaning.
 */
export function adoptMentionedMedia(input: {
	messages: readonly Message[];
	providers: readonly ProviderConfig[];
	picks: ConversationPicks | undefined;
	agents: readonly string[];
}): Partial<Record<MediaKind, string>> {
	const set = input.picks?.set;
	if (!set) return {};
	const rows = { image: mediaModelRows(input.providers, "image"), video: mediaModelRows(input.providers, "video") };
	if (rows.image.length === 0 && rows.video.length === 0) return {};
	const lastReply = input.messages.findLastIndex((message) => message.role === "assistant");
	const said = input.messages
		.slice(lastReply + 1)
		.filter((message): message is Extract<Message, { role: "user" }> => message.role === "user" && !message.synthetic)
		.flatMap((message) => message.content)
		.filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
		.map((part) => part.text)
		.join("\n");
	if (!said.includes("@")) return {};
	const reserved = new Set([...RESERVED, ...input.agents].map((name) => name.toLowerCase()));
	const named = mentionedMedia(said, rows, reserved);
	const adopted: Partial<Record<MediaKind, string>> = {};
	for (const kind of ["image", "video"] as const) {
		const row = named[kind];
		if (!row) continue;
		set.call(input.picks, kind, row.model.id);
		adopted[kind] = row.model.id;
	}
	return adopted;
}

/**
 * The drawing tools with the models there are to choose from, when there is a choice.
 *
 * Without the list a model told 「用 grok 那个高清的」 can only guess a name, spend a call on the
 * error that lists the real ones, and try again. Names only, in the spelling the tool takes back
 * (`mediaModelLabel`); which one is current is deliberately left out — it changes with every switch,
 * and a description that changes is a prompt cache thrown away for a fact the tool already knows.
 */
export function describeMediaTools(tools: readonly Tool[], providers: readonly ProviderConfig[], names: Partial<Record<MediaKind, string>>): Tool[] {
	return tools.map((tool) => {
		const kind = (Object.keys(names) as MediaKind[]).find((key) => names[key] === tool.name);
		if (!kind) return tool;
		const rows = mediaModelRows(providers, kind);
		if (rows.length < 2) return tool;
		const list = rows.map((row) => mediaModelLabel(row, rows)).join(", ");
		const noun = kind === "video" ? "Video" : "Image";
		return { ...tool, description: `${tool.description}\n\n${noun} models configured: ${list}.` };
	});
}
