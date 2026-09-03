/**
 * A PDF, and a Word document.
 *
 * Two formats, one file, because they answer the same question in the same place: a document you
 * read rather than edit, laid out on a page.
 *
 * **PDF** goes to Chromium's own viewer. Electron ships it, it is the same renderer people use
 * every day in a browser — with search, printing, and a page thumbnail strip — and every
 * alternative means bundling a copy of pdf.js to get something worse. It reaches the file through
 * the app's own media protocol, which is already scoped to the open project.
 *
 * **.docx** is rendered by `docx-preview`, which walks the document XML and produces the page as
 * HTML: real page boxes, real margins, tables, lists, images, and the document's own fonts where
 * they resolve. Converting to Markdown was the alternative and it is a different product — it
 * throws away the layout, which for a Word document is most of what the author did.
 */

import { useEffect, useRef, useState } from "react";
import { Text } from "../../ui/primitives/Text.tsx";
import { bridge } from "../../services/index.ts";

export function PdfView({ path, name }: { path: string; name: string }) {
	/*
	 * `<embed>`, not `<iframe>`.
	 *
	 * Chromium mounts its PDF viewer as a plugin, and `<embed type="application/pdf">` is the
	 * element that reaches it directly. An iframe would work too, but it also brings a browsing
	 * context along with it — one this app has no use for and would have to reason about.
	 */
	return (
		<embed
			src={bridge.files.mediaUrl(path)}
			type="application/pdf"
			aria-label={name}
			className="min-h-0 w-full flex-1"
		/>
	);
}

export function WordView({ path }: { path: string }) {
	const host = useRef<HTMLDivElement>(null);
	const [error, setError] = useState<string | null>(null);
	const [ready, setReady] = useState(false);

	useEffect(() => {
		let live = true;
		const container = host.current;
		if (!container) return;

		setError(null);
		setReady(false);
		container.replaceChildren();

		void (async () => {
			try {
				/*
				 * Bytes over IPC, not a fetch of the media protocol.
				 *
				 * That protocol is registered as a *standard* scheme, which means a fetch from the
				 * page is cross-origin — and a cross-origin fetch needs CORS headers on the response
				 * or it fails with a bare "Failed to fetch", which is exactly what it did. The file
				 * IPC already carries the project boundary and hands back the bytes directly.
				 */
				const bytes = await bridge.files.bytes(path);
				if (!bytes) throw new Error("读不到这个文件");
				if (!live) return;
				const blob = new Blob([bytes as unknown as BlobPart]);

				const { renderAsync } = await import("docx-preview");
				await renderAsync(blob, container, undefined, {
					className: "ly-docx",
					inWrapper: true,
					// The page's own paper, so it reads as a document rather than as a web page.
					renderHeaders: true,
					renderFooters: true,
					renderFootnotes: true,
					renderEndnotes: true,
					breakPages: true,
					ignoreWidth: false,
					ignoreHeight: false,
					experimental: true,
				});
				if (live) setReady(true);
			} catch (cause) {
				if (live) setError(cause instanceof Error ? cause.message : String(cause));
			}
		})();

		return () => {
			live = false;
		};
	}, [path]);

	return (
		<div className="relative min-h-0 flex-1 overflow-auto bg-[var(--color-card)]">
			{error && (
				<div className="flex h-full items-center justify-center px-6 text-center">
					<Text size="label" tone="muted">{`打不开这个文档：${error}`}</Text>
				</div>
			)}
			<div ref={host} className={`ly-docx-host ${ready ? "" : "opacity-0"}`} />
		</div>
	);
}
