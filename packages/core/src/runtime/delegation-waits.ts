/**
 * 父会话在等的那些派发——人一开口，就放手。
 *
 * `task` 是一个同步的工具调用：派出去的子代理跑多久，父会话这一轮就卡多久，而插话只在两轮之间
 * 才有人取（`drainSteering`）。于是主会话在等四个子代理的那十几分钟里，人说的每一句话都排在它们
 * 后面——界面上消息发出去了，主智能体一声不吭，直到最后一个子代理交差（2026-09-26 的真实会话：
 * 一句插话等了两分多钟才被读到）。
 *
 * 所以人一开口，父会话就不再干等：还在等的那几个 `task` 当场交回一句「它转到后台了」，这一轮
 * 接着往下走，下一个回合开头就读到人刚说的话。子代理不受打扰，照样跑完；跑完之后，结果由运行时
 * 作为一条消息送回主会话（`Session` 那边决定是插进正在跑的那一轮，还是开一个新回合）。
 *
 * 为什么不是「一直都在后台跑」：大多数时候父会话就是要等结果才能往下做，让它每次都派完就走、
 * 再靠送达消息续上，是把一件本来一轮能做完的事拆成两轮——多一次请求，多一段要重读的前缀。只在
 * 真有人要说话的时候放手，平时的路一步都不多。
 *
 * 只管主会话派出去的那一层。子代理自己派的孩子不在这里：人说话的对象是主会话，不是它们。
 */

import type { DeliveredReport, Message, SubAgentAnswer } from "../types.ts";
import type { SubAgentSummary } from "./sub-agents.ts";

/** 一个放了手的派发跑完了。 */
export interface SettledDispatch {
	id: string;
	answer?: SubAgentAnswer;
	/** 跑到一半抛了——`task` 本来会把它变成一次工具错误，现在只能随结果一起送回去。 */
	error?: string;
}

export interface DelegationWaitHooks {
	/** 放手了：登记簿上标一下它转到后台了。 */
	detached(id: string): void;
	/** 放了手的那个跑完了：把结果送回主会话。 */
	settled(report: SettledDispatch): void;
}

export class DelegationWaits {
	/** 父会话正等着的派发，每个对应一个「放手」的办法。 */
	private readonly held = new Set<() => void>();
	/** 放了手、还在后台跑的，按登记 id。跑完了要送回去的就是这些。 */
	private readonly detached = new Set<string>();
	private readonly hooks: DelegationWaitHooks;

	constructor(hooks: DelegationWaitHooks) {
		this.hooks = hooks;
	}

	/** 父会话此刻正卡在几个派发上。 */
	get waiting(): number {
		return this.held.size;
	}

	/**
	 * 等一个派发，但随时可以放手。
	 *
	 * `id` 是现问的：登记发生在 `runSubAgent` 里、这个 Promise 交过来之后，而放手可能发生在
	 * 登记之前的那一瞬（几乎不会，但没有登记就没有 id，也就没法送回去——那种情况下放手交回的
	 * 话里不带 id，结果照常丢不了：它会在登记之后照样跑完，只是不再有人等它）。
	 */
	hold(run: Promise<SubAgentAnswer>, id: () => string | undefined): Promise<SubAgentAnswer> {
		return new Promise<SubAgentAnswer>((resolve, reject) => {
			let released: string | undefined;
			const release = () => {
				if (!this.held.delete(release)) return;
				released = id();
				if (released) {
					this.detached.add(released);
					this.hooks.detached(released);
				}
				resolve(detachedAnswer(released));
			};
			this.held.add(release);
			const settle = (report: Omit<SettledDispatch, "id">) => {
				// 放手之后会话被停过（`forget`），就不再送：那时候人要的是它们都停下。
				if (released && this.detached.delete(released)) this.hooks.settled({ id: released, ...report });
			};
			run.then(
				(answer) => {
					if (this.held.delete(release)) resolve(answer);
					else settle({ answer });
				},
				(error: unknown) => {
					if (this.held.delete(release)) reject(error);
					else settle({ error: error instanceof Error ? error.message : String(error) });
				},
			);
		});
	}

