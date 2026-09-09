/**
 * Two faults, two rules, both on screen.
 *
 * They were behind a dropdown labelled 「重试故障类型」 that swapped one set of fields for the
 * other, which is a way of saying "pick a fault, then configure the retry" — and that is not what
 * this is. A dropped connection and a rate-limited relay are different events with different
 * answers: the first is worth waiting out indefinitely because the network usually comes back,
 * the second is worth ten tries because a server that is still saying 503 after a minute is having
 * a longer day than this turn can wait for. With only one of them ever visible, the difference
 * between the two — the whole point — was something you had to remember rather than read.
 *
 * A row each, folded, with what it currently does written on the right. Closed, the card answers
 * "what happens when a request fails" in two lines; open, it is the four fields that decide it.
 *
 * No save button, either. Every other setting on this page writes as you change it, and this one
 * had a draft, a dirty check and a 「保存重试策略」 that appeared and disappeared — which shifted
 * everything below it by the height of a button. Edits land immediately and reach requests that
 * are already retrying; see `RetryPolicySource` in core.
 */

import { useEffect, useRef, useState } from "react";
// The subpath, not the package root: `@lyra/core` pulls the whole kernel — and `koffi` with it —
// into a renderer that otherwise only ever imports its types.
import { normalizeRetryPolicy, type RetryFailure, type RetryRule } from "@lyra/core/retry-policy";
import type { Settings } from "@lyra/core";
import { Input } from "../../ui/inputs/NativeField.tsx";
import { Disclosure } from "../../ui/layout/Disclosure.tsx";
import { useApp } from "../../store/index.ts";
import { Card, InlineSelect, SectionTitle, Toggle } from "./controls.tsx";
import { translate, useI18n, type MessageKey } from "../../i18n/index.ts";

/*
 * 两种故障，用 key 记着，不是用译好的字记着。
 *
 * 这张表在模块加载时就成型了——那会儿窗口还没说自己是哪种语言，而且之后换语言它也不会重算。
 * 存 key，让每次渲染自己去译，是唯一能跟着语言走的形式。
 */
const FAULTS: { kind: RetryFailure; titleKey: MessageKey; detailKey: MessageKey }[] = [
	{ kind: "network", titleKey: "retry.network", detailKey: "retry.networkDetail" },
	{ kind: "upstream", titleKey: "retry.upstream", detailKey: "retry.upstreamDetail" },
];

const seconds = (ms: number) => Math.round(ms / 1000);

/** What the rule does, in the words someone would use to describe it — the row's right-hand side. */
function summarize(rule: RetryRule): string {
	const count = rule.retries === null ? translate("retry.forever") : rule.retries === 0 ? translate("retry.never") : translate("retry.count", { count: rule.retries });
	if (rule.retries === 0) return count;
	const pace = rule.strategy === "fixed"
		? translate("retry.everyN", { n: seconds(rule.intervalMs) })
		: translate("retry.backoff", { from: seconds(rule.intervalMs), max: seconds(rule.maxIntervalMs) });
	return `${count} · ${pace}`;
}

