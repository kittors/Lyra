/**
 * Running an extension where it can crash alone.
 *
 * Everything here exists because the code being run was written by somebody else. The three
 * failures that matter are not bugs in the extension's logic — they are what an ordinary bug does
 * to the session hosting it:
 *
 *   It throws. The worker dies; the session does not notice beyond one diagnostic.
 *   It hangs. The host stops waiting after `HANDLER_TIMEOUT_MS` and carries on without it.
 *   It fails every time. After `FAILURE_LIMIT` it is switched off for the session, because the
 *   alternative is paying a timeout per tool call for the rest of the conversation — slow in a way
 *   nobody would ever attribute to an extension.
 *
 * None of the three requires the extension's author to have done anything right.
 */

import { Worker } from "node:worker_threads";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	FAILURE_LIMIT,
	HANDLER_TIMEOUT_MS,
	validateManifest,
	type ExtensionDiagnostic,
	type ExtensionEvent,
	type ExtensionManifest,
	type ExtensionReply,
} from "./types.ts";

interface Pending {
	resolve: (reply: ExtensionReply) => void;
	timer: ReturnType<typeof setTimeout>;
}

export interface LoadedExtension {
	manifest: ExtensionManifest;
	dir: string;
}

/**
 * The bridge script the worker actually runs.
 *
 * Generated rather than shipped as a file so that `core` has nothing to resolve at runtime — it is
 * bundled into an asar and a CLI binary, and a sibling `.mjs` it expects to find on disk is the
 * kind of thing that works in development and not in either of those.
 */
function bridgeSource(entry: string): string {
	return `
import { parentPort } from "node:worker_threads";
const mod = await import(${JSON.stringify(entry)});
const handlers = mod.default ?? mod;

parentPort.on("message", async (message) => {
	const handler = handlers[message.event] ?? handlers.onEvent;
	if (typeof handler !== "function") {
		parentPort.postMessage({ id: message.id });
		return;
	}
	try {
		const answer = await handler(message.payload);
		parentPort.postMessage({ id: message.id, ...(answer && typeof answer === "object" ? answer : {}) });
	} catch (error) {
		parentPort.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) });
	}
});
`;
}

export class ExtensionHost {
	private readonly workers = new Map<string, Worker>();
	private readonly pending = new Map<number, Pending>();
	private readonly failures = new Map<string, number>();
	private readonly disabled = new Set<string>();
	private readonly loaded = new Map<string, LoadedExtension>();
	private seq = 0;

	readonly diagnostics: ExtensionDiagnostic[] = [];

	/** Load one extension directory. Returns false when it could not be started. */
	async load(dir: string): Promise<boolean> {
		const raw = await readFile(join(dir, "extension.json"), "utf8").catch(() => null);
		if (raw === null) return false;

		let parsed: unknown;
		try {
			parsed = JSON.parse(raw);
		} catch (error) {
			this.diagnostics.push({ extension: dir, message: `清单不是合法的 JSON：${error instanceof Error ? error.message : String(error)}`, severity: "error" });
			return false;
		}

		const checked = validateManifest(parsed);
		if ("error" in checked) {
			this.diagnostics.push({ extension: dir, message: checked.error, severity: "error" });
			return false;
		}
		const { manifest } = checked;

		try {
			const worker = new Worker(bridgeSource(join(dir, manifest.main)), {
				eval: true,
				/*
				 * A ceiling rather than a hope. `worker_threads` isolates a thrown error but not an
				 * exhausted heap — without this, an extension that leaks takes the process with it,
				 * and the crash looks like ours.
				 */
				resourceLimits: { maxOldGenerationSizeMb: manifest.memoryLimitMb ?? 128 },
				stdout: true,
				stderr: true,
			});

			worker.on("message", (reply: ExtensionReply) => this.settle(reply));
			worker.on("error", (error) => {
				this.diagnostics.push({ extension: manifest.name, message: `扩展出错：${error.message}`, severity: "error" });
				this.fail(manifest.name);
			});
			worker.on("exit", () => {
				/*
				 * Every waiter is released when the worker goes, whatever took it. A pending promise
				 * for a thread that no longer exists is a turn that never ends.
				 */
				for (const [id, waiter] of this.pending) {
					clearTimeout(waiter.timer);
					waiter.resolve({ id, error: "扩展已经退出" });
				}
				this.pending.clear();
				this.workers.delete(manifest.name);
			});

			this.workers.set(manifest.name, worker);
			this.loaded.set(manifest.name, { manifest, dir });
			return true;
		} catch (error) {
			this.diagnostics.push({ extension: manifest.name, message: `启动失败：${error instanceof Error ? error.message : String(error)}`, severity: "error" });
			return false;
		}
	}

