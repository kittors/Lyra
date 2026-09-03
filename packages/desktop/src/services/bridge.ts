/**
 * The one place `window.lyra` is named.
 *
 * Everything the renderer asks of the main process goes through this object, and it is reached
 * through `services/` rather than directly — 87 files used to name it, which made three questions
 * unanswerable without searching all of them: what does this window actually call, which of those
 * calls work on a phone, and what would have to change to test any of it.
 *
 * `oxlint` enforces the rule (`no-restricted-properties` on `window.lyra`), with this file and
 * `host.ts` exempted. A lint rule rather than a convention because the convention held for exactly
 * as long as somebody was watching.
 *
 * ## Two hosts
 *
 * On the desktop this is built by the preload out of IPC channels. On a phone it is built by
 * `mobile/src/bridge.ts` out of HTTP and one WebSocket, and the renderer cannot tell the
 * difference — that is the whole design. What *does* differ is which methods answer: see `host.ts`.
 */

import type { LyraApi } from "../../electron/ipc-types.ts";

/**
 * The bridge, or a failure that names the cause.
 *
 * A missing `window.lyra` means the preload did not run, and every symptom of that is confusing:
 * blank panels, buttons that do nothing, a settings page with no settings. Better to say so.
 */
function bridgeOrThrow(): LyraApi {
	/*
	 * `globalThis.lyra` and `globalThis.window.lyra` are the same object in a browser and are not in
	 * a test.
	 *
	 * The preload exposes it on `window`, which *is* `globalThis` at runtime — so either spelling
	 * works there. A unit test has no `window` until it makes one, and what it makes is an ordinary
	 * object assigned to `globalThis.window`; reading only `globalThis.lyra` would miss it, and the
	 * store under test would throw at a point unrelated to what the test is about.
	 */
	const scope = globalThis as { lyra?: LyraApi; window?: { lyra?: LyraApi } };
	const api = scope.lyra ?? scope.window?.lyra;
	if (!api) {
		throw new Error(
			"window.lyra 不存在——preload 没有跑起来。在浏览器里直接打开渲染进程会这样；" +
				"应用里出现这个则说明 preload 加载失败，看主进程的日志。",
		);
	}
	return api;
}

/**
 * Deliberately lazy.
 *
 * Module evaluation happens before the preload has necessarily finished, and a top-level read would
 * throw during import rather than at the call that needed it. A `Proxy` keeps the ergonomics of a
 * plain object — `bridge.sessions.list()` — while deferring the lookup to the moment of use.
 */
export const bridge: LyraApi = new Proxy({} as LyraApi, {
	get(_target, property) {
		return bridgeOrThrow()[property as keyof LyraApi];
	},
	has(_target, property) {
		return property in bridgeOrThrow();
	},
});

/** Whether the bridge is there at all. For the boot path, which has to cope with it not being. */
export function bridgeAvailable(): boolean {
	const scope = globalThis as { lyra?: LyraApi; window?: { lyra?: LyraApi } };
	return Boolean(scope.lyra ?? scope.window?.lyra);
}
