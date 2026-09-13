/**
 * The words inside a document, for a model that can only read words.
 *
 * Attaching a contract used to mean one of two things, both useless: before, the file's bytes were
 * decoded as UTF-8 and several thousand replacement characters went into the prompt; after the
 * first fix, nothing went at all and a notice said the contents could not be read. Neither is what
 * anybody attaches a contract for.
 *
 * The modern Office formats make this tractable — `.docx`, `.pptx` and `.xlsx` are zip archives of
 * XML, and the text is in there in plain sight. No conversion, no external binary, no service.
 *
 * What is *not* handled is said plainly rather than guessed at:
 *
 *   - `.doc`, `.xls`, `.ppt` — the pre-2007 binary formats. These are OLE compound files, a
 *     different thing entirely, and extracting text from one means implementing a filesystem. A
 *     wrong answer here is worse than none: half a contract, silently.
 *
 * `.pdf` used to be on that list. It is handled now, by `unpdf` — Mozilla's pdf.js packaged with no
 * native dependency, which is the only reason it can live in this process at all. What it reaches is
 * the *text layer*: a PDF that is a photograph of a page has none, and that case is reported rather
 * than guessed at, because a silent empty string is exactly how somebody ends up believing their
 * scan was read.
 *
 * The caller is told which case it got, so the person attaching the file finds out here rather than
 * from an answer that quietly ignored it.
 */

import { unzipSync, strFromU8 } from "fflate";

export interface ExtractedText {
	text: string;
	/** Roughly how much was in there, before any truncation. */
	fullLength: number;
	truncated: boolean;
	/**
	 * 文件是好的、页也在，但一个字都取不出来——扫描件、或者整页是图的 PDF。
	 *
	 * 和「格式不支持」(`null`) 分开，因为对人来说是两回事：一个是「换个格式」，一个是「这份文件里
	 * 本来就没有文字，需要的是 OCR」。合并成同一句话，等于让人去试一件不可能成功的事。
	 */
	imageOnly?: boolean;
}

/**
 * How much of one document may enter a prompt.
 *
 * A contract runs to a few thousand words and belongs in full. A five-hundred-page manual does not:
 * it would evict the rest of the conversation from the context window, and the person attaching it
 * almost always means "the part about X". Truncation is reported so the answer can say so.
 */
const MAX_CHARS = 120_000;

/** Extensions that are a zip underneath, whatever they are called. */
const ZIP_LIKE = new Set(["zip", "jar", "war", "ipa", "apk", "aar", "whl", "nupkg", "vsix", "epub", "xpi", "crx"]);

/** Every `<w:t>`, `<a:t>` or `<t>` run in an OOXML part, in document order. */
function textFromOoxml(xml: string): string {
	const out: string[] = [];
	/*
	 * Regex rather than an XML parser, and the shape of the format is why it holds: text lives in
	 * leaf elements whose names end in `:t` or are exactly `t`, and they never nest. Paragraph and
	 * row boundaries become newlines so the result reads as a document rather than a wall.
	 */
	const pattern = /<(?:[a-z]+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:[a-z]+:)?t>|<\/(?:w:p|a:p|w:tr)>/g;
	let match: RegExpExecArray | null;
	while ((match = pattern.exec(xml))) {
		if (match[1] === undefined) {
			out.push("\n");
			continue;
		}
		out.push(unescapeXml(match[1]));
	}
	return out.join("");
}

function unescapeXml(raw: string): string {
	return raw
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
		.replace(/&amp;/g, "&");
}

