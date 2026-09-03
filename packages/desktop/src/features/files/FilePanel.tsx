/**
 * The open file, as a pane of its own.
 *
 * It used to be the right-hand half of the file browser, which meant it could only ever be beside
 * the tree, at whatever width was left over, and it disappeared the moment you put the tree away.
 * As a pane it goes wherever the file does: under the tree, across the window, full screen while
 * you read something long, or in the corner while the conversation has the room.
 *
 * All it does is choose between four states. What a file *looks like* is `FileViewer`'s problem,
 * and what is open is the store's.
 */

import { FileText } from "lucide-react";
import { FileViewer } from "./FileViewer.tsx";
import { PanelEmpty } from "../../ui/layout/PanelEmpty.tsx";
import { useOpenFile } from "../../store/openFile.ts";

export function FilePanel() {
	const path = useOpenFile((s) => s.path);
	const name = useOpenFile((s) => s.name);
	const contents = useOpenFile((s) => s.contents);
	const loading = useOpenFile((s) => s.loading);
	const opening = useOpenFile((s) => s.opening);
	const draft = useOpenFile((s) => (s.path ? s.drafts[s.path] : undefined));

	if (!path && !opening) {
		return (
			<PanelEmpty icon={FileText} title="文件内容">
				在文件面板里选一个文件，这里显示它的内容。
			</PanelEmpty>
		);
	}

	/*
	 * 「读取中」 only when there is genuinely nothing to show — the very first file.
	 *
	 * Switching between files keeps the previous one on screen until the next has arrived, which
	 * on a local disk is a few milliseconds. Unmounting the viewer for that interval is what made
	 * every tab click flash: the placeholder has none of the code theme's colours, so the pane
	 * went warm, white, warm.
	 */
	if (loading && !contents) return <p className="ly-pulse p-6 text-center text-detail text-ink-faint">读取中…</p>;
	if (!contents || !path) return <p className="p-6 text-center text-detail text-ink-faint">读不到这个文件</p>;

	return (
		<FileViewer
			/*
			 * Deliberately not keyed on the path.
			 *
			 * It used to be, to give each file a fresh editor rather than one inheriting the last
			 * file's undo history — and that is a real requirement, but this was the wrong place to
			 * meet it. Re-keying here unmounts the *whole pane* on every tab click: the header, the
			 * tab strip and the viewer all torn down and rebuilt, which is a visible blank frame
			 * between two files. Measured at six unmounts for six switches.
			 *
			 * `CodeEditor` already rebuilds its own state when `path` changes — see the effect keyed
			 * `[path, readOnly]` — so the undo history resets without anything leaving the document.
			 * The viewers that genuinely need a reset (zoom, sheet scroll) carry their own key.
			 */
			path={path}
			name={name ?? path}
			contents={contents}
			draft={draft}
			onDraft={(text) => useOpenFile.getState().setDraft(path, text)}
			onSaved={() => void useOpenFile.getState().reread(path)}
		/>
	);
}
