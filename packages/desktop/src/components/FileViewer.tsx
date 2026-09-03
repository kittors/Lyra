import { FileWarning } from "lucide-react";
import type { FileContents } from "../../electron/ipc-types.ts";
import { CodeEditor } from "./CodeEditor.tsx";
import { documentKind } from "../../shared/document-kind.ts";
import { FileTabs } from "./files/FileTabs.tsx";
import { PdfView, WordView } from "./files/DocumentView.tsx";
import { ImagePane } from "./files/ImagePane.tsx";
import { SheetView } from "./files/SheetView.tsx";
import { Markdown } from "./Markdown.tsx";
import { directoryOf } from "./markdown-assets.ts";
import { Scroller } from "./Scroller.tsx";
import { useApp } from "../store.ts";
import { useOpenFile } from "../store/openFile.ts";

const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "avif", "bmp", "ico", "svg"]);
const VIDEO = new Set(["mp4", "webm", "mov", "mkv", "m4v"]);
const AUDIO = new Set(["mp3", "wav", "flac", "ogg", "m4a", "aac"]);

function extensionOf(name: string): string {
	const lower = name.toLowerCase();
	const dot = lower.lastIndexOf(".");
	return dot > 0 ? lower.slice(dot + 1) : "";
}

export type FileKind =
	| "image"
	| "video"
	| "audio"
	| "markdown"
	| "json"
	| "text"
	| "binary"
	/** A spreadsheet or a SQLite database — both drawn as a grid; see `SheetView`. */
	| "sheet"
	| "pdf"
	| "document";

/**
 * What kind of thing this file is, for anything deciding how to treat it.
 *
 * Exported because the pane's header asks the same question — 「格式化」 is for JSON and nothing
 * else — and two answers to it would drift.
 */
export function fileKind(name: string, contents: FileContents | null): FileKind {
	const ext = extensionOf(name);
	if (IMAGE.has(ext)) return "image";
	if (VIDEO.has(ext)) return "video";
	if (AUDIO.has(ext)) return "audio";
	/*
	 * Documents, before the NUL-byte check that would otherwise call all of them binary.
	 *
	 * `documentKind` is shared with the main process — see `shared/document-kind.ts` — because
	 * the two have to agree about what a `.xlsx` is. The window decides which pane to draw and the
	 * main process decides which reader to run; disagreement there is a file that opens as
	 * mojibake in a pane that was expecting rows.
	 */
	const document = documentKind(name);
	if (document === "workbook" || document === "database") return "sheet";
	if (document === "pdf") return "pdf";
	if (document === "document") return "document";
	// A media extension wins over the NUL-byte check: a PNG is "binary" and still viewable.
	if (contents?.binary) return "binary";
	if (ext === "md" || ext === "mdx") return "markdown";
	if (ext === "json" || ext === "jsonc") return "json";
	return "text";
}

/**
 * One file, shown the way that file wants to be shown.
 *
 * A single "file contents" pane that renders everything as text is wrong for most of what is
 * actually in a project: an image becomes a wall of mojibake, a video becomes nothing at all,
 * and Markdown becomes the one thing it is least useful as. Each kind gets the treatment that
 * makes it legible, and the text kinds all get a real editor rather than a read-only dump.
 */
export function FileViewer({
	path,
	name,
	contents,
	draft,
	onDraft,
	onSaved,
}: {
	path: string;
	name: string;
	contents: FileContents;
	/** Unsaved edits, held by the browser so switching files does not discard them. */
	draft: string | undefined;
	onDraft: (text: string | undefined) => void;
	onSaved: () => void;
}) {
	const kind = fileKind(name, contents);
	/*
	 * How to read, not what is being read — so it lives in the store, where the header's controls
	 * can reach it. This component used to own both of these and draw its own toolbar for them;
	 * that row cost a line of the file on every file, for four things that are the same every time.
	 */
	const wrap = useOpenFile((s) => s.wrap);
	const showSource = useOpenFile((s) => s.showSource);

	const text = draft ?? contents.text;
	// Truncated files must not be saved: writing back the head would delete the rest.
	const readOnly = contents.truncated;

	const media = window.lyra.files.mediaUrl(path);

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			{/* Where the toolbar was: the files this pane has had open. */}
			<FileTabs />

			{kind === "image" ? (
				// Zoom and pan, because an icon and a screenshot are both images and neither is
				// legible at "whatever fits the pane" — see `ImagePane`.
				<ImagePane key={path} src={media} name={name} />
			) : kind === "sheet" ? (
				<SheetView key={path} path={path} />
			) : kind === "pdf" ? (
				<PdfView key={path} path={path} name={name} />
			) : kind === "document" ? (
				<WordView key={path} path={path} />
			) : kind === "video" ? (
				<div className="flex min-h-0 flex-1 items-center justify-center bg-black/85 p-2">
					{/* biome-ignore lint/a11y/useMediaCaption: a file preview has no caption track. */}
					<video src={media} controls className="max-h-full max-w-full rounded-md" />
				</div>
			) : kind === "audio" ? (
				<div className="flex min-h-0 flex-1 items-center justify-center p-4">
					{/* biome-ignore lint/a11y/useMediaCaption: a file preview has no caption track. */}
					<audio src={media} controls className="w-full max-w-[420px]" />
				</div>
			) : kind === "binary" ? (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
					<FileWarning size={26} strokeWidth={1.4} className="text-ink-faint" />
					<p className="text-label text-ink-muted">二进制文件，无法以文本显示。</p>
					<p className="text-detail text-ink-faint">{formatBytes(contents.bytes)}</p>
				</div>
			) : kind === "markdown" && !showSource ? (
				<Scroller className="flex-1" contentClassName="px-3">
					<div className="py-3">
						{/*
						 * The two things a rendered document needs beyond its own text.
						 *
						 * `baseDir` is what `<img src="assets/logo.png">` is relative to — this file's own
						 * folder — and `remoteImages` says its https references may be fetched. Given here
						 * and nowhere else: this is a file the user opened off their own disk, which is a
						 * different thing from a comment that arrived over the network. See `Markdown`.
						 */}
						<Markdown text={text} baseDir={directoryOf(path)} remoteImages />
					</div>
				</Scroller>
			) : (
				<CodeEditor
					path={path}
					text={text}
					readOnly={readOnly}
					wrap={wrap}
					onChange={(next) => onDraft(next === contents.text ? undefined : next)}
					/*
					 * ⌘S and the header's button are the same save, so it lives in the store rather
					 * than in either of them — see `useOpenFile.save`.
					 */
					onSave={() =>
						void useOpenFile
							.getState()
							.save()
							.then((error) => {
								if (error) useApp.getState().notify(error, "error");
								else onSaved();
							})
					}
				/>
			)}
		</div>
	);
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
