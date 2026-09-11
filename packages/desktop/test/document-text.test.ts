/**
 * 把一份文档变成模型读得懂的字——对着**真文件**测，不是对着构造好的字符串。
 *
 * 这个模块整个是死代码：写好了，`EXTRACTABLE` 和 `extractDocumentText` 在仓库里零调用点，所以它声称
 * 能做的事从来没有人验证过。接线之前先把它自己验一遍，否则接上去之后分不清是接错了还是本来就不行。
 *
 * 真文件是必须的。OOXML 抽取走的是正则，而正则对着手写的 XML 片段永远是绿的——真正会出事的是
 * SheetJS 写出来的那种共享字符串表、`<w:t xml:space="preserve">` 这类带属性的标签、以及 PDF 里字形
 * 编码和 Unicode 码位对不上。这些都只有真文件才有。
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { zipSync, strToU8 } from "fflate";
import { EXTRACTABLE, extractDocumentText, textFromPdf } from "../electron/document-text.ts";

let dir: string;

/** 一份真 PDF，用 Electron 自己的 `printToPDF` 印出来——和人拿到的 PDF 是同一条生产线。 */
function makePdf(target: string, bodyHtml: string): void {
	const script = join(dir, "gen.cjs");
	writeFileSync(
		script,
		`const { app, BrowserWindow } = require("electron");
		const { writeFileSync } = require("node:fs");
		app.on("ready", async () => {
			const win = new BrowserWindow({ show: false, width: 900, height: 1200 });
			await win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(${JSON.stringify(
				`<html><head><meta charset="utf-8"><style>body{font-family:"PingFang SC";padding:40px;line-height:1.8}</style></head><body>${bodyHtml}</body></html>`,
			)}));
			writeFileSync(${JSON.stringify(target)}, await win.webContents.printToPDF({ printBackground: true }));
			app.quit();
		});`,
	);
	const electron = createRequire(import.meta.url)("electron") as unknown as string;
	execFileSync(electron, [script], { stdio: "ignore", timeout: 90_000 });
}

before(() => {
	dir = mkdtempSync(join(tmpdir(), "lyra-doctext-"));
});

