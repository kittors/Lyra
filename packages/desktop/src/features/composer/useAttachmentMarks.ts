/**
 * 正文里那枚标记的一生，从落下到被删掉。
 *
 * 「照着 【图片 1】 改一版」里的那个「图片 1」——它是一句话和一份附件之间唯一连着的东西，也是附件
 * 送给模型时的次序所在。这一整套从前只长在主输入框上：侧边聊天和子智能体的输入框同样收文件、同样
 * 画那一排缩略图，但句子里什么也没有，于是「第二张图」在那两个地方模型只能猜。
 *
 * 它不是一个「插个字符串」那么小的东西，这也是为什么它没被顺手抄过去——一枚标记要成立，得同时有：
 * 落下时的编号与光标落点、删掉一格之后剩下那些的重新编号、退格按整枚吃掉、光标不许停进它内部、
 * 换界面语言时整篇改写、以及句子里标记没了附件要跟着卸下来。少任何一件，它就会在某一步退化成一串
 * 没人认得的裸方括号，而人看不出自己刚破坏了什么。
 *
 * 所以这里是一个 hook 而不是几个工具函数：这些事共用同一份「改之前的列表」，拆开就各自为政了。
 * 纯逻辑那一层在 `lib/attachment-placeholders.ts`，这里只管把它接到一个真实的输入框上。
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useI18n } from "../../i18n/index.ts";
import {
	clampToPlaceholders,
	placeholderAt,
	placeholderFor,
	renamePlaceholders,
	scanPlaceholders,
} from "../../lib/attachment-placeholders.ts";
import { displayName } from "./attachments/display.ts";
import { fileKind, KIND_LABEL, type FileKind } from "./attachments/file-kind.ts";
import type { ComposerDecorations } from "./CommandText.tsx";

/** 一份附件里，这套记号用得上的那几项。三个输入框各有各的附件类型，交集就是这些。 */
export interface MarkableFile {
	name: string;
	mimeType: string;
	/** 界面上叫什么：「图片 1」或者文件名。正文里那枚标记写的就是它。 */
	label?: string;
	kind?: FileKind;
	isText?: boolean;
	data?: string;
}

export interface AttachmentMarks<F> {
	/** 重新编号后的列表——「图片 2」里的 2 是它在同门类里的位置，别人被删掉它就变了。 */
	relabel: (files: F[]) => F[];
	/**
	 * 收下这几份附件：重新编号、在光标处落下标记、把光标送到标记后面。
	 *
	 * `caret` 要在读文件**之前**记下来传进来：读一份三百页的 PDF 要几百毫秒，那期间光标早不在原地了。
	 */
	attach: (added: F[], caret: number) => void;
	/** 卸下这几份，返回改写后的正文——落地方式由调用方定，有的地方本来就在改字的中途。 */
	unload: (text: string, dropped: F[]) => string;
	/** 附件条上按叉：卸下它，正文跟着对齐。 */
	detach: (file: F) => void;
	/** 镜像层要画的那些标签。 */
	decorationFor: (text: string) => NonNullable<ComposerDecorations["attachments"]>;
	/** 退格/删除：命中一枚标记就整枚吃掉并卸下附件，返回是否已经接管这一下。 */
	keyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => boolean;
	/** 人改完字之后：句子里没人提的附件跟着卸下来。 */
	reconcile: (next: string) => void;
}

