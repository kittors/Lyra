/**
 * The services that hang off a workspace: providers, sync, the symbol index, the scheduler.
 *
 * None of them belong to a conversation, which is why they are here rather than with the session
 * handlers — they answer questions about the machine and the project, and they answer them whether
 * or not anything is running.
 */

import { addMemoryEntry, annotateInjected, buildIndex, clearAllMemory, indexStats, loadIndex, loadMemory, readInjected, removeMemoryEntry, saveIndex, searchIndex, userInjectedPath } from "@lyra/core";
import { ipcMain } from "electron";
import type { ProviderTestResult, SyncStatus } from "../ipc-types.ts";
import { applySettings, settings } from "../app-settings.ts";
import { registerCommandsIpc } from "./commands.ts";
import { registerPluginsIpc } from "./plugins.ts";
import { registerSystemIpc } from "./system.ts";
import { sessions } from "../session-hub.ts";

export interface ServicesIpcDeps {
	testProvider(
		provider: ReturnType<typeof settings>["providers"][number],
		targetModelId?: string,
	): Promise<ProviderTestResult>;
	fetchEndpointModels?(
		provider: ReturnType<typeof settings>["providers"][number],
	): Promise<{ ok: boolean; models: string[]; error?: string }>;
	sync(): { status(): SyncStatus; stop(): Promise<void>; running: boolean } | null;
	startSync(): Promise<SyncStatus>;
	idleSyncStatus(): SyncStatus;
	scheduler(): { tick(): Promise<void> } | null;
}

export function registerServicesIpc(deps: ServicesIpcDeps): void {
	const { testProvider, fetchEndpointModels, idleSyncStatus, startSync } = deps;
	const syncServer = () => deps.sync();
	const scheduler = () => deps.scheduler();

	ipcMain.handle(
		"providers:test",
		async (_event, providerId: string, modelId?: string): Promise<ProviderTestResult> => {
			const provider = settings().providers.find((p) => p.id === providerId);
			if (!provider) return { ok: false, latencyMs: 0, message: "未找到该供应商配置" };
			return testProvider(provider, modelId);
		},
	);

	ipcMain.handle(
		"providers:fetchModels",
		async (_event, providerId: string): Promise<{ ok: boolean; models: string[]; error?: string }> => {
			const provider = settings().providers.find((p) => p.id === providerId);
			if (!provider) return { ok: false, models: [], error: "未找到该供应商配置" };
			if (!fetchEndpointModels) return { ok: false, models: [], error: "未实现模型获取" };
			return fetchEndpointModels(provider);
		},
	);

	ipcMain.handle("sync:status", async () => syncServer()?.status() ?? idleSyncStatus());
	ipcMain.handle("sync:start", async () => {
		await applySettings({ ...settings(), sync: { ...settings().sync, enabled: true } });
		return startSync();
	});
	ipcMain.handle("sync:stop", async () => {
		await applySettings({ ...settings(), sync: { ...settings().sync, enabled: false } });
		await syncServer()?.stop();
		return syncServer()?.status() ?? idleSyncStatus();
	});
	ipcMain.handle("sync:rotateToken", async () => {
		const token = crypto.randomUUID().replace(/-/g, "");
		await applySettings({ ...settings(), sync: { ...settings().sync, token } });
		await syncServer()?.stop();
		return startSync();
	});

	// Scanning does not need a live session: the settings pages are usually opened before
	// any conversation exists, and an empty plugin list there reads as "nothing installed".
	registerPluginsIpc({ settings, saveSettings: applySettings });

	// Same reason: the composer asks for these before the first turn, and the settings page
	// before there is a session at all.
	registerCommandsIpc();

	registerSystemIpc();

	ipcMain.handle("index:stats", async (_event, cwd: string) => indexStats(cwd));

	ipcMain.handle("index:rebuild", async (_event, cwd: string) => {
		const index = await buildIndex(cwd);
		await saveIndex(index);
		// Live sessions hold a cached copy; drop it so the next lookup sees the rebuild.
		for (const session of sessions.values()) {
			if (session.cwd === cwd) session.invalidateSymbolIndex();
		}
		return indexStats(cwd);
	});

	ipcMain.handle("index:search", async (_event, cwd: string, query: string) => {
		const index = (await loadIndex(cwd)) ?? (await buildIndex(cwd));
		return searchIndex(index, query, undefined, 50).map((s) => ({
			name: s.name,
			kind: s.kind,
			file: s.file,
			line: s.line,
		}));
	});

	ipcMain.handle("memory:load", async () => {
		const store = await loadMemory();
		// With when each one last reached the model — the sidecar, so the store itself stays untouched.
		return { entries: annotateInjected(store.entries, await readInjected(userInjectedPath())) };
	});

	ipcMain.handle("memory:add", async (_event, content: string) => {
		return addMemoryEntry(content, "user");
	});

	ipcMain.handle("memory:remove", async (_event, id: string) => {
		return removeMemoryEntry(id);
	});

	ipcMain.handle("memory:clear", async () => {
		return clearAllMemory();
	});

	ipcMain.handle("scheduler:runNow", async (_event, taskId: string) => {
		const task = settings().scheduledTasks.find((t) => t.id === taskId);
		if (!task) return { ok: false, error: "任务不存在" };
		// Clearing lastRunAt makes the task due, then one tick runs it through the normal path.
		await applySettings({
			...settings(),
			scheduledTasks: settings().scheduledTasks.map((t) => (t.id === taskId ? { ...t, lastRunAt: undefined } : t)),
		});
		await scheduler()?.tick();
		return { ok: true };
	});
}
