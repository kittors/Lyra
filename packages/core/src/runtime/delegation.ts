/**
 * 派活派得多积极：默认跟着这一轮的推理等级走，也可以由用户钉死。
 *
 * `dispatch-guard.ts` 定的是**安全边界**——最多几个同时跑、最深几层、不许自己派自己。那三条
 * 跟推理等级无关，任何等级、任何设置下都不能破。这里定的是另一件事：在边界之内，模型该有多想派。
 *
 * 为什么这不是可有可无的调味：派一个子代理的成本，是一整轮独立的模型调用加一份从零开始的上下文，
 * 而它省下来的是「中间过程不进我的上下文」。这笔账划不划算，恰恰取决于当前这一轮值多少钱——
 * 推理等级正是用户对这一轮值多少钱的表态。等级调到低，意思是「这件事不值得慢慢想」，而在那种
 * 时候还并行派四个子代理去查，是把用户刚刚省下来的钱，从另一个口子花掉，而且花得更多。
 *
 * 用户看得见的症状是反过来的：把 gpt-6-astra 开到中档，子代理照样一派一大把。因为在此之前，
 * 派活的倾向根本不看等级——提示词里只有一句「最多几个同时跑」，那是上限，不是建议，而模型读
 * 上限的方式历来是「那就派满」。
 *
 * 两头一起管，缺一不可：
 *
 *   - 提示词里说清这一轮该有多想派（软），因为模型是照着提示词决定要不要调 `task` 的；
 *   - 闸门跟着收窄（硬），因为一句建议挡不住一个已经决定要派八个的模型，而排队是唯一不用
 *     拒绝就能把八个变成两个一批的办法。
 *
 * 跟着等级走是默认，不是唯一。用户可以钉死一档（`DelegationPolicy`），因为「这一轮值多少钱」
 * 只是一个很好的猜测，不是事实：有人把等级开满只是想让模型自己想得久一点，并不想要一棵子代理树。
 */

import type { ThinkingLevel } from "../types/provider.ts";

/**
 * 五档倾向，不是八档。
 *
 * 推理等级有八个名字，但「该不该派活」只有这么几种真正不同的答案。一档一句话会让提示词里多出
 * 五段互相之间只差一个副词的文字，而模型读到的差别近似于零。
 *
 * `off` 是后来加的，而且跟其余四档不是一类东西：那四档回答「多想派」，它回答「派不派」。它落在
 * 同一个枚举里，是因为用户是在同一个选择器里做这个选择的——把它拆成另一个开关，界面上就成了
 * 「先开一个总开关，再在下面挑一档」，而那两步之间没有任何人需要停下来想的东西。
 */
export type DelegationTier = "off" | "sparing" | "selective" | "ready" | "eager";

/**
 * 用户在设置里选的那个值。
 *
 * `auto` 不是第六档，是「别问我，看等级」——它和四个档位是同一个下拉里的选项，但语义上高一层。
 * 分成两个类型而不是让 `DelegationTier` 直接含 `auto`，是因为运行时的每一处（提示词、闸门、
 * 工具表）要的都是「这一轮最终是哪一档」，而 `auto` 在那些地方是个答不上来的值。
 */
export type DelegationPolicy = "auto" | DelegationTier;

/** 下拉里的顺序，也是从不派到放开派的顺序。设置页和磁盘规范化共用，省得两边各写一遍。 */
export const DELEGATION_POLICIES = ["auto", "off", "sparing", "selective", "ready", "eager"] as const;

/** 磁盘上的值可能是任何东西——手写的配置、旧版本、同步过来的字段。认不出来就是 `auto`。 */
export function normalizeDelegationPolicy(value: unknown): DelegationPolicy {
	return typeof value === "string" && (DELEGATION_POLICIES as readonly string[]).includes(value)
		? (value as DelegationPolicy)
		: "auto";
}

/**
 * 等级到倾向，除非用户已经替这个问题做过决定。
 *
 * 认不出来的等级（模型自己声明的 `adaptive`、`deep-custom` 之类）按 `selective` 算：那是唯一
 * 一个猜错了两边都不太糟的答案——既不会在便宜的一轮里铺开摊子，也不会把一个真的调高了的会话
 * 按死在「什么都自己做」上。
 */
export function delegationTier(thinking?: ThinkingLevel, policy?: DelegationPolicy): DelegationTier {
	// 钉死的一档优先：这正是「自定义」的全部含义——从此以后推理等级不再影响派活。
	if (policy && policy !== "auto") return policy;
	switch (thinking) {
		case "off":
		case "minimal":
		case "low":
			return "sparing";
		case "high":
			return "ready";
		case "xhigh":
		case "max":
		case "ultra":
			return "eager";
		default:
			return "selective";
	}
}

