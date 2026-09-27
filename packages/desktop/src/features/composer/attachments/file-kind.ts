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

import type { MessageKey } from "../../../i18n/messages/index.ts";

export type FileKind =
	| "image"
	| "video"
	| "audio"
	| "pdf"
	| "word"
	| "excel"
	| "powerpoint"
	| "archive"
	| "design"
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
	// 表格软件打开它，图标就该是表格——`csv` 落进纯文本那一档时，一列数据长得像一段散文。
	csv: "excel", tsv: "excel",
	ppt: "powerpoint", pptx: "powerpoint", odp: "powerpoint", key: "powerpoint",

	zip: "archive", rar: "archive", "7z": "archive", tar: "archive", gz: "archive", bz2: "archive",
	xz: "archive", dmg: "archive", iso: "archive", jar: "archive", war: "archive",

	ttf: "font", otf: "font", woff: "font", woff2: "font", eot: "font",

	exe: "binary", dll: "binary", so: "binary", dylib: "binary", bin: "binary", node: "binary",
	class: "binary", pyc: "binary", wasm: "binary", db: "binary", sqlite: "binary", sqlite3: "binary",
	// 设计稿有自己的一档：它们确实是二进制，但「打不开的可执行文件」和「同事发来的设计稿」
	// 在列表里是两件事，共用一个灰色的 0/1 图标等于什么都没说。
	psd: "design", ai: "design", sketch: "design", fig: "design", xd: "design", afdesign: "design",
	blend: "design",
};

/** The extension, lowercased, or "" for a file that has none — or that has no name at all. */
function extensionOf(name: string): string {
	// 同样的理由：一份从旧数据里恢复出来的附件可能连名字都没有，而这是渲染期的调用。
	const base = (typeof name === "string" ? name : "").toLowerCase().split(/[/\\]/).pop() ?? "";
	const dot = base.lastIndexOf(".");
	return dot > 0 ? base.slice(dot + 1) : "";
}

export function fileKind(name: string, mimeType = ""): FileKind {
	const byExtension = BY_EXTENSION[extensionOf(name)];
	if (byExtension) return byExtension;

	/*
	 * 兜到字符串，因为默认参数兜不住。
	 *
	 * `mimeType = ""` 只在传 `undefined` 时生效；传 `null` 的话 `mime` 就是 null，下一行当场
	 * `null.startsWith is not a function`——而这是个渲染期的调用，整个界面跟着白。附件不都是这里
	 * 造的：从磁盘恢复的草稿、从手机同步过来的那一份，都可能带着一个没有 `mimeType` 的旧形状，
	 * 而它们进来时是 `as Attachment[]`，类型上那个 `: string` 一次也没被检查过。
	 */
	const mime = typeof mimeType === "string" ? mimeType.toLowerCase() : "";
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

/**
 * 一份已经发出去的附件，该按什么门类画。
 *
 * 记下来的 `kind` 是发送那一刻 `fileKind` 的答案，绝大多数时候就是对的——但它是一段之后再没人校验过
 * 的字符串：旧版本写下的、手机同步过来的、将来哪个入口写错的，都会原样躺在转录里。而渲染端对「图片」
 * 这个答案的信任是一路到底的：去取像素、画成缩略图、菜单里给「复制图片」。一份 `.md` 被记成图片，
 * 屏幕上就是一张裂开的图，alt 是它的文件名。
 *
 * 所以「图片」要经得起名字和类型的复核：名字带着扩展名、或者存了 mimeType，而它们都说不是图，就听它们
 * 的。两样都没有的（剪贴板编的名字、没存类型的老消息）才只能信记下来的那一个——那时没有别的证据可听。
 * 真的图片过得了这一关：它的扩展名或 mimeType 总有一样说得出「图」。
 *
 * 别的门类不复核：记错了顶多是图标不对，不会凭空长出一张图来。认不出的字符串（将来或过去的门类名）
 * 退回现算——拿它去查 `KIND_LABEL` 只会查出一个 `undefined`。
 */
export function sentKind(file: { name: string; kind?: string | null; mimeType?: string | null }): FileKind {
	const mime = typeof file.mimeType === "string" ? file.mimeType : "";
	const guessed = fileKind(file.name, mime);
	const recorded = typeof file.kind === "string" && Object.hasOwn(KIND_LABEL, file.kind) ? (file.kind as FileKind) : undefined;
	if (!recorded) return guessed;
	if (recorded === "image" && guessed !== "image" && (extensionOf(file.name) !== "" || mime !== "")) return guessed;
	return recorded;
}

/**
 * 图标归图标，能不能当文本读是另一件事。
 *
 * `csv` 和 `tsv` 是这条区别的全部理由。它们被归进 `excel` 是为了画一个表格图标——一列数字顶着一个
 * 文档图标确实不像话——但门类同时还被拿去决定「内容能不能进 prompt」，于是一个**纯文本文件**被当成
 * 二进制拒掉了：附一个 csv 上去，模型只收到一个文件名。一个字段扛了两个决定，图标对了，读取坏了。
 *
 * 所以这里按扩展名再问一次。不改 `fileKind` 的归类：图标那一头是对的，不该为了这一头把它弄坏。
 */
const TEXT_DESPITE_KIND = new Set(["csv", "tsv"]);

/** Whether a prompt can carry this file's contents, rather than just its name. */
export function isReadableAsText(kind: FileKind, name = ""): boolean {
	if (kind === "text") return true;
	return TEXT_DESPITE_KIND.has(extensionOf(name));
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
/** What each kind is called. Keys, looked up when drawn — the table is built at import time. */
export const KIND_LABEL: Record<FileKind, MessageKey> = {
	image: "fileKind.image",
	video: "fileKind.video",
	audio: "fileKind.audio",
	pdf: "fileKind.pdf",
	word: "fileKind.word",
	excel: "fileKind.spreadsheet",
	powerpoint: "fileKind.slides",
	archive: "fileKind.archive",
	design: "fileKind.design",
	font: "fileKind.font",
	binary: "fileKind.binary",
	text: "fileKind.text",
};
