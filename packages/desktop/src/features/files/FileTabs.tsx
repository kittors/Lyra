/**
 * The files this pane has had open, as a strip you can go back through.
 *
 * The pane held exactly one file and forgot it the moment you clicked another, so moving between
 * two files meant finding the second one in the tree every single time. Same idea as the terminal's
 * tabs, and for the same reason: once a pane holds several of something, choosing between them is
 * part of what the pane is.
 *
 * Where the toolbar used to be. Those controls are marks in the pane's header now — see
 * `FileActions` — which is what freed this row for something that changes as you work.
 */

import { Copy, CornerUpRight, X } from "lucide-react";
import { useCallback, useEffect, useRef } from "react";

import { useOpenFile, type OpenFileTab } from "../../store/openFile.ts";
import { useApp } from "../../store/index.ts";
import { ContextMenu, useContextMenu } from "../../ui/overlay/ContextMenu.tsx";
import { MenuItem, MenuSeparator } from "../../ui/overlay/Menu.tsx";
import { useRevealLabel } from "./open-targets.ts";
import { bridge } from "../../services/index.ts";

const ICON = { size: 13, strokeWidth: 1.8 } as const;

export function FileTabs() {
	const tabs = useOpenFile((s) => s.tabs);
	/*
	 * The tab being opened wins over the one on screen, for the moment they differ.
	 *
	 * `path` only moves once the file's contents have arrived — that is what stopped the content
	 * area flickering — so highlighting `path` alone would leave a click unacknowledged until the
	 * read landed. The strip answers immediately; the content area answers when it has something.
	 */
	const open = useOpenFile((s) => s.opening ?? s.path);
	const drafts = useOpenFile((s) => s.drafts);
	const strip = useRef<HTMLDivElement>(null);
	const menu = useContextMenu<OpenFileTab>();
	const notify = useApp((s) => s.notify);

	/**
	 * Close a set, and say what was spared.
	 *
	 * A bulk close keeps tabs with unsaved edits (see `closeTabs`), and a strip that quietly
	 * refuses to obey 全部关闭 looks broken. The notice is the difference between "it did not
	 * work" and "it kept the two files you were editing".
	 */
	const closeMany = useCallback(
		(paths: string[]) => {
			const kept = useOpenFile.getState().closeTabs(paths);
			if (kept > 0) notify(`${kept} 个标签有未保存的修改，已保留`);
		},
		[notify],
	);

	/*
	 * Fade whichever end has more tabs beyond it, and only that end.
	 *
	 * A permanent fade on both sides dims the first and last tab of a strip that fits, which reads
	 * as those tabs being disabled. Driven from the scroll position so the softness means what it
	 * says: there is more this way.
	 */
	const markEdges = useCallback(() => {
		const el = strip.current;
		if (!el) return;
		const max = el.scrollWidth - el.clientWidth;
		el.style.setProperty("--ly-fade-left", el.scrollLeft > 1 ? "18px" : "0px");
		el.style.setProperty("--ly-fade-right", el.scrollLeft < max - 1 ? "18px" : "0px");
	}, []);

	useEffect(markEdges, [markEdges, tabs.length]);

	// Keep the open file in view: it can be selected from the tree or the dropdown, which may
	// scroll it in from either end.
	useEffect(() => {
		if (!open) return;
		strip.current?.querySelector(`[data-file-tab="${CSS.escape(open)}"]`)?.scrollIntoView({
			block: "nearest",
			inline: "nearest",
		});
		markEdges();
	}, [open, markEdges]);

	// One file is not a choice, and a row offering it is a row of noise taking height from the file.
	if (tabs.length < 2) return null;

	return (
		<>
			<div
				ref={strip}
				onScroll={markEdges}
				role="tablist"
				aria-label="打开的文件"
				className="ly-fade-tail flex h-7 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-line px-1"
			>
				{tabs.map((tab) => {
					const current = tab.path === open;
					const unsaved = tab.path in drafts;
					return (
						<div
							key={tab.path}
							data-file-tab={tab.path}
							onContextMenu={(event) => menu.show(event, tab)}
							className={`group/tab flex h-[22px] shrink-0 items-center gap-1 rounded-md pr-0.5 pl-2 transition-colors duration-[var(--ly-t-quick)] ${
								current ? "bg-card-hover text-ink" : "text-ink-faint hover:text-ink"
							}`}
						>
							<button
								type="button"
								role="tab"
								aria-selected={current}
								data-ly-tip={tab.path}
								onClick={() =>
									void useOpenFile
										.getState()
										.open({ name: tab.name, path: tab.path, isDirectory: false, size: 0 })
								}
								className="max-w-[160px] truncate py-1 text-detail whitespace-nowrap"
							>
								{tab.name}
							</button>
							{/*
							 * Unsaved edits, in the place the ✕ would be.
							 *
							 * Swapped rather than shown beside it: a dot and a cross on a 22px tab is two
							 * marks fighting over four pixels, and pointing at the tab is what you do when
							 * you mean to close it — which is the moment the dot has to be a cross.
							 */}
							{unsaved ? (
								<span
									aria-label="未保存"
									className="mr-1 size-[5px] shrink-0 rounded-full bg-accent group-hover/tab:hidden"
								/>
							) : null}
							<button
								type="button"
								aria-label={`关闭 ${tab.name}`}
								onClick={() => useOpenFile.getState().closeTab(tab.path)}
								className={`rounded p-0.5 transition-opacity duration-[var(--ly-t-quick)] hover:bg-elevated ${
									current ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover/tab:opacity-60"
								} ${unsaved ? "hidden group-hover/tab:block" : ""}`}
							>
								<X size={11} strokeWidth={2.2} />
							</button>
						</div>
					);
				})}
			</div>

			{menu.target && (
				<TabMenu anchor={menu.anchor} tab={menu.target} tabs={tabs} onClose={menu.close} onCloseMany={closeMany} />
			)}
		</>
	);
}

