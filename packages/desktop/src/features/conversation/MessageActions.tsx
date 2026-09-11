import { translate } from "../../i18n/translate.ts";
import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { Text } from "../../ui/primitives/Text.tsx";

/**
 * The row under a message: when it was written, and what you can do with it.
 *
 * One component for both sides of the transcript. What you want from a message you sent and
 * from a reply you received is the same thing in the same place, and two implementations of
 * that would drift — which is exactly what happened when the reply side was built separately
 * and came out as a bordered pill with relative times against the sent side's plain row.
 *
 * Whoever renders this owns the `group/msg` that reveals it, because the hover target is the
 * whole message, not this row. Height is held whether or not it is showing, so the transcript
 * does not reflow as the pointer travels down it.
 *
 * The row is as tall as the buttons in it, and stands off the message above.
 *
 * It used to be 18px — the height of the timestamp — with 24px buttons centred in it, so each
 * button's hover fill hung 3px out of the row at both ends. With nothing between the row and the
 * bubble, that fill landed *on* the bubble: pointing at 复制 drew a grey rectangle overlapping
 * the message it belongs to. Sizing the row to its tallest child is what keeps the fill inside
 * it; the 4px above is what keeps it off the bubble.
 */
export function MessageActions({
	timestamp,
	text,
	className = "",
	durationMs,
	requestMs,
	sseDurationMs,
	tokens,
	requests,
	children,
}: {
	timestamp: number;
	/** What the copy button puts on the clipboard. */
	text: string;
	className?: string;
	/**
	 * 这一轮实际跑了多久：墙钟，工具和子代理的时间都在里面。见 `grouping.ts` 的 `TurnStats`。
	 */
	durationMs?: number;
	/** 其中模型在应答的时间，工具不在里面——只进悬浮说明。 */
	requestMs?: number;
	/** Pure SSE streaming generation duration in milliseconds (for accurate TPS calculation). */
	sseDurationMs?: number;
	/** Total output or consumed tokens to calculate tokens/sec throughput. */
	tokens?: number;
	/** 这一轮发了几次请求，用来解释上面那两个数的差。 */
	requests?: number;
	/** Anything this side of the transcript offers beyond copying — editing, on a sent message. */
	children?: React.ReactNode;
}) {
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 1600);
		return () => clearTimeout(timer);
	}, [copied]);

	const timeTip = formatTimestampTip(timestamp);
	const durationBadge = formatDurationBadge(durationMs, sseDurationMs, tokens);
	const durationTip = formatDurationTip(durationMs, requestMs, sseDurationMs, tokens, requests);

	return (
		<div
			/*
			 * On a phone this row cannot be revealed by hovering, so it is always out — see the
			 * `(hover: none)` rules in the stylesheet. Marked because it is the one such row that
			 * repeats down the whole page, and at full strength it would compete with the
			 * conversation it belongs to.
			 */
			data-ly-hover-reveal
			className={`mt-1 flex h-6 items-center gap-1.5 opacity-0 transition-opacity duration-[var(--ly-t-quick)] group-hover/msg:opacity-100 has-[:focus-visible]:opacity-100 ${className}`}
		>
			<span data-ly-tip={timeTip || undefined} className="inline-flex items-center">
				<Text size="caption" tone="faint" numeric>
					{formatSentAt(timestamp)}
				</Text>
			</span>
			{durationBadge && (
				/*
				 * 这一行左边那个数是墙钟，右边那个速度的分母却是纯出字的时间——两个口径并排站着，
				 * 谁也不会想到它们不是一回事（22.9k ÷ 13 分 02 秒 算出来是 29 tok/s，不是 236）。
				 * 悬浮上去把三个数一次说清楚，比挑一个口径去迁就另一个要诚实。
				 */
				<span
					data-ly-tip={durationTip || undefined}
					className="inline-flex items-center rounded px-1 py-0.5 text-[11px] font-mono text-ink-faint/80 tabular-nums"
				>
					{durationBadge}
				</span>
			)}
			<button
				type="button"
				data-ly-tip={translate("common.copy")}
				aria-label={translate("messageActions.copyThis")}
				onClick={() => {
					void navigator.clipboard.writeText(text).then(() => setCopied(true));
				}}
				className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink"
			>
				{copied ? <Check size={12.5} strokeWidth={2.2} className="ly-pop text-ok" /> : <Copy size={12.5} strokeWidth={1.8} />}
			</button>
			{children}
		</div>
	);
}

function formatDurationBadge(durationMs?: number, sseDurationMs?: number, tokens?: number): string | null {
	if (!durationMs || durationMs <= 0) return null;
	// Use pure streaming time (sseDurationMs) if available to compute TPS accurately, eliminating network wait and thinking TTFT
	const tpsSecs = (sseDurationMs && sseDurationMs > 0 ? sseDurationMs : durationMs) / 1000;
	if (tokens && tokens > 0 && tpsSecs > 0) {
		const tps = (tokens / tpsSecs).toFixed(1);
		return `${formatSpan(durationMs)} · ${tps} tok/s`;
	}
	return formatSpan(durationMs);
}

/**
 * 一段时长，读出来的样子。
 *
 * 和 `RunningIndicator` 的 `formatElapsed` 同一副写法：秒向下取整、分钟补零。这一行接的正是那一行
 * ——回合一结束，运行指示器让位给这个徽章——两边取整方式不一样的话，数字会在交接的那一帧抖一下。
 *
 * 一分钟以内多给一位小数：这是最终结果，比还在走的那一行值得更准一点。
 *
 * 曾经写作 `(secs % 60).toFixed(0)`，于是 119.7 秒印出来是「1m 60s」。
 */
function formatSpan(ms: number): string {
	const secs = ms / 1000;
	if (secs < 60) return `${secs.toFixed(1)}s`;
	const whole = Math.floor(secs);
	const minutes = Math.floor(whole / 60);
	if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
	return `${minutes}m ${String(whole % 60).padStart(2, "0")}s`;
}

/**
 * 徽章上那两个数分别是怎么来的，悬浮才说。
 *
 * 平时只留一个「这一轮多久」在外面——那是人真正在问的；要问「那为什么 tok/s 对不上」的时候，
 * 答案在这里：模型只应答了其中一段，速度是按那一段里纯出字的时间算的。
 */
function formatDurationTip(
	durationMs?: number,
	requestMs?: number,
	sseDurationMs?: number,
	tokens?: number,
	requests?: number,
): string {
	const lines: string[] = [];
	if (durationMs && durationMs > 0 && requestMs && requestMs > 0 && requests && requests > 0) {
		lines.push(
			translate("messageActions.spanTip", {
				total: formatSpan(durationMs),
				model: formatSpan(requestMs),
				requests: String(requests),
			}),
		);
	}
	if (tokens && tokens > 0 && sseDurationMs && sseDurationMs > 0) {
		lines.push(translate("messageActions.rateTip", { tokens: String(tokens), decode: formatSpan(sseDurationMs) }));
	}
	return lines.join("\n");
}

function formatTimestampTip(timestamp: number): string {
	return new Date(timestamp).toLocaleString("zh-CN", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

/** Same shape as the reference: month, day, time — the year only once it stops being obvious. */
function formatSentAt(timestamp: number): string {
	const sent = new Date(timestamp);
	const sameYear = sent.getFullYear() === new Date().getFullYear();
	return sent.toLocaleString("zh-CN", {
		...(sameYear ? {} : { year: "numeric" }),
		month: "long",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}
