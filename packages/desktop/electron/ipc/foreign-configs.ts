/**
 * 首次进入一个带其他工具配置的项目时的那条提示（15 §5）：有什么、看过没有、看过了。
 */

import { ipcMain } from "electron";
import { FOREIGN_CONFIGS_NOTICE, foreignConfigsIn, markNoticed, noticed } from "@lyra/core";

export function registerForeignConfigsIpc(): void {
	ipcMain.handle("workspace:foreignConfigs", async (_event, cwd: string) => {
		const [lines, seen] = await Promise.all([foreignConfigsIn(cwd).catch(() => []), noticed(cwd, FOREIGN_CONFIGS_NOTICE)]);
		return { lines, seen };
	});
	ipcMain.handle("workspace:markForeignConfigsSeen", async (_event, cwd: string) => {
		await markNoticed(cwd, FOREIGN_CONFIGS_NOTICE);
	});
}
