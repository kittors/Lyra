/**
 * The open file's name, and the whole tree behind it.
 *
 * The pane's header used to say 「文件内容」 — a label naming the pane's own category, on a pane
 * whose category is never in doubt, taking the one row that could have said *which file*. Worse,
 * that was the state the pane was most often left in: the tree is a companion that gets closed, and
 * with it gone this pane became a file with no name and no way to reach another one.
 *
 * So the name is the control. It says what is open, and — when there is no tree on screen — pressing
 * it drops the project's tree down under it. That is the same `FileTree` the panel draws, not a
 * reduced copy: expanding, collapsing, searching, renaming, the right-click menu and drag-and-drop
 * all work here because it *is* that component. Which folders are open is shared state
 * (`store/fileTree.ts`), so a tree opened here is open in the panel and the other way round.
 *
 * Only when there is no tree on screen. With the tree pane beside this one the dropdown would be a
 * second copy of a list you are already looking at, and a control that opens one is a control that
 * does nothing worth doing — so the name is just a name then. What counts as "on screen" is not
 * "open": maximising this pane on its own covers the tree, and a narrow window shows one pane at a
 * time. See `paneVisible`.
 */

import { ChevronDown, FileText, PanelLeft } from "lucide-react";

import { useLayout } from "../../app/layout.tsx";
import { useDock } from "../dock/store.ts";
import { companionOf } from "../dock/panels/definitions.tsx";
import { kinds } from "../dock/tree.ts";
import { paneVisible } from "../dock/visibility.ts";
import { useApp } from "../../store/index.ts";
import { useOpenFile } from "../../store/openFile.ts";
import { MENU_MAX_HEIGHT, Popover, usePopover } from "../../ui/overlay/Popover.tsx";
import { FileTree } from "./FileTree.tsx";

/**
 * How tall the tree in the dropdown is.
 *
 * Fixed, not grown from its contents: the tree is a scroller with a search field pinned above it,
 * and a surface that resized itself as folders opened would move the row under the pointer every
 * time one was expanded. `MENU_MAX_HEIGHT` is what every other list in the app is capped at.
 */
const TREE_HEIGHT = MENU_MAX_HEIGHT;

/** Wider than a menu: these rows are indented paths, and the indent is what a tree reads by. */
const TREE_WIDTH = 320;

export function FileTitle() {
	const root = useApp((s) => s.workspace?.path ?? null);
	const path = useOpenFile((s) => s.path);
	const name = useOpenFile((s) => s.name);
	const dirty = useOpenFile((s) => s.drafts);
	const menu = usePopover();
	const treeOnScreen = useTreeOnScreen();

	const unsaved = path !== null && path in dirty;

	/*
	 * A name, and nothing more, while the tree is beside it.
	 *
	 * Not a disabled button: there is nothing here to be unavailable, the job is simply the tree
	 * pane's while that pane exists. A greyed-out chevron would advertise a route that is already
	 * open in a larger form a few pixels away.
	 */
	if (treeOnScreen) {
		return (
			<span className="flex min-w-0 items-center gap-1 py-0.5 pl-1 text-detail" data-ly-tip={path ?? undefined}>
				<FileText size={12.5} strokeWidth={1.8} className="shrink-0 text-ink-faint" />
				<span className={`min-w-0 truncate ${path ? "text-ink" : "text-ink-muted"}`}>{name ?? "文件内容"}</span>
				{unsaved && <span aria-label="未保存" className="size-[5px] shrink-0 rounded-full bg-accent" />}
			</span>
		);
	}

	return (
		<>
			<button
				type="button"
				// `no-drag`, like every control in a pane header: the bar around it moves the window.
				className="no-drag group/title flex min-w-0 items-center gap-1 rounded-md py-0.5 pr-1 pl-1 text-detail transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover"
				aria-haspopup="tree"
				aria-expanded={menu.open}
				data-ly-tip={path ?? undefined}
				onClick={menu.toggle}
			>
				<FileText size={12.5} strokeWidth={1.8} className="shrink-0 text-ink-faint" />
				<span className={`min-w-0 truncate ${path ? "text-ink" : "text-ink-muted"}`}>{name ?? "文件内容"}</span>
				{/*
				 * Unsaved edits, as the dot the tree uses for the same thing.
				 *
				 * The name is the only place this pane says which file it is, so it is the only place
				 * that can say the file has changed since it was read.
				 */}
				{unsaved && <span aria-label="未保存" className="size-[5px] shrink-0 rounded-full bg-accent" />}
				<ChevronDown
					size={11}
					strokeWidth={2}
					className={`shrink-0 text-ink-faint transition-transform duration-[var(--ly-t-quick)] ${
						menu.open ? "rotate-180" : ""
					}`}
				/>
			</button>

			{menu.open && (
				<Popover
					anchor={menu.anchor}
					onClose={menu.close}
					placement="bottom"
					align="start"
					width={TREE_WIDTH}
					role="group"
					label="项目文件"
					// The tree brings its own scroller and its own padding.
					bodyClassName="p-0"
					/*
					 * The way out of the dropdown and into a pane.
					 *
					 * The two are the same tree in different clothes — one is for reaching a file and
					 * closing again, the other for living in while you work — and which one you want
					 * changes minute to minute. Without this the trip was one-way: closing the tree
					 * pane left the dropdown as the only route, and getting the pane back meant going
					 * through the panel menu, which is a different part of the window entirely.
					 *
					 * In the footer because it is the answer to "I want more of this than a dropdown",
					 * which is a thought you have after looking at the list rather than before.
					 */
					footer={
						<button
							type="button"
							onClick={() => {
								useDock.getState().open("files", companionOf("files"));
								menu.close();
							}}
							className="flex w-full items-center gap-1.5 px-3 py-2 text-detail text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink"
						>
							<PanelLeft size={12} strokeWidth={1.8} className="shrink-0 text-ink-faint" />
							在面板中打开
						</button>
					}
				>
					<div className="flex flex-col" style={{ height: TREE_HEIGHT }}>
						{root ? (
							<FileTree
								root={root}
								openPath={path}
								dirtyPaths={new Set(Object.keys(dirty))}
								onOpen={(entry) => {
									void useOpenFile.getState().open(entry);
									/*
									 * Picking a file is the end of the errand, so the tree goes away.
									 *
									 * Expanding a folder is not — `FileTree` toggles directories itself and
									 * never calls this for one — so browsing down to a file leaves the tree
									 * up the whole way and closes once on the file itself.
									 */
									menu.close();
								}}
								onMoved={(from, to) => useOpenFile.getState().moved(from, to)}
								onRemoved={(paths) => useOpenFile.getState().removed(paths)}
							/>
						) : (
							<p className="px-3 py-6 text-center text-detail text-ink-faint">先打开一个项目。</p>
						)}
					</div>
				</Popover>
			)}
		</>
	);
}

/**
 * Is the file tree on screen right now?
 *
 * Subscribed rather than computed once: every input can change while this pane stays mounted —
 * closing the tree, maximising this one, dragging the window narrow enough to collapse the dock.
 */
function useTreeOnScreen(): boolean {
	const tree = useDock((s) => s.tree);
	const maximized = useDock((s) => s.maximized);
	const focused = useDock((s) => s.focused);
	const { compact } = useLayout();

	return paneVisible("files", {
		present: kinds(tree),
		maximized: maximized?.panes ?? null,
		compact,
		focused,
	});
}
