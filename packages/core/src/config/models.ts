/**
 * 在一份设置里找模型。两个纯函数，一行 Node 内置模块都不碰。
 *
 * 单独一个文件，是为了**渲染器能用**。`settings.ts` 顶上就是 `node:fs` 和 `node:os`——它要读盘、
 * 要知道家目录在哪——所以从它那里导入一个值，会把整条依赖链拉进浏览器包里，然后在第一个
 * Node 内置模块上抛出来，窗口一片空白。类型不要紧（编译时就没了），值必须来自一个自己就
 * 安全的入口。
 *
 * `settings.ts` 仍然把这两个再导出一遍，所以原来的调用点一个字都不用改。
 */

import type { Settings } from "./settings.ts";

/** 按 id 找一个启用中的模型，连同它的供应商。找不到就是 `null`。 */
export function resolveModel(settings: Settings, id: string | null) {
	if (!id) return null;
	for (const provider of settings.providers) {
		if (!provider.enabled) continue;
		const model = provider.models.find((m) => m.id === id);
		if (model) return { provider, model };
	}
	return null;
}

/** 所有启用中的模型，拍平给选择器用。 */
export function availableModels(settings: Settings) {
	return settings.providers.filter((p) => p.enabled).flatMap((p) => p.models.map((m) => ({ provider: p, model: m })));
}
