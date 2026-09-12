/**
 * Files that are documents rather than text: spreadsheets and databases, read into a shape the
 * window can draw as a table.
 *
 * Read here rather than in the renderer for the same reason everything else on this side is: these
 * are files on disk behind a project boundary, and a parser that runs in the page would need the
 * bytes handed to it anyway. Doing the work here also means the renderer receives rows — small,
 * structured, already bounded — rather than a forty-megabyte workbook it has to keep alive.
 *
 * Both formats come back as the same thing: named sheets of cells. A spreadsheet has sheets and a
 * database has tables, and once you are drawing a grid the difference is what the tab is called.
 */

import { readFile } from "node:fs/promises";

/** One grid: a sheet of a workbook, or a table of a database. */
interface DocumentSheet {
	name: string;
	/** Column headers. For a spreadsheet these are A, B, C…; for a table, its columns. */
	columns: string[];
	/** Row-major cells, already stringified — the window draws them, it does not compute with them. */
	rows: string[][];
	/**
	 * How many rows there are in total, which is not always how many are here.
	 *
	 * A table with two million rows is not something anybody scrolls, and shipping it across the
	 * boundary would cost more than the app has. The grid shows what arrived and says what was left.
	 */
	total: number;
}

export interface DocumentData {
	kind: "sheets" | "tables";
	sheets: DocumentSheet[];
	/** Set when the file could not be read at all, in the user's own language. */
	error?: string;
}

/**
 * How much of a sheet is worth moving.
 *
 * Two thousand rows is more than anyone reads in a preview pane and small enough to render without
 * virtualising. What is cut off is said on screen rather than silently dropped.
 */
const MAX_ROWS = 2000;
/** Columns past this are almost always empty padding a tool left behind. */
const MAX_COLUMNS = 64;

/**
 * A workbook, sheet by sheet.
 *
 * `raw: false` so what comes back is what Excel shows — a date as a date, a percentage as a
 * percentage — rather than the serial number underneath it. Someone previewing a spreadsheet wants
 * the spreadsheet, not its storage format.
 */
export async function readWorkbook(path: string): Promise<DocumentData> {
	try {
		const { read, utils } = await import("xlsx");
		const workbook = read(await readFile(path), { type: "buffer", cellDates: true, dense: false });

		const sheets = workbook.SheetNames.slice(0, 32).map((name) => {
			const sheet = workbook.Sheets[name];
			const grid = utils.sheet_to_json<string[]>(sheet, {
				header: 1,
				raw: false,
				defval: "",
				blankrows: false,
			}) as unknown as string[][];

			const width = Math.min(MAX_COLUMNS, Math.max(0, ...grid.map((row) => row.length)));
			return {
				name,
				/*
				 * Spreadsheet column letters, not the first row.
				 *
				 * Whether row 1 is a header is a guess, and a wrong guess eats a row of data. Excel
				 * itself does not guess: it labels the columns A, B, C and leaves the first row where
				 * it is, which is also what makes a cell reference in a formula readable.
				 */
				columns: Array.from({ length: width }, (_, index) => utils.encode_col(index)),
				rows: grid.slice(0, MAX_ROWS).map((row) => padTo(row.map(cell), width)),
				total: grid.length,
			};
		});

		return { kind: "sheets", sheets };
	} catch (error) {
		return { kind: "sheets", sheets: [], error: describe(error) };
	}
}

/**
 * A SQLite database, table by table.
 *
 * `node:sqlite` rather than a dependency: it is in the runtime Electron already ships, it opens
 * files read-only, and adding a native module to this app for a preview pane would mean rebuilding
 * it per platform on every release.
 *
 * Read-only is not a detail. This is a *preview* — opening someone's database in a file browser
 * must not be able to write to it, and a journal file appearing beside a repository because you
 * glanced at it would be a bug with a bad name.
 */
export async function readDatabase(path: string): Promise<DocumentData> {
	let database: { close(): void; prepare(sql: string): { all(...params: unknown[]): unknown[] } } | null = null;
	try {
		const { DatabaseSync } = await import("node:sqlite");
		database = new DatabaseSync(path, { readOnly: true });

		const names = database
			.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
			.all()
			.map((row) => String((row as { name: string }).name));

		const sheets = names.slice(0, 64).map((name) => {
			// Quoted by doubling, which is SQLite's own escape — a table really can be called `a"b`.
			const quoted = `"${name.replaceAll('"', '""')}"`;
			const total = Number((database!.prepare(`SELECT COUNT(*) AS n FROM ${quoted}`).all()[0] as { n: number }).n);
			const rows = database!.prepare(`SELECT * FROM ${quoted} LIMIT ${MAX_ROWS}`).all() as Record<string, unknown>[];
			const columns = rows.length > 0 ? Object.keys(rows[0]).slice(0, MAX_COLUMNS) : columnsOf(database!, quoted);
			return {
				name,
				columns,
				rows: rows.map((row) => columns.map((column) => cell(row[column]))),
				total,
			};
		});

		return { kind: "tables", sheets };
	} catch (error) {
		return { kind: "tables", sheets: [], error: describe(error) };
	} finally {
		try {
			database?.close();
		} catch {
			// Closing a database that never opened is not worth reporting.
		}
	}
}

/** An empty table still has columns, and they are worth showing. */
function columnsOf(
	database: { prepare(sql: string): { all(...params: unknown[]): unknown[] } },
	quoted: string,
): string[] {
	try {
		return database
			.prepare(`PRAGMA table_info(${quoted})`)
			.all()
			.map((row) => String((row as { name: string }).name))
			.slice(0, MAX_COLUMNS);
	} catch {
		return [];
	}
}

/**
 * One value, as text.
 *
 * A BLOB is described rather than decoded: it is bytes, frequently an image, and pasting its
 * contents into a table cell produces a screenful of noise where a size would have been useful.
 */
function cell(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (value instanceof Uint8Array) return `[${value.length} 字节]`;
	if (value instanceof Date) return value.toISOString().replace("T", " ").slice(0, 19);
	return String(value);
}

function padTo(row: string[], width: number): string[] {
	const out = row.slice(0, width);
	while (out.length < width) out.push("");
	return out;
}

function describe(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return `打不开这个文件：${message}`;
}
