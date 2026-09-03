/**
 * The project's files: the tree, and nothing else.
 *
 * Opening one hands it to the `file` pane rather than showing it here. The two used to be halves
 * of this component — a tree on the left, the file on the right, with a breakpoint that stacked
 * them and a draggable seam between them. All of that was this component reimplementing, badly and
 * for two panes only, what the dock now does for every pane: split either way, drag the boundary,
 * put one away, make one full screen.
 *
 * What the tree contains, what right-clicking it offers and what happens to a file when you rename
 * it all live in `files/`.
 */

import { Folder } from "lucide-react";
import { useDock } from "../dock/store.ts";
import { companionOf } from "../panels/definitions.tsx";
import { FileTree } from "./files/FileTree.tsx";
import { PanelEmpty } from "../ui/layout/PanelEmpty.tsx";
import { useApp } from "../store.ts";
import { useOpenFile } from "../store/openFile.ts";

export function FileBrowser() {
	const workspace = useApp((s) => s.workspace);
	const openPath = useOpenFile((s) => s.path);
	const dirty = useOpenFile((s) => s.drafts);
	const root = workspace?.path ?? null;

	/*
	 * Letting go of the last project's file is not this pane's job — see `useProjectFiles` in
	 * `App.tsx`. It used to be done here, in an effect that only ran while this pane was mounted, so
	 * closing the tree and then changing projects left the editor holding a file from the old one.
	 */

	if (!workspace || !root) {
		return (
			<PanelEmpty icon={Folder} title="文件">
				先打开一个项目，这里显示它的文件。
			</PanelEmpty>
		);
	}

	return (
		<FileTree
			root={root}
			openPath={openPath}
			dirtyPaths={new Set(Object.keys(dirty))}
			onOpen={(entry) => {
				void useOpenFile.getState().open(entry);
				/*
				 * Make sure there is somewhere for it to appear.
				 *
				 * `open` focuses the pane if it already exists rather than adding a second, so
				 * clicking through a folder does not stack up editors — and if it was closed, the
				 * click that needs it is what brings it back.
				 */
				useDock.getState().open("file", companionOf("file"));
			}}
			onMoved={(from, to) => useOpenFile.getState().moved(from, to)}
			onRemoved={(paths) => useOpenFile.getState().removed(paths)}
		/>
	);
}
