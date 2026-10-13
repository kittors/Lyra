/**
 * 主进程从渲染进程收消息内容时，图片块上的「标注自哪张图」只认 session-media 里的名字。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { promptContent } from "../electron/prompt-input.ts";

test("标注副本的来源只保留成 session-media 的文件名", () => {
	const name = `${"a".repeat(40)}.jpg`;
	const [kept] = promptContent([{ type: "image", data: "AAAA", mimeType: "image/png", from: name }]);
	assert.equal((kept as { from?: string }).from, name);
	const [dropped] = promptContent([{ type: "image", data: "AAAA", mimeType: "image/png", from: "../../etc/passwd" }]);
	assert.equal("from" in dropped, false);
	const [plain] = promptContent([{ type: "image", data: "AAAA", mimeType: "image/png" }]);
	assert.deepEqual(plain, { type: "image", data: "AAAA", mimeType: "image/png" });
});
