/**
 * `read` 读一份文档，读到的是里面的字。
 *
 * 这条守的是接线，不是抽取本身——抽取有 `document-text.test.ts` 对着真文件盯着。接线是另一回事，而
 * 它断过：应用能读 `.docx`、`.xlsx`、`.pptx`、`.pdf` 的代码写好很久了，却只接在「人把文件拖进输入
 * 框」那条路上。模型自己去读同一份文件，得到的是一句「看起来是二进制文件，没法按文本读」——同一份
 * 文件、同样的字节，因为是谁在问而给出两种答案。
 *
 * 所以这里走的是工具本身，不是抽取函数：中间那层判断（扩展名在不在清单里、抽取失败要不要退回二进制
 * 那条路、扫描件怎么说）全在工具里，而那正是会断的地方。
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { strToU8, zipSync } from "fflate";

import { readTool } from "../src/tools/read.ts";

const dir = mkdtempSync(join(tmpdir(), "lyra-read-docs-"));

/** 工具要的上下文，只给它真正会读的那几项。 */
const context = () => ({ cwd: dir, state: new Map(), abort: new AbortController().signal }) as never;

function textOf(result: { content?: Array<{ type: string; text?: string }> }): string {
	const block = result.content?.[0];
	return block && block.type === "text" ? (block.text ?? "") : "";
}

/** 一份真的 docx：zip 加 OOXML，和 Word 写出来的是同一种东西。 */
function writeDocx(name: string, paragraphs: string[]): string {
	const body = paragraphs.map((line) => `<w:p><w:r><w:t xml:space="preserve">${line}</w:t></w:r></w:p>`).join("");
	const path = join(dir, name);
	writeFileSync(
		path,
		Buffer.from(
			zipSync({
				"[Content_Types].xml": strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
				"word/document.xml": strToU8(
					`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
				),
			}),
		),
	);
	return path;
}

test("模型自己去读一份 docx，读到的是正文", async () => {
	writeDocx("交接说明.docx", ["交接说明", "这一段是正文，模型该读得到。"]);
	const result = await readTool.execute({ path: "交接说明.docx" }, context());

	assert.equal(Boolean((result as { isError?: boolean }).isError), false, "改之前这里是「看起来是二进制文件」");
	const text = textOf(result as never);
	assert.match(text, /交接说明/);
	assert.match(text, /这一段是正文/);
	assert.equal((result as { details?: { kind?: string } }).details?.kind, "document");
});

test("表格按工作表出，一张表一块", async () => {
	// SheetJS 写出来的那种共享字符串表，和手写的 XML 片段不是一回事——所以用它自己写。
	const { utils, write } = await import("xlsx");
	const book = utils.book_new();
	utils.book_append_sheet(book, utils.aoa_to_sheet([["门店", "数量"], ["花园里店", 12]]), "陈列");
	utils.book_append_sheet(book, utils.aoa_to_sheet([["月份", "金额"], ["九月", 3400]]), "对账");
	writeFileSync(join(dir, "台账.xlsx"), write(book, { type: "buffer", bookType: "xlsx" }));

	const text = textOf((await readTool.execute({ path: "台账.xlsx" }, context())) as never);
	assert.match(text, /## 陈列/);
	assert.match(text, /花园里店,12/);
	assert.match(text, /## 对账/, "第二张表也要在——只读第一张是这类实现最常见的漏法");
	assert.match(text, /九月,3400/);
});

test("不在清单里的二进制，照旧拒绝", async () => {
	/*
	 * 抽取是在二进制判定**之前**试的，所以要确认它没把所有二进制都放进来：一个可执行文件仍然该被
	 * 挡在外面，而不是被塞进提示词里当文本。
	 */
	writeFileSync(join(dir, "a.bin"), Buffer.from([0, 1, 2, 3, 0, 255, 0, 7]));
	const result = await readTool.execute({ path: "a.bin" }, context());
	assert.equal(Boolean((result as { isError?: boolean }).isError), true);
});

test("一份坏掉的 docx 不会把工具带崩", async () => {
	// 扩展名在清单里、内容却不是 zip。抽取失败要退回原来那条路，而不是抛出去。
	writeFileSync(join(dir, "坏的.docx"), Buffer.from([0, 1, 2, 3, 0, 255]));
	const result = await readTool.execute({ path: "坏的.docx" }, context());
	assert.equal(Boolean((result as { isError?: boolean }).isError), true, "读不成就说读不成，不该是一次崩溃");
});

test("纯文本照旧按行读，没被这条新路抢走", async () => {
	writeFileSync(join(dir, "readme.md"), "# 标题\n正文\n");
	const result = await readTool.execute({ path: "readme.md" }, context());
	assert.equal(Boolean((result as { isError?: boolean }).isError), false);
	assert.match(textOf(result as never), /标题/);
	assert.notEqual((result as { details?: { kind?: string } }).details?.kind, "document");
});
