/**
 * How a text file sits on disk — a BOM or not, CRLF or LF — so the file tools can work on one plain
 * form of it and write the rest back the way it was.
 *
 * Git for Windows defaults to `core.autocrlf=true`, so a checkout there is CRLF almost throughout,
 * and Windows editors like to lead with a UTF-8 BOM. Splitting on `\n` handed the model a `\r` at
 * the end of every line; `edit` joined a patch back with `\n` into a CRLF file, never found a
 * multi-line `old_string`, and dropped the BOM along with the first line it was glued to; `write`
 * flattened a whole file to LF. So read, edit and write all go through here: matching, applying and
 * displaying happen on the decoded text (no BOM, `\n` breaks), and only the bytes going back to disk
 * are re-encoded.
 *
 * The decoded text is also what the fingerprint, the line count and the shown-characters record are
 * taken from. Those three must come from the same text everywhere — read computing them on one form
 * and edit on another is an edit refused as stale by the tool's own bookkeeping.
 */

export interface TextLayout {
	/** A UTF-8 byte order mark led the file. It is not part of line 1, so it is kept aside. */
	bom: boolean;
	/**
	 * `\r\n` when every break in the file is one; `\n` for a LF file or a file with no break at all.
	 *
	 * `null` for a file that mixes the two, which is left exactly as it is in both directions:
	 * converting it either way rewrites every line of the minority kind, lines nobody edited.
	 */
	eol: "\n" | "\r\n" | null;
}

const BOM = "\uFEFF";
/** A `\r` that does not start a CRLF, or a `\n` that does not end one. */
const LONE_BREAK = /\r(?!\n)|(?<!\r)\n/;

export function decodeText(raw: string): { text: string; layout: TextLayout } {
	const bom = raw.startsWith(BOM);
	const body = bom ? raw.slice(1) : raw;
	const crlf = body.includes("\r\n");
	const eol = !crlf ? "\n" : LONE_BREAK.test(body) ? null : "\r\n";
	return { text: eol === "\r\n" ? body.replaceAll("\r\n", "\n") : body, layout: { bom, eol } };
}

/**
 * Decoded text back into the file's own form.
 *
 * `\r?\n` rather than `\n`, so a CRLF that reached here some other way cannot come out as `\r\r\n`.
 */
export function encodeText(text: string, layout: TextLayout): string {
	const body = layout.eol === "\r\n" ? text.replace(/\r?\n/g, "\r\n") : text;
	return layout.bom ? BOM + body : body;
}

/**
 * Text the model supplied — an `old_string`, a whole file — in the decoded form, so it can be
 * compared with the decoded file and re-encoded with it. A model copies breaks from wherever it saw
 * them, so either kind has to be accepted. A mixed file is compared byte for byte, as it is stored.
 */
export function decodeInput(text: string, layout: TextLayout): string {
	return layout.eol === null ? text : text.replaceAll("\r\n", "\n");
}