	private settle(reply: ExtensionReply): void {
		const waiter = this.pending.get(reply.id);
		if (!waiter) return;
		this.pending.delete(reply.id);
		clearTimeout(waiter.timer);
		waiter.resolve(reply);
	}

	private fail(name: string): void {
		const count = (this.failures.get(name) ?? 0) + 1;
		this.failures.set(name, count);
		if (count < FAILURE_LIMIT) return;
		this.disabled.add(name);
		this.diagnostics.push({
			extension: name,
			message: `连续 ${FAILURE_LIMIT} 次出错或超时，这个会话里不再调用它。`,
			severity: "warning",
		});
		void this.workers.get(name)?.terminate();
	}

	/** Extensions that are loaded, subscribed to this event, and not switched off. */
	private listeners(event: ExtensionEvent): LoadedExtension[] {
		return [...this.loaded.values()].filter(
			(entry) => !this.disabled.has(entry.manifest.name) && (entry.manifest.events ?? []).includes(event) && this.workers.has(entry.manifest.name),
		);
	}

	/**
	 * Deliver an event and collect whatever comes back in time.
	 *
	 * Extensions are asked in parallel and each is bounded on its own. One that hangs delays this
	 * call by the timeout and nothing more; it does not delay the others, and it does not get to
	 * decide when the turn continues.
	 */
	async dispatch(event: ExtensionEvent, payload: unknown): Promise<ExtensionReply[]> {
		const targets = this.listeners(event);
		if (targets.length === 0) return [];

		return Promise.all(
			targets.map(async (entry) => {
				const worker = this.workers.get(entry.manifest.name);
				if (!worker) return { id: -1 } satisfies ExtensionReply;

				const id = ++this.seq;
				const reply = await new Promise<ExtensionReply>((resolve) => {
					const timer = setTimeout(() => {
						this.pending.delete(id);
						this.diagnostics.push({ extension: entry.manifest.name, message: `${HANDLER_TIMEOUT_MS}ms 内没有响应 ${event}。`, severity: "warning" });
						this.fail(entry.manifest.name);
						resolve({ id, error: "timeout" });
					}, HANDLER_TIMEOUT_MS);
					this.pending.set(id, { resolve, timer });
					/*
					 * `worker_threads`'s postMessage, not `window.postMessage`: there is no origin to
					 * pass and no other document to reach. The lint rule matches on the method name.
					 */
					// oxlint-disable-next-line unicorn/require-post-message-target-origin
					worker.postMessage({ id, event, payload });
				});

				if (reply.error) this.fail(entry.manifest.name);
				/*
				 * An extension that did not declare `intercepts` may still answer — its answer just
				 * does not change anything. Dropping the fields here rather than trusting the
				 * manifest at the call site means one place decides, and it is the place that knows
				 * what was declared.
				 */
				if (!entry.manifest.intercepts) return { id: reply.id, error: reply.error } satisfies ExtensionReply;
				return reply;
			}),
		);
	}

	/**
	 * The first extension that wants to stop this, or nothing.
	 *
	 * First rather than a vote: they are independent opinions, and a second one agreeing does not
	 * make the first more right. The reason travels back so the model is told which extension
	 * objected and why, rather than that something unnamed said no.
	 */
	async intercept(event: ExtensionEvent, payload: unknown): Promise<{ block?: string; replace?: unknown }> {
		const replies = await this.dispatch(event, payload);
		const blocked = replies.find((reply) => reply.block?.reason);
		if (blocked?.block) return { block: blocked.block.reason };
		const replaced = replies.find((reply) => reply.replace !== undefined);
		return replaced ? { replace: replaced.replace } : {};
	}

	names(): string[] {
		return [...this.loaded.keys()];
	}

	isDisabled(name: string): boolean {
		return this.disabled.has(name);
	}

	async dispose(): Promise<void> {
		for (const [, waiter] of this.pending) clearTimeout(waiter.timer);
		this.pending.clear();
		await Promise.all([...this.workers.values()].map((worker) => worker.terminate().catch(() => {})));
		this.workers.clear();
		this.loaded.clear();
	}
}
