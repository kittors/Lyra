import { useI18n } from "../../i18n/index.ts";
import type { MessageKey } from "../../i18n/messages/index.ts";
import type { Message, Settings } from "@lyra/core";
import { useEffect, useState } from "react";

import type { ContextBreakdown, ContextSegmentKey } from "../../../electron/ipc-types.ts";
import { useApp } from "../../store/index.ts";
import { findModel } from "../models/index.ts";
import { Popover, usePopover } from "../../ui/overlay/Popover.tsx";
import { formatTokens } from "../conversation/index.ts";
import { bridge } from "../../services/index.ts";
import { ContextMemoryFiles } from "./ContextMemoryFiles.tsx";

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
 * months. Rebuild at turn boundaries or while inspecting, never on every streamed chunk.
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
	const { t } = useI18n();
	const popover = usePopover();
	const [snapshot, setSnapshot] = useState<{ sessionId: string; modelId: string | null; detail: ContextBreakdown | null; error?: string } | null>(null);
	const current = snapshot?.sessionId === sessionId && snapshot.modelId === modelId ? snapshot : null;
	const detail = current?.detail;
	const hasMessages = messages.length > 0;
	const compacted = useApp((s) => s.compactions.length);
	const running = useApp((s) => s.running);
	const open = popover.open;
	const revision = open || !running ? messages.length : 0;

	// Refresh at conversation boundaries; hidden meters do not rebuild prompts for each tool message.
	useEffect(() => {
		if (!sessionId || !hasMessages) return;
		let cancelled = false;
		void bridge.sessions.contextBreakdown(sessionId).then((result) => {
			if (!cancelled) setSnapshot({ sessionId, modelId, detail: result, error: result ? undefined : t("context.unavailable") });
		}, (error: unknown) => {
			if (!cancelled) setSnapshot({ sessionId, modelId, detail: null, error: error instanceof Error ? error.message : String(error) });
		});
		return () => {
			cancelled = true;
		};
	}, [open, sessionId, modelId, hasMessages, revision, compacted, running, settings, t]);

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

	// Both readings use the model history, which can differ from the visible transcript.
	const used = detail?.used ?? 0;
	const limit = detail?.limit ?? model.contextWindow;
	const ratio = Math.min(1, used / limit);
	const percent = Math.round(ratio * 100);
	// The runtime starts compacting well before the window is actually full, so "nearly full"
	// has to mean something earlier than 100 to be a useful warning.
	const tight = ratio >= 0.8;
	/* One sentence for both the tooltip and the label — they were two copies of the same ternary. */
	const reading = detail
		? t(detail.measured ? "context.usedPercent" : "context.usedPercentEstimated", { percent })
		: (current?.error ?? t("context.reading"));

	return (
		<>
			<button
				type="button"
				data-ly-tip={reading}
				aria-label={reading}
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
				className={`ly-composer-control ly-ring-button flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-opacity ${
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
					label={t("context.windowUsage")}
				>
					<div className="px-3.5 py-3">
						<div className="flex items-baseline justify-between gap-4">
							<span className="text-label text-ink">{t("context.window")}</span>
							<span className={`text-label tabular-nums ${tight ? "text-danger" : "text-ink-muted"}`}>
								{detail
									? `${formatTokens(used)} / ${formatTokens(limit)}（${percent}%）`
									: current?.error
										? t("context.unreadable")
										: t("context.loading")}
							</span>
						</div>

						<Bar segments={detail?.segments ?? []} limit={limit} used={used} tight={tight} />

						{tight && (
							<p className="mt-2.5 border-t border-line-soft pt-2 text-detail leading-relaxed text-ink-faint">
								{t("context.nearLimit")}
							</p>
						)}

						{detail ? (
							<div className="mt-2.5 flex flex-col gap-[3px]">
								{detail.segments.filter((segment) => segment.key !== "memory" && segment.key !== "projectMemory").map((segment) => <Row key={segment.key} swatch={shadeOf(detail.segments.indexOf(segment))} label={t(SEGMENT_LABEL[segment.key])} tokens={segment.tokens} share={segment.tokens / limit} />)}
								<Row
									swatch="var(--color-line)"
									label={t("context.remaining")}
									tokens={Math.max(0, limit - used)}
									share={Math.max(0, limit - used) / limit}
								/>
								{!detail.measured && <p className="text-micro text-ink-faint">{t("context.estimateNote")}</p>}
								<ContextMemoryFiles detail={detail} onOpen={popover.close} />

							</div>
						) : current?.error ? (
							<p role="status" className="mt-3 break-words text-detail text-danger">{current.error}</p>
						) : (
							// One row per segment we are about to show, so opening does not jump.
							<div className="mt-2.5 flex flex-col gap-[3px]">
								{[0, 1, 2, 3].map((i) => (
									<div key={i} className="ly-pulse h-[17px] rounded bg-card" />
								))}
							</div>
						)}

					</div>
				</Popover>
			)}
		</>
	);
}

/** What each slice of the window is called. Keys, looked up per render — see `translate`. */
const SEGMENT_LABEL: Record<ContextSegmentKey, MessageKey> = {
	messages: "context.messages",
	systemTools: "context.builtinTools",
	mcpTools: "context.mcpTools",
	skills: "context.skillCatalog",
	systemPrompt: "context.systemPrompt",
	memory: "context.projectInstructions",
	projectMemory: "context.projectMemory",
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

function Row({
	swatch,
	label,
	tokens,
	share,
}: {
	swatch: string;
	label: string;
	tokens: number;
	share: number;
}) {
	return (
		<div className="flex items-center gap-2 rounded px-1 py-0.5 text-detail">
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
