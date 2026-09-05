import type { Skill, SkillCandidate } from "@lyra/core";
import { Layers, Sparkles, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { SkillMark } from "./PluginIcon.tsx";
import { useApp } from "../../store/index.ts";
import { SkeletonList, useSlowLoad } from "../../ui/primitives/Skeleton.tsx";
import { Badge, Card, EmptyHint, ListRow } from "./controls.tsx";
import { bridge } from "../../services/index.ts";

/**
 * Where a skill came from, in one word.
 *
 * A plugin's name beats the directory it happens to sit in: `~/.lyra/skills` is where a collection
 * flattens its skills too, so "个人" there would be false in the way that matters — it would say
 * "you wrote this" about something that arrives and leaves with the plugin.
 */
function originOf(skill: Skill): string {
	if (skill.pluginId) return skill.pluginId;
	if (skill.source === "workspace") return "项目";
	if (skill.source === "builtin") return "内置";
	return "个人";
}

export function SkillsSettings({ filter = "" }: { filter?: string }) {
	const workspace = useApp((s) => s.workspace);
	// A plugin carries skills, so installing one moves this list without touching this page.
	const extensionsNonce = useApp((s) => s.extensionsNonce);
	const [scan, setScan] = useState<Awaited<ReturnType<typeof bridge.plugins.list>> | null>(null);
	/** Only when the scan is slow enough to notice; below that the list simply appears. */
	const slow = useSlowLoad(scan === null);

	/*
	 * 等着人点头的那些，从会话里总结出来的。
	 *
	 * 放在技能列表最上面而不是混进去：它们**还不生效**，而下面每一行都是正在生效的东西。
	 * 一个自动生成的技能会改变这个 agent 以后的行为，而看到它生效的人多半不记得自己批准过
	 * 什么——所以这一段的整个存在意义，就是让那次批准真的发生过。
	 */
	const [pending, setPending] = useState<SkillCandidate[]>([]);
	const reloadPending = useCallback(() => {
		if (!workspace?.path) return;
		void bridge.rules.pendingSkills(workspace.path).then(setPending).catch(() => {});
	}, [workspace?.path]);

	// Scanned directly so the page works before any session exists.
	useEffect(() => {
		void bridge.plugins.list(workspace?.path ?? "").then(setScan);
		reloadPending();
	}, [workspace?.path, extensionsNonce, reloadPending]);

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

			{pending.length > 0 && (
				<Card className="mb-6 border-accent/35 bg-accent/6">
					<div className="px-4 pt-3 pb-1">
						<div className="flex items-center gap-1.5 text-label text-accent">
							<Sparkles size={13} strokeWidth={1.9} />
							从最近的会话里总结出 {pending.length} 个技能，等你决定
						</div>
						<p className="mt-0.5 text-detail text-ink-muted">
							这些还没有生效。启用之后，它们会像你自己写的技能一样被用上。
						</p>
					</div>
					{pending.map((candidate) => (
						<div key={candidate.name} className="px-4 py-3">
							<div className="font-mono text-body">{candidate.name}</div>
							<p className="mt-0.5 text-detail text-ink-muted">{candidate.description}</p>
							{/* 正文全文摆出来。批准一段自己没读过的指令，跟没有这个确认步骤是一回事。 */}
							<pre className="ly-rule-excerpt mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded p-2 font-mono text-detail leading-relaxed">
								{candidate.body}
							</pre>
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
			{shadowed.length > 0 && (
				<Card className="mb-6">
					<div className="px-4 py-3">
						<div className="mb-2 flex items-center gap-1.5 text-label text-ink-muted">
							<Layers size={13} strokeWidth={1.9} />
							{shadowed.length} 个同名技能被覆盖
						</div>
						{shadowed.map((entry) => (
							<div key={entry.path} className="py-0.5 text-detail text-ink-faint">
								<span className="font-mono">{entry.path}</span> 被 {entry.byLabel} 的{" "}
								<span className="font-mono">{entry.by}</span> 覆盖
							</div>
						))}
					</div>
				</Card>
			)}

			{slow ? (
				<SkeletonList count={6} label="正在读取技能" />
			) : skills.length === 0 ? (
				<EmptyHint>
					还没有技能。
					<br />
					在上面的目录里新建 <span className="font-mono">{"<技能名>/SKILL.md"}</span>，写上 name 和 description 即可。
				</EmptyHint>
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
								<span className="truncate font-mono">{skill.name}</span>
								{skill.disableModelInvocation && <Badge tone="accent">仅手动调用</Badge>}
							</span>
						}
						detail={skill.description}
						control={<span className="text-detail whitespace-nowrap text-ink-faint">{originOf(skill)}</span>}
						onOpen={() => void bridge.system.openPath(skill.path)}
						openLabel={`打开 ${skill.name}`}
					/>
				))
			)}
		</div>
	);
}
