import { app, dialog, ipcMain } from "electron";
import { CustomFontStore } from "../custom-fonts.ts";
import { getWindow } from "../window.ts";

export function registerFontsIpc(): void {
	const fonts = new CustomFontStore(app.getPath("userData"));
	ipcMain.handle("fonts:list", () => fonts.list());
	ipcMain.handle("fonts:read", (_event, id: string) => fonts.read(id));
	ipcMain.handle("fonts:import", async () => {
		const window = getWindow();
		if (!window) return null;
		const result = await dialog.showOpenDialog(window, {
			properties: ["openFile"],
			filters: [{ name: "Fonts", extensions: ["ttf", "otf", "woff", "woff2"] }],
		});
		if (result.canceled || result.filePaths.length === 0) return null;
		return fonts.importFile(result.filePaths[0]);
	});
}
