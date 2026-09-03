/**
 * What a file is, for the two decisions that follow from it: which icon to draw, and whether its
 * bytes can go into a prompt.
 *
 * The second one is why this exists. Attaching a file used to mean `file.text()` on anything that
 * was not an image — so a `.doc`, which is a compound binary document, was decoded as UTF-8 and the
 * replacement characters were pasted into the message. What the model received was several thousand
 * lines of `??`; what the person saw was their contract rendered as noise. Nothing checked, because
 * nothing asked what the file was.
 *
 * Extension first, MIME second. Browsers disagree about the type of an uploaded `.doc` — some say
 * `application/msword`, some say nothing at all — and the name is the one thing that always
 * arrives.
 *
 * Pure, so `node --test` can hold it to every case.
 */

export type FileKind =
	| "image"
	| "video"
	| "audio"
	| "pdf"
	| "word"
	| "excel"
	| "powerpoint"
	| "archive"
	| "font"
	| "binary"
	| "text";

const BY_EXTENSION: Record<string, FileKind> = {
	png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", bmp: "image",
	svg: "image", avif: "image", heic: "image", ico: "image", tiff: "image", tif: "image",

	mp4: "video", mov: "video", avi: "video", mkv: "video", webm: "video", flv: "video",
	wmv: "video", m4v: "video", mpeg: "video", mpg: "video",

	mp3: "audio", wav: "audio", flac: "audio", aac: "audio", ogg: "audio", m4a: "audio",
	wma: "audio", opus: "audio", aiff: "audio",

	pdf: "pdf",
	doc: "word", docx: "word", rtf: "word", odt: "word", pages: "word",
	xls: "excel", xlsx: "excel", xlsm: "excel", xlsb: "excel", ods: "excel", numbers: "excel",
	ppt: "powerpoint", pptx: "powerpoint", odp: "powerpoint", key: "powerpoint",

	zip: "archive", rar: "archive", "7z": "archive", tar: "archive", gz: "archive", bz2: "archive",
	xz: "archive", dmg: "archive", iso: "archive", jar: "archive", war: "archive",

	ttf: "font", otf: "font", woff: "font", woff2: "font", eot: "font",

	exe: "binary", dll: "binary", so: "binary", dylib: "binary", bin: "binary", node: "binary",
	class: "binary", pyc: "binary", wasm: "binary", db: "binary", sqlite: "binary", sqlite3: "binary",
	psd: "binary", ai: "binary", sketch: "binary", fig: "binary", blend: "binary",
};

/** The extension, lowercased, or "" for a file that has none. */
function extensionOf(name: string): string {
	const base = name.toLowerCase().split(/[/\\]/).pop() ?? "";
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(dot + 1) : "";
}

export function fileKind(name: string, mimeType = ""): FileKind {
	const byExtension = BY_EXTENSION[extensionOf(name)];
	if (byExtension) return byExtension;

	const mime = mimeType.toLowerCase();
	if (mime.startsWith("image/")) return "image";
	if (mime.startsWith("video/")) return "video";
	if (mime.startsWith("audio/")) return "audio";
	if (mime.startsWith("font/")) return "font";
	if (mime === "application/pdf") return "pdf";
	if (mime.includes("wordprocessing") || mime === "application/msword") return "word";
	if (mime.includes("spreadsheet") || mime === "application/vnd.ms-excel") return "excel";
	if (mime.includes("presentation") || mime === "application/vnd.ms-powerpoint") return "powerpoint";
	if (mime.includes("zip") || mime.includes("compressed") || mime.includes("tar")) return "archive";
	if (mime.startsWith("text/") || mime.includes("json") || mime.includes("xml") || mime.includes("javascript")) {
		return "text";
	}

	/*
	 * Unknown, and treated as text.
	 *
	 * Most files with no extension and no useful type really are text — `Dockerfile`, `LICENSE`, a
	 * shell script someone forgot to name. The bytes are checked before anything is done with them
	 * anyway; see `looksBinary`.
	 */
	return "text";
}

/** Whether a prompt can carry this file's contents, rather than just its name. */
export function isReadableAsText(kind: FileKind): boolean {
	return kind === "text";
}

/**
 * Whether these bytes are binary, judged by looking at them.
 *
 * The extension is the first line of defence and it is not enough on its own: a file can be named
 * anything, and the case that started this — a `.doc` — is only one of the shapes a binary arrives
 * in. Two signals, both cheap:
 *
 *   - a NUL byte, which no text encoding produces in ordinary content;
 *   - a high share of bytes that no text uses at all.
 *
 * Only the first few kilobytes: a file that is text for its first 8KB is text, and reading a
 * hundred megabytes to be sure would cost more than being wrong.
 */
export function looksBinary(bytes: Uint8Array): boolean {
	const sample = bytes.subarray(0, 8192);
	if (sample.length === 0) return false;

	let suspicious = 0;
	for (const byte of sample) {
		if (byte === 0) return true;
		// C0 controls, minus the three that appear in real text.
		if (byte < 0x09 || (byte > 0x0d && byte < 0x20)) suspicious++;
	}
	return suspicious / sample.length > 0.05;
}

/** What to call this kind of file, in a sentence. */
export const KIND_LABEL: Record<FileKind, string> = {
	image: "图片",
	video: "视频",
	audio: "音频",
	pdf: "PDF",
	word: "Word 文档",
	excel: "表格",
	powerpoint: "演示文稿",
	archive: "压缩包",
	font: "字体",
	binary: "二进制文件",
	text: "文本",
};
