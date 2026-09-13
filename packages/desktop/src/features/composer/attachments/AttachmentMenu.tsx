/**
 * 一份附件能拿去做什么。
 *
 * 一份菜单，四个地方点出来的都是它：输入框上那一排格子、句子里那枚标记、气泡外那一排、气泡里那枚
 * 标记。差别只有一处——已经发出去的那一份不给「剪切」和「删除」，因为那是记录。差别只有一处，就没
 * 有理由让它们各写一份：四份菜单会在第三次改动时分家，而人不会因为附件换了个位置就换一套指望。
 *
 * 行的顺序照抄文件树那份（`features/files/FileMenu.tsx`）。同一台机器上「打开」和「在访达中显示」
 * 是同一件事，出现在两个地方却排成两种顺序的话，肌肉记忆每次都得重学一遍。
 *
 * 「打开」就叫打开，不写成「在 Zed 中打开」：那是设置里选的默认应用，写进菜单等于每换一次设置这行
 * 字就变一次，而人按它要的从来只是「打开这个文件」。
 *
 * 只列做得到的。做不到的那些一度也列出来、灰着、各带一句为什么，而一张七行的单子上五行是灰的，读的
 * 人第一眼看到的是「这东西基本没用」——何况那五行说的是同一件事：这份附件在磁盘上没有对应的文件。
 */

import { Copy, CornerUpRight, ExternalLink, Eye, Link2, Scissors, Trash2 } from "lucide-react";

import { ContextMenu } from "../../../ui/overlay/ContextMenu.tsx";
import { MenuItem, MenuSeparator } from "../../../ui/overlay/Menu.tsx";
import { useRevealLabel } from "../../../store/open-targets.ts";
import { bridge } from "../../../services/index.ts";
import { useApp } from "../../../store/index.ts";
import { useAttachmentActions } from "./actions.ts";
import { useI18n } from "../../../i18n/index.ts";

const ICON = { size: 13, strokeWidth: 1.8 } as const;

/** 菜单要认识这份附件的哪几件事。 */
export interface MenuTarget {
	name: string;
	/** 磁盘上的位置，没有就是没有——粘贴进来的图片就是这一类。 */
	path?: string;
	/**
	 * 它的像素，图片才有。
	 *
	 * 「复制」一张图，人要的是能粘进聊天窗口的那种复制，所以走图片格式而不是一行路径——何况路径那
	 * 一行它未必有。
	 */
	src?: string;
	/**
	 * 在应用里看它一眼。
	 *
	 * 由调用方给，因为「看一眼」对图片和对文档是两件事：前者是查看器，从格子的位置放大开；后者是
	 * 右边的文件面板。没有这一项就说明这一份在应用里看不了。
	 */
	onPreview?: () => void;
}

export function AttachmentMenu({
	anchor,
	file,
	onClose,
	onRemove,
}: {
	anchor: { x: number; y: number } | null;
	file: MenuTarget | null;
	onClose: () => void;
	/** 只有还没发出去的那一份给得出这个——发出去的是记录，剪切和删除都无从谈起。 */
	onRemove?: () => void;
}) {
	const { t } = useI18n();
	const actions = useAttachmentActions();
	const reveal = useRevealLabel();

	if (!anchor || !file) return null;

	const { onDisk } = actions.abilities(file.path);
	/** 图片的像素在手上就能复制；文件得先在磁盘上找得到。 */
	const canCopy = Boolean(file.src) || onDisk;

	/*
	 * 一行都没有就别弹。
	 *
	 * 「只列做得到的」有一种下场是这一整份单子空掉：一份已经发出去的文件附件，磁盘上找不到它（老消
	 * 息没存路径），没有像素可复制，记录也谈不上移除——于是屏幕上浮出一个空的圆角灰框，正好盖住人
	 * 刚点的那句话。什么都不弹至少是诚实的：这一枚眼下确实没有能做的事。
	 */
	if (!file.onPreview && !onDisk && !canCopy && !onRemove) return null;

	/** 复制一份出去：图片进剪贴板是图片，文件进剪贴板是它的路径。 */
	const copy = () => {
		if (file.src) {
			void bridge.clipboard.writeImage(file.src);
			useApp.getState().notify(t("attachment.copiedImage"), "info");
			return;
		}
		actions.copyPath(file);
	};

	return (
		<ContextMenu anchor={anchor} onClose={onClose} width="default">
			{/*
			 * 只列做得到的。
			 *
			 * 上一版把做不到的也列出来，灰着，各带一句为什么——一张七行的单子上五行是灰的，读的人第
			 * 一眼看到的是「这东西基本没用」。而那五行说的其实是同一件事：这份附件在磁盘上没有对应的
			 * 文件（粘贴进来的截图就是这样），而那件事它自己已经说清楚了——能做的那几行还在。
			 */}
			{file.onPreview && (
				<MenuItem icon={<Eye {...ICON} />} onClick={file.onPreview}>
					{t("attachment.preview")}
				</MenuItem>
			)}

			{onDisk && (
				<MenuItem icon={<ExternalLink {...ICON} />} onClick={() => actions.openExternal(file)}>
					{t("common.open")}
				</MenuItem>
			)}

			{/*
			 * 「在访达中显示」只此一条。
			 *
			 * 一度还有一条「打开所在文件夹」：前者打开目录并选中它，后者只打开目录——技术上确实是两
			 * 件事，但对着菜单的人读到的是同一句话说了两遍。`reveal` 的文案本来就跟着平台走（访达 /
			 * 文件资源管理器），一条就够。
			 */}
			{onDisk && (
				<MenuItem icon={<CornerUpRight {...ICON} />} onClick={() => actions.reveal(file)}>
					{reveal}
				</MenuItem>
			)}

			{canCopy && <MenuSeparator />}

			{canCopy && (
				<MenuItem icon={<Copy {...ICON} />} onClick={copy}>
					{file.src ? t("attachment.copyImage") : t("fileMenu.copyPath")}
				</MenuItem>
			)}

			{/* 图片那一行复制的是像素；它同时来自磁盘的话，路径另给一行——两样都常要。 */}
			{Boolean(file.src) && onDisk && (
				<MenuItem icon={<Link2 {...ICON} />} onClick={() => actions.copyPath(file)}>
					{t("fileMenu.copyPath")}
				</MenuItem>
			)}

			{onRemove && (
				<>
					<MenuSeparator />
					{/*
					 * 剪切 = 复制一份出去，再从这条消息里拿掉。
					 *
					 * 和文件管理器里的剪切不是一回事——那边剪的是磁盘上的文件，这里剪的是「这条消息带不
					 * 带它」。磁盘上那一份一个字节都不会动：一个输入框没有理由删别人的文件。
					 */}
					{canCopy && (
						<MenuItem
							icon={<Scissors {...ICON} />}
							onClick={() => {
								copy();
								onRemove();
							}}
						>
							{t("attachment.cut")}
						</MenuItem>
					)}
					<MenuItem icon={<Trash2 {...ICON} />} danger onClick={onRemove}>
						{t("common.remove")}
					</MenuItem>
				</>
			)}
		</ContextMenu>
	);
}
