import type { Skill, SkillCandidate } from "@lyra/core";
import { Sparkles, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { RowDeleteButton } from "../../ui/primitives/RowDeleteButton.tsx";
import { useDefinitionRemoval } from "./useDefinitionRemoval.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { SkillMark } from "./PluginIcon.tsx";
import { useApp } from "../../store/index.ts";
import { SkeletonList, useSlowLoad } from "../../ui/primitives/Skeleton.tsx";
import { Badge, Card, EmptyHint, ListRow } from "./controls.tsx";
import { DiffView } from "../git/index.ts";
import { ShadowedList } from "./ShadowedList.tsx";
import { bridge } from "../../services/index.ts";
import { translate, useI18n } from "../../i18n/index.ts";

/**
 * Where a skill came from, in one word.
 *
 * A plugin's name beats the directory it happens to sit in: `~/.lyra/skills` is where a collection
 * flattens its skills too, so t("common.personal") there would be false in the way that matters — it would say
 * "you wrote this" about something that arrives and leaves with the plugin.
 */
function originOf(skill: Skill): string {
	if (skill.pluginId) return skill.pluginId;
	if (skill.source === "workspace") return translate("common.project");
	if (skill.source === "builtin") return translate("common.builtin");
	return translate("common.personal");
}

export function SkillsSettings({ filter = "" }: { filter?: string }) {
	const { t } = useI18n();
	const workspace = useApp((s) => s.workspace);
	// A plugin carries skills, so installing one moves this list without touching this page.
	const extensionsNonce = useApp((s) => s.extensionsNonce);
	const [scan, setScan] = useState<Awaited<ReturnType<typeof bridge.plugins.list>> | null>(null);
	/** Only when the scan is slow enough to notice; below that the list simply appears. */


	/*
	 * 等着人点头的那些，从会话里总结出来的。
	 *
	 * 放在技能列表最上面而不是混进去：它们**还不生效**，而下面每一行都是正在生效的东西。
	 * 一个自动生成的技能会改变这个 agent 以后的行为，而看到它生效的人多半不记得自己批准过
	 * 什么——所以这一段的整个存在意义，就是让那次批准真的发生过。
	 */
	const [pending, setPending] = useState<SkillCandidate[] | null>(null);
	const reloadPending = useCallback(() => {
		if (!workspace?.path) { setPending([]); return; }
		void bridge.rules.pendingSkills(workspace.path).then(setPending).catch(() => {});
	}, [workspace?.path]);

	const slow = useSlowLoad(scan === null || pending === null);

	// Scanned directly so the page works before any session exists.
	const reloadScan = useCallback(() => {
		void bridge.plugins.list(workspace?.path ?? "").then(setScan);
	}, [workspace?.path]);
	const removal = useDefinitionRemoval("skill", workspace?.path ?? "", reloadScan);
	useEffect(() => {
		reloadScan();
		reloadPending();
	}, [reloadScan, extensionsNonce, reloadPending]);

	// Name or description, because you remember a skill by either.
	const needle = filter.trim().toLowerCase();
	const skills = (scan?.skills ?? []).filter(
		(s) => !needle || `${s.name} ${s.description}`.toLowerCase().includes(needle),
	);
	/*
	 * 错误和警告分开数。「N 个技能未能加载」数的是没加载的；描述太短的那些加载了，混进去
	 * 那句话就说错了——而且会让人去找一个不存在的加载失败。
	 */
	const diagnostics = (scan?.skillDiagnostics ?? []).filter((d) => d.severity !== "warning");
	const warnings = (scan?.skillDiagnostics ?? []).filter((d) => d.severity === "warning");
	const shadowed = scan?.shadowedSkills ?? [];

	const decide = async (name: string, keep: boolean) => {
		const cwd = workspace?.path;
		if (!cwd) return;
		if (keep) await bridge.rules.approveSkill(cwd, name);
		else await bridge.rules.rejectSkill(cwd, name);
		reloadPending();
		useApp.getState().bumpExtensions();
	};

	return (
		<div>
			{/* The two directory buttons that used to sit here are in the page's ⋯ now — three tabs
			    each opening with its own pair of them was a header that said nothing about the tab. */}

			{pending && pending.length > 0 && (
				<Card className="mb-6 border-accent/35 bg-accent/6">
					<div className="px-4 pt-3 pb-1">
						<div className="flex items-center gap-1.5 text-label text-accent">
							<Sparkles size={13} strokeWidth={1.9} />
							从最近的会话里总结出 {pending?.length} 个技能，等你决定
						</div>
						<p className="mt-0.5 text-detail text-ink-muted">
							这些还没有生效。启用之后，它们会像你自己写的技能一样被用上。
						</p>
					</div>
					{pending.map((candidate) => (
						<div key={candidate.name} className="px-4 py-3">
							<div className="ly-scroll"><ScrollText text={candidate.name} className="font-mono text-body" /></div>
							<p className="mt-0.5 text-detail text-ink-muted">{candidate.description}</p>
							<p className="mt-1 text-caption text-ink-faint">
								{candidate.scope === "portable" ? t("skills.reusable") : t("skills.candidates")}
								{candidate.sourceSessions && t("skills.fromSessions", { n: candidate.sourceSessions.length })}
							</p>
							{/* 正文全文摆出来。批准一段自己没读过的指令，跟没有这个确认步骤是一回事。 */}
							<Scroller className="ly-rule-excerpt mt-2 max-h-52 rounded" contentClassName="p-2">
							<pre className="whitespace-pre-wrap break-words font-mono text-detail leading-relaxed">
								{candidate.body}
							</pre>
							</Scroller>
							<div className="mt-2 flex items-center gap-2">
								<button
									type="button"
									onClick={() => void decide(candidate.name, true)}
									className="flex h-7 items-center rounded-lg bg-ink px-3 text-detail font-medium text-shell transition-opacity hover:opacity-90"
								>
									启用
								</button>
								<button
									type="button"
									onClick={() => void decide(candidate.name, false)}
									className="h-7 rounded-lg px-2 text-detail text-ink-faint transition-colors hover:bg-card-hover hover:text-ink-muted"
								>
									不要
								</button>
							</div>
						</div>
					))}
				</Card>
			)}
			{diagnostics.length > 0 && (
				<Card className="mb-6 border-accent/35 bg-accent/6">
					<div className="px-4 py-3">
						<div className="mb-2 flex items-center gap-1.5 text-label text-accent">
							<TriangleAlert size={13} strokeWidth={1.9} />
							{diagnostics.length} 个技能未能加载
						</div>
						{diagnostics.map((diagnostic) => (
							<div key={diagnostic.path} className="py-0.5 text-detail text-accent/85">
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
							{warnings.length} 个技能的描述太短，模型可能不会选它
						</div>
						{warnings.map((warning) => (
							<div key={warning.path} className="py-0.5 text-detail text-ink-faint">
								<span className="font-mono">{warning.path}</span> — {warning.message}
							</div>
						))}
					</div>
				</Card>
			)}

			{/*
			 * Shadowing, said out loud.
			 *
			 * A shadowed skill is missing from the list above, which looks identical to one that
			 * failed to parse or was never found — and the person looking is usually the author of
			 * the copy that lost. Naming both paths is the whole answer: it is not broken, another
			 * file of the same name is more specific than yours.
			 *
			 * Not styled as a warning. This is how overriding is supposed to work; someone dropping
			 * a skill into their project to replace a bundled one wants exactly this, and colouring
			 * it like a fault would make a working feature look like a problem.
			 */}
			<ShadowedList
				kind="skill"
				entries={shadowed}
				diff={(winner, loser) => bridge.capabilities.diff("skill", winner, loser)}
				prefer={(name, path) => bridge.capabilities.prefer("skill", name, path)}
				onChanged={reloadScan}
				renderDiff={(hunks, path) => <DiffView hunks={hunks} path={path} />}
			/>

			{slow ? (
				<SkeletonList count={6} label={t("skills.reading")} />
			) : scan === null || pending === null ? null : skills.length === 0 ? (
				<EmptyHint>{needle ? t("common.noMatchingSkills") : t("skills.empty")}</EmptyHint>
			) : (
				/*
				 * The same row as the plugin list, because it is the same kind of thing: a mark, a
				 * name, one line, and the row itself opens it.
				 *
				 * Where it came from sits on the right, quietly, because it is the one thing about a
				 * skill you cannot work out from its name: two skills called `review` behave the same
				 * way and live in different places, and which one is yours to edit depends entirely on
				 * this word. `仅手动调用` stays beside the name instead, because that is not provenance
				 * — it changes what the model will do.
				 */
				skills.map((skill) => (
					<ListRow
						key={skill.path}
						icon={<SkillMark size={30} />}
						title={
							<span className="flex min-w-0 items-center gap-2">
								<ScrollText text={skill.name} className="min-w-0 font-mono" />
								{skill.disableModelInvocation && <Badge tone="accent">{t("skills.manualOnly")}</Badge>}
							</span>
						}
						detail={skill.description}
						actions={<>
							<span className="text-detail whitespace-nowrap text-ink-faint">{originOf(skill)}</span>
							{skill.source !== "builtin" && !skill.pluginId && <RowDeleteButton label={t("skills.deleteNamed", { name: skill.name })} pending={removal.pending.has(skill.path)} onClick={() => removal.ask(skill.name, skill.path)} />}
						</>}
						onOpen={() => void bridge.system.openPath(skill.path)}
						openLabel={t("skills.openNamed", { name: skill.name })}
					/>
				))
			)}
			{removal.element}
		</div>
	);
}
