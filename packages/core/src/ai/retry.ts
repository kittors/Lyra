/** Shared request/stream budget prevents nested retry loops from multiplying the configured limit. */
import { normalizeRetryPolicy, policyDelay, type RetryPolicy, type RetryPolicySource, type RetryFailure } from "../config/retry-policy.ts";
import { classifyFailure, failureOf, FailureError, worthRetrying, type Failure } from "./failure.ts";

/** Explicit low-level attempt overrides (e.g. commit titles) retain their bounded lifetime. */
function resolvePolicy(policy: RetryPolicy | undefined, legacyAttempts: number | undefined): RetryPolicy {
	const normalized = normalizeRetryPolicy(policy, legacyAttempts);
	if (policy || legacyAttempts === undefined) return normalized;
	const retries = Number.isFinite(legacyAttempts) ? Math.max(0, Math.round(legacyAttempts) - 1) : 10;
	const upstream = { ...normalized.upstream, retries };
	return { upstream, network: { ...upstream } };
}

export class RetryBudget {
	private used = { network: 0, upstream: 0 };
	private readonly read: () => RetryPolicy | undefined;
	private readonly legacyAttempts?: number;
	private cache?: { from: RetryPolicy | undefined; resolved: RetryPolicy };
	constructor(policy?: RetryPolicySource, legacyAttempts?: number) {
		this.read = typeof policy === "function" ? policy : () => policy;
		this.legacyAttempts = legacyAttempts;
	}
	/**
	 * The rules in force right now, not the ones this request started under.
	 *
	 * Normalising is not free and this is read on every attempt, so the result is kept until the
	 * settings object itself is replaced — which is what saving the settings page does.
	 */
	get policy(): RetryPolicy {
		const from = this.read();
		if (!this.cache || this.cache.from !== from) this.cache = { from, resolved: resolvePolicy(from, this.legacyAttempts) };
		return this.cache.resolved;
	}
	/**
	 * 还能不能再试一次。
	 *
	 * 失败可以选择传进来，因为有那么几种失败自己带着上限（见 `Failure.retryLimit`），而它比用户
	 * 的策略更有发言权的情形只有一种：重发不可能改变结果。两个数取更严的那个——用户设了 2 次就
	 * 是 2 次，这里不会把它放宽成 4。
	 *
	 * 不传也是对的：调用方手里没有分类结论时（还没发出去的那一次），问的就是纯粹的策略。
	 */
	available(kind: RetryFailure, failure?: Failure): boolean {
		const { retries } = this.policy[kind];
		const limit = retries === null ? failure?.retryLimit : Math.min(retries, failure?.retryLimit ?? retries);
		return limit === undefined || this.used[kind] < limit;
	}
	next(kind: RetryFailure): { attempt: number; delayMs: number } { this.used[kind]++; return { attempt: this.used.network + this.used.upstream, delayMs: policyDelay(this.policy[kind], this.used[kind]) }; }
}

export interface RetryOptions {
	budget?: RetryBudget;
	/** Total attempts, including the first. */
	attempts?: number;
	signal?: AbortSignal;
	/** Called before each wait, so a caller can tell the user what is happening. */
	onRetry?: (info: { attempt: number; delayMs: number; reason: string; failure?: Failure }) => void;
	/** Injected in tests so they do not sleep. */
	sleep?: (ms: number) => Promise<void>;
}

/**
 * 值得再试一次吗——问的是 `failure.ts`，不是这里。
 *
 * 这两个函数从前各自守着一份白名单，是四份互不知情的判断里的两份。留下这层薄壳是因为调用点还在
 * 用它们的名字，而壳里已经换成了同一个分类器：认不出来的东西现在会被重试，而不是被拒之门外。
 */
export function isRetryableError(error: unknown): boolean {
	return worthRetrying(failureOf(error));
}

export function isRetryableStatus(status: number, body?: string): boolean {
	return worthRetrying(classifyFailure({ from: "status", status, body }));
}

/**
 * The longest wait worth sitting through inside one turn.
 *
 * A relay asking for ten minutes is not something to do silently. A minute is: it is shorter than
 * the turn that is already in flight, and the alternative — giving up — throws away everything the
 * turn has assembled so far.
 */
