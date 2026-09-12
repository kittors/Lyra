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
const DEFAULT_MAX_CONCURRENT = 4;
/** How deep dispatch may nest. The main conversation is 0. */
export const DEFAULT_MAX_DEPTH = 2;

export const DISPATCH_KEY = "dispatchChain";

/** Where this run sits in the tree, carried down through each dispatch. */
export interface DispatchContext {
	/** 0 for the main conversation. */
	depth: number;
	/** Agent names from the root down to and including this run. */
	chain: string[];
	/**
	 * The registry id of the run this context belongs to; the main conversation has none.
	 *
	 * `chain` says what kind of agent dispatched this one; this says which. Two `explore` runs
	 * fanned out by the same orchestrator have the same chain, and the lineage the pane draws
	 * needs to tell them apart.
	 */
	id?: string;
}

export function rootDispatch(): DispatchContext {
	return { depth: 0, chain: [] };
}

export function childDispatch(parent: DispatchContext, agent: string, id?: string): DispatchContext {
	return { depth: parent.depth + 1, chain: [...parent.chain, agent], ...(id ? { id } : {}) };
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
	private limit: number;
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

	get width(): number {
		return this.limit;
	}

	/**
	 * 改宽度，因为这个数字会在会话中途变。
	 *
	 * 闸门是会话级的（见 `turn-config.ts` 里的 `dispatchGate`），而决定它多宽的东西是每一轮的
	 * 推理等级——用户在对话进行到一半时把等级从高调到中，如果闸门还是开会话那一刻的宽度，那次
	 * 调整就只改了提示词里的一句话，没改它管的那件事。
	 *
	 * 收窄不打断已经在跑的：一个跑到一半的子代理被腰斩，换来的只是一份半截的工作和一次白花的
	 * 调用。新的宽度从下一个想进来的开始生效，这也是排队本来的语义。放宽要主动放人进来，否则
	 * 队列里的那些要一直等到有人跑完才动——而刚刚发生的事情是「位置变多了」，不是「有人走了」。
	 */
	setLimit(limit: number): void {
		const next = Math.max(1, Math.floor(limit));
		if (next === this.limit) return;
		this.limit = next;
		// 放宽要主动放人：刚刚发生的事情是「位置变多了」，而队列只认「有人走了」。
		this.admit();
	}

	/** Run `body` when a slot is free. The slot is always released, including on a throw. */
	async run<T>(body: () => Promise<T>): Promise<T> {
		if (this.active < this.limit) {
			this.active += 1;
		} else {
			/*
			 * 名额由放行的一方记账，见 `admit`。
			 *
			 * 这里曾经是等到之后自己 `active += 1`，也就是在 `await` 之后、一个微任务之后。只有
			 * 一个放行点的时候那样没问题；`setLimit` 一次放三个人，就不行了——三个人的记账都排在
			 * 循环之后，循环里读到的 `active` 三次都是同一个老数字。
			 */
			await new Promise<void>((resolve) => this.waiting.push(resolve));
		}
		try {
			return await body();
		} finally {
			this.active -= 1;
			this.admit();
		}
	}

	/**
	 * 派生里的派生：先把自己的位置让出来，再让孩子按正常规则进。
	 *
	 * 整棵派生树共用一道闸门（这是对的——不然「最多四个」会变成每层四个）。但一个正在派孩子的
	 * 子代理，这一刻并没有在跑模型，它在等。占着位置等，而等的正是同一道闸门里的位置，那就是
	 * 一个死锁：闸门开到 1 的时候，第二层永远进不来，整棵树停在那里，界面上是一个「派发子任务」
	 * 转到超时。
	 *
	 * 这个坑一直都在——四个子代理各派一个孙代理，`limit` 是 4，同样谁也进不去。以前很少撞上，
	 * 是因为默认宽度是 4 而模型很少真的铺开两层。推理等级把宽度收到 1 之后，它从「很少」变成了
	 * 「必然」。
	 *
	 * 让出的位置不主动放给队列，是留给孩子的：它下一行就要进来，而这个位置本来就是它父亲的。
	 * 取回的时候不排队，无条件加回去——排队等的可能正是自己刚让出去的那个位置，而那个位置上的人
	 * 在等自己。宁可有那么一瞬多出一个，也不要一个永远解不开的环。
	 */
	async nested<T>(body: () => Promise<T>): Promise<T> {
		// 走到这里的一定是个已经拿到名额的子代理；0 只可能是没有会话的宿主临时开的一道新闸门。
		const held = this.active > 0;
		if (held) this.active -= 1;
		try {
			return await this.run(body);
		} finally {
			if (held) this.active += 1;
		}
	}

	/** 在宽度允许的范围内依次放行，名额在这里记账。 */
	private admit(): void {
		while (this.active < this.limit) {
			const next = this.waiting.shift();
			if (!next) return;
			this.active += 1;
			next();
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
