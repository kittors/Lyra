/**
 * 一批刚被放进来的文件，连同它们在磁盘上的位置。
 *
 * 位置是这一层存在的全部理由。`File` 对象本身答不了「它从哪儿来」——Electron 32 之后 `File.path`
 * 就没了，替代品 `webUtils.getPathForFile` 只在 preload 里有。没有它，一份拖进来的表格在附件条
 * 上就只是一个名字：打不开，也指不出它在哪，而那个文件明明就躺在 `~/下载` 里。
 *
 * 同步取，在拿到 `FileList` 的那一刻。`pathForDrop` 本身是同步的，而调用它的时机不能拖到 await
 * 之后——drop 事件返回时 `DataTransfer` 就被清空了。三条路（拖、贴、选）都走这里，免得其中一条
 * 忘了取路径，而那种缺失只在「点开菜单发现全是灰的」时才看得出来。
 */

import { available, bridge } from "../../../services/index.ts";

export interface PickedFile {
	file: File;
	/**
	 * 它在磁盘上的位置，有的话。
	 *
	 * 粘贴进来的截图没有：剪贴板给的是一团像素，从来不是某个文件。浏览器里跑的时候也没有——
	 * `pathForDrop` 是 Electron 的东西。
	 */
	path?: string;
}

export function pickedFrom(list: FileList | null | undefined): PickedFile[] {
	if (!list) return [];
	const canAsk = available("files", "pathForDrop");
	return Array.from(list).map((file) => {
		if (!canAsk) return { file };
		/*
		 * 取不到就是没有，不是错。
		 *
		 * 剪贴板里的图片在这里会拿到空串——它本来就不是一个文件。包一层是因为 `available()` 回答
		 * 的是「契约里有没有这个方法」，不是「此刻调它会不会抛」，而这是一次同步调用，抛出来就
		 * 直接掀掉了整个 drop 处理。
		 */
		try {
			const path = bridge.files.pathForDrop(file);
			return path ? { file, path } : { file };
		} catch {
			return { file };
		}
	});
}
