/**
 * 一轮里的多个工具调用，`function_call` 和它们的结果该怎么排——问出来之后记住。
 *
 * 两家的要求直接冲突，一个全局形状满足不了：
 *
 *   - `api.deepseek.com` 的 Responses：**成组**。所有 `function_call`，然后所有 `function_call_output`。
 *     交错排会被拒，而且它报的是
 *     `The reasoning_text in the thinking mode must be passed back to the API.`——一句跟工具毫无关系的
 *     话。推理项一个都不发时它报的还是这句，所以那不是字面意思，是它对工具配对问题的统一说法。
 *   - 把 Responses 翻译成 Chat Completions 的中转：**交错**。它们把每个 `function_call` 变成一条独立的
 *     助手消息，而 Chat Completions 要求带 `tool_calls` 的消息后面紧跟回答它的 tool 消息，于是两个调用
 *     连排就成了两条背靠背的助手消息：
 *     `an assistant message with 'tool_calls' must be followed by tool messages responding to each
 *     'tool_call_id'. The following tool_call_ids did not have response messages: bash:0`
 *
 * 默认成组，不是因为哪家更重要，是因为**认错的代价不对称**：
 *
 *   - 默认成组、撞上要交错的中转时，它给的错误明确点名 `tool_call_ids`，一看就知道该换哪个形状，学得准。
 *   - 默认交错、撞上要成组的端点时，它只会说「推理没带回来」。拿这句话去猜「其实是工具排错了」，猜不出来
 *     ——这次就是这么埋了两个报废的会话，而且把排查带偏了一整天。
 *
 * 成组也是 Responses 协议本来的样子：结果靠 `call_id` 找它的调用，不靠位置。OpenAI 官方两种都收。
 *
 * **这个默认值的证据覆盖面**（写下来是因为将来有人质疑它时，第一个该看的就是这个）：2026-09-11 用
 * `test/tool-pairing-survey-probe.ts` 普查了用户配置里的 2 个 Responses 端点，各发三次（单个调用做对照、
 * 交错、成组）——
 *
 *   - `api.deepseek.com` / `deepseek-flash`：对照 200，交错 400，成组 200 → **只收成组**
 *   - 某中转 / `claude-opus-4-6-thinking`：三发全 400，连单个调用的对照都拒，理由与排列无关 → 对照作废
 *
 * 也就是**有效样本 n=1**，而且没有任何现存端点被证明需要交错。要交错的那条路来自更早的一次真实报障
 * （错误原文见上），那个端点已不在用户的配置里，所以它现在无法复验。样本这么小仍然改默认值，靠的是上面
 * 那条不对称，不是样本量——这一点必须诚实写在这里。
 *
 * 落盘的原始输出在 `~/.lyra/scratch/tool-pairing-survey.txt`、`tool-pairing-order.txt`、
 * `reasoning-shape-matrix.txt`。
 *
 * 和 `reasoning-compat.ts` 是**两个独立的轴**，各学各的。上一版把「发几块推理」和「一块里带哪些字段」
 * 压进同一条梯子，结果是端点说 A、梯子退 B，对不上号的时候只能靠碰巧。同一个错误不犯第二次。
 *
 * 记在内存里，不落盘——理由同 `reasoning-compat.ts`：重启后重学一次的代价是一次自愈重发，换来不必做
 * 设置迁移，也不必担心一条学错的结论永久粘在用户的配置里。
 */

/** 一轮里多个工具调用的排法。 */
export type ToolPairing = "grouped" | "interleaved";

/** 学到的结论：`${providerId} ${modelId}` → 该怎么排。 */
const learned = new Map<string, ToolPairing>();

const key = (providerId: string, modelId: string) => `${providerId} ${modelId}`;

/** 这个模型该怎么排。默认成组，理由见文件头。 */
export function toolPairing(providerId: string, modelId: string): ToolPairing {
	return learned.get(key(providerId, modelId)) ?? "grouped";
}

/**
 * 「你的工具调用没有一一对上结果」的说法，两种写法。
 *
 * 只认这一句话：它点名了 `tool_call_id`，指向明确。别的 400 不往这儿归——多认一条的代价是把别的原因造成
 * 的失败误判成排列问题，然后拿一个换了形状的请求去重发，那比不认还糟。反过来说，**这条正则是「默认成组」
 * 唯一的退路**，认不出来就等于那类端点永久不可用，所以它有专门的单测（见 `test/tool-pairing.test.ts`）。
 */
const NEEDS_INTERLEAVED = /tool_call_ids did not have response messages|must be followed by tool messages/i;

/**
 * 从一次失败里学点东西。返回「结论变了，值得换个形状重发一次」。
 *
 * 只有一个方向：成组 → 交错。反向不学——要成组的那家给的错误话里没有任何能指认排列问题的东西（见文件头），
 * 拿它当信号只会误判。成组已经是默认，真需要反向时应该是有人拿着新证据来改这里，而不是让它自己猜。
 */
export function learnToolPairing(providerId: string, modelId: string, error: string): boolean {
	if (!NEEDS_INTERLEAVED.test(error)) return false;
	const id = key(providerId, modelId);
	if (learned.get(id) === "interleaved") return false;
	learned.set(id, "interleaved");
	return true;
}

/** 测试用：把学到的都忘掉。 */
export function resetToolPairingCompat(): void {
	learned.clear();
}
