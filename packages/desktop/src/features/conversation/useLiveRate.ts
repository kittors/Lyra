import { useEffect, useRef, useState } from "react";
import { useCountUp } from "../../ui/primitives/useCountUp.ts";
import { useApp } from "../../store/index.ts";
import { useSubAgents } from "../../store/subAgents.ts";
import { CHARS_PER_TOKEN, pushSample, rateFrom, trustworthy, type RateSample } from "./live-rate.ts";

/**
 * 这一轮此刻一共产出了多少字——主 Agent 自己的，加上委派出去的那些。
 *
 * 和 `useLiveRate` 同住一个文件，理由也一样：抽出来才挂得起来。`RunningIndicator` 连着一颗 canvas
 * 思考球，在 `test/ui` 里挂不动，而这两件事——「产出了多少」和「那有多快」——恰恰是那个组件里唯二
 * 值得验的。
 *
 * **为什么非得算上子代理。** 不算的话，一轮里派了几个子代理之后这个读数就废了：主 Agent 在等，
 * 自己一个字都不产，而屏幕上那个 0.9 tok/s 与此同时有四个子代理正在飞快地写。那不是「慢」，是
 * 「没在看真正在写的那个」。
 *
 * 子代理只能按 token 折算：它的消息要等 `message_end` 才整条过来（见 `runtime/sub-agent.ts` 的
 * relay），中途没有字符可数。于是曲线在它们身上是一跳一跳的，被 4 秒的窗口抹平之后，仍然比停在
 * 0.9 诚实得多。
 *
 * 已经结束的那些也在里面，而它们的数字不再变——速率算的是窗口内的差值，不动的部分只是个常量底，
 * 换一轮时窗口整个重置，底也跟着换掉。
 */
export function useProducedChars(): number {
	/*
	 * 正在写的这一条，到此刻为止有多少字。
	 *
	 * 思考和正文都算：两者都是模型这一刻正在产出的东西，速度是同一件事。工具调用的参数不算——它是
	 * 一次落地的，把它算进来会让曲线在调用那一帧凭空冲高。
	 */
	const live = useApp((s) => {
		const last = s.messages[s.messages.length - 1];
		if (last?.role !== "assistant" || last.stopReason !== "pending") return 0;
		let chars = 0;
		for (const block of last.content) {
			if (block.type === "text") chars += block.text.length;
			else if (block.type === "thinking") chars += block.thinking.length;
		}
		return chars;
	});
	const delegated = useSubAgents((s) => s.agents.reduce((sum, one) => sum + (one.usage?.output ?? 0), 0) * CHARS_PER_TOKEN);
	return live + delegated;
}

/**
 * 此刻的写入速度，跟着 `now` 一起走。
 *
 * 采样收在 ref 里而不是 state：它每 250ms 变一次，而运行指示器本来就因为 `now` 每 250ms 重渲染一次——再让
 * 采样也触发一次渲染，等于同一件事渲染两遍。
 *
 * 算完之后再交给 `useCountUp` 走一段，**而且是双向的**。那个 hook 默认拒绝往下走，因为它本来是给只增
 * 不减的累计数用的；速度不一样，慢下来和快起来一样真实，注释里给它留的那个例外说的就是这种读数。
 *
 * 单独一个文件，是为了能在 `test/ui` 里挂起来量。留在组件里它就只能连着那颗 canvas 思考球一起挂，而要验
 * 的东西——「读数保持到被替换」——跟球画成什么样没有半点关系。
 */
export function useLiveRate(chars: number, now: number, turnStartedAt: number | null): number {
	const samples = useRef<RateSample[]>([]);
	const [held, setHeld] = useState(0);

	/*
	 * 换了一轮就从头来过。
	 *
	 * 上一轮写得多快，是上一轮的事。新回合开始时还挂着旧数字，等于把别人的成绩记在这一轮头上。切会话也
	 * 走这条路：`turnStartedAt` 是那一轮的开始时刻，换了会话它就变了。
	 */
	useEffect(() => {
		samples.current = [];
		setHeld(0);
	}, [turnStartedAt]);

	/*
	 * 读数**留在那里，直到被替换**，而不是没字可写就消失。
	 *
	 * 一个回合的大半时间在跑工具：按「此刻有没有在写」来显示，一轮里几十次工具调用就是几十次闪烁——
	 * 出现、消失、再出现。而「刚才那段写得多快」在工具跑着的时候仍然是这一轮的事实，它不因为模型正在
	 * 读文件而变得不真。
	 *
	 * 所以只在新窗口攒稳（`trustworthy`）时更新，其余时刻保持。配合 `useCountUp` 的双向行程，新旧之间
	 * 是走过去的，不是跳过去的——这正是「第二轮的 100 t/s 把第一轮的替换掉」该有的样子。
	 */
	useEffect(() => {
		samples.current = pushSample(samples.current, now, chars);
		if (trustworthy(samples.current)) setHeld(rateFrom(samples.current));
	}, [chars, now]);

	/*
	 * 走得比 token 总数那条快一点。
	 *
	 * 总数走 520ms，因为它一次跳几千、需要时间读完这一段路。速度是另一种东西：它每 250ms 就有新值，
	 * 520ms 的行程会让上一段还没走完下一段就开始，看起来像在拖。240ms 刚好接得上采样的节奏。
	 */
	return useCountUp(held, 240, { bidirectional: true });
}
