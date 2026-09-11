/**
 * 一个端点对「把模型自己的推理还回去」这件事的态度，问出来之后记住。
 *
 * 这里不是可有可无的优化，是因为**各家的要求互相矛盾，一个全局形状在数学上满足不了**。两条都是真实
 * 端点上量出来的：
 *
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

/**
 * 已经用掉过「顶格时原样再试一次」那次机会的模型。
 *
 * 和 `learned` 分开：那张表记的是形状结论，这张记的是配额。混在一起的话，一次瞬时故障会被记成一条
 * 形状结论，而它什么形状都没说。
 */
const retried = new Set<string>();

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

/**
 * 「这个端点要求把推理还回来」的说法——**这句话不可信，留着只当兜底**。
 *
 * 2026-09-11 在 `api.deepseek.com/v1/responses` 上做过一次九格对照，落盘在
 * `~/.lyra/scratch/reasoning-shape-matrix.txt`：同一段历史，推理项的九种形状各发一次——去掉密文、去掉
 * id、去掉 summary、去掉 content、换位置、每个调用前各放一份、**整个推理项都不发**、**连思考都关掉**
 * ——九发全部 400，错误串一字不变。推理项已经不在请求里了，它还在说推理没带回来。
 *
 * 真正的原因是一轮里的多个工具调用排错了（见 `tool-pairing-compat.ts`）：同样的历史改成成组排，推理项
 * 发不发、带不带文本，全都 200。真实日志也吻合——4 次失败前的助手轮分别有 2、4、4 个工具调用，而唯一
 * 一个只有 1 个调用的轮次是唯一过了的那个。
 *
 * 所以这句话在这个端点上是它对**工具配对问题**的统一说法，不是字面意思。凭它判断推理该怎么发，会把
 * 排查引到一个查不出东西的方向上——这件事已经发生过，代价是两个报废的会话和一整天。
 *
 * 那为什么还留着它：别的端点上它可能是字面意思（Chat Completions 链的 `reasoning_content` 版本还没做
 * 过同样的对照）。留着，但**排在工具排列那条之后**看（见 `withReasoningRetry` 的 `alsoLearn`）。
 *
 * 顶格时的处理后来也改了。原本是「不重发」，理由是错的方向上多发一次不如如实报错——那句话对**形状**
 * 成立，对**瞬时故障**不成立，而这个端点用同一句话说两件事：2026-09-11 有一次子 Agent 请求被它用这句话
 * 拒掉，同一段历史原样重发就 200。所以顶格时给一次原样重试，只给一次（见 `retried`）。
 */
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
		if (now !== "replay") {
			learned.set(id, "replay");
			return true;
		}
		/*
		 * 已经在顶格，形状上没有更多可做的——但**原样再试一次**。
		 *
		 * 这句话已经被证明会撒谎两次：一次是工具排列不对时它这么说（`tool-pairing-compat.ts` 的九格
		 * 对照），一次是**瞬时故障**时它也这么说。后者是 2026-09-11 量到的：某个子 Agent 的一次请求被
		 * 它用这句话拒了，把同一段历史原样重发，200。
		 *
		 * 而 400 在 `failure.ts` 里是 `fatal`——不重试。对真正的形状错误这是对的（重发同样的请求还是
		 * 同样的错），对一个会拿这句话当通用拒绝的端点就不对了：一次抖动变成永久失败。代价差得很远
		 * ——重试一次只是一个请求的钱，不重试是子 Agent 跑了 40 秒、21 次调用的成果全丢，只能回报半截。
		 *
		 * 所以给一次，且只给一次：`retried` 记下这个模型已经用掉了这次机会，第二次还是这句话就如实
		 * 抛出去。不换形状——顶格已经是能带的都带了，换只会更少。
		 */
		if (retried.has(id)) return false;
		retried.add(id);
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
	retried.clear();
}

/**
 * 跑一次请求；被端点用「推理形状不对」顶回来时，换成它要的那一档，重发。
 *
 * 套在 `retryStream` **外面**，因为那一层按定义不会重试一个 400——同一个请求再发一遍还是同一个 400，
 * 它拒绝得对。这里重发的是一个**不同的**请求，所以是另一件事。
 *
 * 两条闸：
 *
 *   - 最多走完整条梯子，外加一步留给 `alsoLearn` 那个轴（它自己也只学一次）。每个学习器到底了都返回
 *     false，循环自己停。任何一个轴加格子，这里的上界要跟着改——它是两个轴的步数之和，不是某一个的。
 *   - 已经吐过字（`costIncurred`）就不重来。那些 token 服务商已经收过钱了，而且界面上已经画出了
 *     半个回答，重发会让它凭空再来一遍。请求形状的 400 发生在生成之前，这一条正常不会挡住它。
 */
export async function* withReasoningRetry<T>(
	providerId: string,
	modelId: string,
	reset: () => void,
	/**
	 * 别的轴也来看一眼这次失败——返回 true 表示它学到了东西，值得换个形状重发。
	 *
	 * 先问它再问推理那条梯子，因为**这两个轴会抢同一句话**。DeepSeek 的 Responses 在工具排列不对时报的
	 * 是 `The reasoning_text in the thinking mode must be passed back to the API.`，一句跟工具毫无关系
	 * 的话，而它正好落进下面 `REQUIRES` 的正则里。让推理那条先看，它会把这次失败认成自己的、退回一个
	 * 于事无补的结论；让指向明确的那条先看，误判的机会小得多。
	 */
	alsoLearn: ((providerId: string, modelId: string, error: string) => boolean) | undefined,
	run: (replay: ReasoningReplay) => AsyncGenerator<T, void>,
): AsyncGenerator<T, void> {
	/**
	 * 最多重发几次。
	 *
	 * 推理轴走完整条梯子的步数，加上 `alsoLearn` 那边所有轴各自能学的步数之和。调用方现在挂着两个轴
	 * （工具排列 1 步，请求参数最多 4 个字段各 1 步），给 5。
	 *
	 * 这个数字宁可大一点：每一步都要 `learnXxx` 真的返回 true 才会走，学不到东西的循环自己就停了，所以
	 * 上界偏大只是让「还能学」的情况有机会走完，不会凭空多发请求。反过来偏小才是真的坏——学到了结论却
	 * 没有配额去用它，等于白学。
	 */
	const budget = LADDER.length + 5;
	for (let attempt = 0; attempt < budget; attempt++) {
		try {
			yield* run(reasoningReplay(providerId, modelId));
			return;
		} catch (error) {
			const failure = failureOf(error);
			if (failure.costIncurred) throw error;
			const said = `${failure.summary} ${failure.detail ?? ""}`;
			const moved = alsoLearn?.(providerId, modelId, said) || learnReasoningReplay(providerId, modelId, said);
			if (!moved) throw error;
			reset();
		}
	}
}