	/** 人开口了：正在等的全部放手。返回放了几个。 */
	release(): number {
		const all = [...this.held];
		for (const release of all) release();
		return all.length;
	}

	/** 会话停下了：已经放手的那些不再送回来。它们自己由登记簿停下。 */
	forget(): void {
		this.detached.clear();
	}
}

/**
 * 放手时交给父会话的那句话。
 *
 * 写给模型的，所以三件事都要说到：它还在跑（不是失败，也不是结论）；先去回应人；结果会自己
 * 回来——不用 `resume`，更不要重派。最后一条最要紧：模型只知道「这个任务没拿到结果」时，最顺手
 * 的一步就是再派一个，而那个新派的会把后台那个正在读的东西从头再读一遍。
 */
function detachedAnswer(id: string | undefined): SubAgentAnswer {
	return {
		text:
			"（用户在你等它的时候插了话，这个子代理转到后台继续跑——先回应用户。" +
			"它跑完后，结果会作为一条消息自动送到你这里；不用 resume 它，也不要重派同样的活。）",
		...(id ? { id } : {}),
		detached: true,
	};
}

/** 送达消息里一份报告需要的东西：跑完的结果，和登记簿上它是谁。 */
export interface DeliveryItem {
	report: SettledDispatch;
	/** 登记簿里的那一条；被挤出名单的（极少）没有，就只剩结果本身。 */
	summary: Pick<SubAgentSummary, "agent" | "description" | "status" | "incomplete"> | null;
}

/**
 * 后台子代理的结果，作为一条消息回到主会话。
 *
 * 给模型读的那一份是结果原文，外面套一层标签说清是谁、干的什么、怎么收场的——和 `task` 当场交回
 * 的结果读起来是同一种东西，只是晚到了。末尾那句话和 `task` 的指引是同一个意思：这是材料，不是
 * 成品。多个子代理的结果一起到的时候，模型最顺手的回答是按人头逐个转述（「子智能体 2 做了什么」），
 * 那是把它自己该做的合并工作推给了读的人。
 *
 * `delivery` 给界面：画成一行「谁的结果到了」，不是一个人发的气泡。
 */
export function deliveryMessage(items: DeliveryItem[]): Message {
	const blocks = items.map(({ report, summary }) => {
		const status = report.error ? "failed" : (summary?.status ?? "done");
		const body = report.error ? `它没能跑完：${report.error}` : report.answer?.text || "（它跑完了，但什么都没交回来。）";
		const attrs = [
			`id="${report.id}"`,
			summary ? `agent="${attribute(summary.agent)}"` : "",
			summary ? `task="${attribute(summary.description)}"` : "",
			`status="${status}"`,
		].filter(Boolean);
		return `<subagent_result ${attrs.join(" ")}>\n${body}\n</subagent_result>`;
	});
	const delivery: DeliveredReport[] = items.map(({ report, summary }) => ({
		id: report.id,
		agent: summary?.agent ?? "",
		description: summary?.description ?? "",
		status: report.error ? "failed" : summary?.status === "failed" || summary?.status === "aborted" ? summary.status : "done",
		...(report.answer?.incomplete || summary?.incomplete ? { incomplete: true } : {}),
	}));
	return {
		role: "user",
		synthetic: true,
		timestamp: Date.now(),
		delivery,
		content: [
			{
				type: "text",
				text: [
					"（运行时送达）你之前派出去、在用户插话时转到后台的子代理跑完了：",
					...blocks,
					"这些是交给你的材料，不是给用户的成品：结合用户后来说的话接着做。需要回答用户时，把结论合并成一份按问题组织的回答——去重、核对关键结论，不要逐个转述「某个子代理做了什么」。",
				].join("\n\n"),
			},
		],
	};
}

/** 标签属性里的值：引号换掉，换行压平，免得一句描述把标签撑破。 */
function attribute(value: string): string {
	return value.replace(/"/g, "'").replace(/\s+/g, " ").trim();
}
