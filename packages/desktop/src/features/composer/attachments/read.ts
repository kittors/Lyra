/**
 * 把拖进来、贴进来、选进来的文件读成附件——三个输入框共用这一段。
 *
 * 从前只有主输入框会读：认得出图片、抽得出 PDF 和 Office 文档里的字、看得出一份叫 `.txt` 的文件
 * 其实是二进制、一次最多收八个而且会说出来。侧边聊天和子智能体那两个框各抄了一份最早的两分支版
 * ——图片读字节、其余一律 `file.text()`——于是同一份合同拖进主输入框是一篇可读的正文，拖进侧边
 * 聊天是几千个替换字符，原样发给了模型。三份实现，新长的本事只长在其中一份上。
 *
 * Take files on, without pretending every one of them is text. Three outcomes, and which one
 * applies is decided before anything is read:
 *
 *   - an image, carried as image content the model can actually look at;
 *   - a kind that is known not to be text — a document, a video, an archive — its words extracted
 *     when there are any, otherwise attached by name and type only;
 *   - anything else read as text, and *then* checked: the extension is a first guess, and a file
 *     can be named anything.
 */

import { translate } from "../../../i18n/translate.ts";
import { bridge } from "../../../services/index.ts";
import { useApp } from "../../../store/index.ts";
import { fileKind, isReadableAsText, looksBinary, type FileKind } from "./file-kind.ts";
import { LEGACY_READ_LIMIT, uploadFromPhone } from "./phone-upload.ts";
import type { PickedFile } from "./picked.ts";

/** 输入框里挂着的一份附件——三个输入框是同一个形状。 */
export interface DraftAttachment {
	id: string;
	name: string;
	mimeType: string;
	/** What it is, for the icon and for whether its bytes may enter the prompt. */
	kind?: FileKind;
	data?: string;
	text?: string;
	isText: boolean;
	/**
	 * 它在磁盘上的位置，来自一个文件的话。
	 *
	 * 有它才谈得上「打开」和「在访达中显示」。粘贴进来的截图没有：那是剪贴板里的一团像素，不是
	 * 某个文件。
	 */
	path?: string;
	/**
	 * 界面上管它叫什么——附件条上那一格写的，和正文里那枚标记写的，是同一个。
	 *
	 * 和 `name` 分开：一张粘贴进来的图的 `name` 是剪贴板给的 `image.png`，而屏幕上它是「图片 1」。
	 */
	label?: string;
	/**
	 * The desktop's id for this file, when a phone uploaded it rather than putting it in the prompt.
	 * The prompt names the upload and the desktop turns it into the path it wrote; see `phone-upload.ts`.
	 */
	upload?: string;
}

/**
 * 一次放得进来几个。
 *
 * 四十个文件一起拖进来多半是拖错了目录，而每一个都要读字节、抽文本，窗口会停住。超出的部分会
 * 说出来——从前是默默丢掉，人以为都在里面，模型手里却只有前八个。
 */
const MAX_FILES = 8;

/**
 * `owner` names the composer asking, so that a phone's uploads are drawn in the composer they were
 * dropped on and not in the other two — see `uploads.ts`.
 */
