/**
 * 一次 `task` 调用，和它派出去的那个子智能体，对上号。
 *
 * 两份记录说的是同一件事，却各缺一半。对话里的工具调用知道「派了谁、干什么」，从模型开口那一刻
 * 就在；登记簿（`SubAgentSummary`）知道「它现在怎么样了」——排在闸门后面的也在（`queued`），
 * 但登记簿只活在这一次运行里，重开应用就没了。
 *
 * 这里把两份对起来：对得上的用登记簿的状态；对不上的看调用自己——还在跑的是刚派出去、还没来得及
 * 登记的那一瞬；转到后台的（`detached`）看转录里有没有它的送达。
 *
 * 纯逻辑，没有 React：对话里的派发行用它，单测直接喂数据。
 */

import type { DeliveredReport, SubAgentSummary } from "@lyra/core";
import { RENAMED_AGENTS } from "@lyra/core/agents-builtin";

/** 一张脸此刻的样子——和 `AgentAvatar` 的表情一一对应（它另外还有一个 `idle`）。 */
export type DispatchState = "waiting" | "working" | "done" | "failed" | "stopped";

export interface DispatchCall {
	/** 工具调用的 id。 */
	id: string;
	args: Record<string, unknown>;
	run?: { status: "running" | "done" | "error"; startedAt?: number; result?: { details?: unknown } };
}

export interface Dispatch {
	callId: string;
	/** 定义名，旧名已经翻成新名。 */
	agent: string;
	description: string;
	state: DispatchState;
	/** 对上了登记簿里的哪一条；排队中的、登记簿里已经清掉的没有。 */
	summary?: SubAgentSummary;
}

/** 登记簿里的一条，是什么表情。 */
export function stateOf(one: Pick<SubAgentSummary, "status" | "incomplete">): DispatchState {
	if (one.status === "queued") return "waiting";
	if (one.status === "running") return "working";
	if (one.status === "failed") return "failed";
	if (one.status === "aborted") return "stopped";
	// 跑到检查点停下的也是 `done`，可它没做完、上下文还留着等人续跑——那是在歇着，不是交差。
	return one.incomplete ? "stopped" : "done";
}

const text = (value: unknown) => (typeof value === "string" ? value : "");

/**
 * 按调用出现的顺序，一一配上登记簿里的记录。
 *
 * 先认确定的：做完的调用结果里带着子智能体的 id，续跑的调用参数里带着。剩下还在跑的，按「同一个
 * 智能体、同一句描述、在调用开始之后才登记」去找——描述是派活的那一方自己写的三五个字，同一轮里
 * 撞上的机会很小；撞上了也按先后一个配一个，不会两个调用抢同一条。
 */
export function joinDispatches(
	calls: readonly DispatchCall[],
	roster: readonly SubAgentSummary[],
	/** 转录里送达过的结果，按子智能体 id——登记簿里已经没有它的时候，转到后台的那些靠这个知道怎么收场的。 */
	delivered: ReadonlyMap<string, DeliveredReport> = new Map(),
): Dispatch[] {
	const byId = new Map(roster.map((one) => [one.id, one]));
	const claimed = new Set<string>();
	const found = new Map<string, SubAgentSummary>();

	for (const call of calls) {
		const details = call.run?.result?.details as { subAgentId?: unknown } | undefined;
		const known = typeof details?.subAgentId === "string" ? byId.get(details.subAgentId) : undefined;
		const resume = text(call.args.resume).trim();
		const resumed = resume ? roster.find((one) => one.id === resume || one.id.endsWith(resume)) : undefined;
		const match = known ?? resumed;
		if (match && !claimed.has(match.id)) {
			claimed.add(match.id);
			found.set(call.id, match);
		}
	}
	const waiting = [...roster].sort((a, b) => a.startedAt - b.startedAt);
	for (const call of calls) {
		if (found.has(call.id) || text(call.args.resume)) continue;
		const agent = agentOf(call);
		const description = text(call.args.description);
		const since = (call.run?.startedAt ?? 0) - 2000;
		const match = waiting.find((one) => !claimed.has(one.id) && one.agent === agent && one.description === description && one.startedAt >= since);
		if (match) {
			claimed.add(match.id);
			found.set(call.id, match);
		}
	}

	return calls.map((call) => {
		const summary = found.get(call.id);
		return {
			callId: call.id,
			agent: summary?.agent ?? agentOf(call),
			description: summary?.description ?? (text(call.args.description) || text(call.args.prompt).slice(0, 40)),
			state: summary ? stateOf(summary) : fallbackState(call, delivered),
			...(summary ? { summary } : {}),
		};
	});
}

function agentOf(call: DispatchCall): string {
	const asked = text(call.args.subagent_type) || "general";
	return RENAMED_AGENTS[asked] ?? asked;
}

/**
 * 登记簿里没有它的时候。
 *
 * 调用还在跑 = 刚派出去、还没来得及登记的那一瞬。调用已经结束 = 登记簿清掉了（关过面板上的记录、
 * 重开了应用），看结果就知道它当时怎么收场的。一次都没开始过（历史里读回来、没有运行记录）
 * 就当它做完了——那是很久以前的事。
 *
 * 转到后台的例外：它的结果里只有一句「转到后台了」，怎么收场的要看后来的送达。没有送达就是没有
 * 回来——应用在它跑完之前关掉了——那是停下，不是做完。
 */
function fallbackState(call: DispatchCall, delivered: ReadonlyMap<string, DeliveredReport>): DispatchState {
	if (call.run?.status === "running") return "waiting";
	if (call.run?.status === "error") return "failed";
	const details = call.run?.result?.details as { detached?: unknown; subAgentId?: unknown } | undefined;
	if (details?.detached === true) {
		const report = typeof details.subAgentId === "string" ? delivered.get(details.subAgentId) : undefined;
		if (!report) return "stopped";
		if (report.status === "failed") return "failed";
		return report.status === "aborted" || report.incomplete ? "stopped" : "done";
	}
	return "done";
}

/** 转录里所有送达过的结果，按子智能体 id。 */
export function deliveredReports(messages: readonly { role: string; delivery?: DeliveredReport[] }[]): Map<string, DeliveredReport> {
	const found = new Map<string, DeliveredReport>();
	for (const message of messages) {
		if (message.role !== "user" || !message.delivery) continue;
		for (const report of message.delivery) found.set(report.id, report);
	}
	return found;
}
