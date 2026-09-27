/**
 * 这个项目现在有哪些规则——以及为什么你写的那条没生效。
 *
 * 在这一页之前，规则是这套系统里最看不见的东西：它们从六个地方读进来（项目、个人、Cursor、
 * Windsurf、Cline、Copilot，再加内置），按同名覆盖，然后在提示词里、或者在模型说到一半的时候
 * 起作用。而屏幕上没有任何地方说得出「现在有几条」，更没有地方能关掉一条。
 *
 * `disabledRules` 这个设置字段一直有代码在读——`groupRules` 会拿它过滤——**而没有任何界面在
 * 写它**。也就是说，这个功能只有手改 JSON 的人用得上。
 *
 * 三件这一页必须说清楚的事：
 *
 *   **它花不花上下文。** 常驻规则每一轮都在提示词里；规则库只占一行名字；流规则平时零成本，
 *   命中才注入。这是三种完全不同的代价，而它们在磁盘上长得一模一样。
 *
 *   **触发条件长什么样。** 计划里点名说了：写错的正则是这套系统最大的挫败来源。一条不触发的
 *   规则跟一条不存在的规则在界面上没有区别——除非把那个正则本身摆出来。
 *
 *   **谁被谁盖掉了。** 被同名文件盖掉的规则从列表里消失，跟从没写过一模一样，而看的人通常
 *   正是那个输了的副本的作者。
 */

