import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { SessionStorage } from "@lyra/core";
import { grantArtifactRead } from "../readable-artifacts.ts";
import { sessionDelivery, undoDeliveryFile } from "../turn-delivery.ts";
import { isAppWindowContents } from "../window.ts";
export function registerDeliveryIpc(store: () => SessionStorage): void {
	const trusted = (event: IpcMainInvokeEvent, id: unknown, at: unknown) => {
		if (!isAppWindowContents(event.sender) || event.senderFrame !== event.sender.mainFrame || typeof id !== "string" || typeof at !== "number" || !Number.isFinite(at)) throw new Error("无效的交付记录请求");
	};
	ipcMain.handle("delivery:get", async (event, id: string, at: number) => { trusted(event, id, at); const result = await sessionDelivery(store(), id, at); if (result.reportPath) grantArtifactRead(result.reportPath); return result; });
	ipcMain.handle("delivery:undo", (event, id: string, at: number, path?: string) => {
		trusted(event, id, at); if (path !== undefined && typeof path !== "string") throw new Error("无效路径");
		return undoDeliveryFile(store(), id, at, path);
	});
}
