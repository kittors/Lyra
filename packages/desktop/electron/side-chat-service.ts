/** Shared side-chat operations used by Electron IPC and the mobile sync transport. */

import { SideChat, restoredSideChatMessages, type SideChatEvent, type ThinkingLevel, type UserContent } from "@lyra/core";
import { settings } from "./app-settings.ts";
import { broadcastSideChat, ensureLiveSession, sessions, sideChats } from "./session-hub.ts";
import { loadSideChatSnapshot, saveSideChatTranscript, saveSideChat } from "./sidechat-store.ts";

const opening = new Map<string, Promise<SideChat | null>>();

function reportError(sessionId: string, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	broadcastSideChat(sessionId, { type: "notice", level: "error", message });
	broadcastSideChat(sessionId, { type: "agent_end", reason: "error", error: message });
}

async function ensureSideChat(sessionId: string): Promise<SideChat | null> {
	const existing = sideChats.get(sessionId);
	if (existing) {
		existing.updateSettings(settings());
		return existing;
	}
	const pending = opening.get(sessionId);
	if (pending) return pending;

	const operation = (async () => {
		const main = await ensureLiveSession(sessionId);
		if (!main) return null;
		const chat: SideChat = new SideChat({
			main,
			settings: settings(),
			persistModel: (modelId) => saveSideChat(sessionId, chat.messages, modelId),
			persistReset: (modelId) => saveSideChat(sessionId, [], modelId),
			emit: async (event: SideChatEvent) => {
				broadcastSideChat(sessionId, event);
				if (event.type === "message_end" && event.message.role === "assistant" && event.message.usage) {
					try {
						await main.log.append({
							type: "usage",
							source: "side-chat",
							providerId: event.message.provider,
							modelId: event.message.model,
							usage: event.message.usage,
						});
					} catch (error) {
						console.error("[sidechat] Failed to record usage", error);
					}
				}
				if (event.type !== "message_end" && event.type !== "rewound") return;
				try {
					await saveSideChatTranscript(sessionId, chat.messages, chat.state().modelId);
				} catch (error) {
					console.error("[sidechat] Failed to persist transcript", error);
					broadcastSideChat(sessionId, {
						type: "notice",
						level: "error",
						message: "侧边聊天保存失败，请检查存储空间与目录权限。",
					});
				}
			},
		});
		const snapshot = await loadSideChatSnapshot(sessionId);
		chat.restore(snapshot.messages, snapshot.modelId);
		sideChats.set(sessionId, chat);
		return chat;
	})();
	opening.set(sessionId, operation);
	try {
		return await operation;
	} finally {
		if (opening.get(sessionId) === operation) opening.delete(sessionId);
	}
}

export async function sideChatState(sessionId: string) {
	const existing = sideChats.get(sessionId);
	if (existing) return existing.state();
	const { messages, modelId = settings().sideChatModelId || null } = await loadSideChatSnapshot(sessionId);
	const created = await opening.get(sessionId) ?? sideChats.get(sessionId);
	return created ? created.state() : { messages: restoredSideChatMessages(messages), modelId, running: false, revision: 0 };
}

export async function sideChatSetModel(sessionId: string, modelId: string | null): Promise<void> {
	if (modelId !== null && typeof modelId !== "string") throw new Error("Invalid side-chat model");
	const chat = await ensureSideChat(sessionId);
	if (!chat) throw new Error(`Session ${sessionId} is not open.`);
	await chat.setModel(modelId);
}

export async function sideChatAsk(sessionId: string, content: UserContent[], options?: { thinking?: ThinkingLevel }): Promise<void> {
	const chat = await ensureSideChat(sessionId);
	if (!chat) throw new Error(`Session ${sessionId} is not open.`);
	// 不给 `thinking` 就回落到主会话，再回落到全局设置——见 `sidechat.ts` 的 `run`。
	void chat.ask(content, options ?? {}).catch((error: unknown) => reportError(sessionId, error));
}

export async function sideChatEditAndResend(sessionId: string, index: number, content: UserContent[]): Promise<void> {
	const chat = await ensureSideChat(sessionId);
	if (!chat) throw new Error(`Session ${sessionId} is not open.`);
	void chat.editAndResend(index, content).catch((error: unknown) => reportError(sessionId, error));
}

export function sideChatAbort(sessionId: string): void {
	sideChats.get(sessionId)?.abort();
}

export async function sideChatReset(sessionId: string): Promise<void> {
	const chat = await ensureSideChat(sessionId);
	if (!chat) throw new Error(`Session ${sessionId} is not open.`);
	await chat.restart();
}

export function tasksList(sessionId: string) {
	return sessions.get(sessionId)?.taskQueue ?? [];
}

export async function tasksCancel(sessionId: string, taskId: string): Promise<boolean> {
	return (await sessions.get(sessionId)?.cancelTask(taskId)) ?? false;
}

export async function tasksDismiss(sessionId: string, taskId: string): Promise<boolean> {
	return (await sessions.get(sessionId)?.dismissTask(taskId)) ?? false;
}

export async function tasksResume(sessionId: string, taskId: string): Promise<boolean> {
	return (await sessions.get(sessionId)?.resumeTask(taskId)) ?? false;
}