const MAX_WAIT_MS = 60_000;

/**
 * How long the server itself said to wait, in milliseconds, or null if it did not say.
 *
 * Two places to look, because servers disagree about where to put it. `Retry-After` is the
 * standard one and comes as either seconds or an HTTP date. The body is the other, and ignoring it
 * is what made this useless against the relay in front of us: it answers a 503 with
 * `{"error":{"code":"model_unavailable","reset_seconds":54,"reset_time":"53s"}}` and no header at
 * all, so every wait fell back to the curve below and the whole retry budget was spent in a couple
 * of seconds against an outage it had been told would last just under a minute.
 *
 * Only well-known keys, and only numbers that look like a wait. Scanning for any number in the
 * body would eventually find a model name with digits in it and sleep for that long.
 */
export function serverDelay(header: string | null, body?: string): number | null {
	if (header) {
		const seconds = Number(header);
		const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
		if (Number.isFinite(ms) && ms > 0) return ms;
	}
	if (!body) return null;
	/*
	 * Regex rather than `JSON.parse`, deliberately.
	 *
	 * The field is nested — and nested differently per provider — so parsing would mean knowing
	 * every shape in advance. What is stable is the key next to a number, and an error body is
	 * small enough that scanning it costs nothing.
	 */
	const seconds = body.match(/"(?:reset_seconds|retry_after|retry_after_seconds|retryAfter)"\s*:\s*(\d+(?:\.\d+)?)/);
	if (seconds) {
		const ms = Number(seconds[1]) * 1000;
		if (ms > 0) return ms;
	}
	// `"reset_time":"53s"` — the same fact as a string, which some of them send instead.
	const written = body.match(/"(?:reset_time|retry_after)"\s*:\s*"(\d+(?:\.\d+)?)s"/);
	if (written) {
		const ms = Number(written[1]) * 1000;
		if (ms > 0) return ms;
	}
	return null;
}

/**
 * How long to wait, honouring the server's own answer when it gives one.
 *
 * A server under load knows better than any curve we could pick, so its number wins outright —
 * only capped, never shortened. Ours is the fallback, and it starts where a person would expect a
 * retry to start rather than where a tight loop would: the first version began at 600ms and
 * tripled, which spent three attempts inside two and a half seconds and read as the app hammering
 * a server that had just said it was busy.
 */
export function retryDelay(attempt: number, response?: Response, body?: string): number {
	const said = serverDelay(response?.headers.get("retry-after") ?? null, body);
	if (said !== null) return Math.min(said, MAX_WAIT_MS);
	// 2s, 5s, 12.5s, 31s, 60s — with jitter, so a fleet of clients does not return in lockstep.
	// The ceiling is applied *after* the jitter: capping first lets the ±25% push the result
	// back over the limit, which is what the test caught.
	const base = 2000 * 2.5 ** (attempt - 1);
	return Math.min(base * (0.75 + Math.random() * 0.5), MAX_WAIT_MS);
}

/**
 * Wait for the given delay, unless the signal aborts first.
 *
 * Plain `setTimeout` cannot be cancelled, so sleeping for 60 seconds against an un-abortable timer
 * would keep the turn alive for the whole minute even if the user pressed stop.
 */
function abortableSleep(ms: number, signal?: AbortSignal, customSleep?: (ms: number) => Promise<void>): Promise<void> {
	if (signal?.aborted) return Promise.resolve();
	if (customSleep) return customSleep(ms);
	if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
	return new Promise((resolve) => {
		const done = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", done);
			resolve();
		};
		const timer = setTimeout(done, ms);
		signal.addEventListener("abort", done, { once: true });
	});
}

/**
 * Perform a request, retrying everything except what is certain not to change.
 *
 * 成功的响应原样返回。其余一律抛 `FailureError`——包括 4xx：从前它们是被「原样返回，由调用方
 * 自己去报」的，而三个调用方拿到之后做的第一件事都是 `if (!response.ok) throw`，于是那个结论在
 * 路上被重新猜了一遍，猜出来的东西还不如原来准（一个 `HTTP 401: ...` 字符串在流那一层看起来像
 * 「没见过的连接问题」）。判断带着结论一起走。
 */
