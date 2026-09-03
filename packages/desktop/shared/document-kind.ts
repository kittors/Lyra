/**
 * Which files this app can show as something other than text.
 *
 * One table, on the boundary, because both sides need it and they must agree: the window decides
 * which pane to draw and the main process decides which reader to run, and a file that is a
 * spreadsheet to one and text to the other opens as mojibake.
 *
 * No Electron import, so it can be read and tested without one.
 *
 * In `shared/` rather than beside the main process, which is where it used to sit. The renderer
 * imported it across that boundary — harmless in itself, since there is nothing to import *from*
 * Electron here, but indistinguishable to any tool from the imports that are not harmless. A file
 * both processes own belongs in neither.
 */

export type DocumentKind = "workbook" | "database" | "pdf" | "document";

/**
 * Extensions, mapped to how the file is opened.
 *
 * `.docx` and not `.doc`: the old binary Word format is a different thing entirely — a compound
 * file, not a zip of XML — and nothing here can read it. Claiming it and then failing would be
 * worse than leaving it to the system, which is what falls through to the plain binary pane.
 *
 * `.db` is deliberately included even though it names no format at all. In practice it is SQLite;
 * when it is not, the reader says so and the pane shows the error rather than a wrong guess.
 *
 * `.csv` is deliberately *not* here. It is already text, it already opens in a real editor, and it
 * is already saveable — turning it into a read-only grid would be a feature that took one away.
 */
const KINDS: Record<string, DocumentKind> = {
	xlsx: "workbook",
	xlsm: "workbook",
	xlsb: "workbook",
	xls: "workbook",
	ods: "workbook",

	sqlite: "database",
	sqlite3: "database",
	db: "database",

	pdf: "pdf",

	docx: "document",
};

export function documentKind(path: string): DocumentKind | null {
	const name = path.toLowerCase().split(/[/\\]/).pop() ?? "";
	const dot = name.lastIndexOf(".");
	if (dot <= 0) return null;
	return KINDS[name.slice(dot + 1)] ?? null;
}
