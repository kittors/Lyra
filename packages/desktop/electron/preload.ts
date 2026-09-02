import { contextBridge, ipcRenderer, webUtils } from "electron";
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
const api: LyraApi = {
	platform: process.platform,
	settings: {
		get: () => ipcRenderer.invoke("settings:get"),
		save: (settings) => ipcRenderer.invoke("settings:save", settings),
		onChanged: (handler) => {
			const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof handler>[0]) => handler(payload);
			ipcRenderer.on("settings:changed", listener);
			return () => ipcRenderer.removeListener("settings:changed", listener);
		},
	},
	workspace: {
		pick: () => ipcRenderer.invoke("workspace:pick"),
		info: (path) => ipcRenderer.invoke("workspace:info", path),
		reveal: (path) => ipcRenderer.invoke("workspace:reveal", path),
	},
	sessions: {
		list: () => ipcRenderer.invoke("sessions:list"),
		create: (cwd, modelId) => ipcRenderer.invoke("sessions:create", cwd, modelId),
		open: (projectId, sessionId) => ipcRenderer.invoke("sessions:open", projectId, sessionId),
		transcript: (projectId, sessionId) => ipcRenderer.invoke("sessions:transcript", projectId, sessionId),
		trajectory: (projectId, sessionId) => ipcRenderer.invoke("sessions:trajectory", projectId, sessionId),
		fork: (projectId, sessionId, seq) => ipcRenderer.invoke("sessions:fork", projectId, sessionId, seq),
		remove: (projectId, sessionId) => ipcRenderer.invoke("sessions:remove", projectId, sessionId),
		setArchived: (projectId, sessionId, archived) =>
			ipcRenderer.invoke("sessions:setArchived", projectId, sessionId, archived),
		removeArchived: () => ipcRenderer.invoke("sessions:removeArchived"),
		capabilities: (sessionId) => ipcRenderer.invoke("sessions:capabilities", sessionId),
		rename: (projectId, sessionId, title) => ipcRenderer.invoke("sessions:rename", projectId, sessionId, title),
		compact: (sessionId) => ipcRenderer.invoke("sessions:compact", sessionId),
		contextBreakdown: (sessionId) => ipcRenderer.invoke("sessions:contextBreakdown", sessionId),
	},
	agent: {
		prompt: (sessionId, content, options) => ipcRenderer.invoke("agent:prompt", sessionId, content, options),
		editMessage: (sessionId, messageIndex, content) =>
			ipcRenderer.invoke("agent:editMessage", sessionId, messageIndex, content),
		abort: (sessionId) => ipcRenderer.invoke("agent:abort", sessionId),
		approve: (sessionId, requestId, decision) => ipcRenderer.invoke("agent:approve", sessionId, requestId, decision),
		setModel: (sessionId, modelId) => ipcRenderer.invoke("agent:setModel", sessionId, modelId),
		setThinking: (sessionId, thinking) => ipcRenderer.invoke("agent:setThinking", sessionId, thinking),
		onEvent: (handler) => {
			const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof handler>[0]) => handler(payload);
			ipcRenderer.on("agent:event", listener);
			return () => ipcRenderer.removeListener("agent:event", listener);
		},
	},
	subAgents: {
		list: (sessionId) => ipcRenderer.invoke("subagents:list", sessionId),
		detail: (sessionId, id) => ipcRenderer.invoke("subagents:detail", sessionId, id),
		steer: (sessionId, id, text) => ipcRenderer.invoke("subagents:steer", sessionId, id, text),
		abort: (sessionId, id) => ipcRenderer.invoke("subagents:abort", sessionId, id),
		dismiss: (sessionId, id) => ipcRenderer.invoke("subagents:dismiss", sessionId, id),
		dismissFinished: (sessionId) => ipcRenderer.invoke("subagents:dismissFinished", sessionId),
	},
	sideChat: {
		state: (sessionId) => ipcRenderer.invoke("sidechat:state", sessionId),
		ask: (sessionId, content) => ipcRenderer.invoke("sidechat:ask", sessionId, content),
		editAndResend: (sessionId, index, content) => ipcRenderer.invoke("sidechat:editAndResend", sessionId, index, content),
		abort: (sessionId) => ipcRenderer.invoke("sidechat:abort", sessionId),
		reset: (sessionId) => ipcRenderer.invoke("sidechat:reset", sessionId),
		onEvent: (handler) => {
			const listener = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof handler>[0]) => handler(payload);
			ipcRenderer.on("sidechat:event", listener);
			return () => ipcRenderer.removeListener("sidechat:event", listener);
		},
	},
	tasks: {
		list: (sessionId) => ipcRenderer.invoke("tasks:list", sessionId),
		cancel: (sessionId, taskId) => ipcRenderer.invoke("tasks:cancel", sessionId, taskId),
		dismiss: (sessionId, taskId) => ipcRenderer.invoke("tasks:dismiss", sessionId, taskId),
		resume: (sessionId, taskId) => ipcRenderer.invoke("tasks:resume", sessionId, taskId),
	},
	format: {
		external: (extension, source) => ipcRenderer.invoke("format:external", extension, source),
		available: (extension) => ipcRenderer.invoke("format:available", extension),
		config: (file) => ipcRenderer.invoke("format:config", file),
	},
	files: {
		list: (dir) => ipcRenderer.invoke("files:list", dir),
		read: (path) => ipcRenderer.invoke("files:read", path),
		document: (path) => ipcRenderer.invoke("files:document", path),
		bytes: (path) => ipcRenderer.invoke("files:bytes", path),
		write: (path, text) => ipcRenderer.invoke("files:write", path, text),
		/*
		 * One encoded segment under a fixed host.
		 *
		 * Not the host component: URL parsing lower-cases that, so `/Users/...` came back as
		 * `/users/...` and failed the (case-sensitive) project check. The path component keeps
		 * its case, and encoding it whole means a Windows `C:\` or a space survives too.
		 */
		mediaUrl: (path) => `ly-media://f/${encodeURIComponent(path)}`,
		create: (dir, name, kind) => ipcRenderer.invoke("files:create", dir, name, kind),
		rename: (from, to, overwrite) => ipcRenderer.invoke("files:rename", from, to, overwrite),
		copy: (from, to, overwrite) => ipcRenderer.invoke("files:copy", from, to, overwrite),
		trash: (paths) => ipcRenderer.invoke("files:trash", paths),
		remove: (paths) => ipcRenderer.invoke("files:remove", paths),
		uniquePath: (dir, name) => ipcRenderer.invoke("files:uniquePath", dir, name),
		exists: (path) => ipcRenderer.invoke("files:exists", path),
		importInto: (sources, dir) => ipcRenderer.invoke("files:import", sources, dir),
		/*
		 * The only thing in this bridge that is not an IPC call.
		 *
		 * `webUtils` lives in the preload and nowhere else, and a drop handler cannot await: by the
		 * time a promise resolved the `DataTransfer` has been emptied. So the path is read here,
		 * synchronously, and everything after it goes over IPC like the rest.
		 */
		pathForDrop: (file) => webUtils.getPathForFile(file),
	},
	clipboard: {
		read: () => ipcRenderer.invoke("clipboard:read"),
		write: (text) => ipcRenderer.invoke("clipboard:write", text),
	},
	terminal: {
		list: (cwd) => ipcRenderer.invoke("terminal:list", cwd),
		listAll: () => ipcRenderer.invoke("terminal:list-all"),
		open: (cwd, cols, rows) => ipcRenderer.invoke("terminal:open", cwd, cols, rows),
		prewarm: (cwd, cols, rows) => ipcRenderer.send("terminal:prewarm", cwd, cols, rows),
		attach: (id, cols, rows) => ipcRenderer.invoke("terminal:attach", id, cols, rows),
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
	providers: {
		test: (providerId, modelId) => ipcRenderer.invoke("providers:test", providerId, modelId),
		fetchModels: (providerId) => ipcRenderer.invoke("providers:fetchModels", providerId),
	},
	sync: {
		status: () => ipcRenderer.invoke("sync:status"),
		start: () => ipcRenderer.invoke("sync:start"),
		stop: () => ipcRenderer.invoke("sync:stop"),
		rotateToken: () => ipcRenderer.invoke("sync:rotateToken"),
	},
	commands: {
		list: (cwd) => ipcRenderer.invoke("commands:list", cwd),
		create: (scope, name, cwd) => ipcRenderer.invoke("commands:create", scope, name, cwd),
		reveal: (scope, cwd) => ipcRenderer.invoke("commands:reveal", scope, cwd),
		open: (path) => ipcRenderer.invoke("commands:open", path),
	},
	plugins: {
		list: (cwd) => ipcRenderer.invoke("plugins:list", cwd),
		revealDir: (scope, cwd) => ipcRenderer.invoke("plugins:revealDir", scope, cwd),
		fetchRegistry: (url, force) => ipcRenderer.invoke("registry:fetch", url, force),
		icon: (url) => ipcRenderer.invoke("registry:icon", url),
		icons: (urls) => ipcRenderer.invoke("registry:icons", urls),
		installFromRegistry: (entry, registryName, replace) =>
			ipcRenderer.invoke("registry:install", entry, registryName, replace),
		uninstall: (id) => ipcRenderer.invoke("registry:uninstall", id),
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
		check: (force) => ipcRenderer.invoke("updates:check", force),
		state: () => ipcRenderer.invoke("updates:state"),
		download: (version) => ipcRenderer.invoke("updates:download", version),
		pause: () => ipcRenderer.invoke("updates:pause"),
		cancel: () => ipcRenderer.invoke("updates:cancel"),
		relaunch: () => ipcRenderer.invoke("updates:relaunch"),
		reopen: () => ipcRenderer.invoke("updates:reopen"),
		open: (url) => ipcRenderer.invoke("updates:open", url),
		onProgress: (listener) => {
			const handler = (_event: unknown, phase: Parameters<typeof listener>[0]) => listener(phase);
			ipcRenderer.on("updates:progress", handler);
			return () => ipcRenderer.off("updates:progress", handler);
		},
	},
	system: {
		openPath: (path) => ipcRenderer.invoke("system:openPath", path),
		openExternal: (url) => ipcRenderer.invoke("system:openExternal", url),
		openIn: (target, path) => ipcRenderer.invoke("system:openIn", target, path),
		openTargets: () => ipcRenderer.invoke("system:openTargets"),
		revealSkillsDir: (scope, cwd) => ipcRenderer.invoke("system:revealSkillsDir", scope, cwd),
		platform: () => ipcRenderer.invoke("system:platform"),
		remoteImage: (url) => ipcRenderer.invoke("system:remoteImage", url),
	},
	screenshot: {
		start: (settings) => ipcRenderer.invoke("screenshot:start", settings),
		finish: (dataUrl, settings) => ipcRenderer.invoke("screenshot:finish", dataUrl, settings),
		cancel: () => ipcRenderer.invoke("screenshot:cancel"),
		pickDirectory: () => ipcRenderer.invoke("screenshot:pickDirectory"),
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
	index: {
		stats: (cwd) => ipcRenderer.invoke("index:stats", cwd),
		rebuild: (cwd) => ipcRenderer.invoke("index:rebuild", cwd),
		search: (cwd, query) => ipcRenderer.invoke("index:search", cwd, query),
	},
	scheduler: {
		runNow: (taskId) => ipcRenderer.invoke("scheduler:runNow", taskId),
	},
	forge: {
		kinds: () => ipcRenderer.invoke("forge:kinds"),
		accounts: () => ipcRenderer.invoke("forge:accounts"),
		signIn: (input) => ipcRenderer.invoke("forge:signIn", input),
		signOut: (id) => ipcRenderer.invoke("forge:signOut", id),
		setEnabled: (id, enabled) => ipcRenderer.invoke("forge:setEnabled", id, enabled),
		rename: (id, label) => ipcRenderer.invoke("forge:rename", id, label),
	},
	git: {
		myPullRequests: () => ipcRenderer.invoke("git:myPullRequests"),
		pullRequest: (accountId, repo, number) => ipcRenderer.invoke("git:pullRequest", accountId, repo, number),
		pullRequestDiff: (accountId, repo, number) => ipcRenderer.invoke("git:pullRequestDiff", accountId, repo, number),
		scratchForPullRequest: (pr) => ipcRenderer.invoke("scratch:forPullRequest", pr),
		generalScratch: () => ipcRenderer.invoke("scratch:general"),
		scratchRoots: () => ipcRenderer.invoke("scratch:roots"),
		findLocalCheckout: (repo, candidates) => ipcRenderer.invoke("git:findLocalCheckout", repo, candidates),
		avatar: (login) => ipcRenderer.invoke("git:avatar", login),
		avatars: (people) => ipcRenderer.invoke("git:avatars", people),
		commentOnPullRequest: (accountId, repo, number, body) =>
			ipcRenderer.invoke("git:commentOnPullRequest", accountId, repo, number, body),
		reviewPullRequest: (accountId, repo, number, verdict, body) =>
			ipcRenderer.invoke("git:reviewPullRequest", accountId, repo, number, verdict, body),
		branches: (cwd) => ipcRenderer.invoke("git:branches", cwd),
		switchBranch: (cwd, branch) => ipcRenderer.invoke("git:switchBranch", cwd, branch),
		createWorktree: (cwd, branch, options) => ipcRenderer.invoke("git:createWorktree", cwd, branch, options),
		removeWorktree: (cwd, worktreePath) => ipcRenderer.invoke("git:removeWorktree", cwd, worktreePath),
		pruneWorktrees: (cwd) => ipcRenderer.invoke("git:pruneWorktrees", cwd),
		stat: (cwd) => ipcRenderer.invoke("git:stat", cwd),
		commit: (cwd, message) => ipcRenderer.invoke("git:commit", cwd, message),
		status: (cwd) => ipcRenderer.invoke("git:status", cwd),
		repos: (root) => ipcRenderer.invoke("git:repos", root),
		worktrees: (cwd) => ipcRenderer.invoke("git:worktrees", cwd),
		init: (cwd) => ipcRenderer.invoke("git:init", cwd),
		log: (cwd, limit, ref) => ipcRenderer.invoke("git:log", cwd, limit, ref),
		commitDiff: (cwd, sha) => ipcRenderer.invoke("git:commitDiff", cwd, sha),
		commitDiffSummary: (cwd, sha) => ipcRenderer.invoke("git:commitDiffSummary", cwd, sha),
		diffRefs: (cwd, base, head) => ipcRenderer.invoke("git:diffRefs", cwd, base, head),
		stage: (cwd, paths) => ipcRenderer.invoke("git:stage", cwd, paths),
		unstage: (cwd, paths) => ipcRenderer.invoke("git:unstage", cwd, paths),
		discard: (cwd, paths) => ipcRenderer.invoke("git:discard", cwd, paths),
		commitStaged: (cwd, message) => ipcRenderer.invoke("git:commitStaged", cwd, message),
		generateCommitMessage: (cwd) => ipcRenderer.invoke("git:generateCommitMessage", cwd),
		createBranch: (cwd, name, from) => ipcRenderer.invoke("git:createBranch", cwd, name, from),
		deleteBranch: (cwd, name, force) => ipcRenderer.invoke("git:deleteBranch", cwd, name, force),
		push: (cwd) => ipcRenderer.invoke("git:push", cwd),
		pull: (cwd) => ipcRenderer.invoke("git:pull", cwd),
		releaseInfo: (cwd) => ipcRenderer.invoke("git:releaseInfo", cwd),
		bumpVersion: (cwd, newVersion) => ipcRenderer.invoke("git:bumpVersion", cwd, newVersion),
		triggerDryRun: (cwd) => ipcRenderer.invoke("git:triggerDryRun", cwd),
		listWorkflowRuns: (cwd, limit) => ipcRenderer.invoke("git:listWorkflowRuns", cwd, limit),
		workflowRunStatus: (cwd, runId) => ipcRenderer.invoke("git:workflowRunStatus", cwd, runId),
		publishReleaseTag: (cwd, version) => ipcRenderer.invoke("git:publishReleaseTag", cwd, version),
	},
	memory: {
		load: () => ipcRenderer.invoke("memory:load"),
		add: (content) => ipcRenderer.invoke("memory:add", content),
		remove: (id) => ipcRenderer.invoke("memory:remove", id),
		clear: () => ipcRenderer.invoke("memory:clear"),
	},
	diff: {
		workspaceDiff: (cwd) => ipcRenderer.invoke("diff:workspace", cwd),
		blob: (cwd, path, side) => ipcRenderer.invoke("diff:blob", cwd, path, side),
	},
};

contextBridge.exposeInMainWorld("lyra", api);