import { useI18n } from "../../i18n/index.ts";
import type { MessageKey } from "../../i18n/messages/index.ts";
import type { RuleEntry } from "@lyra/core";
import { FileText, Play, Scale, TriangleAlert, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../store/index.ts";
import { SkeletonList, useSlowLoad } from "../../ui/primitives/Skeleton.tsx";
import { Badge, Card, EmptyHint, ListRow, Toggle } from "./controls.tsx";
import { bridge } from "../../services/index.ts";
import { RuleTryPanel } from "./RuleTryPanel.tsx";
import { Disclosure } from "../../ui/layout/Disclosure.tsx";
import { DiffView } from "../git/index.ts";
import { ShadowedList } from "./ShadowedList.tsx";
import { ProjectOverrideNotice } from "./ProjectOverrideNotice.tsx";
import { RowDeleteButton } from "../../ui/primitives/RowDeleteButton.tsx";
import { useDefinitionRemoval } from "./useDefinitionRemoval.tsx";

/** 三种规则，三种代价。名字和说明是 key——这张表在模块加载时就建好，语言那时还没定。 */
const BUCKETS = {
	always: { label: "rules.always", detail: "rules.alwaysDetail", icon: FileText },
	book: { label: "rules.library", detail: "rules.libraryDetail", icon: FileText },
	stream: { label: "rules.flow", detail: "rules.flowDetail", icon: Zap },
} as const satisfies Record<string, { label: MessageKey; detail: MessageKey; icon: typeof FileText }>;

export function RulesSettings({ filter = "" }: { filter?: string }) {
	const { t } = useI18n();
	const workspace = useApp((s) => s.workspace);
	const messages = useApp((s) => s.messages);
	const [data, setData] = useState<Awaited<ReturnType<typeof bridge.rules.list>> | null>(null);
	/*
	 * What the try-panel is holding: one pattern per input.
	 *
	 * Starts as a single empty box for a pattern that has not been written yet; a stream rule's
	 * 「试一下」 replaces it with that rule's conditions, one box each, because the file's
	 * `condition` is a list and the monitor fires on whichever matches first.
	 */
	const [tryPatterns, setTryPatterns] = useState<string[]>([""]);
	const [tryOpen, setTryOpen] = useState(false);
	const slow = useSlowLoad(data === null);

	const reload = useCallback(() => {
		void bridge.rules.list(workspace?.path ?? "").then(setData);
	}, [workspace?.path]);
	const removal = useDefinitionRemoval("rule", workspace?.path ?? "", reload);

	useEffect(reload, [reload]);

	const needle = filter.trim().toLowerCase();
	const all = (data?.rules ?? []).filter(
		(rule) => !needle || `${rule.name} ${rule.description ?? ""} ${rule.sourceLabel}`.toLowerCase().includes(needle),
	);
	/*
	 * 被盖掉的单列一段，而不是混在列表里灰掉。
	 *
	 * 它们不是「关掉的规则」——那是一个可以打开的状态。被盖掉的那条永远不会生效，除非改名或者
	 * 删掉盖它的那个文件，而那是一句话就能说清、混在列表里却说不清的事。
	 */
	const live = all.filter((rule) => !rule.shadowedBy);
	const shadowed = all.filter((rule) => rule.shadowedBy);
	/*
	 * Errors and warnings apart, each counted by file. Only an error is a file that could not be
	 * read; a warning is a description cut short, a condition or scope entry dropped, a rule that
	 * came to nothing (its line says which), and counted as unreadable it sent people looking for a
	 * broken file. One file can have several lines, and both headers say how many rules.
	 */
	const diagnostics = (data?.diagnostics ?? []).filter((diagnostic) => diagnostic.severity !== "warning");
	const warnings = (data?.diagnostics ?? []).filter((diagnostic) => diagnostic.severity === "warning");
	const unreadable = new Set(diagnostics.map((diagnostic) => diagnostic.path)).size;
	const warned = new Set(warnings.map((warning) => warning.path)).size;
	const enabled = new Set(data?.enabledForeignUserRules ?? []);

	const toggle = async (rule: RuleEntry, on: boolean) => {
		await bridge.rules.setDisabled(rule.name, !on);
		reload();
	};

	return (
		<div>
			<ProjectOverrideNotice keys={["disabledRules", "enabledForeignUserRules", "capabilityPreferences"]} />
			{diagnostics.length > 0 && (
				<Card className="mb-6 border-accent/35 bg-accent/6">
					<div className="px-4 py-3">
						<div className="mb-2 flex items-center gap-1.5 text-label text-accent">
							<TriangleAlert size={13} strokeWidth={1.9} />
							{t("rules.unreadable", { n: unreadable })}
						</div>
						{/* By position: a path repeats when one file has two lines, and these rows hold no state. */}
						{diagnostics.map((diagnostic, index) => (
							<div key={index} className="py-0.5 text-detail text-accent/85">
								<span className="font-mono">{diagnostic.path}</span> — {diagnostic.message}
							</div>
						))}
					</div>
				</Card>
			)}

			{warnings.length > 0 && (
				<Card className="mb-6">
					<div className="px-4 py-3">
						<div className="mb-2 flex items-center gap-1.5 text-label text-ink-muted">
							<TriangleAlert size={13} strokeWidth={1.9} />
							{t("rules.warnings", { n: warned })}
						</div>
						{warnings.map((warning, index) => (
							<div key={index} className="py-0.5 text-detail text-ink-faint">
								<span className="font-mono">{warning.path}</span> — {warning.message}
							</div>
						))}
					</div>
				</Card>
			)}

			<ShadowedList
				kind="rule"
				entries={shadowed.map((rule) => ({ name: rule.name, path: rule.path, by: rule.shadowedBy?.path ?? "", byLabel: rule.shadowedBy?.label ?? "" }))}
				diff={(winner, loser) => bridge.capabilities.diff("rule", winner, loser)}
				prefer={(name, path) => bridge.capabilities.prefer("rule", name, path)}
				onChanged={reload}
				renderDiff={(hunks, path) => <DiffView hunks={hunks} path={path} />}
			/>

			{slow ? (
				<SkeletonList count={5} label={t("rules.reading")} />
			) : data === null ? null : live.length === 0 ? (
				<EmptyHint icon={Scale}>{t(needle ? "rules.noMatch" : "rules.empty")}</EmptyHint>
			) : (
				<Card className="px-2 py-1">
					{live.map((rule) => {
						const bucket = BUCKETS[rule.bucket];
						return (
							<ListRow
								key={`${rule.name}-${rule.path}`}
								icon={<bucket.icon size={15} strokeWidth={1.7} className={rule.disabled ? "text-ink-faint" : "text-ink-muted"} />}
								title={rule.name}
								/*
								 * 流规则那一行显示的是**它的正则**，不是它的描述。
								 *
								 * 这一行只有一行的位置，而对一条流规则来说「它什么时候触发」就是关于它
								 * 最要紧的事。计划里点名说了：写错的正则是这套系统最大的挫败来源——
								 * 而一条不触发的规则跟一条不存在的规则在界面上没有区别，除非把那个正则
								 * 本身摆出来。等宽、原样，包括内联标志。
								 */
								detail={
									rule.condition && rule.condition.length > 0 ? (
										<span className="font-mono">{rule.condition.join("   ")}</span>
									) : (
										(rule.description ?? t(bucket.detail))
									)
								}
								actions={
									/*
									 * 路径在提示里，不在行上：它很长，而且只在你打算去改它的时候才需要。
									 *
									 * 来源一直在，其余等悬停：「常驻 / 流规则」行首的图标已经说了（文档 / 闪电），
									 * 试一下的 ▶ 只对写条件的人有用——五行各挂两枚徽章一颗按钮，读起来比规则本身还多。
									 */
									<span className="flex items-center gap-2" data-ly-tip={rule.path}>
										<span className="flex items-center gap-1.5 opacity-0 transition-opacity duration-[var(--ly-t-quick)] group-hover/row:opacity-100 focus-within:opacity-100">
											{rule.condition && rule.condition.length > 0 && (
												<button
													type="button"
													data-rule-try-fill={rule.name}
													onClick={() => {
														setTryPatterns([...(rule.condition ?? [])]);
														setTryOpen(true);
													}}
													className="flex h-[22px] w-[22px] items-center justify-center rounded-md text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink"
													data-ly-tip={t("rules.tryIt")}
													aria-label={t("rules.tryIt")}
												>
													<Play size={12} strokeWidth={1.9} />
												</button>
											)}
											<Badge tone="muted">{t(bucket.label)}</Badge>
										</span>
										<span className="text-detail whitespace-nowrap text-ink-faint">{rule.sourceLabel}</span>
									</span>
								}
								/*
								 * The delete slot is kept even where there is nothing to delete, so every toggle in the
								 * list lines up — built-in rules used to push theirs half a button further right.
								 */
								control={<div className="flex items-center gap-2">
									<Toggle checked={!rule.disabled} onChange={(on) => void toggle(rule, on)} />
									{rule.path.startsWith("builtin:") ? (
										<span aria-hidden className="w-[26px] shrink-0" />
									) : (
										<RowDeleteButton label={t("rules.deleteOne", { name: rule.name })} pending={removal.pending.has(rule.path)} onClick={() => removal.ask(rule.name, rule.path)} />
									)}
								</div>}
							/>
						);
					})}
				</Card>
			)}

			{(data?.foreignUserSources.length ?? 0) > 0 && (
				<Card className="mt-6">
					<div className="px-4 pt-3 pb-1">
						<div className="text-label text-ink-muted">{t("rules.foreignPersonal")}</div>
						<p className="mt-0.5 text-detail text-ink-faint">
							{t("rules.foreignPersonalDetail")}
						</p>
					</div>
					{/* Inset by the rows' own padding, so their text starts where the heading's does. */}
					<div className="px-2 pb-1">
						{data?.foreignUserSources.map((source) => (
							<ListRow
								key={source.id}
								title={source.label}
								detail={source.describe}
								control={
									/* The same trailing slot as the rules above, so the two cards' switches line up. */
									<div className="flex items-center gap-2">
										<Toggle
											checked={enabled.has(source.id)}
											onChange={(on) => {
												void bridge.rules.setForeignUser(source.id, on).then(reload);
											}}
										/>
										<span aria-hidden className="w-[26px] shrink-0" />
									</div>
								}
							/>
						))}
					</div>
				</Card>
			)}

			{/*
			 * The regex tester, folded away until it is wanted: it is a tool for someone writing a
			 * condition, not something everyone opening the page needs a paragraph about. The ▶ on a
			 * rule with conditions opens it, filled in.
			 */}
			<div className="mt-6">
				<Disclosure title={t("ruleTry.title")} open={tryOpen} onToggle={() => setTryOpen((was) => !was)}>
					<RuleTryPanel patterns={tryPatterns} onChange={setTryPatterns} messages={messages} titled={false} />
				</Disclosure>
			</div>
			{removal.element}
		</div>
	);
}
