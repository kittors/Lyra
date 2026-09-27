import type { Plugin, Skill, SkillCandidate } from "@lyra/core";
import { Sparkles, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { RowDeleteButton } from "../../ui/primitives/RowDeleteButton.tsx";
import { useDefinitionRemoval } from "./useDefinitionRemoval.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { SkillMark } from "./PluginIcon.tsx";
import { useApp } from "../../store/index.ts";
import { SkeletonList, useSlowLoad } from "../../ui/primitives/Skeleton.tsx";
import { Badge, Card, EmptyHint, ListRow } from "./controls.tsx";
import { SkillCandidates } from "./SkillCandidates.tsx";
import { DiffView } from "../git/index.ts";
import { ShadowedList } from "./ShadowedList.tsx";
import { bridge } from "../../services/index.ts";
import { translate, useI18n } from "../../i18n/index.ts";
import { useLocalScan } from "../plugins/index.ts";

/**
 * The skills, in groups by where they came from — the project's, your own, each plugin's, the
 * built-in ones — rather than one list with the origin repeated at the end of every row.
 *
 * Where a skill came from is the one thing about it you cannot work out from its name: two skills
 * called `review` behave the same way and live in different places, and which one is yours to edit
 * depends entirely on this. Said once above a group, it is read once; said on every row, eight rows
 * of 「waza」 down the right edge were the loudest thing on the page. A plugin's group goes by the
 * plugin's name, because `~/.lyra/skills` is where a collection flattens its skills too, and 「个人」
 * there would say "you wrote this" about something that arrives and leaves with the plugin.
 */
function groupSkills(skills: Skill[], plugins: Plugin[]): { key: string; title: string; skills: Skill[] }[] {
	const groups = new Map<string, { key: string; title: string; rank: number; skills: Skill[] }>();
	for (const skill of skills) {
		const key = skill.pluginId ? `plugin:${skill.pluginId}` : skill.source;
		let group = groups.get(key);
		if (!group) {
			const plugin = skill.pluginId ? plugins.find((entry) => entry.id === skill.pluginId) : undefined;
			const title = skill.pluginId
				? (plugin?.manifest.interface?.displayName ?? plugin?.manifest.name ?? skill.pluginId)
				: skill.source === "workspace"
					? translate("common.project")
					: skill.source === "builtin"
						? translate("common.builtin")
						: translate("common.personal");
			const rank = skill.pluginId ? 2 : skill.source === "workspace" ? 0 : skill.source === "builtin" ? 3 : 1;
			group = { key, title, rank, skills: [] };
			groups.set(key, group);
		}
		group.skills.push(skill);
	}
	return [...groups.values()].sort((a, b) => a.rank - b.rank || a.title.localeCompare(b.title));
}

export function SkillsSettings({ filter = "" }: { filter?: string }) {
	const { t } = useI18n();
	const workspace = useApp((s) => s.workspace);
	// A plugin carries skills, so installing one moves this list without touching this page.
	const extensionsNonce = useApp((s) => s.extensionsNonce);
	// The one scan the whole 插件 page shares — see `useLocalScan`.
	const { scan } = useLocalScan();
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

	// Scanned without a session, so the page works before any conversation exists. A change here is
	// a change for every list that reads the same directories.
	const reloadScan = useCallback(() => useApp.getState().bumpExtensions(), []);
	const removal = useDefinitionRemoval("skill", workspace?.path ?? "", reloadScan);
	useEffect(() => {
		reloadPending();
	}, [extensionsNonce, reloadPending]);

	// Name or description, because you remember a skill by either.
	const needle = filter.trim().toLowerCase();
	const skills = (scan?.skills ?? []).filter(
		(s) => !needle || `${s.name} ${s.description}`.toLowerCase().includes(needle),
	);
	/*
	 * Errors and warnings are counted apart. The failed-to-load header counts skills that did not
	 * load, and a warning counted in would send someone looking for a load failure that never
	 * happened. The warning header names no one problem — a short description, an `allowed-tools`
	 * entry Lyra cannot honour as written — because each row below it already says which.
	 *
	 * Both count files, not lines: one skill can fail for two reasons (a frontmatter never closed,
	 * then no description) or carry three warnings, and a header that says "skills" means skills.
	 */
	const diagnostics = (scan?.skillDiagnostics ?? []).filter((d) => d.severity !== "warning");
	const warnings = (scan?.skillDiagnostics ?? []).filter((d) => d.severity === "warning");
	const failed = new Set(diagnostics.map((d) => d.path)).size;
	const warned = new Set(warnings.map((d) => d.path)).size;
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

			{pending && pending.length > 0 && <SkillCandidates candidates={pending} onDecide={decide} />}
			{diagnostics.length > 0 && (
				<Card className="mb-6 border-accent/35 bg-accent/6">
					<div className="px-4 py-3">
						<div className="mb-2 flex items-center gap-1.5 text-label text-accent">
							<TriangleAlert size={13} strokeWidth={1.9} />
							{t("skillsSettings.failedToLoad", { n: failed })}
						</div>
						{/* By position: a path repeats when one file has two diagnostics, and these rows hold no state. */}
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
							{t("skillsSettings.warnings", { n: warned })}
						</div>
						{warnings.map((warning, index) => (
							<div key={index} className="py-0.5 text-detail text-ink-faint">
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
				<EmptyHint icon={Sparkles}>{needle ? t("common.noMatchingSkills") : t("skills.empty")}</EmptyHint>
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
				groupSkills(skills, scan?.plugins ?? []).map((group, groupIndex) => (
					<section key={group.key} className={groupIndex === 0 ? "" : "pt-4"} data-skill-group={group.key}>
						<h3 className="flex items-baseline gap-1.5 px-2 pb-1 text-detail font-medium text-ink-faint">
							{group.title}
							<span className="font-normal tabular-nums">{group.skills.length}</span>
						</h3>
						{group.skills.map((skill) => (
							<ListRow
								key={skill.path}
								icon={<SkillMark size={28} />}
								title={
									<span className="flex min-w-0 items-center gap-2">
										<ScrollText text={skill.name} className="min-w-0 font-mono" />
										{skill.disableModelInvocation && <Badge tone="accent">{t("skills.manualOnly")}</Badge>}
									</span>
								}
								detail={skill.description}
								actions={
									skill.source !== "builtin" && !skill.pluginId ? (
										<RowDeleteButton label={t("skills.deleteNamed", { name: skill.name })} pending={removal.pending.has(skill.path)} onClick={() => removal.ask(skill.name, skill.path)} />
									) : undefined
								}
								onOpen={() => void bridge.system.openPath(skill.path)}
								openLabel={t("skills.openNamed", { name: skill.name })}
							/>
						))}
					</section>
				))
			)}
			{removal.element}
		</div>
	);
}
