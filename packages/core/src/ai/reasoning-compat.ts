/**
 * 一个端点对「把模型自己的推理还回去」这件事的态度，问出来之后记住。
 *
 * 这里不是可有可无的优化，是因为**各家的要求互相矛盾，一个全局形状在数学上满足不了**。三条都是真实
 * 端点上量出来的：
 *
 *   - `api.deepseek.com`：带工具调用的助手轮**必须**带推理，否则
 *     `The reasoning_text in the thinking mode must be passed back to the API.`
 *   - 某中转上的 Claude：推理项可以有，但**必须带得动签名**。换过模型之后签名被
 *     `stripStaleHandles` 剥掉了，剩下一个没有句柄的思考块，于是
 *     `messages.1.content.0.thinking.signature: Field required`——补上 summary 也只是换成
 *     `thinking.thinking: Field required`，因为缺的那样东西我们根本没有。
 *   - 某中转上的 `gpt-oss-120b-medium`：input 里**只要有** reasoning 项就 400，四种形状全试过。
 *
 * 所以是三档，不是开关。三档之间是一条梯子，越往下发得越少：
 *
 *     replay（都发） → handled（只发带句柄的） → omit（一个都不发）
 *
 * 被顶回来一次就往下走一格，重发。往下走是安全的方向——少发一点推理最多让模型接不回自己那条思维链，
 * 而多发一格是整个请求被拒。第二种信号（「你得还回来」）把它一次拉回顶格。
 *
 * 只认有实测证据的错误串。多认一条的代价是把别的原因造成的 400 误判成形状问题，然后拿一个改坏了的
 * 请求去重发——那比不认还糟。
 *
 * 记在内存里，不落盘。进程重启后重新学一次，代价是一次自愈的重发；换来的是不必为它做一次设置迁移，
 * 也不必担心一条学错的结论永久粘在用户的配置里。
 */

import { failureOf } from "./failure.ts";

/** 推理块在下一轮请求里的去向。 */
export type ReasoningReplay = "replay" | "handled" | "omit";

/** 梯子，从发得最多到发得最少。 */
const LADDER: ReasoningReplay[] = ["replay", "handled", "omit"];

/** 学到的结论：`${providerId} ${modelId}` → 该发哪一档。 */
const learned = new Map<string, ReasoningReplay>();

const key = (providerId: string, modelId: string) => `${providerId} ${modelId}`;

/** 这个模型该发哪一档。默认顶格——那是绝大多数端点要的，也是没撞过之前唯一有依据的猜测。 */
export function reasoningReplay(providerId: string, modelId: string): ReasoningReplay {
	return learned.get(key(providerId, modelId)) ?? "replay";
}

/**
 * 「这一份推理它接不下」的说法——往下走一格。
 *
 * 前两条是中转把 Responses 翻译成 Anthropic 时的原话：它那边的 thinking 块要文本也要签名，而剥过句柄
 * 的思考块两样都拿不出来。后两条是翻译成别的协议时的：我们的 reasoning 项在它那边变不出一个合法的
 * 消息元素，或者 `content` 在这个端点上最大长度就是 0。
 */
const REJECTS = [
	/thinking\.(thinking|signature).{0,20}(required|missing)/i,
	/Expected a\(n\) 'messages' array element to be an object/i,
	/maximum length 0/i,
];

/** 「这个端点要求把推理还回来」的说法。DeepSeek 系两条链上的原话，只有字段名不同。 */
const REQUIRES = /reasoning(_content|_text)?.{0,40}must be passed back/i;

/**
 * 从一次失败里学点东西。返回「结论变了，值得换个形状重发一次」。
 *
 * 已经在梯子最底下还被顶回来，返回 false——再往下没有格子了，重发只是多烧一次钱。
 */
export function learnReasoningReplay(providerId: string, modelId: string, error: string): boolean {
	const id = key(providerId, modelId);
	const now = learned.get(id) ?? "replay";

	if (REQUIRES.test(error)) {
		if (now === "replay") return false;
		learned.set(id, "replay");
		return true;
	}
	if (!REJECTS.some((pattern) => pattern.test(error))) return false;

	const next = LADDER[LADDER.indexOf(now) + 1];
	if (!next) return false;
	learned.set(id, next);
	return true;
}

/** 测试用：把学到的都忘掉。 */
export function resetReasoningCompat(): void {
	learned.clear();
}

/**
 * 跑一次请求；被端点用「推理形状不对」顶回来时，换成它要的那一档，重发。
 *
 * 套在 `retryStream` **外面**，因为那一层按定义不会重试一个 400——同一个请求再发一遍还是同一个 400，
 * 它拒绝得对。这里重发的是一个**不同的**请求，所以是另一件事。
 *
 * 两条闸：
 *
 *   - 最多走完整条梯子（三格，两步）。`learnReasoningReplay` 到底了就返回 false，循环自己停。
 *   - 已经吐过字（`costIncurred`）就不重来。那些 token 服务商已经收过钱了，而且界面上已经画出了
 *     半个回答，重发会让它凭空再来一遍。请求形状的 400 发生在生成之前，这一条正常不会挡住它。
 */
export async function* withReasoningRetry<T>(
	providerId: string,
	modelId: string,
	reset: () => void,
	run: (replay: ReasoningReplay) => AsyncGenerator<T, void>,
): AsyncGenerator<T, void> {
	for (let attempt = 0; attempt < LADDER.length; attempt++) {
		try {
			yield* run(reasoningReplay(providerId, modelId));
			return;
		} catch (error) {
			const failure = failureOf(error);
			if (failure.costIncurred) throw error;
			const said = `${failure.summary} ${failure.detail ?? ""}`;
			if (!learnReasoningReplay(providerId, modelId, said)) throw error;
			reset();
		}
	}
}
