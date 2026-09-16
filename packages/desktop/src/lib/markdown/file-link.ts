/**
 * What a local file link should show in the transcript.
 *
 * Models write [`docs/issue/very-long-name.md`](docs/issue/very-long-name.md). Painting that whole
 * path inside a chip forces a wrap through the middle of a word. The chip keeps the filename;
 * overflow is an ellipsis, never a second line. The path belongs on the tooltip.
 */
export function fileLinkCaption(label: string, path: string): { text: string; tip: string } {
	const trimmed = label.trim().replace(/:\d+(?:-\d+)?$/, "");
	const base = path.split(/[/\\]/).pop()?.trim() || path;
	if (!trimmed) return { text: base, tip: path };
	const pathLike = /[/\\]/.test(trimmed) || trimmed === base;
	if (!pathLike) return { text: trimmed, tip: path };
	return { text: trimmed.split(/[/\\]/).pop() || base, tip: trimmed };
}
