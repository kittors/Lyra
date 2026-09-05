/**
 * "This repository has other tools' configuration, and Lyra is already using it" (15 §5).
 *
 * Shown once per project, the first time it is opened with a `.cursor/rules/` or a `.claude/` in
 * it. Worded as a fact and not as an offer — there is nothing to import, because every format is
 * read in place — so the line has a way to look and a way to dismiss, and nothing else.
 *
 * Above the composer, where the sub-agent bar goes, and shaped like it. Not a toast, which would
 * be gone before it was read; not a dialog, which would make an announcement into an interruption.
 * Not a table either: three columns of paths and counts read as a list of files to click on, and
 * the button under it led to the plugin page, which is about something else entirely. 「查看」 now
 * goes where each place is actually shown — rules to the rules page, skills to skills, a
 * `CLAUDE.md` into the file pane — and with more than one place it asks which, the way a split
 * button does, rather than guessing.
 */

import type { ForeignConfigLine } from "@lyra/core";
import { Blocks, ChevronDown, X } from "lucide-react";
import { useEffect, useState } from "react";
import { joinPath } from "../../lib/paths.ts";
import { bridge } from "../../services/index.ts";
import { type ExtensionsTab, type SettingsSection, useApp } from "../../store/index.ts";
import { useOpenFile } from "../../store/openFile.ts";
import { MenuBody, MenuItem, Popover, usePopover } from "../../ui/overlay/Popover.tsx";
import { companionOf, useDock } from "../dock/index.ts";

/**
 * Where one place is shown in this app: a settings page (a tab on it, something in its search
 * box), or the file itself.
 */
export type LookTarget = { page: SettingsSection; tab?: ExtensionsTab; query?: string } | { file: string };

/**
 * A `.cursor/rules/` is shown on the rules page — every rule in it, with a badge saying whose and
 * a switch to turn it off — and the tool's name goes into the page's search box so that those are
 * the rules on screen, with the box saying why. Skills, commands and agents have pages too. A
 * context file has no page: it is one file, and the pane that shows files is the honest place to
 * read it.
 */
export function targetFor(line: ForeignConfigLine): LookTarget {
	switch (line.kind) {
		case "rule":
			return { page: "plugins", tab: "rules", query: line.label };
		case "skill":
			return { page: "plugins", tab: "skills" };
		case "command":
			return { page: "commands" };
		case "agent":
			return { page: "agents" };
		default:
			return { file: line.where };
	}
}

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

	if (!workspace?.path) return null;
	const root = workspace.path;
	if (!lines || lines.length === 0) return null;

	const look = (line: ForeignConfigLine) => {
		const target = targetFor(line);
		if ("file" in target) {
			void useOpenFile.getState().open({
				path: joinPath(root, target.file),
				name: target.file.split("/").pop() || target.file,
				isDirectory: false,
				size: 0,
			});
			useDock.getState().open("file", companionOf("file"));
			return;
		}
		const app = useApp.getState();
		app.setExtensionsFocus(target.tab ? { tab: target.tab, query: target.query } : null);
		app.setSettingsSection(target.page);
		app.setView("settings");
	};

	return (
		<ForeignConfigBanner
			lines={lines}
			onLook={look}
			onOk={() => {
				setLines([]);
				void bridge.workspace.markForeignConfigsSeen(root);
			}}
		/>
	);
}

/** What a place says about itself, after the path: 「2 条规则」, 「项目上下文」. */
export function describeLine(line: ForeignConfigLine): string {
	if (line.kind === "rule") return `${line.count} 条规则`;
	if (line.kind === "skill") return `${line.count} 个技能`;
	if (line.kind === "command") return `${line.count} 个命令`;
	if (line.kind === "agent") return `${line.count} 个子 Agent 定义`;
	return "项目上下文";
}

/**
 * One line, like the bars around it: whose configuration is in use, and in how many places.
 *
 * Tool names rather than paths — 「Cursor、Claude Code」 is recognised at a glance where
 * `.cursor/rules/ 2 条规则 · .claude/commands/ 1 个命令` has to be read, and a line above the
 * composer must not need reading. The places themselves are behind 「查看」.
 */
export function summarize(lines: ForeignConfigLine[]): { tools: string; places: number } {
	return {
		tools: [...new Set(lines.map((line) => line.label))].join("、"),
		places: lines.length,
	};
}

export function ForeignConfigBanner({
	lines,
	onLook,
	onOk,
}: {
	lines: ForeignConfigLine[];
	onLook: (line: ForeignConfigLine) => void;
	onOk: () => void;
}) {
	const { tools, places } = summarize(lines);
	const menu = usePopover();
	return (
		<div
			className="ly-enter mb-1.5 flex w-full items-center gap-2 rounded-lg border border-line-soft bg-card/60 px-2 py-0.5"
			data-foreign-config-notice
		>
			<Blocks size={13} strokeWidth={1.8} className="shrink-0 text-accent" />
			<span className="min-w-0 flex-1 truncate py-1 text-detail text-ink-muted" data-foreign-config-summary>
				已在用 <span className="text-ink">{tools}</span> 的配置
			</span>
			{places > 1 && (
				<span className="shrink-0 text-caption tabular-nums text-ink-faint" data-foreign-config-count>
					{places} 处
				</span>
			)}
			{/* One place: go there. Several: ask which — a button cannot land on all of them. */}
			<button
				type="button"
				onClick={(event) => (places === 1 ? onLook(lines[0]) : menu.toggle(event))}
				data-foreign-config-look
				aria-haspopup={places > 1 ? "menu" : undefined}
				aria-expanded={places > 1 ? menu.open : undefined}
				className="flex shrink-0 items-center gap-0.5 text-caption text-ink-muted underline-offset-2 transition-colors duration-[var(--ly-t-quick)] hover:text-ink hover:underline"
			>
				查看
				{places > 1 && <ChevronDown size={11} strokeWidth={2} className="opacity-70" />}
			</button>
			<button
				type="button"
				onClick={onOk}
				data-foreign-config-ok
				data-ly-tip="知道了，这个项目不再提示"
				aria-label="知道了，这个项目不再提示"
				className="shrink-0 rounded-md p-1 text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink"
			>
				<X size={12} strokeWidth={2} />
			</button>
			{menu.open && (
				/* Wider than a menu: a path on the left and what it holds on the right must not meet. */
				<Popover anchor={menu.anchor} onClose={menu.close} placement="top" align="end" width={360} role="menu" label="在用的配置">
					<MenuBody>
						{lines.map((line) => (
							<MenuItem
								key={`${line.where} ${line.kind}`}
								hint={`${describeLine(line)} · ${line.label}`}
								onClick={() => {
									menu.close();
									onLook(line);
								}}
							>
								<span className="block truncate font-mono">{line.where}</span>
							</MenuItem>
						))}
					</MenuBody>
				</Popover>
			)}
		</div>
	);
}