after(() => {
	rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// PDF
// ---------------------------------------------------------------------------

test("PDF：抽得出正文，中英混排都在，页码标出来", async () => {
	const file = join(dir, "白皮书.pdf");
	makePdf(
		file,
		`<h1>技术架构白皮书</h1><p>系统在生产环境的 P99 延迟为 320 毫秒。</p>
		 <p>English text is included to verify mixed-script extraction.</p>`,
	);
	const out = await extractDocumentText("白皮书.pdf", new Uint8Array(readFileSync(file)));

	assert.ok(out, "PDF 该抽得出东西");
	assert.match(out.text, /## 第 1 页/, "页码要标出来——问「第几页写了什么」得有依据");
	assert.ok(out.text.includes("320 毫秒"), `正文该在，得到：${out.text.slice(0, 120)}`);
	assert.ok(out.text.includes("mixed-script extraction"), "英文段落也该在");
	assert.equal(out.imageOnly, undefined, "有文本层，不该被当成扫描件");
});

test("PDF：部首码位被换回真正的汉字", async () => {
	/*
	 * 这一条是实测踩出来的，不是想出来的。
	 *
	 * PDF 抽出的「白皮书」是 U+2F69 U+2F6A + U+4E66——前两个是康熙部首区的「⽩」「⽪」，和正文里的
	 * 「白」「皮」(U+767D/U+76AE) 是**不同的字符**。人眼分辨不出，而用户问「白皮书里写了什么」时，
	 * 问题里的字和文档里的字对不上。
	 */
	const file = join(dir, "码位.pdf");
	makePdf(file, `<p>白皮书记载：第一章自下而上，生产环境可用区日均处理。</p>`);
	const out = await extractDocumentText("码位.pdf", new Uint8Array(readFileSync(file)));

	assert.ok(out);
	for (const word of ["白皮书", "第一章", "自下而上", "生产环境", "可用区", "日均处理"]) {
		assert.ok(out.text.includes(word), `「${word}」该以常用码位出现，实际抽到的是：${out.text.slice(0, 80)}`);
	}
	// 康熙部首区一个都不该剩下。
	assert.doesNotMatch(out.text, /[⺀-⻿⼀-⿟]/, "部首形码位没清干净");
});

test("PDF：全角标点保持原样，不被顺手压成半角", async () => {
	// 整段 NFKC 能修好汉字，但会把「，」压成「,」——那是在改原文。
	const file = join(dir, "标点.pdf");
	makePdf(file, `<p>第一项，第二项；第三项。</p>`);
	const out = await extractDocumentText("标点.pdf", new Uint8Array(readFileSync(file)));

	assert.ok(out);
	assert.ok(out.text.includes("，"), `全角逗号该留着，得到：${out.text}`);
});

test("PDF：没有文本层的，说清楚是扫描件而不是空文件", async () => {
	/*
	 * 整页是图的 PDF 抽不出一个字。返回空字符串就让人以为附件坏了，而实际上他要的是 OCR——
	 * 一个需要换工具的问题，被说成了一个换个文件重试就能解决的问题。
	 */
	const file = join(dir, "扫描件.pdf");
	// 一个 1×1 的透明 PNG 撑满一页，没有任何文字。
	const png =
		"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
	makePdf(file, `<img src="${png}" style="width:600px;height:800px">`);
	const out = await extractDocumentText("扫描件.pdf", new Uint8Array(readFileSync(file)));

	assert.ok(out, "文件本身是好的，不该当成不支持的格式");
	assert.equal(out.text, "", "一个字都不该编出来");
	assert.equal(out.imageOnly, true, "要能分辨出这是扫描件");
});

test("PDF：解析不会吃掉调用方手里的那份字节", async () => {
	/*
	 * pdf.js 会把传进去的 buffer 转移给它的 worker，调用方那一份就此 detached。
	 *
	 * 这在这里是真会出事的：同一份字节既要拿去解析，又要作为附件本体带上。少了内部那次拷贝，解析
	 * 之后附件就变成 0 字节——而且解析本身是成功的，所以没有任何报错。
	 */
	const file = join(dir, "字节.pdf");
	makePdf(file, `<p>保持字节完整</p>`);
	const bytes = new Uint8Array(readFileSync(file));
	const before = bytes.byteLength;

	await textFromPdf(bytes);

	assert.equal(bytes.byteLength, before, "解析之后调用方那份字节该原封不动");
	assert.equal(bytes[0], 0x25, "PDF 的魔数 %PDF 还该在");
});

// ---------------------------------------------------------------------------
// Office：这几条路径写好之后从没被调用过
// ---------------------------------------------------------------------------

test("docx：正文和页眉页脚都抽得出来", async () => {
	/*
	 * 手搓一个最小 OOXML 包。`xml:space="preserve"` 是特意加的——`<w:t>` 带属性时正则必须还能匹配，
	 * 而真实的 Word 文档里到处都是带属性的 `<w:t>`。
	 */
	const docx = zipSync({
		"[Content_Types].xml": strToU8("<?xml version='1.0'?><Types/>"),
		"word/document.xml": strToU8(
			`<?xml version="1.0"?><w:document><w:body>` +
				`<w:p><w:r><w:t xml:space="preserve">合同金额为 </w:t></w:r><w:r><w:t>120,000</w:t></w:r></w:p>` +
				`<w:p><w:r><w:t>乙方：品类实验室</w:t></w:r></w:p>` +
				`</w:body></w:document>`,
		),
		"word/header1.xml": strToU8(`<?xml version="1.0"?><w:hdr><w:p><w:r><w:t>机密文件</w:t></w:r></w:p></w:hdr>`),
	});
	const out = await extractDocumentText("合同.docx", docx);

	assert.ok(out);
	assert.ok(out.text.includes("合同金额为 120,000"), `同一段里的多个 run 该拼在一起，得到：${out.text}`);
	assert.ok(out.text.includes("乙方：品类实验室"), "第二段该在");
	assert.ok(out.text.includes("机密文件"), "页眉该在——签约方和日期常常只写在那里");
});

test("xlsx：每张表一块，按 CSV 摊平", async () => {
	const { utils, write } = await import("xlsx");
	const book = utils.book_new();
	utils.book_append_sheet(book, utils.aoa_to_sheet([["名称", "数量"], ["苹果", 12], ["香蕉", 340]]), "库存");
	utils.book_append_sheet(book, utils.aoa_to_sheet([["月份", "销售额"], ["一月", 8800]]), "销售");
	const bytes = new Uint8Array(write(book, { type: "array", bookType: "xlsx" }));

	const out = await extractDocumentText("报表.xlsx", bytes);

	assert.ok(out);
	assert.match(out.text, /## 库存/, "表名要标出来");
	assert.match(out.text, /## 销售/, "第二张表也要");
	assert.ok(out.text.includes("香蕉,340"), `单元格该按 CSV 摊平，得到：${out.text}`);
	assert.ok(out.text.includes("一月,8800"), "第二张表的数据也要在");
});

test("pptx：按页分块并编号", async () => {
	const slide = (text: string) =>
		strToU8(`<?xml version="1.0"?><p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
	const pptx = zipSync({
		"ppt/slides/slide1.xml": slide("第一页：项目背景"),
		"ppt/slides/slide2.xml": slide("第二页：架构设计"),
		"ppt/notesSlides/notesSlide2.xml": strToU8(
			`<?xml version="1.0"?><p:notes><a:p><a:r><a:t>这里讲三分钟</a:t></a:r></a:p></p:notes>`,
		),
	});
	const out = await extractDocumentText("方案.pptx", pptx);

	assert.ok(out);
	assert.match(out.text, /## 第 1 页/);
	assert.match(out.text, /## 第 2 页/);
	assert.ok(out.text.includes("架构设计"), "第二页的正文该在");
	assert.ok(out.text.includes("这里讲三分钟"), "演讲者备注也该带上");
});

test("zip：列出里面有什么，不把内容摊进来", async () => {
	const archive = zipSync({ "src/index.ts": strToU8("export const a = 1"), "README.md": strToU8("# 说明") });
	const out = await extractDocumentText("包.zip", archive);

	assert.ok(out);
	assert.ok(out.text.includes("共 2 个文件"));
	assert.ok(out.text.includes("src/index.ts"), "路径该在");
	assert.ok(!out.text.includes("export const a = 1"), "内容不该摊进来——一个 zip 能撑爆上下文");
});

// ---------------------------------------------------------------------------
// 说不知道的那些
// ---------------------------------------------------------------------------

test("老式二进制格式老实返回 null，不猜", async () => {
	// `.doc`/`.xls`/`.ppt` 是 OLE 复合文档，猜出半份合同比什么都不给更糟。
	for (const name of ["合同.doc", "表.xls", "稿.ppt"]) {
		assert.equal(await extractDocumentText(name, new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])), null, name);
	}
});

test("坏文件不抛异常，返回 null", async () => {
	// 一个自称 docx 的随机字节流。解压会炸，而炸在这里等于整条发送路径断掉。
	const junk = new Uint8Array(Array.from({ length: 256 }, (_, i) => i));
	assert.equal(await extractDocumentText("坏的.docx", junk), null);
	assert.equal(await extractDocumentText("坏的.pdf", junk), null);
});

test("EXTRACTABLE 和 extractDocumentText 说的是同一件事", async () => {
	/*
	 * 两处各写一遍扩展名清单，迟早会分家：清单里加了一个格式而分派没加，调用方就会兴冲冲把文件送进来
	 * 拿回一个 null，表现成「这个格式坏了」。这里让真文件把两边钉在一起。
	 */
	const { utils, write } = await import("xlsx");
	const book = utils.book_new();
	utils.book_append_sheet(book, utils.aoa_to_sheet([["a", 1]]), "S1");

	// 每一档给一个它自己认得的样本：工作簿家族要真的工作簿，OOXML 家族要对应的部件路径。
	const workbook = new Uint8Array(write(book, { type: "array", bookType: "xlsx" }));
	const archive = zipSync({ "a.txt": strToU8("x") });
	const wordLike = zipSync({ "word/document.xml": strToU8("<w:document><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>") });
	const slideLike = zipSync({ "ppt/slides/slide1.xml": strToU8("<p:sld><a:t>x</a:t></p:sld>") });
	const sampleFor = (extension: string): Uint8Array => {
		if (["xlsx", "xlsm", "xlsb", "ods"].includes(extension)) return workbook;
		if (["docx", "odt"].includes(extension)) return wordLike;
		if (["pptx", "odp"].includes(extension)) return slideLike;
		return archive;
	};

	for (const extension of EXTRACTABLE) {
		if (extension === "pdf") continue; // 上面有它自己的真文件测试
		const out = await extractDocumentText(`sample.${extension}`, sampleFor(extension));
		assert.ok(out !== null, `EXTRACTABLE 里有 ${extension}，但分派表不认它`);
	}
});
