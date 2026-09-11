/**
 * 请求体里那些「这个端点不吃这个字段」的参数，撞出来之后记住。
 *
 * 和另外两个轴（`reasoning-compat.ts` 管推理怎么还、`tool-pairing-compat.ts` 管工具怎么排）是并列的
 * 第三件事，各学各的。压进同一条梯子的代价上一轮付过了：端点说 A、梯子退 B，对不上号时只能靠碰巧。
 *
 * 这里管的四个参数有一个共同点——**它们都不是必需品**。少发一个最多损失一点控制力（思考没关干净、
 * 采样参数没生效），而多发一个是整个请求被拒。所以默认全发、撞了就撤，方向永远是安全的那边。
 *
 * 为什么是「学」而不是「配」：这四条在作者能测到的两个端点上**全部 200**（2026-09-11，
 * `test/responses-params-probe.ts`，落盘在 `~/.lyra/scratch/responses-params.txt`）。也就是说我们手上
 * 没有能复现它们的端点，没有资格替所有人改默认值。oh-my-pi 有一张人工普查出来的表能直接查（它的
 * `catalog/src/compat/axes.ts` 有 `reasoning-disable-mode`、`supports-tool-choice`、
 * `supports-sampling-params` 等轴），我们没有那份普查数据——但错误串自带诊断，撞一次就够了。
 *
 * 已知的先验仍然写死，不靠学：Gemini 系拒 `effort: "none"` 是早就量到过的（错误原话
 * `none is not a valid ThinkingLevel enum value`），那条留在 `openai-responses.ts` 的 `isGemini` 里，
 * 让 Gemini 用户第一次就对，而不是先失败一次。这里的机制是给**没见过的端点**兜底的。
 *
 * 记在内存里，不落盘，理由同另外两个轴。
 */

/** 一个可以在撞墙后撤掉的请求参数。 */
export type DroppedParam = "reasoning-off" | "tool-choice" | "sampling" | "include-encrypted";

/**
 * 端点拒绝某个参数时的说法，以及该撤哪个。
 *
 * 每条都要能指出出处。指不出的不要往这里加——多认一条的代价是把别的原因造成的 400 误判成参数问题，
 * 然后拿一个被削过的请求去重发，那比不认还糟。
 */
const SIGNALS: { pattern: RegExp; drop: DroppedParam; source: string }[] = [
	{
		// 实测原话记在 `openai-responses.ts` 关思考那段注释里：Google Gemini/Vertex 拒 `effort: "none"`。
		// 第二种写法是 OpenAI 系对枚举外取值的通用说法，`'none'` 是 GPT-5.1 之后才加进去的值。
		pattern: /none is not a valid ThinkingLevel|Invalid value: ['"]none['"]|reasoning\.effort.{0,40}(not|invalid)/i,
		drop: "reasoning-off",
		source: "Gemini/Vertex 实测 + OpenAI 枚举外取值的通用说法",
	},
	{
		pattern: /tool_choice/i,
		drop: "tool-choice",
		source: "错误串点名这个参数即可判定——它是唯一叫这个名字的东西",
	},
	{
		/*
		 * OpenAI 官方对 o 系列和 gpt-5.x 的两种原话：
		 *
		 *     Unsupported value: 'temperature' does not support 0.7 with this model.
		 *     Only the default (1) is supported.
		 *     Unsupported parameter: 'top_p' is not supported with this model.
		 *
		 * `[^.]{0,60}?` 不跨句号，是为了不把一段顺口提到 temperature 的长错误也算进来——那种误判会削掉
		 * 用户自己配的采样参数，而真正的失败原因还在，于是重发还是失败，只是安静地改坏了一件事。
		 */
		pattern:
			/(?:unsupported\s+(?:value|parameter)\s*:\s*)?["'`]?(?:temperature|top_p|top_k|min_p|frequency_penalty|presence_penalty|repetition_penalty)["'`]?[^.]{0,60}?(?:does not support|is not supported|not supported with this model|only the default)/i,
		drop: "sampling",
		source: "OpenAI 官方 o 系列/gpt-5.x 的两种原话；oh-my-pi 的结论是这跟主机无关、只跟模型有关",
	},
	{
		pattern: /include.{0,30}encrypted_content|encrypted_content.{0,30}(not supported|unsupported|invalid)/i,
		drop: "include-encrypted",
		source: "我们无条件请求上游回密文；不认识这个 include 值的端点会拒",
	},
];

/** 学到的结论：`${providerId} ${modelId}` → 这些参数别再发了。 */
const learned = new Map<string, Set<DroppedParam>>();

const key = (providerId: string, modelId: string) => `${providerId} ${modelId}`;

const EMPTY: ReadonlySet<DroppedParam> = new Set();

/** 这个模型上该省掉哪些参数。没撞过就是一个都不省。 */
export function droppedParams(providerId: string, modelId: string): ReadonlySet<DroppedParam> {
	return learned.get(key(providerId, modelId)) ?? EMPTY;
}

/**
 * 从一次失败里学点东西。返回「结论变了，值得削掉这个参数重发一次」。
 *
 * 已经撤过同一个参数还被同一句话顶回来，返回 false——再发一次还是同样的结果，只是多烧一次钱。
 */
export function learnDroppedParam(providerId: string, modelId: string, error: string): boolean {
	const hit = SIGNALS.find((signal) => signal.pattern.test(error));
	if (!hit) return false;
	const id = key(providerId, modelId);
	const set = learned.get(id) ?? new Set<DroppedParam>();
	if (set.has(hit.drop)) return false;
	set.add(hit.drop);
	learned.set(id, set);
	return true;
}

/** 测试用：把学到的都忘掉。 */
export function resetRequestParamsCompat(): void {
	learned.clear();
}
