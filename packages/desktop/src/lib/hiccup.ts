/**
 * 一次连接上的岔子，从开始到收场。
 *
 * 从前这件事在界面上是两样东西：重试是 store 里一个瞬时的 `retrying`，重连上就抹掉，转录里什么
 * 都不留；失败是消息上的 `stopReason: "error"`，画成一行红字加一个展开箭头加一个「重试」按钮。
 * 两者毫无关系，各画各的——于是一次自己好了的抖动什么痕迹都没有，而一次没好的占了两行、四个可点
 * 的东西、一个红标。
 *
 * 它们其实是同一件事的三个阶段。合成一条记录之后，「重试解决了就别报错，留个轻微的痕迹」这句话
 * 就是它自然的样子：等待时它在数秒，接上了它变成一行灰字，真没救了才换成一句失败。
 */

import type { MessageKey } from "../i18n/messages/index.ts";
import { translate } from "../i18n/translate.ts";

/** 摘要在一行里放不下时截到多少——再长的原文进悬停和展开。 */
const LINE_MAX = 40;

/** 悬停气泡里放多少。气泡最宽 360px，塞一页 JSON 只会得到一堵墙。 */
const TIP_MAX = 220;

type HiccupOutcome = "waiting" | "recovered" | "gave_up";

export interface Hiccup {
	/** 一次中断一条。同一条里次数往上加，不新开。 */
	id: string;
	/**
	 * 它是在转录的哪儿发生的——当时已经有多少条消息。
	 *
	 * 从前没有这个，于是所有的记录一律画在转录末尾、运行指示器底下。一轮跑四十分钟，中间断过两次
	 * 又接上了，那句「重连 2 次后恢复」却贴在最下面那行 loading 底下——它说的是四十分钟里某个时刻
	 * 的事，摆的位置却是「此刻」。断线是这段工作里的一件事，就该待在它发生的那一段旁边。
	 *
	 * 和 `compactions` 记的是同一种东西（见 `store/index.ts`），插进转录的办法也是同一个，见
	 * `conversation/grouping.ts`。还在等的那一条数出来正好是末尾，因为它确实正在此刻发生。
	 */
	at: number;
	attempts: number;
	/** 等待结束的时刻。存时刻而不是时长，因为时长在渲染出来之前就过期了。 */
	until: number;
	summary: string;
	detail?: string;
	kind: "network" | "upstream" | "fatal";
	fingerprint: string;
	/** 同一个指纹连续出现了几次——见 `describeHiccup` 里那句「一直是同一个错误」。 */
	repeated: number;
	outcome: HiccupOutcome;
	/** 界面据此给下一步：查密钥、换模型、看账单。 */
	hint?: string;
	/** 不是「再发一次请求」，而是「这一轮被重新捡起来」。 */
	resume: boolean;
}

/**
 * 同一次中断，还是新的一次？
 *
 * 只有还在等的那条才接得上。已经收场的——接上了，或者放弃了——是历史，不该被下一次抖动改写。
 */
export function foldRetry(
	hiccups: Hiccup[],
	event: { attempt: number; delayMs: number; reason: string; resume?: boolean; failure?: HiccupFailure },
	now: number,
	/** 转录当下有多少条消息——这一条记录就落在那儿。见 `Hiccup.at`。 */
	at: number,
): Hiccup[] {
	const last = hiccups[hiccups.length - 1];
	const failure = event.failure;
	const fingerprint = failure?.fingerprint ?? event.reason;
	const next: Hiccup = {
		id: last?.outcome === "waiting" ? last.id : `hiccup-${now}-${hiccups.length}`,
		// 接着上一条的，位置也是上一条的：同一次中断重试了几回，说的仍是同一个时刻的事。
		at: last?.outcome === "waiting" ? last.at : at,
		attempts: last?.outcome === "waiting" ? last.attempts + 1 : 1,
		until: now + event.delayMs,
		summary: failure?.summary ?? event.reason,
		detail: failure?.detail,
		kind: failure?.kind ?? "network",
		fingerprint,
		/*
		 * 「还是刚才那个错误吗」。
		 *
		 * 开着无限重试撞上一个我们没认出来的终局错误时，界面唯一能说的真话就是这个。真正的临时故障
		 * 换着花样报错；一字不差重复几十次的，人一眼就知道不是在排队。不替他决定停不停，只把事实
		 * 摆到最显眼的地方。
		 */
		repeated: last?.outcome === "waiting" && last.fingerprint === fingerprint ? last.repeated + 1 : 1,
		outcome: "waiting",
		hint: failure?.hint,
		resume: event.resume === true,
	};
	return last?.outcome === "waiting" ? [...hiccups.slice(0, -1), next] : [...hiccups, next];
}

export interface HiccupFailure {
	kind: "network" | "upstream" | "fatal";
	summary: string;
	detail?: string;
	fingerprint: string;
	hint?: string;
}