export async function fetchWithRetry(
	doFetch: typeof globalThis.fetch,
	url: string,
	init: RequestInit,
	options: RetryOptions = {},
): Promise<Response> {
	const attempts = options.budget ? Infinity : Math.max(1, options.attempts ?? 3);
	let lastError: unknown;

	for (let attempt = 1; attempt <= attempts; attempt++) {
		if (options.signal?.aborted) break;
		try {
			const response = await doFetch(url, init);
			if (response.ok) return response;

			/*
			 * The body is read, off a clone, purely to find out what happened and how long to wait.
			 *
			 * 从前这一行写的是 `options.budget ? undefined : await response.clone().text()`——也就是
			 * 说下面这段讲「不读正文会把重试预算在几秒内烧光」的道理，只在没配重试策略的时候才作数，
			 * 而配了策略的人反而拿不到服务器自己说的等待时间。The relay puts `reset_seconds` in there
			 * and no `Retry-After` header. 用克隆读，调用方可能还要用的那个响应一个字节不动。
			 */
			const body = await response.clone().text().catch(() => undefined);
			const failure = classifyFailure({ from: "status", status: response.status, body });
			const canRetry = options.budget ? options.budget.available("upstream", failure) : attempt < attempts;

			if (!worthRetrying(failure) || !canRetry) {
				// 判断带着结论一起往上走，免得流那一层拿到一个字符串又重新猜一遍——猜错的那次会把
				// 一个 401 当成没见过的连接问题，然后无限重试下去。
				await response.body?.cancel().catch(() => undefined);
				throw new FailureError(failure);
			}

			/*
			 * 服务器说的等待时间只在没有配策略时作数。
			 *
			 * 一度写成「服务器比我们准，取两者的大值」——那是把设置页上的话当成了建议。那一页写着
			 * 「每次等待相同时间，不受服务端建议或随机抖动影响」，配了固定间隔的人是在明确要求这
			 * 件事。`retryDelay` 是没人配置时的兜底曲线，它才该听服务器的；`policyDelay` 是用户说
			 * 的数，不该被谁覆盖。正文照读不误——分类要用它。
			 */
			const retry = options.budget?.next("upstream") ?? { attempt, delayMs: retryDelay(attempt, response, body) };
			const delay = retry.delayMs;
			// Release each failed response before an unlimited wait can accumulate connections.
			await response.body?.cancel().catch(() => undefined);
			options.onRetry?.({ ...retry, delayMs: delay, reason: failure.summary, failure });
			await abortableSleep(delay, options.signal, options.sleep);
			continue;
		} catch (error) {
			lastError = error;
			/*
			 * 上面那几行自己抛的，直接放走——它已经判过了，判的结果就是不再重试。
			 *
			 * 少了这一句是个死循环，而且是默认配置下就会撞上的那种：状态码那一路把 `FailureError`
			 * 抛在 `try` 里，于是被这个 `catch` 接住，而下面那行查的是 **network** 预算——它默认
			 * 是无限的。一个 upstream 预算已经用尽的 503 就这样被 network 的无限额度接着重试，永远
			 * 转下去。`retry-policy.test.ts` 整个文件挂住，一条都跑不出来。
			 */
			if (error instanceof FailureError) throw error;
			const failure = failureOf(error);
			// A cancelled turn is not a failed one; stop immediately rather than waiting to retry.
			if (options.signal?.aborted || !worthRetrying(failure) || (options.budget ? !options.budget.available("network", failure) : attempt === attempts)) throw error;
			const retry = options.budget?.next("network") ?? { attempt, delayMs: retryDelay(attempt) };
			const delay = retry.delayMs;
			options.onRetry?.({ ...retry, reason: failure.summary, failure });
			await abortableSleep(delay, options.signal, options.sleep);
		}
	}

	/*
	 * How many attempts it took to give up, attached to the error.
	 *
	 * Without it a failure after five tries and a failure on the first look identical in the
	 * transcript, and they call for opposite things: one is a wobble worth continuing through, the
	 * other is something that is not going to work no matter how long you wait.
	 *
	 * 只在次数确切的时候说。配了预算时 `attempts` 是 `Infinity`，而在重试等待中按下停止正好会走到
	 * 这里——从前拼出来的是一句「已重试 Infinity 次」。
	 */
	if (lastError instanceof Error && Number.isFinite(attempts) && attempts > 1) {
		lastError.message = `${lastError.message}（已重试 ${attempts} 次）`;
	}
	throw lastError ?? new Error("请求已取消");
}

