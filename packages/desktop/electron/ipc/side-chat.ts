/** Electron IPC bindings for the shared side-chat service. */

import { ipcMain } from "electron";
import type { ThinkingLevel, UserContent } from "@lyra/core";
import {
	sideChatAbort,
	sideChatAsk,
	sideChatEditAndResend,
	sideChatReset,
	sideChatState,
	sideChatSetModel,
	tasksCancel,
	tasksDismiss,
	tasksList,
	tasksResume,
} from "../side-chat-service.ts";

export function registerSideChatIpc(): void {
	ipcMain.handle("sidechat:setModel", (_event, sessionId: string, modelId: string | null) => sideChatSetModel(sessionId, modelId));
	ipcMain.handle("sidechat:state", (_event, sessionId: string) => sideChatState(sessionId));
	ipcMain.handle("sidechat:ask", (_event, sessionId: string, content: UserContent[], options?: { thinking?: ThinkingLevel }) => sideChatAsk(sessionId, content, options));
	ipcMain.handle("sidechat:editAndResend", (_event, sessionId: string, index: number, content: UserContent[]) =>
		sideChatEditAndResend(sessionId, index, content));
	ipcMain.handle("sidechat:abort", (_event, sessionId: string) => sideChatAbort(sessionId));
	ipcMain.handle("sidechat:reset", (_event, sessionId: string) => sideChatReset(sessionId));
	ipcMain.handle("tasks:list", (_event, sessionId: string) => tasksList(sessionId));
	ipcMain.handle("tasks:cancel", (_event, sessionId: string, taskId: string) => tasksCancel(sessionId, taskId));
	ipcMain.handle("tasks:dismiss", (_event, sessionId: string, taskId: string) => tasksDismiss(sessionId, taskId));
	ipcMain.handle("tasks:resume", (_event, sessionId: string, taskId: string) => tasksResume(sessionId, taskId));
}
