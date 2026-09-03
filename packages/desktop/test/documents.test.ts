/**
 * Files that are documents rather than text, read into rows.
 *
 * Against real files — a workbook written by SheetJS and a database written by `node:sqlite` —
 * because the interesting failures are all at the edges of those libraries: a date that comes back
 * as a serial number, a BLOB pasted into a cell as raw bytes, an empty table that loses its
 * columns, a table whose name contains a quote.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { documentKind } from "../shared/document-kind.ts";
import { readDatabase, readWorkbook } from "../electron/documents.ts";

let dir: string;
let workbook: string;
let database: string;

before(async () => {
	dir = mkdtempSync(join(tmpdir(), "lyra-docs-"));
	workbook = join(dir, "book.xlsx");
	database = join(dir, "data.sqlite");

	const { utils, write } = await import("xlsx");
	const book = utils.book_new();
	const stock = utils.aoa_to_sheet([
		["名称", "数量", "占比"],
		["苹果", 12, 0.25],
		["香蕉", 340, 0.5],
	]);
	// A number format on the cell, which is what makes 0.25 display as 25% in Excel — and the
	// thing `raw: false` exists to honour.
	stock.C2.z = "0%";
	stock.C3.z = "0%";
	utils.book_append_sheet(book, stock, "库存");
	utils.book_append_sheet(book, utils.aoa_to_sheet([["只有一列"], ["值"]]), "第二张");
	writeFileSync(workbook, write(book, { type: "buffer", bookType: "xlsx" }) as Buffer);

	const { DatabaseSync } = await import("node:sqlite");
	const db = new DatabaseSync(database);
	db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, avatar BLOB)");
	db.exec("CREATE TABLE empty_one (a TEXT, b INTEGER)");
	db.exec('CREATE TABLE "odd""name" (x TEXT)');
	db.prepare("INSERT INTO users VALUES (?, ?, ?)").run(1, "小明", new Uint8Array([1, 2, 3, 4]));
	db.prepare("INSERT INTO users VALUES (?, ?, ?)").run(2, "小红", null);
	db.prepare('INSERT INTO "odd""name" VALUES (?)').run("ok");
	db.close();
});

after(() => {
	rmSync(dir, { recursive: true, force: true });
});

test("每种文件都知道自己该怎么打开", () => {
	assert.equal(documentKind("book.xlsx"), "workbook");
	assert.equal(documentKind("data.SQLITE"), "database");
	assert.equal(documentKind("report.pdf"), "pdf");
	assert.equal(documentKind("spec.docx"), "document");
	// csv 仍然是可编辑的文本，不进表格视图。
	assert.equal(documentKind("rows.csv"), null);
	assert.equal(documentKind("main.ts"), null);
	assert.equal(documentKind("Makefile"), null);
});

test("a workbook comes back sheet by sheet, in the order the book has them", async () => {
	const data = await readWorkbook(workbook);
	assert.equal(data.error, undefined);
	assert.deepEqual(
		data.sheets.map((sheet) => sheet.name),
		["库存", "第二张"],
	);
});

test("the first row is data, not a header — Excel does not guess and neither does this", async () => {
	const data = await readWorkbook(workbook);
	const sheet = data.sheets[0];
	assert.deepEqual(sheet.columns, ["A", "B", "C"]);
	assert.deepEqual(sheet.rows[0], ["名称", "数量", "占比"]);
	assert.equal(sheet.rows[1][0], "苹果");
	assert.equal(sheet.total, 3);
});

test("cells come back as the spreadsheet shows them, not as their storage", async () => {
	const data = await readWorkbook(workbook);
	// A cell formatted as a percentage reads as one; the stored value is 0.25.
	assert.equal(data.sheets[0].rows[1][2], "25%");
	// And everything is already text, so the grid never has to decide how to print a number.
	for (const row of data.sheets[0].rows) for (const cell of row) assert.equal(typeof cell, "string");
});

test("short rows are padded, so the grid stays rectangular", async () => {
	const data = await readWorkbook(workbook);
	for (const sheet of data.sheets) {
		for (const row of sheet.rows) assert.equal(row.length, sheet.columns.length);
	}
});

test("a file that is not a workbook comes back as something, never as a throw", async () => {
	/*
	 * SheetJS is deliberately forgiving — handed prose it will read it as a one-cell CSV rather
	 * than refuse — so what is checked here is that the pane always has something to draw. A
	 * reader that threw would take the whole file pane down with it.
	 */
	const broken = join(dir, "broken.xlsx");
	writeFileSync(broken, "这不是一个表格");
	const data = await readWorkbook(broken);
	assert.equal(data.kind, "sheets");
	assert.ok(Array.isArray(data.sheets));
});

test("a workbook that is actually binary noise is reported rather than thrown", async () => {
	const noise = join(dir, "noise.xlsx");
	writeFileSync(noise, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0x00, 0x11, 0x22, 0x33]));
	const data = await readWorkbook(noise);
	assert.ok(data.error, "读不了的文件应该带回一句能显示的话");
	assert.deepEqual(data.sheets, []);
});

test("a database comes back table by table, with its row counts", async () => {
	const data = await readDatabase(database);
	assert.equal(data.error, undefined);
	assert.equal(data.kind, "tables");
	const users = data.sheets.find((sheet) => sheet.name === "users");
	assert.deepEqual(users?.columns, ["id", "name", "avatar"]);
	assert.equal(users?.total, 2);
	assert.equal(users?.rows[0][1], "小明");
});

test("a BLOB is described rather than dumped into the cell", async () => {
	const data = await readDatabase(database);
	const users = data.sheets.find((sheet) => sheet.name === "users");
	assert.equal(users?.rows[0][2], "[4 字节]");
	// NULL is empty, not the string "null".
	assert.equal(users?.rows[1][2], "");
});

test("an empty table keeps its columns, which are worth showing on their own", async () => {
	const data = await readDatabase(database);
	const empty = data.sheets.find((sheet) => sheet.name === "empty_one");
	assert.deepEqual(empty?.columns, ["a", "b"]);
	assert.equal(empty?.total, 0);
});

test("a table whose name contains a quote is still readable", async () => {
	const data = await readDatabase(database);
	const odd = data.sheets.find((sheet) => sheet.name === 'odd"name');
	assert.equal(odd?.rows[0][0], "ok");
});

test("sqlite's own bookkeeping tables are not shown as data", async () => {
	const data = await readDatabase(database);
	assert.ok(!data.sheets.some((sheet) => sheet.name.startsWith("sqlite_")));
});

test("a file that is not a database is reported, not thrown", async () => {
	const broken = join(dir, "broken.sqlite");
	writeFileSync(broken, "这不是一个数据库");
	const data = await readDatabase(broken);
	assert.ok(data.error);
});

test("opening a database is read-only — a preview must not write to it", async () => {
	// A journal appearing beside a repository because somebody glanced at a file would be a bug
	// with a very bad name.
	const before = mkdtempSync(join(tmpdir(), "lyra-ro-"));
	const path = join(before, "ro.sqlite");
	const { DatabaseSync } = await import("node:sqlite");
	const seed = new DatabaseSync(path);
	seed.exec("CREATE TABLE t (a TEXT)");
	seed.close();

	const { readdirSync } = await import("node:fs");
	const filesBefore = readdirSync(before).sort();
	await readDatabase(path);
	assert.deepEqual(readdirSync(before).sort(), filesBefore, "预览数据库时留下了新文件");
	rmSync(before, { recursive: true, force: true });
});