/** Collapse the runs of blank lines that paragraph boundaries leave behind. */
function tidy(text: string): string {
	return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * 把「长得像汉字但不是汉字」的码位换回汉字。
 *
 * PDF 里的字形是按字体的编码表走的，抽出来的未必是常用码位。实测一份中文白皮书，抽出的「白皮书」是
 * U+2F69 U+2F6A——康熙部首区的「⽩」「⽪」，和正文里的「白」「皮」(U+767D/U+76AE) 是不同的字符。人眼
 * 完全看不出区别，而对模型来说，用户问「白皮书里写了什么」时，问题里的字和文档里的字不是同一个。
 * 七个探针里六个在归一之前匹配不上。
 *
 * 只动这两个区（康熙部首、CJK 部首补充），不整段 `NFKC`。整段归一能修好汉字，但顺带把全角「，」压成
 * 半角「,」——那是在改原文。要读的是文档，不是文档的一个近似。
 */
function normalizeRadicals(text: string): string {
	return text.replace(/[⺀-⻿⼀-⿟]/g, (char) => {
		const folded = char.normalize("NFKC");
		// 只接受一对一的映射；部首区里少数码位会展开成多个字符，那种情况保持原样。
		return folded.length === 1 ? folded : char;
	});
}

function finish(text: string): ExtractedText {
	const tidied = tidy(text);
	return {
		text: tidied.length > MAX_CHARS ? tidied.slice(0, MAX_CHARS) : tidied,
		fullLength: tidied.length,
		truncated: tidied.length > MAX_CHARS,
	};
}

/** A Word document: the body, plus headers and footers, which carry parties and dates. */
function textFromDocx(bytes: Uint8Array): ExtractedText {
	const zip = unzipSync(bytes);
	const parts = ["word/document.xml"];
	// Headers and footers, in the order they are numbered.
	for (const name of Object.keys(zip).sort()) {
		if (/^word\/(header|footer)\d*\.xml$/.test(name)) parts.push(name);
	}
	const text = parts
		.map((name) => (zip[name] ? textFromOoxml(strFromU8(zip[name]!)) : ""))
		.filter(Boolean)
		.join("\n\n");
	return finish(text);
}

/**
 * A deck: one block per slide, numbered, plus whatever is in the speaker notes.
 *
 * Numbered because a question about a deck is nearly always about a particular slide, and an
 * unlabelled run of bullet points gives the model no way to answer "what does slide 4 say".
 */
function textFromPptx(bytes: Uint8Array): ExtractedText {
	const zip = unzipSync(bytes);
	const slides = Object.keys(zip)
		.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
		.sort((a, b) => slideNumber(a) - slideNumber(b));

	const blocks = slides.map((name) => {
		const body = textFromOoxml(strFromU8(zip[name]!));
		const notesName = `ppt/notesSlides/notesSlide${slideNumber(name)}.xml`;
		const notes = zip[notesName] ? textFromOoxml(strFromU8(zip[notesName]!)) : "";
		const header = `## 第 ${slideNumber(name)} 页`;
		return [header, tidy(body), notes.trim() ? `（备注）${tidy(notes)}` : ""].filter(Boolean).join("\n");
	});
	return finish(blocks.join("\n\n"));
}

function slideNumber(name: string): number {
	return Number(/(\d+)\.xml$/.exec(name)?.[1] ?? 0);
}

/**
 * A workbook, as one block per sheet.
 *
 * `xlsx` is already a dependency — it is what the spreadsheet viewer uses — so this is the one
 * format where the parsing is somebody else's problem. CSV per sheet rather than a grid: it is the
 * densest way to put a table in front of a model, and the one it reads most reliably.
 */
async function textFromXlsx(bytes: Uint8Array): Promise<ExtractedText> {
	const { read, utils } = await import("xlsx");
	const book = read(bytes, { type: "array" });
	const blocks = book.SheetNames.map((name) => {
		const sheet = book.Sheets[name];
		if (!sheet) return "";
		const csv = utils.sheet_to_csv(sheet, { blankrows: false });
		return csv.trim() ? `## ${name}\n${csv.trim()}` : "";
	}).filter(Boolean);
	return finish(blocks.join("\n\n"));
}

/**
 * A PDF's text layer, page by page.
 *
 * Pages are numbered in the output for the same reason slides are: a question about a hundred-page
 * document is nearly always about one part of it, and an unbroken wall of text gives the model no
 * way to answer "what does the deployment section say" or to cite where it got something.
 *
 * `unpdf` rather than a system binary or a service: it is pdf.js with the browser assumptions
 * mocked out, pure JavaScript and no native build, which is what makes it safe to load in the main
 * process of an app people install. MIT, no dependencies of its own.
 */
export async function textFromPdf(bytes: Uint8Array): Promise<ExtractedText> {
	const { extractText, getDocumentProxy } = await import("unpdf");
	/*
	 * A copy, because pdf.js takes ownership of the buffer it is given.
	 *
	 * It transfers the bytes to its worker and the caller's view comes back detached — which matters
	 * here because the same bytes are also what gets attached to the message. Without this the file
	 * arrived as zero bytes for everything downstream of the parse.
	 */
	const pdf = await getDocumentProxy(new Uint8Array(bytes));
	const { totalPages, text } = await extractText(pdf, { mergePages: false });
	const pages = Array.isArray(text) ? text : [text];

	const blocks = pages
		.map((page, index) => {
			const body = tidy(normalizeRadicals(page ?? ""));
			return body ? `## 第 ${index + 1} 页\n${body}` : "";
		})
		.filter(Boolean);

	// 页在、字不在：这是扫描件，不是空文件。说清楚，别让人以为附件坏了。
	if (blocks.length === 0) return { text: "", fullLength: 0, truncated: false, imageOnly: totalPages > 0 };
	return finish(blocks.join("\n\n"));
}

/**
 * An archive, as the list of what is in it.
 *
 * Not the contents: a zip is arbitrarily large and arbitrarily nested, and unpacking one into a
 * prompt is how a context window disappears. The listing is what the question is nearly always
 * about — "what's in this jar", "did the build output what I expected" — and it is small.
 *
 * Sizes are included because they answer the second question people ask, and directories are left
 * out because the paths already say where everything sits.
 */
function listArchive(bytes: Uint8Array): ExtractedText {
	const zip = unzipSync(bytes);
	const entries = Object.entries(zip)
		.filter(([name]) => !name.endsWith("/"))
		.sort(([a], [b]) => a.localeCompare(b));

	const lines = entries.map(([name, data]) => `${name}  (${formatBytes(data.length)})`);
	const header = `共 ${entries.length} 个文件`;
	return finish([header, ...lines].join("\n"));
}

function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Which formats this module can read, keyed by extension. */
export const EXTRACTABLE = new Set([
	"pdf",
	"docx", "pptx", "xlsx", "xlsm", "xlsb", "ods", "odt", "odp",
	"zip", "jar", "war", "ipa", "apk", "aar", "whl", "nupkg", "vsix", "epub", "xpi", "crx",
]);

/**
 * The text of a document, or null when the format is one nothing here can read.
 *
 * Null is a real answer and not a failure: it means "say so", which is what the caller does.
 */
export async function extractDocumentText(name: string, bytes: Uint8Array): Promise<ExtractedText | null> {
	const extension = name.toLowerCase().split(".").pop() ?? "";
	try {
		if (extension === "pdf") return await textFromPdf(bytes);
		if (extension === "docx" || extension === "odt") return textFromDocx(bytes);
		if (extension === "pptx" || extension === "odp") return textFromPptx(bytes);
		if (extension === "xlsx" || extension === "xlsm" || extension === "xlsb" || extension === "ods") {
			return await textFromXlsx(bytes);
		}
		/*
		 * Zip-based bundles, listed rather than unpacked.
		 *
		 * `.jar`, `.apk`, `.whl`, `.vsix` and the rest are all zips wearing a different extension,
		 * and the question about one is nearly always what is inside — which the listing answers.
		 */
		if (ZIP_LIKE.has(extension)) return listArchive(bytes);
		return null;
	} catch {
		// A corrupt or unexpected file. Saying nothing beats putting garbage in the prompt, which is
		// exactly the failure this module exists to end.
		return null;
	}
}
