/**
 * Dragging rows around the tree, and dropping things onto it from outside.
 *
 * Kept out of the tree component because the interesting part is not the drawing: it is what a drop
 * is allowed to be. A folder cannot be dropped into itself or into anything under it — the first
 * would recurse until the disk filled and the second would delete what it was moving — and that
 * has to be decided during `dragover`, where the payload cannot be read back out of the
 * `DataTransfer` (the browser hides it until the drop). So the dragged paths are held here.
 *
 * Which gesture is which follows the platform: dragging moves, and holding ⌥ copies.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { FileEntry } from "../../../electron/ipc-types.ts";
import { dirName, isDescendantPath } from "../../lib/paths.ts";
import { bridge } from "../../services/index.ts";

/** Our own type, so a drag from this tree is distinguishable from a drag out of the Finder. */
const PATHS = "application/x-lyra-paths";

/** How long a collapsed folder has to be hovered before it opens to let you drop inside it. */
const SPRING_MS = 550;

export interface TreeDrag {
	/** The folder a drop would land in, for the row that should say so. */
	dropTarget: string | null;
	/** True while rows from this tree are being dragged, so the tree can dim them. */
	dragging: string[];
	rowProps(entry: FileEntry): {
		onDragStart(event: React.DragEvent): void;
		onDragEnd(): void;
		onDragOver(event: React.DragEvent): void;
		onDragLeave(): void;
		onDrop(event: React.DragEvent): void;
	};
	/** The empty space below the rows, which drops into the folder the tree is showing. */
	backgroundProps(): {
		onDragOver(event: React.DragEvent): void;
		onDragLeave(): void;
		onDrop(event: React.DragEvent): void;
	};
}

export function useTreeDrag({
	root,
	pathsFor,
	expand,
	isExpanded,
	onTransfer,
	onImport,
}: {
	/** Where a drop on the background goes. */
	root: string;
	/** The rows a drag starting on this one should carry: the selection, or just this row. */
	pathsFor(entry: FileEntry): string[];
	expand(path: string): void;
	isExpanded(path: string): boolean;
	onTransfer(paths: string[], dir: string, mode: "copy" | "cut"): void;
	onImport(sources: string[], dir: string): void;
}): TreeDrag {
	const [dragging, setDragging] = useState<string[]>([]);
	const [dropTarget, setDropTarget] = useState<string | null>(null);
	/** The folder being hovered and the timer that will open it. */
	const spring = useRef<{ path: string; timer: number } | null>(null);

	const cancelSpring = useCallback(() => {
		if (spring.current) window.clearTimeout(spring.current.timer);
		spring.current = null;
	}, []);

	useEffect(() => cancelSpring, [cancelSpring]);

	/** Whether a drop into `dir` is legal, given what is being dragged. */
	const allows = useCallback(
		(dir: string, external: boolean) => {
			if (external) return true;
			if (dragging.length === 0) return false;
			return !dragging.some((path) => path === dir || isDescendantPath(path, dir));
		},
		[dragging],
	);

	/** Hovering a folder long enough opens it, so you can drop into something that was shut. */
	const springOpen = useCallback(
		(entry: FileEntry) => {
			if (!entry.isDirectory || isExpanded(entry.path)) return cancelSpring();
			if (spring.current?.path === entry.path) return;
			cancelSpring();
			spring.current = {
				path: entry.path,
				timer: window.setTimeout(() => expand(entry.path), SPRING_MS),
			};
		},
		[cancelSpring, expand, isExpanded],
	);

	const accept = useCallback(
		(event: React.DragEvent, dir: string) => {
			const external = event.dataTransfer.types.includes("Files") && !event.dataTransfer.types.includes(PATHS);
			if (!allows(dir, external)) {
				event.dataTransfer.dropEffect = "none";
				setDropTarget(null);
				return false;
			}
			event.preventDefault();
			// ⌥ copies, matching the Finder; without it a drag inside one tree is a move.
			event.dataTransfer.dropEffect = external || event.altKey ? "copy" : "move";
			setDropTarget(dir);
			return true;
		},
		[allows],
	);

	const finish = useCallback(
		(event: React.DragEvent, dir: string) => {
			event.preventDefault();
			event.stopPropagation();
			cancelSpring();
			setDropTarget(null);

			const carried = event.dataTransfer.getData(PATHS);
			if (carried) {
				const paths = JSON.parse(carried) as string[];
				if (allows(dir, false)) onTransfer(paths, dir, event.altKey ? "copy" : "cut");
				setDragging([]);
				return;
			}

			// From outside: `File.path` was removed in Electron 32, so the preload resolves it.
			const sources = [...event.dataTransfer.files].map((file) => bridge.files.pathForDrop(file)).filter(Boolean);
			if (sources.length > 0) onImport(sources, dir);
		},
		[allows, cancelSpring, onImport, onTransfer],
	);

	const rowProps = useCallback(
		(entry: FileEntry) => ({
			onDragStart: (event: React.DragEvent) => {
				const paths = pathsFor(entry);
				setDragging(paths);
				event.dataTransfer.setData(PATHS, JSON.stringify(paths));
				// So dropping into a text field elsewhere writes something legible rather than nothing.
				event.dataTransfer.setData("text/plain", paths.join("\n"));
				event.dataTransfer.effectAllowed = "copyMove";
			},
			onDragEnd: () => {
				setDragging([]);
				setDropTarget(null);
				cancelSpring();
			},
			onDragOver: (event: React.DragEvent) => {
				// A file is not a destination; dropping on one means dropping beside it.
				const dir = entry.isDirectory ? entry.path : dirName(entry.path);
				if (accept(event, dir)) springOpen(entry);
				event.stopPropagation();
			},
			onDragLeave: cancelSpring,
			onDrop: (event: React.DragEvent) => finish(event, entry.isDirectory ? entry.path : dirName(entry.path)),
		}),
		[accept, cancelSpring, finish, pathsFor, springOpen],
	);

	const backgroundProps = useCallback(
		() => ({
			onDragOver: (event: React.DragEvent) => void accept(event, root),
			onDragLeave: () => setDropTarget(null),
			onDrop: (event: React.DragEvent) => finish(event, root),
		}),
		[accept, finish, root],
	);

	return { dropTarget, dragging, rowProps, backgroundProps };
}
