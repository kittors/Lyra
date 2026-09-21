import type { SessionStorage } from "@lyra/core";
import type { SessionChange } from "./ipc-shapes.ts";

/** Observe committed writes at the shared IPC/RPC boundary, including cold sessions. */
export function observeSessionStorage(store: SessionStorage, changed: (change: SessionChange) => void): SessionStorage {
	return {
		async create(...args) {
			const meta = await store.create(...args);
			changed({ id: meta.id, projectId: meta.projectId, meta });
			return meta;
		},
		async append(...args) {
			const meta = await store.append(...args);
			// Token updates already travel over the agent stream; only directory changes need a push.
			if (args[1].type !== "event") changed({ id: meta.id, projectId: meta.projectId, meta });
			return meta;
		},
		async setArchived(...args) {
			const meta = await store.setArchived(...args);
			if (meta) changed({ id: meta.id, projectId: meta.projectId, meta });
			return meta;
		},
		/*
		 * 推出去的 `projectId` 是**新**的那个，这正是侧边栏据以换组的依据：收到的一方按 id 找到
		 * 原来那条、整条换成这一份（见渲染层的 `applySessionChange`），于是它就从旧项目底下消失、
		 * 在新项目底下出现。
		 */
		async move(...args) {
			const meta = await store.move(...args);
			if (meta) changed({ id: meta.id, projectId: meta.projectId, meta });
			return meta;
		},
		async truncateFrom(...args) {
			const result = await store.truncateFrom(...args);
			if (result) changed({ id: result.meta.id, projectId: result.meta.projectId, meta: result.meta });
			return result;
		},
		async delete(projectId, id) {
			await store.delete(projectId, id);
			changed({ id, projectId, meta: null });
		},
		async deleteMany(targets) {
			await store.deleteMany(targets);
			for (const target of targets) changed({ ...target, meta: null });
		},
		read: (...args) => store.read(...args),
		readChanges: store.readChanges?.bind(store),
		messages: (...args) => store.messages(...args),
		load: (...args) => store.load(...args),
		listSessions: () => store.listSessions(),
		rebuildIndex: () => store.rebuildIndex(),
		// Startup maintenance runs before clients connect.
		pruneEmpty: (...args) => store.pruneEmpty(...args),
	};
}
