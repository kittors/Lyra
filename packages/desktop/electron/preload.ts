import { contextBridge, ipcRenderer, webUtils } from "electron";
import { METHODS } from "@lyra/contract";
import type { LyraApi } from "./ipc-types.ts";

/**
 * Paint the saved theme onto the document before anything else runs.
 *
 * This is the earliest point in the renderer that exists — before the stylesheet, before React,
 * before `settings:get` could possibly answer. Waiting for any of those means one or more frames
 * in the stylesheet's own palette, which is what made a light-theme app flash dark on every
 * launch. Only the four values the boot screen actually paints with are set here; the full
 * derived scale still comes from `applyAppearance` once the settings arrive.
 */
function paintBootTheme(): void {
	const flag = process.argv.find((arg) => arg.startsWith("--ly-boot="));
	if (!flag) return;

	let boot: { dark: boolean; background: string; foreground: string; accent: string };
	try {
		boot = JSON.parse(decodeURIComponent(flag.slice("--ly-boot=".length)));
	} catch {
		return;
	}

	const apply = () => {
		const root = document.documentElement;
		if (!root) return;
		root.classList.toggle("dark", boot.dark);
		root.classList.toggle("light", !boot.dark);
		// `light-dark()` in the editor's syntax colours resolves against this and nothing else.
		root.style.colorScheme = boot.dark ? "dark" : "light";
		root.style.setProperty("--color-shell", boot.background);
		root.style.setProperty("--color-ink", boot.foreground);
		root.style.setProperty("--color-accent", boot.accent);
		root.style.color = boot.foreground;
		/*
		 * Painted directly as well, not only as a token: the stylesheet that turns `--color-shell`
		 * into a background is itself a load away, and until it lands the page is default white.
		 */
		root.style.background = boot.background;
		// Left behind so "did the theme land before the first paint?" stays answerable later.
		root.dataset.bootThemeMs = String(Math.round(performance.now()));
	};

	apply();
	// Belt and braces: on the rare launch where the document element is not up yet.
	if (!document.documentElement) document.addEventListener("readystatechange", apply, { once: true });
}

paintBootTheme();

/**
 * The renderer gets exactly this surface and nothing else — no `ipcRenderer`, no `require`.
 * Every method maps to one named channel so a compromised renderer cannot invoke arbitrary IPC.
 */
/**
 * The invoke half of `window.lyra`, built from the contract.
 *
 * One line per method used to live here — 156 of them, each spelling out a channel name that also
 * appears in the main process's handler and, for the ones a phone may call, a third time in
 * `sync-rpc`. Three spellings of one string, and a typo in any of them fails differently: a wrong
 * channel here is `undefined is not a function`, a wrong one there is a call that never returns.
 *
 * Now the name exists once, in `@lyra/contract`, and this walks it. A method cannot be missing
 * from the preload, and a channel cannot be misspelt, because neither is written twice.
 *
 * What is *not* generated: anything that subscribes to a push (`ipcRenderer.on`), and the two
 * places that need something only the preload has — `webUtils` for a dropped file's path, and
 * `process.platform`. Those stay written out below, which is also why this is a merge rather than
 * a replacement.
 */
function invokers(): Record<string, unknown> {
	const built: Record<string, Record<string, unknown>> = {};
	for (const [group, methods] of Object.entries(METHODS)) {
		built[group] = {};
		for (const [name, method] of Object.entries(methods)) {
			built[group][name] = (...args: unknown[]) => ipcRenderer.invoke(method.channel, ...args);
		}
	}
	return built;
}

/**
 * The generated methods, then the hand-written ones on top.
 *
 * Order matters: a group defined below — `terminal`, say, which also carries `onData` — has to
 * merge *into* its generated half rather than replace it, or the invoke methods vanish.
 */
function merge(generated: Record<string, unknown>, extra: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = { ...generated };
	for (const [key, value] of Object.entries(extra)) {
		const base = out[key];
		out[key] =
			base && typeof base === "object" && value && typeof value === "object" && !Array.isArray(value)
				? { ...(base as object), ...(value as object) }
				: value;
	}
	return out;
}

/*
 * 手写的那部分，按 `LyraApi` 的形状检查，但每一组都是可选的。
 *
 * 直接标 `LyraApi` 不行——这里只有事件订阅和两三个特例，缺掉的方法由 `invokers()` 补上，
 * 而类型系统看不到那次合并。`DeepPartial` 让参数仍然能从接口推断出类型（那正是上一版丢掉的
 * 东西：没有标注时 `handler` 全都成了隐式 any），同时允许这张表是不完整的。
 */
