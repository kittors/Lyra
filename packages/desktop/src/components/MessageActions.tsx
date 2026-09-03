import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { Text } from "./Text.tsx";

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
	sseDurationMs,
	tokens,
	children,
}: {
	timestamp: number;
	/** What the copy button puts on the clipboard. */
	text: string;
	className?: string;
	/** Elapsed execution time in milliseconds (for assistant responses). */
	durationMs?: number;
	/** Pure SSE streaming generation duration in milliseconds (for accurate TPS calculation). */
	sseDurationMs?: number;
	/** Total output or consumed tokens to calculate tokens/sec throughput. */
	tokens?: number;
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
				<span className="inline-flex items-center rounded px-1 py-0.5 text-[11px] font-mono text-ink-faint/80 tabular-nums">
					{durationBadge}
				</span>
			)}
			<button
				type="button"
				data-ly-tip="复制"
				aria-label="复制这条消息"
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
	const secs = durationMs / 1000;
	const durationText = secs < 60 ? `${secs.toFixed(1)}s` : `${Math.floor(secs / 60)}m ${(secs % 60).toFixed(0)}s`;
	// Use pure streaming time (sseDurationMs) if available to compute TPS accurately, eliminating network wait and thinking TTFT
	const tpsSecs = (sseDurationMs && sseDurationMs > 0 ? sseDurationMs : durationMs) / 1000;
	if (tokens && tokens > 0 && tpsSecs > 0) {
		const tps = (tokens / tpsSecs).toFixed(1);
		return `${durationText} · ${tps} tok/s`;
	}
	return durationText;
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
