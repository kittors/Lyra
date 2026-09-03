/**
 * The tree half of the file panel: a search field, a few actions, and the rows.
 *
 * The search field lives in here rather than above both panes, which is where it used to be. Its
 * scope is this column — it filters these rows and nothing else — and stretched across a panel
 * opened to full screen it was a 1500px control acting on a 212px list. A filter should be as wide
 * as the thing it filters.
 *
 * One tab stop, arrows to move inside it: the container owns the keyboard and the rows are
 * `treeitem`s, which is what lets ↑↓ mean "next row" instead of "next control".
 */

import { ChevronsDownUp, FilePlus2, FolderPlus, X } from "lucide-react";
import { Fragment, useCallback, useMemo, useRef, useState } from "react";

import type { FileEntry } from "../../../electron/ipc-types.ts";
import { useOpenTarget } from "./open-targets.ts";
import { useSide } from "../dock/index.ts";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { SearchField } from "../../ui/inputs/SearchField.tsx";
import { useContextMenu } from "../../ui/overlay/ContextMenu.tsx";
import { FileMenu } from "./FileMenu.tsx";
import { baseName, dirName } from "./paths.ts";
import { NewRow, TreeRow } from "./TreeRow.tsx";
import { useFileActions } from "./useFileActions.ts";
import { useFileTree } from "./useFileTree.ts";
import { useTreeDrag } from "./useTreeDrag.ts";
import { bridge } from "../../services/index.ts";