export async function readPickedFiles(picked: PickedFile[], owner = ""): Promise<DraftAttachment[]> {
	const next: DraftAttachment[] = [];
	/** 本该有文字却没有的那些——只有这一类要说出来。 */
	const scanned: string[] = [];

	if (picked.length > MAX_FILES) {
		useApp.getState().notify(translate("composer.tooManyFiles", { count: MAX_FILES, dropped: picked.length - MAX_FILES }), "warn");
	}

	for (const { file, path } of picked.slice(0, MAX_FILES)) {
		const id = `${file.name}-${Date.now()}-${Math.random()}`;
		const kind = fileKind(file.name, file.type);
		// 每一条出口都要带上它，所以在这里摊平一次——漏在某一条分支上，那一类附件就打不开了。
		const from = path ? { path } : {};

		// On a phone, a file that should not ride inside the prompt is streamed to the desktop first.
		const sent = await uploadFromPhone(file, kind, isReadableAsText(kind, file.name), owner);
		if (sent.kind === "cancelled") continue;
		if (sent.kind === "uploaded") {
			next.push({ id, name: file.name, mimeType: sent.file.mimeType, isText: false, kind, path: sent.file.path, upload: sent.file.upload });
			continue;
		}
		// The failed upload stays in the composer as a card with 重试 (`PhoneUploads`); that is where it is said.
		if (sent.kind === "failed") continue;
		if (sent.kind === "unsupported" && file.size > LEGACY_READ_LIMIT) {
			// A phone app too old to upload: named, not read — the file would not survive the trip.
			next.push({ id, name: file.name, mimeType: file.type || "application/octet-stream", isText: false, kind, ...from });
			useApp.getState().notify(translate("subAgent.fileUnreadable", { name: file.name }), "warn");
			continue;
		}

		if (kind === "image") {
			const buffer = await file.arrayBuffer();
			next.push({ id, name: file.name, mimeType: file.type, data: bytesToBase64(new Uint8Array(buffer)), isText: false, kind, ...from });
			continue;
		}

		if (!isReadableAsText(kind, file.name)) {
			/*
			 * 不是文本，但未必读不出字来。
			 *
			 * PDF、Word、Excel、PPT 里的字是拿得到的。抽取在主进程：架构规则不许页面伸手进
			 * `electron/`，而且 pdf.js 解析一份三百页的文档要几百毫秒，卡住一个没有界面的进程比卡住
			 * 正在打字的窗口好。哪些格式认得由那边说了算，这里不复制一份清单。
			 */
			const bytes = new Uint8Array(await file.arrayBuffer());
			const extracted = await bridge.files.documentText(file.name, bytes).catch(() => null);

			if (extracted?.text) {
				next.push({
					id,
					name: file.name,
					mimeType: file.type || "application/octet-stream",
					text: extracted.truncated
						? `${extracted.text}\n\n${translate("composer.textTruncated", { count: extracted.fullLength - extracted.text.length })}`
						: extracted.text,
					isText: true,
					// 门类不改：图标该是 PDF 就还是 PDF，变的只是「内容进不进 prompt」。
					kind,
					...from,
				});
				continue;
			}

			next.push({ id, name: file.name, mimeType: file.type || "application/octet-stream", isText: false, kind, ...from });
			/*
			 * 读不出来的两种，只有一种要说。
			 *
			 * 扫描件是「这份 PDF 本该有文字，但它是一张图」——人得换个做法，不说他不会知道。格式本身
			 * 不支持（压缩包、可执行文件）是可预期的，改由标记上那枚淡一档的图标说，见
			 * `.ly-attachment-token[data-bodiless]`。
			 */
			if (extracted?.imageOnly) scanned.push(translate("composer.scannedDocument", { name: file.name }));
			continue;
		}

		try {
			const buffer = new Uint8Array(await file.arrayBuffer());
			if (looksBinary(buffer)) {
				// Named like text, and is not. Same treatment as the known kinds above.
				next.push({ id, name: file.name, mimeType: file.type || "application/octet-stream", isText: false, kind: "binary", ...from });
				continue;
			}
			next.push({ id, name: file.name, mimeType: file.type || "text/plain", text: new TextDecoder().decode(buffer), isText: true, kind, ...from });
		} catch {
			useApp.getState().notify(translate("subAgent.fileUnreadable", { name: file.name }), "warn");
		}
	}

	if (scanned.length > 0) useApp.getState().notify(scanned.join("\n"), "warn");
	return next;
}

/** btoa cannot take a raw byte array; chunk it so large images do not blow the call stack. */
function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

/**
 * Split an annotated `data:` URL back into the shape an attachment is stored in.
 *
 * The annotator always hands back PNG, whatever went in — flattening a JPEG with marks on it and
 * calling it a JPEG would re-compress the original a second time.
 */
export function fromDataUrl(dataUrl: string, previous: { mimeType: string }): { data: string; mimeType: string } {
	const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
	if (!match) return { data: "", mimeType: previous.mimeType };
	return { mimeType: match[1], data: match[2] };
}
