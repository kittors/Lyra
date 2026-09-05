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

import type { RuleEntry } from "@lyra/core";
import { FileText, TriangleAlert, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useApp } from "../../store/index.ts";
import { SkeletonList, useSlowLoad } from "../../ui/primitives/Skeleton.tsx";
import { Badge, Card, EmptyHint, ListRow, Toggle } from "./controls.tsx";
import { bridge } from "../../services/index.ts";
import { RuleTryPanel } from "./RuleTryPanel.tsx";
import { DiffView } from "../git/index.ts";
import { ShadowedList } from "./ShadowedList.tsx";
import { ProjectOverrideNotice } from "./ProjectOverrideNotice.tsx";

/** 三种规则，三种代价。 */
const BUCKETS = {
	always: { label: "常驻", detail: "每一轮都在提示词里", icon: FileText },
	book: { label: "规则库", detail: "只占一行名字，模型按需读正文", icon: FileText },
	stream: { label: "流规则", detail: "平时零成本，命中才注入", icon: Zap },
} as const;

export function RulesSettings({ filter = "" }: { filter?: string }) {
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
	const slow = useSlowLoad(data === null);

	const reload = useCallback(() => {
		void bridge.rules.list(workspace?.path ?? "").then(setData);
	}, [workspace?.path]);

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
	const diagnostics = data?.diagnostics ?? [];
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
							{diagnostics.length} 条规则没能读进来
						</div>
						{diagnostics.map((diagnostic) => (
							<div key={diagnostic.path} className="py-0.5 text-detail text-accent/85">
								<span className="font-mono">{diagnostic.path}</span> — {diagnostic.message}
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

			{(data?.foreignUserSources.length ?? 0) > 0 && (
				<Card className="mb-6">
					<div className="px-4 pt-3 pb-1">
						<div className="text-label text-ink-muted">也读别家工具的个人规则</div>
						<p className="mt-0.5 text-detail text-ink-faint">
							项目里的那些一直都读。这里勾的是你自己主目录下的那份——它会跟着你进每一个仓库。
						</p>
					</div>
					{data?.foreignUserSources.map((source) => (
						<ListRow
							key={source.id}
							title={source.label}
							detail={source.describe}
							control={
								<Toggle
									checked={enabled.has(source.id)}
									onChange={(on) => {
										void bridge.rules.setForeignUser(source.id, on).then(reload);
									}}
								/>
							}
						/>
					))}
				</Card>
			)}

			{/*
			 * Above the list rather than inside an editor, because there is no editor: rules are
			 * files, and the page sends you to the file. What the file cannot do is meet the
			 * conversation — this can, and it is the one check the plan says people need most.
			 */}
			<RuleTryPanel patterns={tryPatterns} onChange={setTryPatterns} messages={messages} />

			{slow ? (
				<SkeletonList count={5} label="正在读取规则" />
			) : live.length === 0 ? (
				<EmptyHint>
					这个项目还没有规则。
					<br />
					在 <span className="font-mono">.lyra/rules/</span> 里新建一个 <span className="font-mono">.md</span>，
					写上 frontmatter 就是一条——有 <span className="font-mono">condition</span> 的是流规则，
					有 <span className="font-mono">description</span> 的进规则库。
				</EmptyHint>
			) : (
				<Card>
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
										(rule.description ?? bucket.detail)
									)
								}
								actions={
									/* 路径在提示里，不在行上：它很长，而且只在你打算去改它的时候才需要。 */
									<span className="flex items-center gap-1.5" data-ly-tip={rule.path}>
										{rule.condition && rule.condition.length > 0 && (
											<button
												type="button"
												data-rule-try-fill={rule.name}
												onClick={() => setTryPatterns([...(rule.condition ?? [])])}
												className="text-caption text-ink-faint underline-offset-2 transition-colors duration-[var(--ly-t-quick)] hover:text-ink hover:underline"
											>
												试一下
											</button>
										)}
										<Badge tone="muted">{bucket.label}</Badge>
										<Badge tone="muted">{rule.sourceLabel}</Badge>
									</span>
								}
								control={<Toggle checked={!rule.disabled} onChange={(on) => void toggle(rule, on)} />}
							/>
						);
					})}
				</Card>
			)}
		</div>
	);
}
