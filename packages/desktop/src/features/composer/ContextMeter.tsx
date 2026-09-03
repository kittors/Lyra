/*
 * The subpath, not the package root.
 *
 * `@lyra/core` is the kernel's entry point and pulls in the bash tool, the settings loader
 * and the plugin host with it — all of which reach for `process`, which the renderer does not
 * have. Importing the root here took the whole window white on load.
 */
import { estimateTokens } from "@lyra/core/tokens";
import type { Message, Settings } from "@lyra/core";
import { useEffect, useState } from "react";

import type { ContextBreakdown, ContextSegmentKey } from "../../../electron/ipc-types.ts";
import { findModel } from "../models/index.ts";
import { Popover, usePopover } from "../../ui/overlay/Popover.tsx";
import { formatTokens } from "../conversation/index.ts";
import { bridge } from "../../services/index.ts";

/**
 * How much of the model's context window this conversation is using.
 *
 * The number matters because it is spent, not rented: everything already said is re-sent with
 * every question, so a long session gets slower and dearer on its own, and at the far end the
 * runtime starts summarising the beginning away. None of that is visible from the transcript,
 * which looks the same at 5% as at 95%.
 *
 * The ring alone answers "am I close?". Opening it answers "why?", which is the question you
 * actually act on — the culprit is nearly always one segment, and which one decides whether you
 * start a new conversation, drop an MCP server, or go and trim a CLAUDE.md nobody has read in
 * months. That detail is not free to compute, so it is fetched on open rather than on render.
 */
export function ContextMeter({
	messages,
	settings,
	modelId,
	sessionId,
}: {
	messages: Message[];
	settings: Settings | null;
	modelId: string | null;
	sessionId: string | null;
}) {
	const popover = usePopover();
	const [detail, setDetail] = useState<ContextBreakdown | null>(null);
	const open = popover.open;

	/*
	 * Re-fetched every time it opens, and dropped when it closes.
	 *
	 * The breakdown reflects the conversation at the moment it was asked for; keeping the last
	 * one around would show a stale total under a ring that had already moved on.
	 */
	useEffect(() => {
		if (!open || !sessionId) return;
		let cancelled = false;
		void bridge.sessions.contextBreakdown(sessionId).then((result) => {
			if (!cancelled) setDetail(result);
		});
		return () => {
			cancelled = true;
			setDetail(null);
		};
	}, [open, sessionId]);

	const model = findModel(settings, modelId);
	if (!model || model.contextWindow <= 0) return null;
	/*
	 * Nothing to report until something has been said.
	 *
	 * A new conversation does carry a system prompt and a tool table, so the reading is not
	 * literally zero — but "1% used" next to an empty transcript is a gauge for a journey that
	 * has not started. It appears with the first message, which is also when it starts moving.
	 */
	if (messages.length === 0) return null;

	// The ring reads from the transcript so it is correct before the detail has been asked for.
	const used = detail?.used ?? measureContext(messages);
	const limit = detail?.limit ?? model.contextWindow;
	const ratio = Math.min(1, used / limit);
	const percent = Math.round(ratio * 100);
	// The runtime starts compacting well before the window is actually full, so "nearly full"
	// has to mean something earlier than 100 to be a useful warning.
	const tight = ratio >= 0.8;

	return (
		<>
			<button
				type="button"
				data-ly-tip={`上下文占用 ${percent}%`}
				aria-label={`上下文占用 ${percent}%`}
				aria-haspopup="dialog"
				aria-expanded={open}
				onClick={popover.toggle}
				/*
				 * No background on hover, unlike its neighbours.
				 *
				 * The ring is a reading, and the filled `bg-card-hover` those buttons use sat at
				 * almost exactly the track's own value — pointing at it made the one thing it is
				 * for, the proportion, impossible to see. Brightening the mark itself says the
				 * same "this is a control" without erasing what it shows.
				 */
				className={`ly-ring-button flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-opacity ${
					open ? "opacity-100" : "opacity-80 hover:opacity-100"
				}`}
			>
				<Ring ratio={ratio} tight={tight} />
			</button>

			{open && (
				// A reading, not a menu — `group` so it is not announced as a list of things to pick.
				<Popover
					anchor={popover.anchor}
					onClose={popover.close}
					placement="top"
					align="center"
					width="panel"
					role="group"
					label="上下文窗口用量"
				>
					<div className="px-3.5 py-3">
						<div className="flex items-baseline justify-between gap-4">
							<span className="text-label text-ink">上下文窗口</span>
							<span className={`text-label tabular-nums ${tight ? "text-danger" : "text-ink-muted"}`}>
								{formatTokens(used)} / {formatTokens(limit)}（{percent}%）
							</span>
						</div>

						<Bar segments={detail?.segments ?? []} limit={limit} used={used} tight={tight} />

						{detail ? (
							<div className="mt-2.5 flex flex-col gap-[3px]">
								{detail.segments.map((segment, index) => (
									<Row
										key={segment.key}
										swatch={shadeOf(index)}
										label={SEGMENT_LABEL[segment.key]}
										tokens={segment.tokens}
										share={segment.tokens / limit}
									/>
								))}
								<Row
									swatch="var(--color-line)"
									label="剩余空间"
									tokens={Math.max(0, limit - used)}
									share={Math.max(0, limit - used) / limit}
								/>
							</div>
						) : (
							// One row per segment we are about to show, so opening does not jump.
							<div className="mt-2.5 flex flex-col gap-[3px]">
								{[0, 1, 2, 3].map((i) => (
									<div key={i} className="ly-pulse h-[17px] rounded bg-card" />
								))}
							</div>
						)}

						{tight && (
							<p className="mt-2.5 border-t border-line-soft pt-2 text-detail leading-relaxed text-ink-faint">
								接近上限，较早的消息会被自动摘要压缩。开新对话可以拿回全部窗口。
							</p>
						)}
					</div>
				</Popover>
			)}
		</>
	);
}

