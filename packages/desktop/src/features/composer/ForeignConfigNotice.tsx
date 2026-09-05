/**
 * "This repository has other tools' configuration, and Lyra is already using it" (15 §5).
 *
 * Shown once per project, the first time it is opened with a `.cursor/rules/`, an `AGENTS.md`, a
 * `.claude/` in it. Worded as a fact and not as an offer — there is nothing to import, because
 * every format is read in place — which is why the only buttons are a look and an acknowledgement.
 * The numbers are what the registry loaded, not what directories exist.
 *
 * Above the composer, where the sub-agent bar goes: the strip that says what the conversation is
 * running on. Not a toast, which would be gone before it was read, and not a dialog, which would
 * make an announcement into an interruption.
 */

import type { ForeignConfigLine } from "@lyra/core";
import { Blocks } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../../store/index.ts";
import { bridge } from "../../services/index.ts";

export function ForeignConfigNotice() {
	const workspace = useApp((s) => s.workspace);
	const [lines, setLines] = useState<ForeignConfigLine[] | null>(null);

	useEffect(() => {
		let gone = false;
		setLines(null);
		if (!workspace?.path) return;
		void bridge.workspace
			.foreignConfigs(workspace.path)
			.then((found) => {
				if (!gone) setLines(found.seen ? [] : found.lines);
			})
			.catch(() => {});
		return () => {
			gone = true;
		};
	}, [workspace?.path]);

	if (!workspace?.path || !lines || lines.length === 0) return null;
	return (
		<ForeignConfigBanner
			lines={lines}
			onLook={() => {
				useApp.getState().setSettingsSection("plugins");
				useApp.getState().setView("settings");
			}}
			onOk={() => {
				setLines([]);
				void bridge.workspace.markForeignConfigsSeen(workspace.path);
			}}
		/>
	);
}

/** What a line says about itself, after the path: 「6 条规则」, 「项目上下文」. */
export function describeLine(line: ForeignConfigLine): string {
	if (line.kind === "rule") return `${line.count} 条规则`;
	if (line.kind === "skill") return `${line.count} 个技能`;
	if (line.kind === "command") return `${line.count} 个命令`;
	if (line.kind === "agent") return `${line.count} 个子 Agent 定义`;
	return "项目上下文";
}

export function ForeignConfigBanner({ lines, onLook, onOk }: { lines: ForeignConfigLine[]; onLook: () => void; onOk: () => void }) {
	return (
		<div className="ly-enter mb-1.5 rounded-lg border border-line-soft bg-card/60 px-3 py-2" data-foreign-config-notice>
			<div className="flex items-center gap-2 text-detail text-ink">
				<Blocks size={13} strokeWidth={1.8} className="shrink-0 text-accent" />
				<span>这个仓库里有其他 AI 工具的配置，Lyra 已经在用：</span>
			</div>
			<ul className="mt-1 ml-5 space-y-0.5 text-detail text-ink-muted">
				{lines.map((line) => (
					<li key={`${line.provider}:${line.where}:${line.kind}`} className="flex gap-3" data-foreign-config-line>
						<span className="min-w-[180px] font-mono text-ink">{line.where}</span>
						<span>{describeLine(line)}</span>
						<span className="text-ink-faint">{line.label}</span>
					</li>
				))}
			</ul>
			<div className="mt-1.5 flex gap-3 text-caption">
				<button type="button" onClick={onLook} data-foreign-config-look className={link}>
					看看它们
				</button>
				<button type="button" onClick={onOk} data-foreign-config-ok className={link}>
					知道了
				</button>
			</div>
		</div>
	);
}

const link = "text-ink-muted underline-offset-2 transition-colors duration-[var(--ly-t-quick)] hover:text-ink hover:underline";
