/**
 * 项目配置层相对全局的差别，给设置页说出来（14 §3）。
 *
 * 设置页读写的是全局文件；项目里一份 .lyra/config.json 把某个数组整体换掉之后，页面上的开关
 * 照样能拨，只是在这个项目里什么都不改变。这条方法回答的就是「哪些键被换掉了、换成了什么、
 * 原来是什么」，外加那个文件在哪、里面哪些键被拒绝了。
 */

import { ipcMain } from "electron";
import { stat } from "node:fs/promises";
import { layerOverrides, loadProjectLayer, projectConfigPath } from "@lyra/core";
import { settings } from "../app-settings.ts";

export function registerLayersIpc(): void {
	ipcMain.handle("settings:layers", async (_event, cwd: string) => {
		const path = projectConfigPath(cwd);
		const exists = await stat(path).then(() => true).catch(() => false);
		if (!exists) return { path, exists: false, refused: [], overrides: [] };
		const layer = await loadProjectLayer(cwd);
		return {
			path,
			exists: true,
			error: layer.error,
			refused: layer.refused,
			overrides: layerOverrides(settings() as unknown as Record<string, unknown>, layer.config),
		};
	});
}
