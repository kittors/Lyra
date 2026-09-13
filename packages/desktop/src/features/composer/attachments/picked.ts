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

import { bridge } from "../../../services/index.ts";

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
	/*
	 * 问桥本身有没有这个方法，不问 `available()`。
	 *
	 * `available()` 查的是契约表（`@lyra/contract` 的 `METHODS`），而 `pathForDrop` **不在那张表
	 * 里**——它不是一次 IPC，是 preload 里手写的一个同步调用，`webUtils` 只有那儿有。于是这一问永远
	 * 答 false，路径一次都没被取到过：附件条上每一份都是「粘贴进来的，磁盘上没有它」，哪怕它就是从
	 * 访达里拖进来的。打开、在访达中显示、复制路径，三件事因此从来没有真正工作过。
	 *
	 * 这类判断只有一种可靠问法：那个函数在不在。
	 */
	const canAsk = typeof bridge.files?.pathForDrop === "function";
	return Array.from(list).map((file) => {
		if (!canAsk) return { file };
		/*
		 * 取不到就是没有，不是错。
		 *
		 * 剪贴板里的图片在这里会拿到空串——它本来就不是一个文件。包一层是因为「方法在」不等于「此刻
		 * 调它不会抛」，而这是一次同步调用，抛出来就直接掀掉了整个 drop 处理。
		 */
		try {
			const path = bridge.files.pathForDrop(file);
			return path ? { file, path } : { file };
		} catch {
			return { file };
		}
	});
}