/**
 * What right-clicking a tab offers.
 *
 * The four closes in the order every editor puts them, then the two things you want a path for.
 * 关闭右侧 disables itself on the last tab rather than disappearing: a row that comes and goes as
 * you move along the strip is harder to aim at than one that is simply grey.
 */
function TabMenu({
	anchor,
	tab,
	tabs,
	onClose,
	onCloseMany,
}: {
	anchor: { x: number; y: number } | null;
	tab: OpenFileTab;
	tabs: OpenFileTab[];
	onClose: () => void;
	onCloseMany: (paths: string[]) => void;
}) {
	const reveal = useRevealLabel();
	const notify = useApp((s) => s.notify);
	const at = tabs.findIndex((each) => each.path === tab.path);
	const toRight = tabs.slice(at + 1).map((each) => each.path);
	const others = tabs.filter((each) => each.path !== tab.path).map((each) => each.path);

	return (
		<ContextMenu anchor={anchor} onClose={onClose} width="default">
			<MenuItem icon={<X {...ICON} />} onClick={() => useOpenFile.getState().closeTab(tab.path)}>
				关闭
			</MenuItem>
			<MenuItem disabled={others.length === 0} onClick={() => onCloseMany(others)}>
				关闭其他
			</MenuItem>
			<MenuItem disabled={toRight.length === 0} onClick={() => onCloseMany(toRight)}>
				关闭右侧
			</MenuItem>
			<MenuItem onClick={() => onCloseMany(tabs.map((each) => each.path))}>全部关闭</MenuItem>

			<MenuSeparator />
			<MenuItem
				icon={<Copy {...ICON} />}
				onClick={() => {
					void bridge.clipboard.write(tab.path);
					notify("已复制路径");
				}}
			>
				复制路径
			</MenuItem>
			<MenuItem icon={<CornerUpRight {...ICON} />} onClick={() => void bridge.workspace.reveal(tab.path)}>
				{reveal}
			</MenuItem>
		</ContextMenu>
	);
}
