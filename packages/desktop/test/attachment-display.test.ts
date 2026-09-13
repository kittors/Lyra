/**
 * 附件那一格上写什么，以及它能被怎么处置。
 *
 * 两类错误各有一条不会被看见的路径。「图片几」错了，界面和提示词会各说各的编号，而人说的那句
 * 「第二张图」于是指向一张模型看不到的图——两边都自洽，只有合起来是错的。能力判定错了，菜单上
 * 会出现一行点下去什么都不发生的「打开」，因为路径根本没进到附件里，或者它压根不在项目里。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { abilitiesOf, displayName, isPlaceholderName, nameParts } from "../src/features/composer/attachments/display.ts";
import { parentOf } from "../src/lib/paths.ts";

test("剪贴板给的那些名字，等于没说", () => {
	for (const name of [
		"image.png",
		"IMAGE.PNG",
		"image (1).png",
		"photo.jpg",
		"screenshot.png",
		"Screen Shot.png",
		"screen-shot.png",
		"pasted image.png",
		"pasted_image 2.png",
		"clipboard.png",
		"untitled.png",
		"   ",
		"",
	]) {
		assert.equal(isPlaceholderName(name), true, name);
	}
});

test("人自己起的名字不让位给序号", () => {
	for (const name of [
		"陈列道具导入模板(花园里店).xlsx",
		"report.pdf",
		"Screenshot 2026-09-13 at 10.00.00.png",
		"image-of-the-rig.png",
		"photos.zip",
		".env",
		"README",
	]) {
		assert.equal(isPlaceholderName(name), false, name);
	}
});

test("应用内截图那个名字是翻译过的，只能由调用方说出来", () => {
	// 中文窗口下它叫这个，而写死在判定里的任何一份清单都会在第七种语言上漏掉。
	assert.equal(isPlaceholderName("页面区域.png", "页面区域.png"), true);
	assert.equal(isPlaceholderName("页面区域.png"), false);
});

test("没有真名的图片，按它在同门类里的序号称呼", () => {
	// 和提示词里 `image 2 of 3` 数的必须是同一个数——见 attachment-placeholders。
	assert.equal(displayName({ name: "image.png", kindLabel: "图片", kindIndex: 2 }), "图片 2");
	assert.equal(displayName({ name: "", kindLabel: "图片", kindIndex: 1 }), "图片 1");
	assert.equal(
		displayName({ name: "陈列道具导入模板(花园里店).xlsx", kindLabel: "表格", kindIndex: 1 }),
		"陈列道具导入模板(花园里店).xlsx",
	);
});

test("扩展名单独摘出来，省略号吃不到它", () => {
	assert.deepEqual(nameParts("陈列道具导入模板(花园里店).xlsx"), { stem: "陈列道具导入模板(花园里店)", ext: "xlsx" });
	assert.deepEqual(nameParts("archive.tar.gz"), { stem: "archive.tar", ext: "gz" });
	assert.deepEqual(nameParts("design.sketch"), { stem: "design", ext: "sketch" });
});

test("看着像扩展名而不是扩展名的，整个留在名字里", () => {
	// 角标上顶着一个大写的 `13 定稿` 比没有角标糟。
	assert.deepEqual(nameParts("会议纪要 2026.09.13 定稿"), { stem: "会议纪要 2026.09.13 定稿", ext: "" });
	assert.deepEqual(nameParts(".env"), { stem: ".env", ext: "" });
	assert.deepEqual(nameParts("README"), { stem: "README", ext: "" });
	assert.deepEqual(nameParts("backup."), { stem: "backup.", ext: "" });
	// 八个字符是 `numbers` 和 `afdesign` 的地方，不是一句话的地方。
	assert.deepEqual(nameParts("note.verylongsuffix"), { stem: "note.verylongsuffix", ext: "" });
});

test("没有路径的附件，磁盘上没有它", () => {
	// 粘贴进来的图片：像素在内存里，菜单上「打开」「在访达中显示」都是灰的。
	assert.deepEqual(abilitiesOf(undefined, ["/Users/me/work"]), { onDisk: false, inProject: false });
});

test("项目外的文件打得开，但打不进面板", () => {
	// `files.read` 和 `ly-media://` 两头都过 resolveReadablePath，项目外是 403。
	assert.deepEqual(abilitiesOf("/Users/me/Downloads/表.xlsx", ["/Users/me/work"]), { onDisk: true, inProject: false });
	assert.deepEqual(abilitiesOf("/Users/me/work/docs/表.xlsx", ["/Users/me/work"]), { onDisk: true, inProject: true });
	// 项目根本身也算在里头。
	assert.deepEqual(abilitiesOf("/Users/me/work", ["/Users/me/work"]), { onDisk: true, inProject: true });
});

test("同名前缀的另一个目录不算在项目里", () => {
	// `/Users/me/work-old` 不是 `/Users/me/work` 的下级，前缀比较会说它是。
	assert.deepEqual(abilitiesOf("/Users/me/work-old/表.xlsx", ["/Users/me/work"]), { onDisk: true, inProject: false });
});

test("所在文件夹是它上一级，不是它自己", () => {
	// 「在访达中显示」打开目录并选中文件；「打开所在文件夹」只打开目录——两件事，两个菜单项。
	assert.equal(parentOf("/Users/me/Downloads/表.xlsx"), "/Users/me/Downloads");
	assert.equal(parentOf("C:\\Users\\me\\表.xlsx"), "C:\\Users\\me");
	// 根目录下的文件：上级是根，不是空串——空串会被当成「没有路径」而把菜单项画成灰的。
	assert.equal(parentOf("/表.xlsx"), "/");
	// 压根不是路径的东西，答不出上级
	assert.equal(parentOf("表.xlsx"), "");
});
