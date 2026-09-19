import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from "electron";
import { parseBrowserCommand } from "../../shared/browser.ts";
import { browserCommand, browserState, configureBrowser, attachBrowser } from "../browser-workspace.ts";
import { cancelBrowserInspect, inspectBrowser } from "../browser-inspect.ts";
import { isAppWindowContents } from "../window.ts";

export function registerBrowserIpc(window: () => BrowserWindow | null, settings: () => { defaultZoom?: number }): void {
	configureBrowser(window, settings);
	const trusted = (event: IpcMainInvokeEvent) => {
		if (!isAppWindowContents(event.sender) || event.senderFrame !== event.sender.mainFrame) throw new Error("浏览器控制只允许来自 Lyra 应用窗口");
	};
	ipcMain.handle("browser:state", (event) => { trusted(event); return browserState(); });
	ipcMain.handle("browser:command", async (event, command: unknown) => {
		trusted(event);
		return browserCommand(parseBrowserCommand(command));
	});
	ipcMain.handle("browser:attach", (event, id: string, contentsId: number) => { trusted(event); attachBrowser(id, contentsId, event.sender); });
	ipcMain.handle("browser:inspect", async (event, id: string, mode: "element" | "region") => {
		trusted(event);
		if (mode !== "element" && mode !== "region") throw new Error("未知检查方式");
		return inspectBrowser(id, mode);
	});
	ipcMain.handle("browser:cancelInspect", async (event, id: string) => { trusted(event); await cancelBrowserInspect(id); });
}
