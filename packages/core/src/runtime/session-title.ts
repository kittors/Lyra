/**
 * 会话标题：先取一句现成的，再在后台换成一句摘要。
 *
 * 从 `AgentSession` 拆出来的。那个类 992 行、35 个公开方法，而报告点名它「拆分做了一半」——
 * `tasks`、`approvals`、`subAgents` 已经是协作者，其余职责还全挤在类里。这是接着拆的第一块，挑
 * 它是因为它最内聚：四个字段（流、控制器、任务、轮次）和三个方法只服务一件事，和会话其余部分的
 * 来往只有「往日志写一条记录」和「发一个 title 事件」。
 *
 * 两件事值得写在这里，因为它们解释了为什么这块比看起来难：
 *
 * **轮次（epoch）不是计数器，是取消的凭据。** 摘要在后台跑，而用户随时可能发下一句、或者自己改
 * 标题。一次摘要回来时要问的不是「我跑完了吗」而是「我还是当前那一次吗」——轮次每次作废都 +1，
 * 回来的那次拿自己出发时的号码比一下，不对就整个丢掉。只看信号不够：abort 和「用户手动改了标题」
 * 都要让这次结果作废，而后者不经过任何信号。
 *
 * **用量要记，标题可以不要。** 摘要被作废时那几个 token 服务商已经收过钱了，所以 `usage` 那条在
 * `current()` 之前写，标题那条在之后写。这一行顺序是原来就有的，注释也是原来那句。
 */

import { streamAssistant } from "../ai/index.ts";
import { resolveModel } from "../config/models.ts";
import { resolveModelRef } from "../config/model-roles.ts";
import type { Settings } from "../config/settings.ts";
import type { SessionRecordInput } from "../session/store.ts";
import type { UserContent } from "../types.ts";
import { summarizeTitle, TITLE_SUMMARY_THRESHOLD, TITLE_SUMMARY_TIMEOUT_MS } from "./title-summary.ts";

/**
 * 这块要从会话那边借的东西。
 *
 * 传具体的函数而不是把会话本身传进来：这样它不认识 `AgentSession`，没有反向依赖，也能单独测。
 */
export interface TitleDeps {
	settings: () => Settings;
	append: (record: SessionRecordInput) => Promise<void>;
	emitTitle: (title: string) => Promise<void>;
	/** 用户自己改过标题了吗——改过就不再自动覆盖。 */
	titleSetByUser: () => boolean;
	/** 这个会话当前的模型 id，空串表示跟默认。 */
	modelId: () => string;
	/**
	 * 摘要用的流函数，以及会话自己有没有被注入过流。
	 *
	 * 两个一起传，是因为原来那句判断要同时看它们：`if (!this.titleSummaryStream && this.streamFn)
	 * return;`——会话被注入了流（也就是在测试里）而标题摘要没有被单独注入时，不去碰真实的
	 * provider。少看一个就会在测试里真的发请求。
	 */
	stream: typeof streamAssistant | undefined;
	sessionStreamInjected: boolean;
}

export class SessionTitle {
	private deps: TitleDeps;
	private abort: AbortController | null = null;
	private task: Promise<void> | null = null;
	/** 见文件头那段：这是取消的凭据，不是计数器。 */
	private epoch = 0;

	constructor(deps: TitleDeps) {
		this.deps = deps;
	}

	/**
	 * 作废当前这一次，并等它收尾。
	 *
	 * 等，是因为调用方接下来往往要写标题——不等的话，一个正在返回路上的旧摘要会盖在新标题上面。
	 */
	async cancel(): Promise<void> {
		this.epoch++;
		this.abort?.abort();
		this.abort = null;
		await this.task;
	}

	/** 还在跑的那次，`dispose` 要等它。 */
	pending(): Promise<void> | null {
		return this.task;
	}

	/** 从这一句话取个标题：先落一个现成的，够长的话再在后台换成摘要。 */
	async fromPrompt(content: UserContent[], displayText?: string): Promise<void> {
		const pending = this.cancel();
		const epoch = this.epoch;
		await pending;
		if (epoch !== this.epoch || this.deps.titleSetByUser()) return;
		// Structured display text excludes injected context; ordinary prose must never be guessed away.
		const raw = displayText ?? content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
		const cleanText = raw.replace(/\s+/g, " ").trim();
		const fallbackTitle =
			[...cleanText].slice(0, 60).join("") || (content.some((block) => block.type === "image") ? "图片消息" : "New session");
		await this.deps.append({ type: "title", title: fallbackTitle, source: "auto" });
		if (epoch !== this.epoch || this.deps.titleSetByUser()) return;
		await this.deps.emitTitle(fallbackTitle);

		const settings = this.deps.settings();
		if (
			epoch === this.epoch &&
			settings.autoSummarizeTitle !== false &&
			[...cleanText].length > TITLE_SUMMARY_THRESHOLD &&
			!this.deps.titleSetByUser()
		) {
			this.summarizeInBackground(cleanText, epoch);
		}
	}

	private summarizeInBackground(text: string, epoch: number): void {
		if (!this.deps.stream && this.deps.sessionStreamInjected) return;
		const stream = this.deps.stream ?? streamAssistant;

		const settings = this.deps.settings();
		const resolved = resolveModel(settings, this.deps.modelId() || settings.defaultModelId);
		if (!resolved) return;
		const chosen = resolveModelRef(settings, "@fast", resolved);
		const controller = new AbortController();
		this.abort = controller;
		const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(TITLE_SUMMARY_TIMEOUT_MS)]);
		const current = () => epoch === this.epoch && !signal.aborted && !this.deps.titleSetByUser();
		const run = async () => {
			try {
				const summary = await summarizeTitle({
					retryPolicy: () => settings.retryPolicy,
					text,
					provider: chosen.provider,
					model: chosen.model,
					stream,
					signal,
				});
				if (!summary) return;
				// Cancellation invalidates the title, not usage already reported by the provider.
				await this.deps.append({
					type: "usage",
					source: "title-summary",
					providerId: chosen.provider.id,
					modelId: chosen.model.modelId,
					usage: summary.usage,
				});
				if (!summary.title || !current()) return;
				await this.deps.append({ type: "title", title: summary.title, source: "auto" });
				if (current()) await this.deps.emitTitle(summary.title);
			} catch {
				// Title summary failure is non-fatal; the initial fallback title remains in place.
			}
		};
		const task = run();
		this.task = task;
		void task.finally(() => {
			if (this.task === task) this.task = null;
			if (this.abort === controller) this.abort = null;
		});
	}
}
