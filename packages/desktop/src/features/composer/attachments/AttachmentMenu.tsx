/**
 * 一份附件能拿去做什么。
 *
 * 一份菜单，输入框上和气泡外共用——两处唯一真正的差别是「移除」这一行，因为已经发出去的那一份是
 * 记录。差别只有这一处，就没有理由让它们各写一份：两份菜单会在第三次改动时分家，而人不会因为附件
 * 在气泡外面就换一套指望。
 *
 * 行的顺序和措辞照抄文件树那份（`features/files/FileMenu.tsx`）。同一台机器上「打开」和「在访达中
 * 显示」是同一件事，出现在两个地方却排成两种顺序的话，肌肉记忆每次都得重学一遍。
 *
 * 做不到的事画成灰的，并且说出为什么。这里有两种做不到：粘贴进来的图片在磁盘上根本没有文件；项目
 * 外的文件打得开，却进不了应用内的面板。两种都不是「点了没反应」能解释的，所以它们各有一句话。
 */

import { CornerUpRight, ExternalLink, FolderOpen, Link2, Trash2 } from "lucide-react";

import { ContextMenu } from "../../../ui/overlay/ContextMenu.tsx";
import { MenuItem, MenuSeparator } from "../../../ui/overlay/Menu.tsx";
import { openLabel, useRevealLabel } from "../../../store/open-targets.ts";
import { useAttachmentActions } from "./actions.ts";
import { useI18n } from "../../../i18n/index.ts";

const ICON = { size: 13, strokeWidth: 1.8 } as const;

/** 菜单要认识这份附件的哪几件事。 */
export interface MenuTarget {
	name: string;
	/** 磁盘上的位置，没有就是没有——粘贴进来的图片就是这一类。 */
	path?: string;
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
	/** 只有还没发出去的那一份给得出这个。 */
	onRemove?: () => void;
}) {
	const { t } = useI18n();
	const actions = useAttachmentActions();
	const reveal = useRevealLabel();

	if (!anchor || !file) return null;

	const { onDisk } = actions.abilities(file.path);
	/*
	 * 为什么这一行是灰的，写成它下面常驻的一行小字。
	 *
	 * 不能挂 tooltip：`MenuItem` 把 `title` 接到 `data-ly-tip` 上，而**禁用的按钮不派发鼠标事件**
	 * ——指针停上去什么都不会发生，那句解释于是永远不会出现。一个不解释自己的禁用项，和一个点下去
	 * 没反应的按钮，对用的人是同一件事。
	 */
	const why = onDisk ? undefined : t("attachment.noFile");

	return (
		<ContextMenu anchor={anchor} onClose={onClose} width="default">
			<MenuItem
				icon={<FolderOpen {...ICON} />}
				disabled={!file.onPreview}
				{...(file.onPreview ? {} : { detail: why ?? t("attachment.outsideProject") })}
				onClick={file.onPreview}
			>
				{t("attachment.openHere")}
			</MenuItem>

			<MenuItem icon={<ExternalLink {...ICON} />} disabled={!onDisk} {...(why ? { detail: why } : {})} onClick={() => actions.openExternal(file)}>
				{openLabel(actions.target)}
			</MenuItem>

			<MenuItem icon={<CornerUpRight {...ICON} />} disabled={!onDisk} {...(why ? { detail: why } : {})} onClick={() => actions.reveal(file)}>
				{reveal}
			</MenuItem>

			<MenuSeparator />

			<MenuItem icon={<Link2 {...ICON} />} disabled={!onDisk} {...(why ? { detail: why } : {})} onClick={() => actions.copyPath(file)}>
				{t("fileMenu.copyPath")}
			</MenuItem>

			{onRemove && (
				<>
					<MenuSeparator />
					<MenuItem icon={<Trash2 {...ICON} />} danger onClick={onRemove}>
						{t("common.remove")}
					</MenuItem>
				</>
			)}
		</ContextMenu>
	);
}