type DeepPartial<T> = {
	// 函数原样保留——递归下去会把参数拆成 unknown，那正是上一版每个 handler 都成了隐式 any 的原因。
	[K in keyof T]?: T[K] extends (...args: never[]) => unknown ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const extras: DeepPartial<LyraApi> = {
	platform: process.platform,
	settings: {
		onChanged: (handler) => {
			const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof handler>[0]) => handler(payload);
			ipcRenderer.on("settings:changed", listener);
			return () => ipcRenderer.removeListener("settings:changed", listener);
		},
	},
	agent: {
		onEvent: (handler) => {
			const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof handler>[0]) => handler(payload);
			ipcRenderer.on("agent:event", listener);
			return () => ipcRenderer.removeListener("agent:event", listener);
		},
	},
	sideChat: {
		onEvent: (handler) => {
			const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof handler>[0]) => handler(payload);
			ipcRenderer.on("sidechat:event", listener);
			return () => ipcRenderer.removeListener("sidechat:event", listener);
		},
	},
	files: {
		mediaUrl: (path) => `ly-media://f/${encodeURIComponent(path)}`,
		/*
		 * The only thing in this bridge that is not an IPC call.
		 *
		 * `webUtils` lives in the preload and nowhere else, and a drop handler cannot await: by the
		 * time a promise resolved the `DataTransfer` has been emptied. So the path is read here,
		 * synchronously, and everything after it goes over IPC like the rest.
		 */
		pathForDrop: (file) => webUtils.getPathForFile(file),
	},
	terminal: {
		prewarm: (cwd, cols, rows) => ipcRenderer.send("terminal:prewarm", cwd, cols, rows),
		detach: (id, epoch) => ipcRenderer.send("terminal:detach", id, epoch),
		// `send`, not `invoke`: keystrokes must not wait for a round trip to echo.
		write: (id, data) => ipcRenderer.send("terminal:write", id, data),
		resize: (id, cols, rows) => ipcRenderer.send("terminal:resize", id, cols, rows),
		kill: (id) => ipcRenderer.send("terminal:kill", id),
		onData: (handler) => {
			const listener = (_e: Electron.IpcRendererEvent, payload: Parameters<typeof handler>[0]) => handler(payload);
			ipcRenderer.on("terminal:data", listener);
			return () => ipcRenderer.removeListener("terminal:data", listener);
		},
		onExit: (handler) => {
			const listener = (_e: Electron.IpcRendererEvent, payload: Parameters<typeof handler>[0]) => handler(payload);
			ipcRenderer.on("terminal:exit", listener);
			return () => ipcRenderer.removeListener("terminal:exit", listener);
		},
	},
	
	setWindowTheme: (colors: { color: string; symbolColor: string }) =>
		ipcRenderer.send("window:theme", colors),
	onFullScreenChange: (handler) => {
		const listener = (_e: Electron.IpcRendererEvent, full: boolean) => handler(full);
		ipcRenderer.on("window:fullscreen", listener);
		return () => ipcRenderer.removeListener("window:fullscreen", listener);
	},
	/** An error that reached the top of the main process. See `reportToTopLevel` in `main.ts`. */
	onMainError: (handler) => {
		const listener = (_e: Electron.IpcRendererEvent, payload: { origin: string; message: string }) => handler(payload);
		ipcRenderer.on("app:mainError", listener);
		return () => ipcRenderer.removeListener("app:mainError", listener);
	},
	/** What the status bar menu was asked for. One channel, because the commands are one kind. */
	onTrayCommand: (handler) => {
		const listener = (_e: Electron.IpcRendererEvent, command: Parameters<typeof handler>[0]) => handler(command);
		ipcRenderer.on("tray:command", listener);
		return () => ipcRenderer.removeListener("tray:command", listener);
	},
	updates: {
		onProgress: (listener) => {
			const handler = (_event: unknown, phase: Parameters<typeof listener>[0]) => listener(phase);
			ipcRenderer.on("updates:progress", handler);
			return () => ipcRenderer.off("updates:progress", handler);
		},
	},
	screenshot: {
		onInit: (handler) => {
			const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof handler>[0]) => handler(payload);
			ipcRenderer.on("screenshot:init", listener);
			return () => ipcRenderer.removeListener("screenshot:init", listener);
		},
		// "The snapshot is on the canvas" — the overlay stays hidden until this arrives, so that
		// what appears is the frozen screen rather than an empty window catching up to it.
		ready: () => ipcRenderer.send("screenshot:ready"),
		// Measurements from inside the overlay, for the capture log.
		debug: (what: string, detail: Record<string, unknown>) => ipcRenderer.send("screenshot:debug", what, detail),
		// The other half of that handshake: "you are on screen now", which is when a fade has
		// frames to run in. A hidden page is not composited and a transition started there jumps
		// straight to its end.
		onShown: (handler: () => void) => {
			const listener = () => handler();
			ipcRenderer.on("screenshot:shown", listener);
			return () => ipcRenderer.removeListener("screenshot:shown", listener);
		},
		// "A frame exists" — sent from inside a rAF, which is when the window may safely be made
		// visible. Until then its surface may still be rebuilding, and a rebuilding surface shows
		// stretched. See `reveal` in `screenshot.ts`.
		painted: () => ipcRenderer.send("screenshot:painted"),
		// "A colour was taken" — the capture is visually over, so let presses through while the
		// confirmation is still up. See `overlayPassedThrough`.
		colourPicked: () => ipcRenderer.send("screenshot:colourPicked"),
		// And the end of one: the window is off screen and the page can let go of the picture.
		onHidden: (handler: () => void) => {
			const listener = () => handler();
			ipcRenderer.on("screenshot:hidden", listener);
			return () => ipcRenderer.removeListener("screenshot:hidden", listener);
		},
	},
};

contextBridge.exposeInMainWorld("lyra", merge(invokers(), extras) as unknown as LyraApi);