export function FileTree({
	root,
	openPath,
	dirtyPaths,
	onOpen,
	onMoved,
	onRemoved,
}: {
	root: string;
	/** The file the pane beside this one is showing, so the tree can mark it. */
	openPath: string | null;
	dirtyPaths: Set<string>;
	onOpen(entry: FileEntry): void;
	onMoved(from: string, to: string): void;
	onRemoved(paths: string[]): void;
}) {
	const tree = useFileTree(root);
	const actions = useFileActions({ root, refresh: tree.refresh, onMoved, onRemoved });
	const openWith = useOpenTarget();
	const runInTerminal = useSide((s) => s.runInTerminal);

	/** Ordered, so ⇧-click has an anchor and the last one decides where 新建 lands. */
	const [selection, setSelection] = useState<string[]>([]);
	const [focus, setFocus] = useState<string | null>(null);
	const [renaming, setRenaming] = useState<string | null>(null);
	const [creating, setCreating] = useState<{ dir: string; kind: "file" | "directory" } | null>(null);
	const menu = useContextMenu<FileEntry | null>();
	const rowsHost = useRef<HTMLDivElement>(null);

	const chosen = useMemo(() => new Set(selection), [selection]);
	const cutSet = useMemo(
		() => new Set(actions.clipboard?.mode === "cut" ? actions.clipboard.paths : []),
		[actions.clipboard],
	);
	const byPath = useMemo(() => new Map(tree.rows.map(({ entry }) => [entry.path, entry])), [tree.rows]);

	/** Where 新建 and 粘贴 land when nothing was right-clicked: inside the selection, or the root. */
	const home = tree.scope ?? root;
	const targetDir = useMemo(() => {
		const last = selection.at(-1);
		if (!last) return home;
		const entry = byPath.get(last);
		return entry?.isDirectory ? last : dirName(last);
	}, [selection, byPath, home]);

	const focusTree = useCallback(() => rowsHost.current?.focus(), []);

	const put = useCallback((path: string) => {
		setSelection([path]);
		setFocus(path);
	}, []);

	/** Move the cursor to a row and bring it into view; the selection follows, as arrows do. */
	const moveTo = useCallback(
		(index: number) => {
			const row = tree.rows[Math.min(Math.max(index, 0), tree.rows.length - 1)];
			if (!row) return;
			put(row.entry.path);
			rowsHost.current
				?.querySelector(`[data-path="${CSS.escape(row.entry.path)}"]`)
				?.scrollIntoView({ block: "nearest" });
		},
		[tree.rows, put],
	);

	const activate = useCallback(
		(entry: FileEntry) => {
			if (entry.isDirectory) tree.toggle(entry.path);
			else onOpen(entry);
		},
		[tree, onOpen],
	);

	const startCreate = useCallback(
		(dir: string, kind: "file" | "directory") => {
			if (dir !== home) tree.expand(dir);
			setRenaming(null);
			setCreating({ dir, kind });
		},
		[home, tree],
	);

	const commitCreate = useCallback(
		async (name: string) => {
			if (!creating) return;
			const { dir, kind } = creating;
			setCreating(null);
			const path = await actions.create(dir, name, kind);
			if (!path) return;
			put(path);
			if (kind === "file") onOpen({ name, path, isDirectory: false, size: 0 });
			else tree.expand(path);
		},
		[creating, actions, put, onOpen, tree],
	);

	const commitRename = useCallback(
		async (path: string, name: string) => {
			setRenaming(null);
			const next = await actions.rename(path, name);
			if (next) put(next);
		},
		[actions, put],
	);

	/**
	 * Delete, then land the cursor somewhere sensible.
	 *
	 * Worked out before the rows change: after the refresh the removed ones are gone and the index
	 * that was next to them no longer means anything. Falling back to the row above is what the
	 * Finder does when you delete the last item in a folder.
	 */
	const removeSelected = useCallback(
		async (permanent: boolean) => {
			const doomed = selection.length > 0 ? selection : focus ? [focus] : [];
			if (doomed.length === 0) return;
			const gone = new Set(doomed);
			const survivors = tree.rows.filter(({ entry }) => !gone.has(entry.path));
			const first = tree.rows.findIndex(({ entry }) => gone.has(entry.path));
			const next = survivors.find((row) => tree.rows.indexOf(row) > first) ?? survivors.at(-1);

			if (!(await actions.remove(doomed, permanent))) return;
			if (next) put(next.entry.path);
			else {
				setSelection([]);
				setFocus(null);
			}
		},
		[selection, focus, tree.rows, actions, put],
	);

	const acted = useCallback(() => (selection.length > 0 ? selection : focus ? [focus] : []), [selection, focus]);

	const drag = useTreeDrag({
		root: home,
		pathsFor: (entry) => (chosen.has(entry.path) ? selection : [entry.path]),
		expand: tree.expand,
		isExpanded: (path) => tree.expanded.has(path),
		onTransfer: (paths, dir, mode) => void actions.transfer(paths, dir, mode),
		onImport: (sources, dir) => void actions.importInto(sources, dir),
	});

	function onRowClick(event: React.MouseEvent, entry: FileEntry, index: number) {
		focusTree();
		if (event.metaKey || event.ctrlKey) {
			// Add or drop one, without opening anything: this is building a selection, not browsing.
			setSelection((current) =>
				current.includes(entry.path) ? current.filter((path) => path !== entry.path) : [...current, entry.path],
			);
			setFocus(entry.path);
			return;
		}
		if (event.shiftKey && focus) {
			const from = tree.rows.findIndex((row) => row.entry.path === focus);
			if (from !== -1) {
				const [low, high] = from < index ? [from, index] : [index, from];
				setSelection(tree.rows.slice(low, high + 1).map((row) => row.entry.path));
				return;
			}
		}
		put(entry.path);
		activate(entry);
	}

	function onKeyDown(event: React.KeyboardEvent) {
		const mod = event.metaKey || event.ctrlKey;
		const index = tree.rows.findIndex((row) => row.entry.path === focus);
		const row = index === -1 ? null : tree.rows[index];

		if (mod && event.key === "c" && !event.altKey) return run(() => actions.copy(acted()));
		if (mod && event.key === "x") return run(() => actions.cut(acted()));
		if (mod && event.key === "v") return run(() => void actions.paste(targetDir));
		if (mod && event.altKey && event.code === "KeyC") return run(() => void actions.copyPath(acted(), event.shiftKey));
		if (mod && (event.key === "Backspace" || event.key === "Delete")) {
			return run(() => void removeSelected(event.shiftKey));
		}

		switch (event.key) {
			case "ArrowDown":
				return run(() => moveTo(index + 1));
			case "ArrowUp":
				return run(() => moveTo(index === -1 ? 0 : index - 1));
			case "Home":
				return run(() => moveTo(0));
			case "End":
				return run(() => moveTo(tree.rows.length - 1));
			case "ArrowRight":
				if (row?.entry.isDirectory && !tree.expanded.has(row.entry.path)) {
					return run(() => tree.expand(row.entry.path));
				}
				return run(() => moveTo(index + 1));
			case "ArrowLeft": {
				if (row?.entry.isDirectory && tree.expanded.has(row.entry.path)) {
					return run(() => tree.collapse(row.entry.path));
				}
				// Otherwise step out: the nearest row above that is one level shallower.
				if (!row) return;
				for (let i = index - 1; i >= 0; i--) {
					if (tree.rows[i].depth < row.depth) return run(() => moveTo(i));
				}
				return;
			}
			case "Enter":
			case " ":
				if (row) return run(() => activate(row.entry));
				return;
			case "F2":
				if (row) return run(() => setRenaming(row.entry.path));
				return;
			case "Escape":
				if (creating) return run(() => setCreating(null));
				if (tree.filter || tree.scope) {
					return run(() => {
						tree.setFilter("");
						tree.setScope(null);
					});
				}
				return;
			default:
				return;
		}

		function run(action: () => void) {
			event.preventDefault();
			event.stopPropagation();
			action();
		}
	}

	const menuEntry = menu.target;
	const menuDir = menuEntry ? (menuEntry.isDirectory ? menuEntry.path : dirName(menuEntry.path)) : home;
	const menuCount = menuEntry && chosen.has(menuEntry.path) ? selection.length : menuEntry ? 1 : 0;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{/*
			 * The filter, and the two things you do to a tree that are not about one row in it.
			 * 全部折叠 only once something is open — a permanently disabled button is furniture.
			 */}
			<div className="flex h-[30px] shrink-0 items-center gap-0.5 px-1">
				<SearchField
					value={tree.filter}
					onChange={tree.setFilter}
					placeholder={`搜索 ${baseName(home)} 内的文件`}
					className="min-w-0 flex-1"
					onEscape={() => tree.setScope(null)}
				/>
				<IconButton
					size="sm"
					label="新建文件"
					icon={<FilePlus2 size={12.5} strokeWidth={1.8} />}
					onClick={() => startCreate(targetDir, "file")}
				/>
				<IconButton
					size="sm"
					label="新建文件夹"
					icon={<FolderPlus size={12.5} strokeWidth={1.8} />}
					onClick={() => startCreate(targetDir, "directory")}
				/>
				{tree.expanded.size > 0 && (
					<IconButton
						size="sm"
						label="全部折叠"
						icon={<ChevronsDownUp size={12.5} strokeWidth={1.8} />}
						onClick={tree.collapseAll}
					/>
				)}
			</div>

			{/* Only while narrowed, and it says so in one row: which folder, and the way out. */}
			{tree.scope && (
				<button
					type="button"
					onClick={() => tree.setScope(null)}
					className="mx-1 mb-1 flex h-[20px] shrink-0 items-center gap-1 rounded-md bg-accent/12 px-1.5 text-caption text-accent transition-colors hover:bg-accent/20"
				>
					<span className="min-w-0 truncate">{`只看 ${baseName(tree.scope)}`}</span>
					<X size={9.5} strokeWidth={2.4} className="shrink-0" />
				</button>
			)}

			<Scroller className="flex-1" contentClassName="px-1 py-1">
				{/* biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard is handled on this node. */}
				<div
					ref={rowsHost}
					role="tree"
					aria-label="项目文件"
					tabIndex={0}
					data-ly-tree
					onKeyDown={onKeyDown}
					onContextMenu={(event) => menu.show(event, null)}
					{...drag.backgroundProps()}
					className={`flex min-h-full flex-col rounded-md outline-none ${
						drag.dropTarget === home ? "bg-accent/8 ring-1 ring-accent ring-inset" : ""
					}`}
				>
					{creating?.dir === home && (
						<NewRow
							depth={0}
							isDirectory={creating.kind === "directory"}
							onCommit={(name) => void commitCreate(name)}
							onCancel={() => setCreating(null)}
						/>
					)}

					{tree.rows.map(({ entry, depth }, index) => (
						<Fragment key={entry.path}>
							<TreeRow
								entry={entry}
								depth={depth}
								expanded={tree.expanded.has(entry.path)}
								selected={chosen.has(entry.path) || openPath === entry.path}
								focused={focus === entry.path && selection.length > 1}
								dirty={dirtyPaths.has(entry.path)}
								cut={cutSet.has(entry.path)}
								dropping={entry.isDirectory && drag.dropTarget === entry.path}
								renaming={renaming === entry.path}
								onRename={(name) => void commitRename(entry.path, name)}
								onRenameCancel={() => setRenaming(null)}
								onClick={(event) => onRowClick(event, entry, index)}
								onContextMenu={(event) => {
									// Right-clicking outside the selection acts on that row instead.
									if (!chosen.has(entry.path)) put(entry.path);
									focusTree();
									menu.show(event, entry);
								}}
								{...drag.rowProps(entry)}
							/>
							{creating?.dir === entry.path && (
								<NewRow
									depth={depth + 1}
									isDirectory={creating.kind === "directory"}
									onCommit={(name) => void commitCreate(name)}
									onCancel={() => setCreating(null)}
								/>
							)}
						</Fragment>
					))}

					{tree.rows.length === 0 && !creating && (
						<p className="px-2 py-6 text-center text-detail text-ink-faint">
							{tree.filter ? "没有匹配的文件" : "这个目录是空的"}
						</p>
					)}
				</div>
			</Scroller>

			{menu.open && (
				<FileMenu
					anchor={menu.anchor}
					onClose={menu.close}
					entry={menuEntry}
					dir={menuDir}
					count={menuCount}
					canPaste={actions.clipboard !== null}
					actions={{
						open: activate,
						openWith: (path) => void bridge.system.openIn(openWith.id, path),
						reveal: (path) => void bridge.workspace.reveal(path),
						// Single-quoted so a space or a bracket in the path cannot become shell syntax.
						openInTerminal: (dir) => runInTerminal(`cd '${dir.replaceAll("'", "'\\''")}'`),
						newFile: (dir) => startCreate(dir, "file"),
						newFolder: (dir) => startCreate(dir, "directory"),
						cut: () => actions.cut(acted()),
						copy: () => actions.copy(acted()),
						paste: (dir) => void actions.paste(dir),
						copyPath: (relative) => void actions.copyPath(acted(), relative),
						rename: setRenaming,
						duplicate: (path) => void actions.duplicate(path).then((next) => next && put(next)),
						remove: (permanent) => void removeSelected(permanent),
						findInFolder: (dir) => {
							tree.setScope(dir);
							tree.setFilter("");
						},
						collapseAll: tree.collapseAll,
						refresh: () => void tree.refreshOpen(),
					}}
				/>
			)}

			{/* Replace this file? Delete these three? The app's one confirmation, centred. */}
			{actions.prompt}
		</div>
	);
}
