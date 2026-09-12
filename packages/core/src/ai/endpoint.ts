/**
 * 三条链都要做、而且必须做得一样的两件小事：拼地址、把 fetch 的失败说成人话。
 *
 * 它们原来住在 `anthropic-messages.ts` 里，被另外两条链跨适配器 import——也就是说「OpenAI 那条链
 * 的 URL 怎么拼」这件事的答案，写在 Anthropic 那个文件的第 619 行。审计把这一条列在「三条链共用
 * 零件、不共用骨架」下面，理由不是体积：一个住在某一条链里的共享零件，改它的时候看不见另外两个
 * 使用者，而这两个函数恰好都是「错了不会报错、只会行为变怪」的那种。
 *
 * `joinUrl` 的那条 `/v1` 规则是真事故留下的：用户把 baseUrl 填成 `https://host/v1`，而适配器又拼
 * 上 `/v1/messages`，得到 `/v1/v1/messages`。三条链都拼地址，所以三条链都需要这条规则——放在这里
 * 之后，它是一个大家都看得见的决定，而不是某条链的私事。
 */

import type { AssistantMessage, ModelConfig, StreamEvent, Usage } from "../types.ts";
import { addUsage } from "../types.ts";
import { computeCost } from "../utils/pricing.ts";
import { failureOf, worthRetrying } from "./failure.ts";

/** `base` 与 `path` 拼成一个地址，避开 `/v1` 重复。 */
export function joinUrl(base: string, path: string): string {
	const trimmedBase = base.replace(/\/+$/, "");
	// A base URL that already ends in the version segment must not get a second one.
	if (trimmedBase.endsWith("/v1") && path.startsWith("/v1/")) return trimmedBase + path.slice(3);
	return trimmedBase + path;
}

/**
 * 一次 fetch 失败，说成能放进界面的一句话。
 *
 * 不导出：三条链原来各自 import 它，而现在唯一的使用者是下面那个 `failedStreamEvent`——「失败时
 * 这条消息长什么样」整件事都在这个文件里，链那边不必再知道它怎么把错误说成人话。
 *
 * 先看 abort：用户按了停，那不是故障，不该报成网络错误。再看 `cause.code`——Node 把
 * `ECONNREFUSED`、`ENOTFOUND` 这类放在那里，而 `error.message` 只有一句 `fetch failed`，光有它
 * 排查不出任何东西。
 */
function describeFetchError(error: unknown, signal?: AbortSignal): string {
	if (signal?.aborted) return "Aborted by user";
	if (error instanceof Error) {
		const cause = (error as { cause?: { code?: string } }).cause;
		if (cause?.code) return `${error.message} (${cause.code})`;
		return error.message;
	}
	return String(error);
}

/**
 * 一次流失败或被中止，把它收成一条错误消息。
 *
 * 这 21 行原来在三条链里各抄一遍，逐字相同（只有一条链少了一行注释）。逐字重复的代价不是体积，
 * 是漂移：审计记下的「三条链已经产生可观测分歧」全部出在这种地方——改一处忘两处，而三处看起来
 * 都对。这一段管的是「失败时消息长什么样」，三条协议没有任何理由长得不一样。
 *
 * 成功那一侧**没有**抽出来，而且不该抽：`stopReason` 怎么算是真协议差异（Anthropic 有
 * `stop_reason` 字段、chat/completions 靠 `finish_reason` 加工具调用推断、Responses 看收尾事件），
 * 把三种算法塞进一个带 flag 的函数只会让每一条都更难读。
 *
 * 返回那个事件而不是 yield 它：这是个普通函数，调用方是生成器，`yield` 只能发生在生成器自己
 * 那一层。
 */
export function failedStreamEvent(
	partial: AssistantMessage,
	context: {
		error: unknown;
		signal: AbortSignal | undefined;
		model: ModelConfig;
		/** 前几次失败尝试各自花掉的 token，要算进账。 */
		spentOnRetries: Usage;
		startTime: number;
		/** 第一个 token 到达的时刻，`null` 表示一个都没到。 */
		firstTokenTime: number | null;
	},
): StreamEvent {
	const aborted = context.signal?.aborted;
	const failure = aborted ? undefined : failureOf(context.error);
	partial.stopReason = aborted ? "aborted" : "error";
	partial.errorMessage = aborted ? "Aborted by user" : (failure?.summary ?? describeFetchError(context.error, context.signal));
	// Recorded here because here is the last place it is knowable; see `errorRetryable`.
	partial.errorRetryable = failure ? worthRetrying(failure) : false;
	partial.failure = failure;
	partial.usage = addUsage(partial.usage, context.spentOnRetries);
	partial.usage = computeCost(partial.usage, context.model);
	partial.durationMs = Math.max(1, Date.now() - context.startTime);
	if (context.firstTokenTime !== null) {
		partial.sseDurationMs = Math.max(1, Date.now() - context.firstTokenTime);
	}
	return { type: "error", error: partial.errorMessage, message: { ...partial } };
}
