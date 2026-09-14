/**
 * 一份缺胳膊少腿的附件，不该把整个界面带走。
 *
 * `fileKind` 是渲染期被调用的：附件条画每一格时问一次，输入框算正文里那些标记时问一次。它拿到
 * 一个 `null` 的 mimeType 就会在 `mime.startsWith` 上抛出去，而那是 React 渲染中途——结果不是一格
 * 附件画不出来，是整块界面白掉，只剩一句 `child.startsWith is not a function`（压缩后的变量名，
 * 真身就是这里的 `mime`）。
 *
 * 而缺字段是正常的：附件不都是当场造的，从磁盘恢复的草稿、从手机同步过来的那一份，都可能带着
 * 一个更老的形状进来，而它们进来时是 `as Attachment[]` ——类型上那个 `: string` 一次也没被检查过。
 * 默认参数 `mimeType = ""` 只挡 `undefined`，挡不住 `null`。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { fileKind } from "../src/features/composer/attachments/file-kind.ts";

test("一个没有 mimeType 的附件按扩展名归类，而不是把界面带走", () => {
	const missing = undefined as unknown as string;
	const nulled = null as unknown as string;
	assert.equal(fileKind("shot.png", missing), "image");
	assert.equal(fileKind("shot.png", nulled), "image");
	assert.equal(fileKind("notes.md", nulled), "text");
});

test("连名字都没有也只是归不了类，不是异常", () => {
	const nameless = null as unknown as string;
	assert.doesNotThrow(() => fileKind(nameless, null as unknown as string));
	assert.doesNotThrow(() => fileKind(nameless, "image/png"));
	assert.equal(fileKind(nameless, "image/png"), "image");
});

test("mimeType 认得出来的仍然优先于「不知道」", () => {
	assert.equal(fileKind("blob", "application/pdf"), "pdf");
	assert.equal(fileKind("blob", null as unknown as string), "text");
});
