/**
 * Which backend answers, and what happens while it is still waking up.
 *
 * A language server is heavy: `tsserver` on a mid-sized TypeScript project is several hundred
 * megabytes and takes seconds before it can answer anything. Two consequences shape this file.
 *
 * It starts lazily. Most sessions never ask a symbol question, and warming up on session start
 * would mean every window costs that memory for a feature it does not use.
 *
 * And a call that arrives before it is ready gets the textual answer *now* rather than a wait. The
 * agent asked because it is about to change something; an answer that arrives after it has already
 * moved on is worth less than a caveated one that arrives immediately.
 */

import { extname } from "node:path";
import { TsServerBackend } from "./tsserver.ts";
import type { CodeIntelBackend } from "./types.ts";

/**
 * How long a first call may block on a server that is still starting.
 *
 * Short on purpose. This is not "how long until tsserver is ready" — it is how long a tool call may
 * hang before a degraded answer beats an accurate one.
 */
const READY_WAIT_MS = 3000;

/**
 * 空闲多久之后把语言服务器杀掉。
 *
 * 一台 tsserver 几百兆内存，而一个会话开着一整天里真正问它的时间加起来不到十分钟。
 * 十分钟是计划 18 定的数——比一次「想一想再问」长，比一顿饭短。下次问它会重新起，
 * 代价是那一次多等几秒。
 */
export const IDLE_MS = 10 * 60 * 1000;

export class CodeIntelManager {
	private readonly backends: CodeIntelBackend[];
	private readonly starting = new Map<string, Promise<void>>();
	private root: string | null = null;
	private readonly idleMs: number;
	private idleTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(backends: CodeIntelBackend[] = [new TsServerBackend()], options: { idleMs?: number } = {}) {
		this.backends = backends;
		this.idleMs = options.idleMs ?? IDLE_MS;
	}

	/**
	 * 有人问了：重新计时。
	 *
	 * `unref`，跟子进程本身一样：一个还没到期的计时器不该成为进程活着的理由——CLI 跑完一件事
	 * 之后不该因为十分钟后要杀一个服务器而挂着不退。
	 */
	private touch(): void {
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.idleTimer = setTimeout(() => void this.recycle(), this.idleMs);
		this.idleTimer.unref();
	}

	/**
	 * 到期了：杀掉在跑的，忘掉在起的。
	 *
	 * 管理器自己留着——下次 `acquire` 会重新起。跟 `dispose` 的区别就在这儿：那个是会话结束，
	 * 这个只是没人问了一阵。
	 */
	private async recycle(): Promise<void> {
		this.idleTimer = null;
		await Promise.all(this.backends.filter((b) => b.ready()).map((b) => b.dispose().catch(() => {})));
		this.starting.clear();
	}

	backendFor(file: string): CodeIntelBackend | null {
		const ext = extname(file).toLowerCase();
		return this.backends.find((backend) => backend.extensions.includes(ext)) ?? null;
	}

	/**
	 * Get a backend that can answer about `file`, or null to use the fallback.
	 *
	 * Null covers three different situations on purpose — no backend for this language, the binary
	 * is not installed, and it is still starting — because the caller does the same thing in all
	 * three, and distinguishing them would only move the branching one level up.
	 */
	async acquire(file: string, root: string): Promise<CodeIntelBackend | null> {
		const backend = this.backendFor(file);
		if (!backend) return null;
		if (!(await backend.available())) return null;

		if (backend.ready()) {
			this.touch();
			return backend;
		}

		const key = `${backend.name}:${root}`;
		let pending = this.starting.get(key);
		if (!pending) {
			this.root = root;
			pending = backend.start(root).catch(() => {});
			this.starting.set(key, pending);
		}

		/*
		 * Race the startup against the deadline rather than awaiting it.
		 *
		 * Losing the race is not a failure — the startup keeps going, and the next call finds it
		 * ready. What must not happen is the first call blocking for the fifteen seconds a cold
		 * `tsserver` can take on a large project.
		 */
		const won = await Promise.race([pending.then(() => true), delay(READY_WAIT_MS).then(() => false)]);
		// 起来了就开始计时——起不来的不计，它没占着什么。
		if (backend.ready()) this.touch();
		return won && backend.ready() ? backend : null;
	}

	async dispose(): Promise<void> {
		if (this.idleTimer) clearTimeout(this.idleTimer);
		this.idleTimer = null;
		await Promise.all(this.backends.map((backend) => backend.dispose().catch(() => {})));
		this.starting.clear();
		this.root = null;
	}
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export const CODE_INTEL_KEY = "codeIntel";
