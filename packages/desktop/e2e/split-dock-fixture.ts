import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const IDS = ["dock-a", "dock-b", "dock-c", "dock-d"] as const;

export async function seed(home: string): Promise<void> {
	const cwd = join(home, "project");
	const projectId = createHash("sha256").update(cwd).digest("hex").slice(0, 16);
	await mkdir(cwd, { recursive: true });
	await writeFile(join(cwd, "README.md"), "# floor\n");
	await mkdir(join(home, "sessions", projectId), { recursive: true });
	const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
	const metas = [];
	for (const [index, id] of IDS.entries()) {
		const messages = [
			{ role: "user", content: [{ type: "text", text: `会话 ${id} 用来验证分屏拖拽验证` }], timestamp: index * 10 },
			{ role: "assistant", content: [{ type: "text", text: `${id} 的回复。` }], api: "anthropic-messages", provider: "qa", model: "qa", usage, stopReason: "stop", timestamp: index * 10 + 1 },
		];
		const meta = {
			id,
			title: `地板 ${id.slice(-1).toUpperCase()}`,
			projectId,
			projectName: "分屏拖拽验证",
			cwd,
			createdAt: 1 + index,
			updatedAt: 100 - index,
			modelId: "qa/model",
			messageCount: messages.length,
			usage,
			seq: 3,
		};
		metas.push(meta);
		await writeFile(
			join(home, "sessions", projectId, `${id}.jsonl`),
			[
				JSON.stringify({ type: "meta", meta, seq: 0, ts: 1 }),
				...messages.map((message, i) => JSON.stringify({ type: "message", message, seq: i + 1, ts: 1 })),
				JSON.stringify({ type: "meta", meta, seq: 3, ts: 2 }),
			].join("\n") + "\n",
		);
	}
	await writeFile(join(home, "sessions", "index.json"), JSON.stringify(metas));
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1360, height: 850, x: 40, y: 40 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id: projectId, path: cwd, name: "分屏拖拽验证", pinned: true, lastOpenedAt: 1 }],
			defaultModelId: null,
			permissionMode: "full",
			thinking: "off",
			retryAttempts: 1,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4588, token: null },
			uiLocale: "zh-CN",
			appearance: { theme: "dark" },
		}),
	);
}