/**
 * 这一轮真正的并发上限。
 *
 * 永远只往下收，从不往上放：`maxConcurrentSubAgents` 是用户（或项目配置）定的天花板，推理等级
 * 是在天花板底下的一个选择。把等级调到极致不该让会话突破用户写下的那个数字——那样的话，这个
 * 设置就成了一个可以被别的设置绕过去的设置。
 */
export function delegationConcurrency(limit: number, thinking?: ThinkingLevel, policy?: DelegationPolicy): number {
	const ceiling = Math.max(1, Math.floor(limit));
	switch (delegationTier(thinking, policy)) {
		/*
		 * 关掉的时候闸门仍然是 1，不是 0。
		 *
		 * 0 会把一道排队用的闸门变成一道谁也过不去的墙，而这一档下**仍然有合法的派发**——用户
		 * 自己点名的那次。挡住模型自作主张的是工具表（见 `session-turn.ts`）和 `task` 里的兜底，
		 * 不是这个数字；这个数字只回答「放进来的那些，一次跑几个」，而「从不派」的人要的显然是
		 * 一次一个。
		 */
		case "off":
		// 一次一个。低档下并行派活省不出时间——它省的是思考，而这里花掉的是调用。
		case "sparing":
			return 1;
		// 一半，向上取整：默认的 4 变成 2，够做「两路并查」，不够做「铺开八个」。
		case "selective":
			return Math.max(1, Math.ceil(ceiling / 2));
		default:
			return ceiling;
	}
}

/**
 * 并发派活之前必须先做完的两件事。
 *
 * 都是看着它出错才写下来的，不是从道理上推出来的。跟着倾向一起走，而不是跟着并发上限走：
 * 一个一次只派一个的等级，读到「并发之前要先……」只会多一段用不上的字。
 */
const PARALLEL_PRECONDITIONS = [
	"并发派活之前，两件事必须先做完：",
	"1. 每个任务都要跳过验证（构建、lint、测试）。跑到一半的验证会让它们互相阻塞——A 的测试跑在 B 改了一半的代码上。最后统一验证一次。",
	"2. 跨任务的契约（A 实现、B 消费的那个接口）必须在派活之前定好，写进各自的 prompt 里。子代理之间看不见对方，没法协商。",
].join("\n");

/** 写进提示词那一段时，除了等级和档位之外还需要知道的东西。 */
export interface DelegationNoteContext {
	policy?: DelegationPolicy;
	/**
	 * 这一轮用户在自己的消息里点名的智能体。只在 `off` 档下有意义。
	 *
	 * 关着的时候要说的话有两种，差别不在措辞而在事实：没点名的那一轮模型手里根本没有 `task`，
	 * 该告诉它的是「这条路这一轮不通，自己做」；点了名的那一轮工具在手里，该告诉它的是
	 * 「只派这一个，别的不要顺手带上」——后者是这一档最容易漏的那个口子。
	 */
	mentioned?: readonly string[];
}

/**
 * 写进提示词里的那一段。
 *
 * 每一段都带着「为什么」，因为只说结论的规则模型会绕：告诉它「少派点」，它会把八个改成七个；
 * 告诉它派一个的成本是一整轮模型调用加一份新上下文，它才有东西可以拿来跟自己做一遍比较。
 */