export function useAttachmentMarks<F extends MarkableFile>({
	attachments,
	setAttachments,
	setText,
	field,
}: {
	attachments: F[];
	setAttachments: (files: F[]) => void;
	/** 函数式更新，因为这几件事经常和人正在打的字撞在同一帧。 */
	setText: (update: (current: string) => string) => void;
	field: React.RefObject<HTMLTextAreaElement | null>;
}): AttachmentMarks<F> {
	const { t, locale } = useI18n();
	/** 闭包里那份会过期，而这几件事都要拿「此刻」的列表去配对。 */
	const live = useRef(attachments);
	live.current = attachments;
	/** 方向键的去向，`clampToPlaceholders` 靠它决定把光标推到标记的哪一头。 */
	const lastArrow = useRef(0);

	const relabel = useCallback(
		(files: F[]): F[] => {
			const seen = new Map<FileKind, number>();
			return files.map((file) => {
				const kind = file.kind ?? (file.isText ? "text" : fileKind(file.name ?? "", file.mimeType ?? ""));
				const kindIndex = (seen.get(kind) ?? 0) + 1;
				seen.set(kind, kindIndex);
				/*
				 * 有名字就叫名字，没有才叫「图片 1」。
				 *
				 * 和附件条上那一格写的是同一个字符串（`displayName` 是纯函数，两处算得出同一个结果）
				 * ——两边差一个字，正文里那枚标记就配不上任何一份附件。
				 */
				return { ...file, label: displayName({ name: file.name, kindLabel: t(KIND_LABEL[kind]), kindIndex }, t("composer.regionShot")) };
			});
		},
		[t],
	);

	const unload = useCallback(
		(text: string, dropped: F[]): string => {
			/*
			 * 定位用**改之前**那份列表，所以不存在「认不出」的窗口。
			 *
			 * 两件事必须在一次里做完：被卸下的那些，标记从句子里拿掉；剩下的那些名字可能变了——删掉
			 * 「图片 1」之后原来的「图片 2」就成了「图片 1」，正文里那句「照着 【图片 2】 改」不跟着
			 * 改就指向一个不存在的编号，那枚标记当场退化成裸方括号。
			 */
			const before = live.current;
			const remaining = before.filter((file) => !dropped.includes(file));
			const relabelled = relabel(remaining);
			const renamed = new Map(remaining.map((file, index) => [file, relabelled[index].label ?? file.name]));
			setAttachments(relabelled);
			return renamePlaceholders(text, before, (file) => renamed.get(file) ?? null);
		},
		[relabel, setAttachments],
	);

	const attach = useCallback(
		(added: F[], caret: number) => {
			if (added.length === 0) return;
			const before = live.current;
			const grown = relabel([...before, ...added]);
			setAttachments(grown);

			/*
			 * 标记之间不另外塞空格：收尾那个方括号是透明的，它自己就占一格。再加一个，两枚标记之间
			 * 就空出两格，看着像中间掉了个字。
			 */
			const marks = grown
				.slice(before.length)
				.map((file) => placeholderFor(file.label ?? file.name))
				.join("");
			setText((current) => {
				const at = Math.min(caret, current.length);
				const head = current.slice(0, at);
				// 前面留一个空格，后面不留——后面那一格已经由透明的收尾方括号占着了。
				const lead = head && !/\s$/.test(head) ? " " : "";
				return `${head}${lead}${marks}${current.slice(at)}`;
			});
			/* 光标落在标记后面，人接着打的字就跟在它后头。 */
			requestAnimationFrame(() => {
				const el = field.current;
				if (!el) return;
				const to = Math.min(caret, el.value.length) + marks.length + 1;
				el.setSelectionRange(to, to);
			});
		},
		[field, relabel, setAttachments, setText],
	);

	const detach = useCallback((file: F) => setText((current) => unload(current, [file])), [setText, unload]);

	const decorationFor = useCallback(
		(text: string) =>
			/*
			 * 认得出的那些画成标签，认不出的原样留着。
			 *
			 * 「这个【重要】」在中文里是普通标点，不是引用——扫描按名字配对，配不上就当作人打的字。
			 */
			scanPlaceholders(text, attachments).map(({ start, end, file }) => ({
				start,
				end,
				kind: file.kind ?? (file.isText ? "text" : fileKind(file.name ?? "", file.mimeType ?? "")),
				// 正文和像素都没进提示词的那些——模型只拿到一个名字，图标淡一档说这件事。
				...(!file.isText && !file.data ? { bodiless: true } : {}),
			})),
		[attachments],
	);

	const keyDown = useCallback(
		(event: React.KeyboardEvent<HTMLTextAreaElement>): boolean => {
			const el = event.currentTarget;
			lastArrow.current = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
			/*
			 * 退格吃掉整枚标记，不是一个字符。
			 *
			 * 一格一格地退，`【表格 1】` 会先变成 `【表格 1`——那一刻它已经不再是标记（配不上任何附件），
			 * 附件不会跟着卸下来，而屏幕上还剩一串没人认得的字。整枚一起走，这一下才和「这份附件不要了」
			 * 是同一件事。只在没有选区时接管：人自己框住一段按删除，那是他要删的那一段。
			 */
			if ((event.key !== "Backspace" && event.key !== "Delete") || el.selectionStart !== el.selectionEnd) return false;
			const hit = placeholderAt(el.value, live.current, el.selectionStart, event.key === "Backspace");
			if (!hit) return false;
			event.preventDefault();
			const cut = `${el.value.slice(0, hit.start)}${el.value.slice(hit.end)}`.replace(/[ \t]{2,}/g, " ");
			setText(() => unload(cut, [hit.file]));
			requestAnimationFrame(() => el.setSelectionRange(hit.start, hit.start));
			return true;
		},
		[setText, unload],
	);

	const reconcile = useCallback(
		(next: string) => {
			/*
			 * 句子里那枚标记被删掉，附件跟着卸下来。
			 *
			 * 标记就是这份附件在这条消息里的存在：删了标记还留着附件，就成了一份谁也提不到的东西。
			 * 在这里做而不是放 effect 里，因为它必须只在**人改字**时发生：放文件时是先加附件、再写
			 * 标记，两次更新之间有一帧附件已在而标记未落——effect 会在那一帧认定它是孤儿，当场把刚
			 * 拖进来的文件删掉。
			 */
			const kept = new Set(scanPlaceholders(next, live.current).map((hit) => hit.file));
			const orphaned = live.current.filter((file) => !kept.has(file));
			if (orphaned.length > 0) setText(() => unload(next, orphaned));
		},
		[setText, unload],
	);

	/*
	 * 光标不进标记里面。
	 *
	 * 标记是一个整体：停进去之后方向键一格一格地穿过它，打一个字它就废了——当场退化成裸方括号，而人
	 * 看不出自己刚破坏了什么。
	 *
	 * 挂原生的 `selectionchange`，不挂 React 的 `onSelect`：后者是从 focus/按键/鼠标几类事件里合成
	 * 出来的，合成不出来的路径（拖选、双击选词、输入法落字、程序改选区）就没有它——方向键那一路因此
	 * 是好的，而点进去那一路不是。
	 */
	useEffect(() => {
		const clamp = () => {
			const el = field.current;
			if (!el || document.activeElement !== el) return;
			// 组字时不碰选区：一次 `setSelectionRange` 就能让输入法当场散掉，而那几个字母还没上屏。
			if (el.dataset.composing !== undefined) return;
			const next = clampToPlaceholders(
				el.value,
				live.current,
				{ start: el.selectionStart, end: el.selectionEnd },
				el.selectionStart === el.selectionEnd ? lastArrow.current : 0,
			);
			if (next.start !== el.selectionStart || next.end !== el.selectionEnd) {
				el.setSelectionRange(next.start, next.end, el.selectionDirection ?? "none");
			}
		};
		document.addEventListener("selectionchange", clamp);
		return () => document.removeEventListener("selectionchange", clamp);
	}, [field]);

	/*
	 * 换了界面语言，正文里那些标记跟着改写。
	 *
	 * 「图片 1」是一句会翻译的话。标记是放文件那天写下的，界面换成英文之后附件条上那一格叫 `Image 1`
	 * 而句子里还写着 `【图片 1】`——两边一对不上，那枚标记就不再是标记，删掉附件时也不会跟着走。
	 * 文件名不在此列，它本来就不翻译。
	 */
	const spokenIn = useRef(locale);
	useEffect(() => {
		if (spokenIn.current === locale) return;
		spokenIn.current = locale;
		const before = live.current;
		if (before.length === 0) return;
		const relabelled = relabel(before);
		const renamed = new Map(before.map((file, index) => [file, relabelled[index].label ?? file.name]));
		setAttachments(relabelled);
		setText((current) => renamePlaceholders(current, before, (file) => renamed.get(file) ?? null));
	}, [locale, relabel, setAttachments, setText]);

	return useMemo(
		() => ({ relabel, attach, unload, detach, decorationFor, keyDown, reconcile }),
		[relabel, attach, unload, detach, decorationFor, keyDown, reconcile],
	);
}
