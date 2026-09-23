import type { Message, MessageAttachment, SessionStorage, Settings, UserContent } from "@lyra/core";
import type { SessionSnapshot } from "./ipc-types.ts";

export interface InitialPrompt {
	content: UserContent[];
	synthetic?: boolean;
	displayText?: string;
	skillRef?: { name: string; path?: string; pluginId?: string };
	sessionRefs?: Array<{ id: string; title: string }>;
	attachments?: MessageAttachment[];
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
	const title = (text || referenceTitle || "").replace(/\s+/g, " ").trim().slice(0, 60) || (initial ? "图片消息" : "New session");
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
	for (const message of messages) meta = await store.append(meta, { type: "message", message });
	if (initial || settings.worktrees?.autoCreateOnNewSession) {
		meta = await store.append(meta, { type: "meta", meta: {
			...meta,
			...(initial ? { pendingPrompt: true } : {}),
			...(settings.worktrees?.autoCreateOnNewSession ? { workspaceSetup: "worktree" } : {}),
		} });
	}
	return { meta, messages, running: Boolean(initial), pendingApprovals: [] };
}
