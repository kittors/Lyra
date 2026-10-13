import type { Message, MessageAttachment, SessionStorage, Settings, SpawnedFrom, UserContent } from "@lyra/core";
import type { SessionSnapshot } from "./ipc-types.ts";

export interface InitialPrompt {
	content: UserContent[];
	synthetic?: boolean;
	displayText?: string;
	skillRef?: { name: string; path?: string; pluginId?: string };
	sessionRefs?: Array<{ id: string; title: string }>;
	attachments?: MessageAttachment[];
	/** Run this conversation in a worktree of its own, or not. Absent follows `worktrees.autoCreateOnNewSession`. */
	worktree?: boolean;
	/** The suggestion card this conversation was started from; see `SessionMeta.spawnedFrom`. */
	spawnedFrom?: SpawnedFrom;
	/**
	 * What to call it, when whoever starts it already has a name for it — a suggestion card's title. The
	 * first message is written for the model, and its first sixty characters made a poor name in the list.
	 * Kept as a chosen name (`titleSetByUser`): neither the first turn nor the summariser replaces it.
	 */
	title?: string;
}

/** Persist identity, title and the submitted message without starting MCP, Git or a provider. */
export async function createStoredSession(
	store: SessionStorage,
	settings: Settings,
	cwd: string,
	modelId: string,
	initial?: InitialPrompt,
): Promise<SessionSnapshot> {
	const text = initial?.displayText ?? initial?.content.find((block) => block.type === "text")?.text ?? "";
	const referenceTitle = initial?.skillRef?.name ?? initial?.sessionRefs?.[0]?.title;
	const title = (initial?.title || text || referenceTitle || "").replace(/\s+/g, " ").trim().slice(0, 60) || (initial ? "图片消息" : "New session");
	// The level a new chat was given before its first message lives on the app default until now;
	// written here, so the next new chat moving the default does not move this one. See `SessionMeta.thinking`.
	let meta = await store.create(cwd, modelId || settings.defaultModelId || "", title, { thinking: settings.thinking });
	const messages: Message[] = initial
		? [
				{
					role: "user",
					content: initial.content,
					timestamp: Date.now(),
					...(initial.synthetic ? { synthetic: true } : {}),
					...(initial.displayText !== undefined ? { displayText: initial.displayText } : {}),
					...(initial.skillRef ? { skillRef: initial.skillRef } : {}),
					...(initial.sessionRefs?.length ? { sessionRefs: initial.sessionRefs } : {}),
					...(initial.attachments?.length ? { attachments: initial.attachments } : {}),
				},
			]
		: [];
	for (const message of messages) meta = (await store.append(meta, { type: "message", message })) ?? meta;
	// The choice made for this conversation, where one was; the setting is only the default it starts from.
	const worktree = initial?.worktree ?? Boolean(settings.worktrees?.autoCreateOnNewSession);
	if (initial || worktree) {
		meta = (await store.append(meta, { type: "meta", meta: {
			...meta,
			...(initial ? { pendingPrompt: true } : {}),
			...(worktree ? { workspaceSetup: "worktree" } : {}),
			/*
			 * A given name is a chosen one: taken when a person pressed Start on the card that offered it.
			 * Without this the first turn renames the conversation after its opening message — the
			 * instructions written for the model — the moment it starts (`resumePendingPrompt`).
			 */
			...(initial?.title ? { titleSetByUser: true } : {}),
		} })) ?? meta;
	}
	// Written before the snapshot goes back, so the card that started it reads as started the moment the session exists.
	if (initial?.spawnedFrom) meta = (await store.append(meta, { type: "meta", meta: { ...meta, spawnedFrom: initial.spawnedFrom } })) ?? meta;
	return { meta, messages, running: Boolean(initial), pendingApprovals: [] };
}
