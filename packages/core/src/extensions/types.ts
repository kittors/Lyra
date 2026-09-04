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
 *
 * **隔离的是崩溃，不是能力。** 一个扩展跑在 worker 里，而 worker 里有完整的 Node：它能
 * `import("node:fs")` 读写任何文件、能联网、能起子进程。装一个第三方扩展 = 在这台机器上以
 * 你的身份运行别人的代码，跟装一个 npm 包是同一件事。
 *
 * 这里曾经有一个 `permissions` 字段，声明「这个扩展需要哪些能力」，解析得很仔细、校验得很
 * 完整——而**宿主从来不看它**。`worker_threads` 里没有能给出这种保证的原语：你无法给一个
 * worker「只读文件、不能联网」。一个不执行的权限声明比没有更糟，它让人以为装扩展是安全的，
 * 所以那个字段删掉了，换成这一段。
 */

/**
 * 扩展能订阅的事件。
 *
 * 五个，不是 omp 的三十个。三十是它的实现细节，不是需求——而这五个各自对应一个真实的用途：
 * 拦一次工具调用、看一次结果、在回合前后做点什么、会话起来时初始化。
 *
 * **每一个都必须有地方真的派发它**（`test/extension-events.test.ts` 拿这份名单去对代码）。
 * 这条约束是这个类型存在的一半意义：清单里认得、而永远不会到达的事件，比没有这个事件更糟
 * ——扩展装上了、加载成功了、然后什么也收不到，而屏幕上没有任何东西说得出为什么。
 */
export type ExtensionEvent = "tool_call" | "tool_result" | "turn_start" | "turn_end" | "session_start";

/** 全部事件，给校验和那条「每个都有人发」的测试用。 */
export const ALL_EXTENSION_EVENTS: ExtensionEvent[] = ["tool_call", "tool_result", "turn_start", "turn_end", "session_start"];

/**
 * What an extension declares about itself.
 *
 * 每一条都是宿主真的会执行的——这句话以前不成立（`permissions` 从来没被读过），所以现在
 * 只留下真的会执行的那几条。
 */
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
	/** Hard ceiling for the worker. Beyond this Node kills it rather than the process running out. */
	memoryLimitMb?: number;
}

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
		const known = ALL_EXTENSION_EVENTS;
		const bad = events.find((e) => typeof e !== "string" || !known.includes(e as ExtensionEvent));
		if (bad !== undefined) return { error: `不认识的事件 “${String(bad)}”。可用的是：${known.join("、")}` };
	}

	/*
	 * 清单里写了 `permissions` 也不报错，只是不作数。
	 *
	 * 这个字段以前存在，装过它的扩展的清单里还留着。为一个已经不看的字段报错，等于让那些扩展
	 * 装不上——而它们本来就没有因为写了它而受到过任何限制。见文件头。
	 */

	return {
		manifest: {
			name: record.name.trim(),
			version: typeof record.version === "string" ? record.version : undefined,
			description: typeof record.description === "string" ? record.description : undefined,
			main: record.main,
			events: (events as ExtensionEvent[] | undefined) ?? [],
			intercepts: record.intercepts === true,
			memoryLimitMb: typeof record.memoryLimitMb === "number" ? Math.min(512, Math.max(32, record.memoryLimitMb)) : 128,
		},
	};
}