export function delegationNote(thinking?: ThinkingLevel, context: DelegationNoteContext = {}): string {
	switch (delegationTier(thinking, context.policy)) {
		case "off": {
			const named = context.mentioned ?? [];
			if (named.length === 0) {
				return (
					"用户把子代理关掉了：这一轮不要派活，`task` 也不在你的工具表里。所有事情自己做完——" +
					"要翻很多文件就自己 grep、自己读。如果这件事真的必须靠子代理才做得下去，把原因说给" +
					"用户听，让他点名要派哪一个（在消息里写 `@智能体名`），不要自己想办法绕过去。"
				);
			}
			return (
				`用户把子代理关掉了，但这一轮点名要派 ${named.map((name) => `\`${name}\``).join("、")}——` +
				"派它，只派它。点名之外的一个都不要派，也不要为了「顺便」把一件活拆成好几个子代理；" +
				"没被点到的部分自己做完。"
			);
		}
		case "sparing":
			return (
				"这一轮的推理等级调得很低，派活也要跟着省着来。除非用户点名要派，或者要读的东西明显" +
				"装不进上下文，否则自己做完——派一个子代理的代价是一整轮独立的模型调用加一份从零" +
				"开始的上下文，在这个等级上，它通常比你自己 grep 一遍还慢，而且更贵。"
			);
		case "selective":
			return (
				"这一轮的推理等级是中档，派活要挑着派。值得派的只有一种：**中间过程你并不需要**的活——" +
				"翻几十个文件找一个答案、把一大段输出压成一句结论。这种活隔离上下文是赚的。" +
				"能用 grep / read 直接做完的就直接做，不要为了并行而并行；也不要把一件事拆成三个" +
				"子代理再自己把结果拼回来，那样你既付了三份调用，又要把三份结果重新读进上下文。" +
				`\n\n${PARALLEL_PRECONDITIONS}`
			);
		case "ready":
			return (
				"这一轮的推理等级偏高，可以主动派活：互相独立的子任务并行派出去是划算的，" +
				"你自己留着做拆分、串联和收口。" +
				`\n\n${PARALLEL_PRECONDITIONS}`
			);
		default:
			return (
				"这一轮的推理等级拉满了，可以放开编排：能拆成互不依赖的几块就并行派出去，" +
				"把闸门用满，自己专心做拆分、串联和最后的验证。" +
				`\n\n${PARALLEL_PRECONDITIONS}`
			);
	}
}

/**
 * 「用户这一轮点名要派谁」，从他自己写的那段话里认出来。
 *
 * 为什么必须在这里认：`@explore` 在输入框里只是一段**纯文本**——提及菜单插进去的就是这几个字符
 * （见 desktop 的 `useMention.ts`），没有任何结构跟着它一起传下来。整条链上真正派活的入口只有
 * 一个，就是模型自己去调 `task`。所以「关掉自动派、但保留手动点名」没法靠摘掉工具实现：摘掉了，
 * 两条路一起断。
 *
 * 于是反过来做——这一轮的文本里认出点名，认到了就把工具留在桌上，认不到就收走。
 *
 * 只认一轮，是有意的。点名是一次祈使句，不是一个开关：「@explore 看看这个」说的是现在这件事，
 * 而不是「从此以后你可以随便派 explore」。往后翻历史找点名的话，一次点名会把这场会话剩下的
 * 每一轮都变成开着的——那正是用户关掉它想避免的事。
 */
export function mentionedAgents(text: string, names: readonly string[]): string[] {
	if (!text || names.length === 0) return [];
	/*
	 * `@` 前面必须是行首或者一个「不像标识符」的字符。
	 *
	 * 挡的是邮箱和路径：`yuan364299311@gmail.com` 里的 `@gmail` 前面是数字，`./@general` 里的
	 * 前面是斜杠，两个都不算点名。中文字符不在排除集里，所以「用@explore 查一下」认得出来——
	 * 中文用户不打空格是常态，而那确确实实是一次点名。
	 */
	const found = new Set<string>();
	// 名字里可以有连字符（`claude-code-guide`），所以 token 一直吃到非 [A-Za-z0-9_-] 为止。
	for (const [, token] of text.matchAll(/(?:^|[^\w@./\\-])@([A-Za-z0-9_-]+)/g)) {
		// 精确优先，再退到大小写不敏感：agent 名一律小写，但没有理由因为有人打了 `@Explore` 就装作没看见。
		const exact = names.find((name) => name === token);
		const loose = exact ?? names.find((name) => name.toLowerCase() === token!.toLowerCase());
		if (loose) found.add(loose);
	}
	return [...found];
}

/** 会话状态里存这一轮派活决定的键。`task` 的兜底和子代理都从这里读。 */
export const DELEGATION_KEY = "delegationDecision";

/**
 * 这一轮关于派活的决定，放在会话状态里给 `task` 兜底用。
 *
 * 主路径是工具表——关掉的时候 `task` 根本不在里面，模型不会想要一个没见过的工具。这里是第二道，
 * 挡的是工具**在**桌上的那种情况：用户点名了 `@explore`，工具因此留着，而模型顺手又派了两个
 * 没人点过的。没有这道，「只派点名的那个」就只是提示词里的一句请求。
 */
export interface DelegationDecision {
	tier: DelegationTier;
	/** `off` 档下这一轮唯一放行的名字。其余档位为空数组，不参与判断。 */
	mentioned: string[];
}

/** 这一轮能不能派 `agent`。`undefined` 是没登记过决定的会话（CLI、测试），一律放行。 */
export function dispatchAllowed(decision: DelegationDecision | undefined, agent: string): boolean {
	if (!decision || decision.tier !== "off") return true;
	return decision.mentioned.includes(agent);
}