export function RetrySettings({ settings }: { settings: Settings }) {
	const { t } = useI18n();
	const policy = normalizeRetryPolicy(settings.retryPolicy, settings.retryAttempts);
	const [open, setOpen] = useState<RetryFailure | null>(null);

	/*
	 * Read at write time, not at render time.
	 *
	 * Two rules share one settings object, and a debounced field can fire its commit a moment
	 * after the other rule was changed. Merging into the `settings` this render closed over would
	 * quietly undo that change; the store's current value is the one that has both.
	 */
	const write = (kind: RetryFailure, patch: Partial<RetryRule>) => {
		const current = useApp.getState().settings;
		if (!current) return;
		const base = normalizeRetryPolicy(current.retryPolicy, current.retryAttempts);
		void useApp.getState().saveSettings({ ...current, retryPolicy: { ...base, [kind]: { ...base[kind], ...patch } } });
	};

	return (
		<div data-retry-settings>
			<SectionTitle>{t("retry.title")}</SectionTitle>
			{/* Said once, above both rules, rather than twice inside them. */}
			<p className="-mt-1 mb-3 max-w-[62ch] text-label leading-relaxed text-ink-muted">
				网络中断、限流或服务暂时不可用时自动重试，次数不含首次请求。改动立即生效，正在重试的请求从下一次等待起就用新值；
				已执行的工具不会重做，点击停止可立即取消等待。
			</p>
			<Card className="mb-9 px-4">
				{FAULTS.map((fault) => {
					const rule = policy[fault.kind];
					const patch = (next: Partial<RetryRule>) => write(fault.kind, next);
					const linear = rule.strategy === "linear";
					return (
						<Disclosure
							key={fault.kind}
							open={open === fault.kind}
							onToggle={() => setOpen((was) => (was === fault.kind ? null : fault.kind))}
							title={
								<span className="block font-normal">
									<span className="block text-body text-ink">{t(fault.titleKey)}</span>
									<span className="mt-0.5 block text-label text-ink-faint">{t(fault.detailKey)}</span>
								</span>
							}
							trailing={
								<span data-retry-summary={fault.kind} className="shrink-0 pl-3 text-label text-ink-muted tabular-nums">
									{summarize(rule)}
								</span>
							}
						>
							{/* Indented to the title rather than to the chevron, so the fold reads as one block. */}
							<div className="flex flex-wrap items-start gap-x-6 gap-y-3 pb-1 pl-5">
								<NumberField
									label={t("retry.times")}
									ariaLabel={t("retry.timesAria", { fault: t(fault.titleKey) })}
									value={rule.retries}
									min={0}
									max={1_000_000}
									unit={t("common.times")}
									onCommit={(retries) => patch({ retries })}
								>
									{/* Beside the number it replaces, because it is the same decision. */}
									<Toggle
										ariaLabel={t("retry.unlimitedAria", { fault: t(fault.titleKey) })}
										checked={rule.retries === null}
										onChange={(on) => patch({ retries: on ? null : 10 })}
									/>
									<span className="text-label text-ink-muted">{t("common.unlimited")}</span>
								</NumberField>
								{rule.retries !== 0 && (
									<>
										<Labeled label={t("retry.spacing")}>
											<InlineSelect
												ariaLabel={t("retry.spacingAria", { fault: t(fault.titleKey) })}
												value={rule.strategy}
												options={[
													{ value: "fixed", label: t("retry.fixed") },
													{ value: "linear", label: t("retry.growing") },
												]}
												onChange={(strategy) => patch({ strategy })}
											/>
										</Labeled>
										<NumberField
											label={linear ? t("retry.firstWait") : t("retry.interval")}
											ariaLabel={t("retry.intervalAria", { fault: t(fault.titleKey) })}
											value={seconds(rule.intervalMs)}
											min={1}
											max={3600}
											unit={t("common.seconds")}
											onCommit={(value) => patch({ intervalMs: value * 1000, maxIntervalMs: Math.max(rule.maxIntervalMs, value * 1000) })}
										/>
										{linear && (
											<NumberField
												label={t("retry.maxWait")}
												ariaLabel={t("retry.maxWaitAria", { fault: t(fault.titleKey) })}
												value={seconds(rule.maxIntervalMs)}
												min={seconds(rule.intervalMs)}
												max={3600}
												unit={t("common.seconds")}
												onCommit={(value) => patch({ maxIntervalMs: value * 1000 })}
											/>
										)}
									</>
								)}
							</div>
							<p className="pl-5 text-detail leading-relaxed text-ink-faint">
								{rule.retries === 0
									? t("retry.failFast")
									: linear
										? t("retry.growingDetail", { a: seconds(rule.intervalMs), b: seconds(rule.intervalMs) * 2, c: seconds(rule.intervalMs) * 3, max: seconds(rule.maxIntervalMs) })
										: t("retry.fixedDetail")}
							</p>
						</Disclosure>
					);
				})}
			</Card>
		</div>
	);
}

/** A field's label and its control, stacked, so a row of them shares one baseline. */
function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="flex flex-col gap-1.5">
			<span className="text-detail text-ink-muted">{label}</span>
			<div className="flex h-[30px] items-center">{children}</div>
		</div>
	);
}

/**
 * A number that writes itself out as you stop typing.
 *
 * Committing on every keystroke would save `1` on the way to `10`, and with the policy now live
 * that is a limit a waiting request would briefly obey. Committing only on blur would lose the
 * edit of anyone who changes a value and closes the window. So: the typed text is local while the
 * field has focus, and lands a third of a second after the last key — or immediately on blur,
 * where the field goes back to showing the stored value, normalised.
 */
function NumberField({
	label,
	ariaLabel,
	value,
	min,
	max,
	unit,
	onCommit,
	children,
}: {
	label: string;
	ariaLabel: string;
	/** `null` is the unlimited rule, which has no number to show. */
	value: number | null;
	min: number;
	max: number;
	unit: string;
	onCommit: (value: number) => void;
	/** Anything that belongs to the same decision as this number — the 不限 switch. */
	children?: React.ReactNode;
}) {
	const [typed, setTyped] = useState<string | null>(null);
	const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	useEffect(() => () => clearTimeout(timer.current), []);

	const commit = (raw: string, now: boolean) => {
		clearTimeout(timer.current);
		const parsed = Number(raw);
		if (raw.trim() === "" || !Number.isFinite(parsed)) return;
		const clamped = Math.min(max, Math.max(min, Math.round(parsed)));
		if (now) onCommit(clamped);
		else timer.current = setTimeout(() => onCommit(clamped), 300);
	};

	return (
		<Labeled label={label}>
			<div className="flex items-center gap-2">
				<Input
					type="number"
					aria-label={ariaLabel}
					min={min}
					max={max}
					step={1}
					disabled={value === null}
					value={typed ?? (value === null ? "" : String(value))}
					onChange={(event) => {
						setTyped(event.target.value);
						commit(event.target.value, false);
					}}
					onBlur={(event) => {
						commit(event.target.value, true);
						setTyped(null);
					}}
					className="h-[30px] w-[72px] rounded-lg border border-line bg-input px-2 text-center text-label text-ink tabular-nums disabled:opacity-40"
				/>
				<span className={`text-label text-ink-muted ${value === null ? "opacity-40" : ""}`}>{unit}</span>
				{children}
			</div>
		</Labeled>
	);
}
