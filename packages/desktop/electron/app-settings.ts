/**
 * The app's settings, in one place that owns them.
 *
 * They were a mutable module variable that six different files assigned to, which meant a change
 * could take effect in some of the places that care and not the others — a saved model that live
 * sessions never heard about, sync left running after being switched off. Here there is one setter,
 * and applying a change is one thing that either happens completely or not at all.
 *
 * `subscribe` exists because the parts that must react are not all reachable from here: the window
 * belongs to Electron, live sessions belong to the hub, sync to the server. They register what to
 * do; this decides when.
 */

import { loadSettings, migrateSecrets, saveSettings as persist, type Settings } from "@lyra/core";

type Listener = (next: Settings) => void | Promise<void>;

let current: Settings | undefined;
const listeners: Listener[] = [];

export async function loadAppSettings(): Promise<Settings> {
	/*
	 * Move any API key still written into `settings.json` out of it, before anything reads it.
	 *
	 * `saveSettings` does this on every write, so a key would move the next time anything was
	 * changed — but somebody who never opens the settings page would keep theirs in a plaintext,
	 * world-readable file forever. Here it happens once, on the first launch after updating, and is
	 * a no-op on every launch after that.
	 *
	 * Failures are swallowed on purpose: a profile on a read-only volume, or a home directory
	 * somebody has made undeletable, must not stop the app from starting over a hygiene task.
	 */
	await migrateSecrets().catch(() => 0);
	current = await loadSettings();
	return current;
}

/**
 * The settings, or undefined before boot has read them.
 *
 * Undefined rather than a default, because a default here would be a second source of truth for
 * every field — and the one place it is genuinely needed (the window's first frame) already knows
 * how to fall back.
 */
export function getSettings(): Settings | undefined {
	return current;
}

/** The settings, asserted to exist. For code that only ever runs after boot. */
export function settings(): Settings {
	if (!current) throw new Error("settings read before boot");
	return current;
}

export function onSettingsChanged(listener: Listener): () => void {
	listeners.push(listener);
	return () => {
		const at = listeners.indexOf(listener);
		if (at >= 0) listeners.splice(at, 1);
	};
}

/**
 * Change the settings: in memory, on disk, and everywhere that cares.
 *
 * The in-memory value moves first so that a listener reading `settings()` sees the new one, which
 * is what anything reacting to the change would expect.
 *
 * **一个监听器出错，不能把「保存」变成失败。** 它们跑在 `persist` 之后——文件已经写完了，改动
 * 已经生效了。让异常冒出去，调用方拿到的是一个 rejected promise，于是窗口回滚显示旧值，
 * 而磁盘上是新值：一次成功的保存，看起来像一次失败，两边还对不上。
 *
 * 撞到的那次是同步服务：端口被另一个进程占着，`startSync` 抛了 EADDRINUSE，于是在设置页
 * **改任何一项**都会失败——改主题、换模型、开个开关，全都一样，而屏幕上只有那个控件默默弹回去。
 */
export async function applySettings(next: Settings): Promise<Settings> {
	current = next;
	await persist(next);
	for (const listener of listeners) {
		try {
			await listener(next);
		} catch (error) {
			// 报给主进程的错误通道，跟别的后台失败走同一条路，而不是消失。
			console.error("[settings] 应用改动时有一个监听器失败了：", error);
		}
	}
	return next;
}
