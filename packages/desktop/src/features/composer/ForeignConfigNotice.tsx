/**
 * Helpers for "this repository already has another tool's configuration".
 *
 * The bar used to sit above the composer and say 「已在用 Cursor 的配置」. That is a fact the
 * person already lives with — they opened the project — so it is not shown. `targetFor` and
 * `summarize` stay because the settings pages still need to know whose rules a path is.
 */

import { useI18n } from "../../i18n/index.ts";
import { translate } from "../../i18n/translate.ts";
import type { ForeignConfigLine } from "@lyra/core";
import { Blocks, X } from "lucide-react";
import { Caret } from "../../ui/primitives/Caret.tsx";
import { type ExtensionsTab, type SettingsSection } from "../../store/index.ts";
import { MenuBody, MenuItem, Popover, usePopover } from "../../ui/overlay/Popover.tsx";

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
	return null;
}

/** What a place says about itself, after the path: 「2 条规则」, 「项目上下文」. */
export function describeLine(line: ForeignConfigLine): string {
	if (line.kind === "rule") return translate("foreign.rules", { n: line.count });
	if (line.kind === "skill") return translate("foreign.skills", { n: line.count });
	if (line.kind === "command") return translate("foreign.commands", { n: line.count });
	if (line.kind === "agent") return translate("foreign.subAgents", { n: line.count });
	return translate("foreign.projectContext");
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
	const { t } = useI18n();
	const { tools, places } = summarize(lines);
	const menu = usePopover();
	return (
		<div
			className="ly-enter mb-1.5 flex w-full items-center gap-2 rounded-lg border border-line-soft bg-card/60 px-2 py-0.5"
			data-foreign-config-notice
		>
			<Blocks size={13} strokeWidth={1.8} className="shrink-0 text-accent" />
			<span className="min-w-0 flex-1 truncate py-1 text-detail text-ink-muted" data-foreign-config-summary>
				{t("foreign.inUse")} <span className="text-ink">{tools}</span>
				{t("foreign.theirConfig")}
			</span>
			{places > 1 && (
				<span className="shrink-0 text-caption tabular-nums text-ink-faint" data-foreign-config-count>
					{t("foreign.placeCount", { n: places })}
				</span>
			)}
			{/* One place: go there. Several: ask which — a button cannot land on all of them. */}
			<button
				type="button"
				onClick={(event) => (places === 1 ? onLook(lines[0]) : menu.toggle(event))}
				data-foreign-config-look
				aria-haspopup={places > 1 ? "menu" : undefined}
				aria-expanded={places > 1 ? menu.open : undefined}
				className="flex h-5 shrink-0 items-center gap-0.5 rounded px-1 text-caption text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink"
			>
				{/*
				 * 这颗在句子末尾，留字。
				 *
				 * 几个地方用着别人的配置——后面跟一个「查看」。换成一枚眼睛图标之后，那句话的结尾
				 * 突然变成一个符号，读起来像话说了一半；而它多数时候还会展开一张单子，那就更该
				 * 说清楚按下去会发生什么。箭头只在真有单子可展开时出现，并跟着开合转身。
				 */}
				{t("common.look")}
				{places > 1 && <Caret open={menu.open} size={11} className="opacity-70" />}
			</button>
			<button
				type="button"
				onClick={onOk}
				data-foreign-config-ok
				data-ly-tip={t("foreign.dismiss")}
				aria-label={t("foreign.dismiss")}
				className="shrink-0 rounded-md p-1 text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink"
			>
				<X size={12} strokeWidth={2} />
			</button>
			{menu.open && (
				/* Wider than a menu: a path on the left and what it holds on the right must not meet. */
				<Popover anchor={menu.anchor} onClose={menu.close} placement="top" align="end" width={360} role="menu" label={t("foreign.configInUse")}>
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