/** 那一条等着的记录，收场了。 */
export function settleHiccups(
	hiccups: Hiccup[],
	event: { outcome: "recovered" | "gave_up"; attempts: number; failure?: HiccupFailure },
	/** 只有下面那条凭空补出来的失败用得上——它没有「正在等」的记录可以接着。见 `Hiccup.at`。 */
	at: number,
): Hiccup[] {
	const last = hiccups[hiccups.length - 1];
	if (!last || last.outcome !== "waiting") {
		/*
		 * 一次都没重试就失败了的，也要有一条。
		 *
		 * 密钥不对、模型名写错——这些分类器判成 `fatal`，当场停下，一条 retry 事件都不会有，所以
		 * 这里没有「正在等」的记录可以收场。而它恰恰是最需要说清楚的一种失败：不说的话屏幕上只剩
		 * 一片安静，人不知道刚才发生了什么，更不知道该去改哪里。
		 */
		if (event.outcome === "recovered" || !event.failure) return hiccups;
		return [
			...hiccups,
			{
				id: `hiccup-fatal-${hiccups.length}-${event.failure.fingerprint}`,
				at,
				attempts: event.attempts,
				until: 0,
				summary: event.failure.summary,
				detail: event.failure.detail,
				kind: event.failure.kind,
				fingerprint: event.failure.fingerprint,
				repeated: 1,
				outcome: "gave_up",
				hint: event.failure.hint,
				resume: false,
			},
		];
	}
	return [
		...hiccups.slice(0, -1),
		{
			...last,
			outcome: event.outcome,
			attempts: Math.max(last.attempts, event.attempts),
			// 放弃时以最后那个失败为准：等待途中报的可能只是过程里的一个，最后那个才是拦住它的。
			summary: event.failure?.summary ?? last.summary,
			detail: event.failure?.detail ?? last.detail,
			hint: event.failure?.hint ?? last.hint,
		},
	];
}

/**
 * 一行字，一眼能看完。
 *
 * 三个阶段说三种话，因为读的人在三个时刻想知道的不是同一件事：等的时候想知道还要等多久，接上了
 * 想知道刚才那阵子过去了，没救了想知道到底卡在哪。
 */
export function describeHiccup(hiccup: Hiccup, now: number): string {
	if (hiccup.outcome === "recovered") {
		return hiccup.attempts === 1
			? translate("hiccup.recovered")
			: translate("hiccup.recoveredAfter", { n: hiccup.attempts });
	}
	if (hiccup.outcome === "gave_up") {
		return clip(hiccup.summary, LINE_MAX);
	}
	const left = Math.ceil((hiccup.until - now) / 1000);
	const wait = left > 0 ? translate("hiccup.retryIn", { n: left }) : translate("hiccup.retrying");
	/*
	 * 等的时候，「还要等多久」比「什么错」要紧。
	 *
	 * 这里一度直接截服务商的原话，于是屏幕上是一句 `upstream tempor…`——半个英文单词，对读的人
	 * 什么也没说，还占掉了倒计时的位置。具体原因不会丢：它在悬停里，也在展开里。
	 */
	const what = translate(hiccup.kind === "network" ? "hiccup.dropped" : "hiccup.serverFault");
	if (hiccup.resume) {
		const state = left > 0 ? translate("hiccup.continueIn", { n: left }) : translate("hiccup.continuing");
		return translate("hiccup.progressKept", { what, state });
	}
	/*
	 * 一直是同一个错误的时候，次数比原因重要。
	 *
	 * 三次以上、指纹一模一样，说明这不是在排队等一个会好起来的东西。这句话不需要认识那个错误就能
	 * 说出口，而它正是无限重试唯一可能骗人的地方。
	 */
	if (hiccup.repeated >= 3) return translate("hiccup.sameErrorEvery", { what, n: hiccup.attempts });
	return translate("hiccup.attemptN", { what, wait, n: hiccup.attempts });
}

/**
 * 悬停时多说的那几句。
 *
 * 原文在这里，但也只到这里为止：气泡最宽 360px，一页 JSON 塞进去只会变成一堵挡住半个窗口的墙。
 * 要读全的走展开，那里有可以滚的地方。
 */
export function hiccupTip(hiccup: Hiccup): string | undefined {
	const lines: string[] = [];
	// 等待时行内只写「还要等多久」，所以那句原因得在这儿说，否则它就无处可看了。
	if (hiccup.summary) lines.push(clip(hiccup.summary, TIP_MAX));
	if (hiccup.detail && hiccup.detail !== hiccup.summary) lines.push(clip(hiccup.detail, TIP_MAX));
	if (hiccup.outcome === "recovered" && hiccup.attempts > 1)
		lines.push(translate("hiccup.tookNTries", { n: hiccup.attempts }));
	const hint = hiccup.hint ? HINTS[hiccup.hint] : undefined;
	if (hint) lines.push(translate(hint));
	const text = lines.filter(Boolean).join("\n");
	return text || undefined;
}

const HINTS: Record<string, MessageKey> = {
	"check-key": "hiccup.hintKey",
	"check-model": "hiccup.hintModel",
	"check-billing": "hiccup.hintQuota",
	"check-request": "hiccup.hintRequest",
	blocked: "hiccup.hintSafety",
};

/** 一行放得下的长度，超了就截，末尾留一个省略号说明还有。 */
function clip(text: string, max: number): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
