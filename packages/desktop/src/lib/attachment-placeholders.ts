/**
 * Where an attachment sits in the sentence it was attached to.
 *
 * A draft used to be a body of text plus a bag of files, and the bag had no position: images were
 * always packed ahead of the text and documents always spliced onto the end, whatever order they
 * were picked up in. For one file that is invisible. For "compare this screenshot with the old one"
 * it is the whole meaning of the message, and it was being thrown away before the model ever saw it.
 *
 * A placeholder is written into the draft at the caret when a file is taken on — `【report.md】` —
 * so the ordering lives in the one place that already survives editing, undo, being queued, and
 * being restored from a queue: the text itself. Nothing new has to be kept in sync.
 *
 * Matching is by name and by ordinal: the second `【shot.png】` in the text belongs to the second
 * attachment called `shot.png`. Two files can share a name, so a name alone will not do; an opaque
 * id would be exact but would also be what the person sees and edits, and `【att:7f3b16f2】` in the
 * middle of a sentence is not a message anyone wants to write.
 */

/** The token written into the draft, and shown verbatim in the sent message. */
export function placeholderFor(name: string): string {
	return `【${name}】`;
}

/** How a text attachment's contents are spelled into the prompt, named and fenced. */
export function attachmentBody(name: string, text: string): string {
	return `\n\n### Attached file: ${name}\n\`\`\`\n${text}\n\`\`\`\n\n`;
}

/** How a file that could not be read is spelled instead — so the model does not answer as if it had. */
export function attachmentStub(name: string, mimeType?: string): string {
	return `\n\n[Attached file: ${name}${mimeType ? ` (${mimeType})` : ""} — contents not included]\n\n`;
}

/**
 * Whether a text block is an attachment's contents rather than something a person typed.
 *
 * Used when a sent message is edited. The editor works on `displayText`, which is the typed words
 * with the file bodies left out — so rebuilding the message from the edited text alone would send
 * the attachment names with nothing behind them. This is what lets the bodies be carried across
 * unchanged: they were never what was being edited.
 */
export function isAttachmentBody(text: string): boolean {
	return /^\n\n(?:### Attached file: |\[Attached file: )/.test(text);
}

export type Segment<File> = { kind: "text"; text: string } | { kind: "file"; file: File };

export interface Placement<File> {
	/** The draft cut at its placeholders, in reading order. */
	segments: Segment<File>[];
	/**
	 * Files with no placeholder to stand at.
	 *
	 * A draft can lose a placeholder honestly — the person deleted that part of the sentence, or the
	 * file arrived from somewhere with no caret to write at, like a queued message being restored.
	 * They still have to be sent, so they go on the end rather than being dropped: an attachment that
	 * silently does not arrive is much worse than one in the wrong place.
	 */
	unplaced: File[];
}

/**
 * Cut `text` at the placeholders that name one of `files`.
 *
 * A `【…】` that names nothing stays as literal text — the brackets are ordinary punctuation in
 * Chinese, and a message that happens to contain 【重要】 is not making a reference to anything.
 */
export function placeAttachments<File extends { name: string }>(text: string, files: File[]): Placement<File> {
	const segments: Segment<File>[] = [];
	const taken = new Set<File>();
	let plain = "";
	let at = 0;

	while (at < text.length) {
		const open = text.indexOf("【", at);
		if (open === -1) break;
		const close = text.indexOf("】", open + 1);
		if (close === -1) break;
		const name = text.slice(open + 1, close);
		const file = files.find((candidate) => candidate.name === name && !taken.has(candidate));
		if (!file) {
			// Not a reference. Keep the brackets and carry on looking after the opening one, so
			// 【a【b.md】 still finds the inner name.
			plain += text.slice(at, open + 1);
			at = open + 1;
			continue;
		}
		plain += text.slice(at, open);
		if (plain) segments.push({ kind: "text", text: plain });
		plain = "";
		segments.push({ kind: "file", file });
		taken.add(file);
		at = close + 1;
	}

	plain += text.slice(at);
	if (plain) segments.push({ kind: "text", text: plain });

	return { segments, unplaced: files.filter((file) => !taken.has(file)) };
}
