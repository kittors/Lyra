/**
 * 扩展的可观测（10 §7.3）：加载状态、注册了什么、每个事件的调用次数与 p95、最近的错误、熔断。
 *
 * 宿主是每个会话一个，数字也是这个会话的。没有会话的时候页面不该空着——磁盘上的清单还在，
 * 「装了什么、想要哪些事件」不需要会话就能回答，只是没有数字。
 */

import { ipcMain } from "electron";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { extensionDirs, validateManifest, type ExtensionDiagnostic, type ExtensionStats } from "@lyra/core";
import { sessions } from "../session-hub.ts";

/** 只有清单：一个还没在任何会话里跑起来的扩展长什么样。 */
async function idleStats(cwd: string): Promise<{ extensions: ExtensionStats[]; diagnostics: ExtensionDiagnostic[] }> {
	const extensions: ExtensionStats[] = [];
	const diagnostics: ExtensionDiagnostic[] = [];
	for (const dir of await extensionDirs(cwd)) {
		const raw = await readFile(join(dir, "extension.json"), "utf8").catch(() => null);
		if (raw === null) continue;
		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (error) {
			diagnostics.push({ extension: dir, message: `清单不是合法的 JSON：${error instanceof Error ? error.message : String(error)}`, severity: "error" });
			continue;
		}
		const checked = validateManifest(parsed);
		if ("error" in checked) {
			diagnostics.push({ extension: dir, message: checked.error, severity: "error" });
			continue;
		}
		const { manifest } = checked;
		extensions.push({
			name: manifest.name,
			version: manifest.version,
			description: manifest.description,
			dir,
			events: manifest.events ?? [],
			intercepts: manifest.intercepts === true,
			state: "idle",
			failures: 0,
			perEvent: (manifest.events ?? []).map((event) => ({ event, calls: 0, errors: 0, timeouts: 0, p95Ms: null })),
		});
	}
	return { extensions, diagnostics };
}

export function registerExtensionsIpc(): void {
	ipcMain.handle("extensions:stats", async (_event, sessionId: string | null, cwd: string) => {
		const session = sessionId ? sessions.get(sessionId) : undefined;
		if (session) {
			const host = session.can.extensions;
			return { live: true, extensions: host.stats(), diagnostics: host.diagnostics.slice(-20) };
		}
		return { live: false, ...(await idleStats(cwd)) };
	});
}
