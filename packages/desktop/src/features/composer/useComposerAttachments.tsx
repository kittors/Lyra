/**
 * 一个输入框收下附件之后的那一整套：读文件、句子里那枚标记、上方那一排图、右键菜单、点开预览、
 * 左下角那颗「+」。
 *
 * 主输入框、侧边聊天、子智能体三个框从前各写一份。主输入框那份一直在长——八个的上限、PDF 抽字、
 * 二进制识别、上方只摆图片（文件在句子里）、右键标记弹出同一份菜单、在查看器里标注完替换原图——
 * 另外两份停在最早的样子：所有文件都摆成 56px 的卡片挤在上面，PDF 读成乱码，右键什么都没有。
 * 同一个动作在三个地方是三种结果，人只能记住「主输入框那个好用」。
 *
 * 一个 hook 而不是一个组件：三个框的外壳（`ComposerShell`）各自摆着不同的按钮和菜单，要共用的是
 * 行为和那几块现成的零件，不是整块界面。
 *
 * 打开一个磁盘上的文件要惊动 dock（右边的文件面板），而这个域不能直接引它——见 `actions.ts` 里
 * `ensureThere` 那段。所以「打开」由调用方给；不给的话，点标记就只做预览和「在访达中显示」。
 */

import { useEffect, useId, useRef, useState, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from "react";

import { useI18n } from "../../i18n/index.ts";
import { scanPlaceholders } from "../../lib/attachment-placeholders.ts";
import { openFromEvent, openViewer } from "../image/index.ts";
import { AttachmentMenu } from "./attachments/AttachmentMenu.tsx";
import { AttachmentStrip, type StripFile } from "./attachments/AttachmentStrip.tsx";
import { PhoneUploads } from "./attachments/PhoneUploads.tsx";
import { useAttachmentActions } from "./attachments/actions.ts";
import { KIND_LABEL } from "./attachments/file-kind.ts";
import { pickedFrom, type PickedFile } from "./attachments/picked.ts";
import { fromDataUrl, readPickedFiles, type DraftAttachment } from "./attachments/read.ts";
import { receiveLateUploads } from "./attachments/uploads.ts";
import { useAttachmentMarks, type AttachmentMarks } from "./useAttachmentMarks.ts";

export interface ComposerAttachments<T> {
	marks: AttachmentMarks<T>;
	/** 读进来、在光标处落下标记。光标位置在读字节之前就记下了。 */
	addFiles: (picked: PickedFile[]) => Promise<void>;
	/** 上方那一排——只有图片。文件的全部信息就是名字，而名字已经写在句子里那枚标记上了。 */
	strip: StripFile[];
	/**
	 * That row, drawn, plus a phone's uploads still in flight. The tray around it opens on
	 * `strip.length` (and, on a phone, on an upload being listed), so an empty node costs nothing.
	 */
	stripNode: ReactNode;
	/** 句子里点中第 n 枚标记。 */
	onAttachmentClick: (index: number, rect?: DOMRect) => void;
	/** 右键点在一枚标记上：弹出它的菜单。点在别处不管，交还给浏览器。 */
	onContextMenu: (event: React.MouseEvent<HTMLTextAreaElement>) => void;
	/** 那份菜单，挂在输入框旁边任意位置——它自己浮起来。 */
	menu: ReactNode;
	/** 左下角那颗「+」背后的文件选择框。 */
	picker: { open: () => void; input: ReactNode };
}

export function useComposerAttachments<T extends DraftAttachment>({
	text,
	attachments,
	setAttachments,
	setText,
	field,
	openFile,
	thumbnail,
}: {
	text: string;
	attachments: T[];
	setAttachments: Dispatch<SetStateAction<T[]>>;
	setText: Dispatch<SetStateAction<string>>;
	field: RefObject<HTMLTextAreaElement | null>;
	/** 在应用里打开一个磁盘上的文件（右边的文件面板）。 */
	openFile?: (path: string, name: string) => void;
	/** 上方那一排格子的边长。面板窄，侧边聊天和子智能体那两个框小一号。 */
	thumbnail?: number;
}): ComposerAttachments<T> {
	const { t } = useI18n();
	const actions = useAttachmentActions();
	/*
	 * 正文里那些标记的一生，都在这里面——见 `useAttachmentMarks`。
	 */
	const marks = useAttachmentMarks<T>({ attachments, setAttachments, setText, field });
	/** 右键点在句子里某一枚标记上时，那份附件和菜单该弹在哪儿。 */
	const [markMenu, setMarkMenu] = useState<{ point: { x: number; y: number }; file: T } | null>(null);
	/** 读一份三百页的 PDF 要几百毫秒，那期间正文可能变了；落标记时拿的是此刻的，不是按下时的。 */
	const textRef = useRef(text);
	textRef.current = text;
	const fileRef = useRef<HTMLInputElement>(null);
	/** This composer, as far as a phone's uploads are concerned: each draws only the ones it started. */
	const owner = useId();
	const marksRef = useRef(marks);
	marksRef.current = marks;
	/*
	 * A phone upload that failed and was retried from its card lands after `addFiles` has returned;
	 * it is attached here, at the caret as it is now, exactly like one that arrived first time.
	 */
	useEffect(
		() =>
			receiveLateUploads(owner, (arrived) => {
				const attachment = {
					id: `${arrived.name}-${Date.now()}-${Math.random()}`,
					name: arrived.name,
					mimeType: arrived.mimeType,
					isText: false,
					kind: arrived.kind,
					path: arrived.path,
					upload: arrived.upload,
				} as T;
				marksRef.current.attach([attachment], field.current?.selectionStart ?? textRef.current.length);
			}),
		[owner, field],
	);

	/**
	 * 带着像素的那几个，按它们在附件里的先后。
	 *
	 * 查看器里的序号只能在这一份里数：混着文档一起数，附件里有图有文档时点开的就是另一张图。
	 */
	const previewable = attachments.filter((a) => !a.isText && a.data);

	/**
	 * 从句子里那枚标记上打开图片查看器。
	 *
	 * 查看器是从一个矩形放大开的，而这里没有被点中的那个元素——点中的是 textarea。上面那一排里有这
	 * 张图自己的格子，就从那儿长出来；那一排被滚走了，退回从右键点的位置长。
	 */
	const previewImage = (target: T, originRect?: DOMRect) => {
		const index = previewable.findIndex((file) => file.id === target.id);
		if (index < 0) return;
		const tile = document.querySelector<HTMLElement>(`[data-ly-attachment="${CSS.escape(target.id)}"] .ly-attachment-body`);
		const origin = originRect ?? tile?.getBoundingClientRect() ?? new DOMRect(markMenu?.point.x ?? window.innerWidth / 2, markMenu?.point.y ?? window.innerHeight / 2, 1, 1);
		openViewer(
			previewable.map((file) => ({ src: `data:${file.mimeType};base64,${file.data}`, alt: file.name })),
			index,
			origin,
			tile,
		);
	};

	const addFiles = async (picked: PickedFile[]) => {
		if (picked.length === 0) return;
		/* 在读字节之前问一次：抽一份三百页 PDF 的文本要几百毫秒，那之后光标早不在原地了。 */
		const caret = field.current?.selectionStart ?? textRef.current.length;
		const next = (await readPickedFiles(picked, owner)) as T[];
		// 标记、编号、光标落点，都在这一步里——见 `useAttachmentMarks`。
		if (next.length > 0) marks.attach(next, caret);
	};

	/**
	 * 输入框上方那一排，只有图片。
	 *
	 * 文件不在这里：它的全部信息就是名字，而名字已经写在句子里那枚标记上了——再在上面摆一个同样写着
	 * 名字的格子，是同一件事说两遍，还把那一排撑得老长。图片不一样：缩略图答的是「是哪一张」。
	 *
	 * 两者的删除入口也因此不同：图片在格子上按叉，文件是把句子里那枚标记删掉。
	 */
	const strip: StripFile[] = attachments
		.filter((attachment) => attachment.data && !attachment.isText)
		.map((attachment) => {
			const kind = attachment.kind ?? "image";
			return {
				key: attachment.id,
				name: attachment.name,
				kind,
				...(attachment.label ? { label: attachment.label } : {}),
				src: `data:${attachment.mimeType};base64,${attachment.data}`,
				...(attachment.path ? { path: attachment.path } : {}),
				tip: `${attachment.name}\n${t(KIND_LABEL[kind])}`,
			};
		});

	/*
	 * The images, and — on a phone — any file still on its way to the desktop. `PhoneUploads` draws
	 * nothing when there is nothing in flight, and the phone's stylesheet opens the tray around it
	 * while there is (`.ly-reveal:has(.ly-phone-uploads)`), so no composer has to know about uploads.
	 */
	const images =
		strip.length > 0 ? (
			<AttachmentStrip
				files={strip}
				/*
				 * 独占一行，多了横着滚。这一块地方是拿来打字的：一排附件换到第三行时，被挤出屏幕的是
				 * 输入框自己。
				 */
				layout="row"
				{...(thumbnail ? { thumbnail } : {})}
				eager
				onRemove={(file) => {
					const target = attachments.find((a) => a.id === file.key);
					if (target) marks.detach(target);
				}}
				/*
				 * 这一份还能被改：在查看器里标注完，改的是还没发出去的草稿本身。气泡外那一排就没有
				 * `onReplace`——那一份已经发出去了，是记录。
				 */
				onOpen={(index, event) =>
					openFromEvent(
						event,
						previewable.map((a) => ({
							src: `data:${a.mimeType};base64,${a.data}`,
							alt: a.name,
							onReplace: (dataUrl: string) =>
								setAttachments((prev) => prev.map((item) => (item.id === a.id ? { ...item, ...fromDataUrl(dataUrl, item) } : item))),
						})),
						index,
					)
				}
			/>
		) : null;
	const stripNode = (
		<>
			{images}
			<PhoneUploads owner={owner} />
		</>
	);

	const onAttachmentClick = (index: number, rect?: DOMRect) => {
		const hit = scanPlaceholders(text, attachments)[index];
		if (!hit) return;
		actions.openOrPreview(
			{
				name: hit.file.label ?? hit.file.name,
				path: hit.file.path,
				src: hit.file.data && !hit.file.isText ? `data:${hit.file.mimeType};base64,${hit.file.data}` : undefined,
				mimeType: hit.file.mimeType,
				isImage: !hit.file.isText && Boolean(hit.file.data),
				onPreviewImage: (originRect) => previewImage(hit.file, originRect),
				...(openFile ? { onOpenFile: openFile } : {}),
			},
			rect,
		);
	};

	/*
	 * 右键点在一枚标记上，弹出它的菜单。
	 *
	 * 被点到的是 textarea，不是标记——那一层高亮是铺在它上面的镜像，而镜像整层 `pointer-events: none`。
	 * 所以得自己回答「点的是哪一枚」：问镜像层里那些 span 的位置，逐个 rect 比——一枚跨行的标记有
	 * 两个矩形，它们的并集会把中间整片空白也算进去。
	 */
	const onContextMenu = (event: React.MouseEvent<HTMLTextAreaElement>) => {
		const mirror = field.current?.closest(".ly-composer")?.querySelector("[data-command-mirror]");
		const tokens = [...(mirror?.querySelectorAll(".ly-attachment-token") ?? [])];
		const at = tokens.findIndex((token) =>
			[...token.getClientRects()].some(
				(rect) => event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom,
			),
		);
		if (at < 0) return;
		/* 镜像里 span 的先后和扫描出来的先后是同一个——两边都是文档顺序。 */
		const hit = scanPlaceholders(text, attachments)[at];
		if (!hit) return;
		event.preventDefault();
		setMarkMenu({ point: { x: event.clientX, y: event.clientY }, file: hit.file });
	};

	/*
	 * 句子里那一枚被右键点中时，弹的是和附件条上同一份菜单——打开、在访达中显示、复制路径，以及
	 * 「先确认文件还在」那一步，都只有一处实现。
	 *
	 * 预览只给图片：图片的像素就在手上。文件的「预览」只能是右边那个文件面板，而面板读不到项目外的
	 * 东西，附件绝大多数来自项目外——一个点下去会失败的菜单项比没有更糟，文件要打开有「打开」那一行。
	 */
	const menu = (
		<AttachmentMenu
			anchor={markMenu?.point ?? null}
			file={
				markMenu
					? {
							name: markMenu.file.label ?? markMenu.file.name,
							...(markMenu.file.path ? { path: markMenu.file.path } : {}),
							...(markMenu.file.data && !markMenu.file.isText ? { src: `data:${markMenu.file.mimeType};base64,${markMenu.file.data}` } : {}),
							...(markMenu.file.data && !markMenu.file.isText ? { onPreview: () => previewImage(markMenu.file) } : {}),
						}
					: null
			}
			onClose={() => setMarkMenu(null)}
			onRemove={() => {
				const target = markMenu?.file;
				setMarkMenu(null);
				if (target) marks.detach(target);
			}}
		/>
	);

	const picker = {
		open: () => fileRef.current?.click(),
		input: (
			<input
				ref={fileRef}
				type="file"
				multiple
				hidden
				onChange={(event) => {
					// 选进来的也要取路径，和拖进来的走同一条路——见 `attachments/picked.ts`。
					void addFiles(pickedFrom(event.target.files));
					event.target.value = "";
				}}
			/>
		),
	};

	return { marks, addFiles, strip, stripNode, onAttachmentClick, onContextMenu, menu, picker };
}
