/**
 * Three limits on delegation, none of which is optional.
 *
 * Sub-agents are the one feature where a bad prompt costs real money rather than a wasted turn:
 * an agent that dispatches twelve at once, or one that dispatches something which dispatches it
 * back, spends without any of the usual signals that something has gone wrong. All three failures
 * look like the system working hard.
 *
 * The limits are enforced in different places on purpose:
 *
 *   Concurrency is a queue rather than a refusal. Wanting to look at eight things is a reasonable
 *   thought; running eight at once is what is unreasonable, and the correct answer to "do these
 *   eight" is to do them, four at a time.
 *
 *   Depth removes the `task` tool from the run instead of refusing calls to it. A model cannot
 *   want a tool it was never shown, and an error after the fact costs a turn to discover something
 *   that was never going to work.
 *
 *   Self-recursion is a refusal, because it is always a mistake. `explore → reviewer → explore` is
 *   a prompt written wrong, and it burns money fast enough that failing loudly is the kindness.
 */

/** How many sub-agents may run at once. Beyond this they queue. */
export const DEFAULT_MAX_CONCURRENT = 4;
/** How deep dispatch may nest. The main conversation is 0. */
export const DEFAULT_MAX_DEPTH = 2;

export const DISPATCH_KEY = "dispatchChain";

/** Where this run sits in the tree, carried down through each dispatch. */
export interface DispatchContext {
	/** 0 for the main conversation. */
	depth: number;
	/** Agent names from the root down to and including this run. */
	chain: string[];
}

export function rootDispatch(): DispatchContext {
	return { depth: 0, chain: [] };
}

export function childDispatch(parent: DispatchContext, agent: string): DispatchContext {
	return { depth: parent.depth + 1, chain: [...parent.chain, agent] };
}

/**
 * Why a dispatch cannot proceed, or undefined when it can.
 *
 * Returns the sentence the model will read. It names the limit and what to do instead, because
 * "refused" without either is a message a model can only respond to by trying again.
 */
export function refuseDispatch(
	context: DispatchContext,
	agent: string,
	limits: { maxDepth?: number } = {},
): string | undefined {
	const maxDepth = limits.maxDepth ?? DEFAULT_MAX_DEPTH;

	if (context.depth >= maxDepth) {
		return `派生已经到了第 ${context.depth} 层，上限是 ${maxDepth}。这一层的活自己做完，不要再往下派。`;
	}

	if (context.chain.includes(agent)) {
		return (
			`\`${agent}\` 已经在这条派生链上（${[...context.chain, agent].join(" → ")}），不能再派它一次。` +
			`这种环通常是提示词写歪了——把要做的事直接说清楚，或者换一个 agent。`
		);
	}

	return undefined;
}

/**
 * A semaphore that queues rather than rejects.
 *
 * Held per session: two windows working on two projects should not slow each other down, and a
 * process-wide limit would do exactly that while looking like the app being slow.
 */
export class DispatchGate {
	private readonly limit: number;
	private active = 0;
	private readonly waiting: (() => void)[] = [];

	constructor(limit: number = DEFAULT_MAX_CONCURRENT) {
		this.limit = Math.max(1, limit);
	}

	get running(): number {
		return this.active;
	}

	get queued(): number {
		return this.waiting.length;
	}

	/** Run `body` when a slot is free. The slot is always released, including on a throw. */
	async run<T>(body: () => Promise<T>): Promise<T> {
		if (this.active >= this.limit) {
			await new Promise<void>((resolve) => this.waiting.push(resolve));
		}
		this.active += 1;
		try {
			return await body();
		} finally {
			this.active -= 1;
			const next = this.waiting.shift();
			next?.();
		}
	}
}

/**
 * The sentence in the prompt that tells the model the limit.
 *
 * Without it a model dispatches twelve and then wonders why the answers are so slow to arrive —
 * it has no way to know that eight of them are sitting in a queue, and the natural reading of
 * "this is slow" is to try harder.
 */
export function concurrencyNote(limit: number, maxDepth: number): string {
	return (
		`最多 ${limit} 个子代理同时跑，超出的会排队——一次派超过 ${limit} 个只会让结果更晚到，不会更快。` +
		`派生最多嵌套 ${maxDepth} 层。`
	);
}
