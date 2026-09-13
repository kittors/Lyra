/**
 * 一份附件在屏幕上叫什么，以及能拿它做什么。
 *
 * 两件事在这里，因为它们回答的是同一个问题的两半：这一格里画的到底是什么东西。名字决定人怎么
 * 指认它，能力决定菜单里哪几行是活的——而两者的答案都取决于同一件事，这份附件在磁盘上到底存不
 * 存在。
 *
 * 纯函数，没有 DOM 也没有桥，所以 `node --test` 能把每一种名字都过一遍。判定写在这里而不是散
 * 在渲染里，是因为「这张图该叫图片几」错了以后没有任何迹象——界面上是「图片 2」，提示词里是
 * `image 1 of 1`，人说「看图片 2」，模型去找一个不存在的编号。
 */

import { splitExtension } from "../../../lib/paths.ts";
import { isDescendantPath } from "../../../lib/paths.ts";

/**
 * 这个名字是不是等于没说。
 *
 * 剪贴板里的图片没有文件名可言：浏览器给的是 `image.png`，macOS 截图粘贴过来也是它，应用内的
 * 区域截图给的是我们自己编的那一个。这些名字在一排附件里全长一样，指认不了任何东西——「第二张
 * 截图」才是人真正会说的话，所以这一类让位给序号。
 *
 * 拖进来和选进来的文件不在此列：`report.pdf` 是人自己起的名字，换成「PDF 1」是把信息换成了废话。
 *
 * `regionShot` 由调用方传进来，因为它是**翻译过的**——窗口语言换一种，那个名字就换一种，写死
 * 在这里的任何一份清单都会在第七种语言上漏掉。
 */
export function isPlaceholderName(name: string, regionShot?: string): boolean {
	const trimmed = name.trim();
	if (!trimmed) return true;
	if (regionShot && trimmed === regionShot) return true;
	const [stem] = splitExtension(trimmed);
	// `image`、`image (1)`、`pasted image`、`screenshot`——加不加序号、用什么分隔都算。
	return /^(image|photo|picture|screenshot|screen[\s_-]?shot|clipboard|pasted[\s_-]?image|untitled)([\s_-]*\(?\d+\)?)?$/i.test(stem);
}

/**
 * 名字拆成「可以被省略号吃掉的」和「不许被吃掉的」。
 *
 * 扩展名就是类型本身。一个两行 `line-clamp` 的省略号落在名字末尾，而末尾正好是 `.xlsx`——一排
 * 六个文件于是既看不出是哪一个，也看不出是什么。所以扩展名从名字里摘出来单独画，剩下的部分才
 * 参与截断。
 *
 * 复用 `splitExtension`：`archive.tar.gz` 是 `.gz`，`.env` 整个是名字，这些边界那边已经定过一次。
 */
export function nameParts(name: string): { stem: string; ext: string } {
	const [stem, extension] = splitExtension(name);
	// `.` 去掉：画在角标上的是 `XLSX`，不是 `.XLSX`。
	const ext = extension.replace(/^\./, "");
	/*
	 * 太长或带空格的，不是扩展名。
	 *
	 * `会议纪要 2026.09.13 定稿` 的最后一段是日期的一部分，把它当类型画成角标，那一格上就会顶着
	 * 一个大写的 `13 定稿`。八个字符放得下 `sketch` 和 `numbers`，放不下一句话。
	 */
	if (!ext || ext.length > 8 || /\s/.test(ext)) return { stem: name, ext: "" };
	return { stem, ext };
}

/**
 * 这一格上写哪几个字。
 *
 * `kindIndex` 是它在**同门类里**的序号，和提示词里 `image 2 of 3` 数的是同一个数——见
 * `attachment-placeholders.ts`。两边必须是同一个数，否则人说的「图片 2」和模型看到的「图片 2」
 * 不是同一张，而这种错没有任何外在迹象。
 */
export function displayName(file: { name: string; kindLabel: string; kindIndex: number }, regionShot?: string): string {
	return isPlaceholderName(file.name, regionShot) ? `${file.kindLabel} ${file.kindIndex}` : file.name;
}

/** 一份附件在这台机器上能被怎么处置。 */
export interface Abilities {
	/** 磁盘上真的有这么一个文件。粘贴进来的图片只有内存里的像素，没有。 */
	onDisk: boolean;
	/**
	 * 在某个已登记的项目目录里头。
	 *
	 * 应用内的文件面板只读得到这一类：`files.read` 和 `ly-media://` 两头都要过
	 * `resolveReadablePath(…, projectRoots())`。`~/下载` 里的表格拿得到路径、打得开系统应用，
	 * 但在面板里会是一句 403——所以菜单第一行对它是灰的，而不是点下去什么都不发生。
	 */
	inProject: boolean;
}

export function abilitiesOf(path: string | undefined, projectRoots: readonly string[]): Abilities {
	if (!path) return { onDisk: false, inProject: false };
	return {
		onDisk: true,
		inProject: projectRoots.some((root) => root === path || isDescendantPath(root, path)),
	};
}