/**
 * A tool call's id, invented if the provider did not supply one.
 *
 * The id is the only thing tying a call to its result and to the card on screen. A provider
 * that omits it — some relays drop `call_id` on a truncated stream — used to yield the empty
 * string for every such call, so they all collided on one entry: the newest call reset the
 * shared record to "running" and every earlier card in the transcript started spinning again,
 * all showing the same elapsed time because they were all reading the same object.
 *
 * The fallback is remembered per output index, because one call arrives across several events
 * and they have to agree on what it is called.
 */
export function toolCallId(given: unknown, outputIndex: number, invented: Map<number, string>): string {
	const supplied = String(given ?? "").trim();
	if (supplied) return supplied;
	let generated = invented.get(outputIndex);
	if (!generated) {
		generated = `ly-call-${outputIndex}-${Math.random().toString(36).slice(2, 10)}`;
		invented.set(outputIndex, generated);
	}
	return generated;
}

/**
 * Run a streamed request, and start it over if the stream itself dies.
 *
 * `fetchWithRetry` covers getting the connection; this covers keeping it. They are different
 * failures with the same cause and very different odds: a request that takes forty seconds to
 * stream a large reply is exposed to a dropped socket for the whole of it, and a long piece of
 * work is exactly where the replies are longest. Losing one there ends the turn — and with it a
 * plan the agent was eight steps into.
 *
 * Starting over is safe because nothing has happened yet. Tools are executed by the caller after
 * a complete reply arrives, so a half-streamed one has changed nothing; the only cost is the
 * tokens spent saying it again.
 *
 * `reset` is called before every attempt to clear whatever the last one accumulated. Anything
 * already emitted to the UI is replaced by what the retry emits, because each update carries the
 * whole message rather than a delta to apply.
 */
export async function* retryStream<T>(
	attempt: (attemptNumber: number) => AsyncGenerator<T, void>,
	options: {
		budget?: RetryBudget;
		attempts?: number;
		signal?: AbortSignal;
		reset: () => void;
		onRetry?: (info: { attempt: number; delayMs: number; reason: string; failure?: Failure }) => void;
		sleep?: (ms: number) => Promise<void>;
	},
): AsyncGenerator<T, void> {
	const attempts = options.budget ? Infinity : Math.max(1, options.attempts ?? 3);

	for (let number = 1; number <= attempts; number++) {
		if (options.signal?.aborted) throw options.signal.reason ?? new Error("请求已取消");
		options.reset();
		try {
			yield* attempt(number);
			return;
		} catch (error) {
			const failure = failureOf(error);
			/*
			 * 哪一条规则，由失败自己说了算。
			 *
			 * 从前这里一律记在 `network` 头上——流断了嘛。可流里跑的不止是断线：一个 503、一个流内
			 * error 事件、一次空回答，全都从这里经过，而它们该走的是「上游故障」那条规则。记错了账，
			 * 界面上两行设置就有一行永远不生效。
			 */
			const rule = failure.kind === "upstream" ? "upstream" : "network";
			const last = options.budget ? !options.budget.available(rule, failure) : number === attempts;
			if (last || options.signal?.aborted || !worthRetrying(failure)) throw error;
			// 同上：配了策略就按策略的数走，服务器的建议只喂给兜底曲线。
			const retry = options.budget?.next(rule) ?? { attempt: number, delayMs: retryDelay(number) };
			const delayMs = retry.delayMs;
			options.onRetry?.({ ...retry, delayMs, reason: failure.summary, failure });
			await abortableSleep(delayMs, options.signal, options.sleep);
		}
	}
}
