/**
 * What a third-party extension may do, and what it may not take down with it.
 *
 * The plugin registry is the reason this is not omp's design. omp runs extensions in-process with
 * no isolation, and its own documentation says what that costs: a raw `setInterval` callback that
 * throws tears down the whole session. Its answer is a managed `ctx.setInterval` that authors are
 * asked to use — a convention, not a boundary.
 *
 * With a registry, "install a third-party extension" and "hand a stranger the stability of your
 * session" cannot be the same act. So the code runs somewhere it can crash alone.
 *
 * **Where** it runs is a deliberate departure from the plan, which named Electron's
 * `utilityProcess`. `core` also runs the CLI and has four dependencies; taking one on Electron to
 * host extensions would make the headless path impossible. `worker_threads` is in Node itself,
 * isolates crashes (a thrown error kills the worker, not the process), and measured *faster* than
 * a forked process on this machine: p99 0.032ms against 0.074ms for a thousand empty round trips,
 * both far under the 5ms the plan set as the bar. The one thing it does not isolate is memory —
 * a worker that exhausts the heap takes the process with it — which is why `memoryLimitMb` exists.
 */

/** The events an extension can subscribe to. */
export type ExtensionEvent = "tool_call" | "tool_result" | "turn_start" | "turn_end" | "session_start";

/** What an extension declares about itself. Everything here is a promise the host enforces. */
export interface ExtensionManifest {
	name: string;
	version?: string;
	description?: string;
	/** Entry file, relative to the extension directory. */
	main: string;
	/** Which events it wants. Nothing else reaches it. */
	events?: ExtensionEvent[];
	/**
	 * Whether it may change or block what it sees.
	 *
	 * Declared rather than assumed, because the two are different risks: an observer that hangs
	 * costs a timeout, an interceptor that hangs blocks the tool call it was inspecting. Installing
	 * one is a different decision from installing the other, and the settings page can only present
	 * that decision if the manifest states it.
	 */
	intercepts?: boolean;
	/** Capabilities it needs, shown at install time. */
	permissions?: ExtensionPermission[];
	/** Hard ceiling for the worker. Beyond this Node kills it rather than the process running out. */
	memoryLimitMb?: number;
}

export type ExtensionPermission = "read-files" | "write-files" | "network" | "run-commands" | "read-settings";

export const ALL_PERMISSIONS: ExtensionPermission[] = ["read-files", "write-files", "network", "run-commands", "read-settings"];

export const PERMISSION_LABELS: Record<ExtensionPermission, string> = {
	"read-files": "读取工作区里的文件",
	"write-files": "修改工作区里的文件",
	network: "访问网络",
	"run-commands": "执行 shell 命令",
	"read-settings": "读取你的设置（不含凭证）",
};

/** A message from the host to an extension. */
export interface HostMessage {
	id: number;
	event: ExtensionEvent;
	payload: unknown;
}

/** An extension's answer. */
export interface ExtensionReply {
	id: number;
	/** Set to stop the action the event described. Only honoured for `intercepts` extensions. */
	block?: { reason: string };
	/** A replacement payload. Only honoured for `intercepts` extensions. */
	replace?: unknown;
	error?: string;
}

/**
 * How long one handler may take before the host stops waiting.
 *
 * Not a guess at how long extensions need: it is how long a tool call may be held up by one. An
 * extension doing real work should do it after answering, not before.
 */
export const HANDLER_TIMEOUT_MS = 2000;

/**
 * How many failures before an extension is switched off for the session.
 *
 * A broken extension that throws on every event would otherwise cost a timeout per tool call for
 * the life of the session — slow in a way nobody would attribute to an extension. Three is enough
 * to ride out something transient and few enough that a genuinely broken one stops mattering.
 */
export const FAILURE_LIMIT = 3;

export interface ExtensionDiagnostic {
	extension: string;
	message: string;
	severity: "error" | "warning";
}

/** Reject a manifest that would not work, with the reason. */
export function validateManifest(raw: unknown): { manifest: ExtensionManifest } | { error: string } {
	if (typeof raw !== "object" || raw === null) return { error: "清单不是一个对象。" };
	const record = raw as Record<string, unknown>;

	if (typeof record.name !== "string" || !record.name.trim()) return { error: "清单缺少 `name`。" };
	if (typeof record.main !== "string" || !record.main.trim()) return { error: "清单缺少 `main`（入口文件）。" };
	/*
	 * An entry path that climbs out of the extension directory is refused here rather than at load.
	 * By the time a path is being resolved the decision has already been made; the manifest is where
	 * "this extension is asking for something it should not" is still a readable statement.
	 */
	if (record.main.startsWith("/") || record.main.includes("..")) return { error: "`main` 必须是扩展目录内的相对路径。" };

	const events = record.events;
	if (events !== undefined) {
		if (!Array.isArray(events)) return { error: "`events` 必须是数组。" };
		const known: ExtensionEvent[] = ["tool_call", "tool_result", "turn_start", "turn_end", "session_start"];
		const bad = events.find((e) => typeof e !== "string" || !known.includes(e as ExtensionEvent));
		if (bad !== undefined) return { error: `不认识的事件 “${String(bad)}”。可用的是：${known.join("、")}` };
	}

	const permissions = record.permissions;
	if (permissions !== undefined) {
		if (!Array.isArray(permissions)) return { error: "`permissions` 必须是数组。" };
		const bad = permissions.find((p) => typeof p !== "string" || !ALL_PERMISSIONS.includes(p as ExtensionPermission));
		if (bad !== undefined) return { error: `不认识的权限 “${String(bad)}”。` };
	}

	return {
		manifest: {
			name: record.name.trim(),
			version: typeof record.version === "string" ? record.version : undefined,
			description: typeof record.description === "string" ? record.description : undefined,
			main: record.main,
			events: (events as ExtensionEvent[] | undefined) ?? [],
			intercepts: record.intercepts === true,
			permissions: (permissions as ExtensionPermission[] | undefined) ?? [],
			memoryLimitMb: typeof record.memoryLimitMb === "number" ? Math.min(512, Math.max(32, record.memoryLimitMb)) : 128,
		},
	};
}