const SEGMENT_LABEL: Record<ContextSegmentKey, string> = {
	messages: "对话消息",
	systemTools: "内置工具",
	mcpTools: "MCP 工具",
	skills: "技能目录",
	systemPrompt: "系统提示词",
	memory: "项目指令",
};

/**
 * One shade per segment, largest first.
 *
 * Deliberately one hue rather than six. These are parts of a single quantity, and six colours
 * would read as six unrelated things — the ordering already carries which is which, and the
 * legend below names them.
 */
function shadeOf(index: number): string {
	const opacity = Math.max(0.24, 1 - index * 0.16);
	return `color-mix(in srgb, var(--color-accent) ${Math.round(opacity * 100)}%, transparent)`;
}

function Bar({
	segments,
	limit,
	used,
	tight,
}: {
	segments: ContextBreakdown["segments"];
	limit: number;
	used: number;
	tight: boolean;
}) {
	return (
		<div className="mt-2 flex h-[5px] overflow-hidden rounded-full bg-line">
			{segments.length === 0 ? (
				// Before the detail arrives the bar still has to show the total it already knows.
				<div
					className={`h-full ${tight ? "bg-danger" : "bg-accent"}`}
					style={{ width: `${Math.max(1, (used / limit) * 100)}%` }}
				/>
			) : (
				segments.map((segment, index) => (
					<div
						key={segment.key}
						style={{
							width: `${(segment.tokens / limit) * 100}%`,
							background: tight ? "var(--color-danger)" : shadeOf(index),
						}}
						className="h-full"
					/>
				))
			)}
		</div>
	);
}

function Row({ swatch, label, tokens, share }: { swatch: string; label: string; tokens: number; share: number }) {
	return (
		<div className="flex items-center gap-2 text-detail">
			<span className="h-[8px] w-[8px] shrink-0 rounded-[2px]" style={{ background: swatch }} />
			<span className="min-w-0 flex-1 truncate text-ink-muted">{label}</span>
			<span className="shrink-0 tabular-nums text-ink-muted">{formatTokens(tokens)}</span>
			<span className="w-[44px] shrink-0 text-right tabular-nums text-ink-faint">{(share * 100).toFixed(1)}%</span>
		</div>
	);
}

/**
 * Same construction as the working spinner — r=9 on a 24 viewBox, 3.4 stroke — so the two marks
 * read as one family. Rotated a quarter turn because a gauge that does not start at twelve
 * o'clock is a gauge nobody can read at a glance.
 */
function Ring({ ratio, tight }: { ratio: number; tight: boolean }) {
	const circumference = 2 * Math.PI * 9;
	return (
		<svg width={14} height={14} viewBox="0 0 24 24" aria-hidden className="shrink-0">
			{/*
			 * A heavier track than the spinner's, which can afford to be faint because it moves.
			 * This one is still, and at a low reading the arc is only a few pixels — with a track
			 * as pale as the spinner's the whole control disappeared into the composer.
			 */}
			<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="3.4" className="text-line" />
			<circle
				cx="12"
				cy="12"
				r="9"
				fill="none"
				stroke="currentColor"
				strokeWidth="3.4"
				strokeLinecap="round"
				strokeDasharray={`${circumference * ratio} ${circumference}`}
				transform="rotate(-90 12 12)"
				className={tight ? "text-danger" : "text-accent"}
			/>
		</svg>
	);
}

/**
 * The ring's own reading, from what the renderer already has.
 *
 * Deliberately duplicates what the main process computes properly, because the ring is on screen
 * all the time and the real breakdown costs a prompt rebuild. It agrees with the detailed figure
 * on the part that dominates — the conversation — and understates the fixed overhead, which is
 * why opening the card can nudge the number up slightly.
 */
function measureContext(messages: Message[]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message.role !== "assistant" || message.stopReason === "pending") continue;
		const { input, cacheRead, output } = message.usage;
		const measured = input + cacheRead + output;
		if (measured <= 0) break;
		return measured + estimateTokens(messages.slice(i + 1));
	}
	return estimateTokens(messages);
}
