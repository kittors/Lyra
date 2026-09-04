import type { Skill } from "@lyra/core";
import { Layers, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
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

	// Scanned directly so the page works before any session exists.
	useEffect(() => {
		void bridge.plugins.list(workspace?.path ?? "").then(setScan);
	}, [workspace?.path, extensionsNonce]);

	// Name or description, because you remember a skill by either.
	const needle = filter.trim().toLowerCase();
	const skills = (scan?.skills ?? []).filter(
		(s) => !needle || `${s.name} ${s.description}`.toLowerCase().includes(needle),
	);
	const diagnostics = scan?.skillDiagnostics ?? [];
	const shadowed = scan?.shadowedSkills ?? [];

	return (
		<div>
			{/* The two directory buttons that used to sit here are in the page's ⋯ now — three tabs
			    each opening with its own pair of them was a header that said nothing about the tab. */}
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
