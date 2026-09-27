/**
 * A phone sending a file to the desktop: what the composer shows while it travels.
 *
 * The attachment only appears once the desktop has the file, so until then the composer has to say
 * something — how far along it is, how to stop it, and when the link drops, how to try again without
 * picking the file a second time. Driven through the real `uploadFromPhone` against a bridge whose
 * upload the test controls, and read back off the rendered cards.
 */

import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, createElement as h } from "react";

import { PhoneUploads } from "../../src/features/composer/attachments/PhoneUploads.tsx";
import { uploadFromPhone, type PhoneUploadOutcome } from "../../src/features/composer/attachments/phone-upload.ts";
import { pendingUploads, receiveLateUploads, type ArrivedUpload } from "../../src/features/composer/attachments/uploads.ts";
import { click, mount } from "../helpers/mount.ts";

interface Call {
	options: { signal?: AbortSignal; onProgress?(transfer: { done: number; total: number }): void };
	resolve(value: unknown): void;
	reject(error: Error): void;
}

let calls: Call[];

beforeEach(() => {
	calls = [];
	Object.defineProperty(window, "lyra", {
		configurable: true,
		value: {
			host: "mobile",
			platform: "darwin",
			files: {
				upload: (_file: unknown, options: Call["options"]) =>
					new Promise((resolve, reject) => {
						calls.push({ options, resolve, reject });
						options.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
					}),
			},
		},
	});
});

afterEach(() => {
	Reflect.deleteProperty(window, "lyra");
	for (const row of pendingUploads()) row.cancel();
});

const MB = 1024 * 1024;
const file = (name: string, size: number) => ({ name, size, type: "application/pdf" }) as unknown as File;

test("a file on its way shows its name and how far it has got, then gives way to the attachment", async () => {
	const view = await mount(h(PhoneUploads, { owner: "main" }));
	try {
		let outcome: PhoneUploadOutcome | null = null;
		void uploadFromPhone(file("季度报告.pdf", 12 * MB), "pdf", false, "main").then((value) => (outcome = value));
		await act(async () => {});
		assert.equal(view.find(".ly-phone-upload-name").textContent, "季度报告.pdf");

		await act(async () => calls[0].options.onProgress?.({ done: 3 * MB, total: 12 * MB }));
		assert.equal(view.find("[role='progressbar']").getAttribute("aria-valuenow"), "25");
		assert.equal(view.find(".ly-phone-upload-meta").textContent, "3.0 MB / 12 MB");

		await act(async () => calls[0].resolve({ id: "u1", name: "季度报告.pdf", size: 12 * MB, mimeType: "application/pdf", path: "/tmp/uploads/季度报告.pdf" }));
		assert.equal(view.all(".ly-phone-upload").length, 0, "到了就收起，附件接着出现在句子里");
		assert.deepEqual(outcome, { kind: "uploaded", file: { upload: "u1", path: "/tmp/uploads/季度报告.pdf", mimeType: "application/pdf" } });
	} finally {
		await view.unmount();
	}
});

test("the cross stops it: the transfer is aborted and nothing is attached", async () => {
	const view = await mount(h(PhoneUploads, { owner: "main" }));
	try {
		let outcome: PhoneUploadOutcome | null = null;
		void uploadFromPhone(file("日志.zip", 80 * MB), "archive", false, "main").then((value) => (outcome = value));
		await act(async () => {});
		assert.equal(view.find(".ly-phone-upload-cancel").getAttribute("aria-label"), "取消上传 日志.zip");
		await click(view.find(".ly-phone-upload-cancel"));
		assert.equal(calls[0].options.signal?.aborted, true, "中止的是那一次传输本身");
		assert.deepEqual(outcome, { kind: "cancelled" });
		assert.equal(view.all(".ly-phone-upload").length, 0);
	} finally {
		await view.unmount();
	}
});

test("a failed upload stays as a card with 重试, and a retry that lands is attached late", async () => {
	const view = await mount(h(PhoneUploads, { owner: "main" }));
	const late: ArrivedUpload[] = [];
	const stop = receiveLateUploads("main", (arrived) => late.push(arrived));
	try {
		let outcome: PhoneUploadOutcome | null = null;
		void uploadFromPhone(file("录屏.mov", 40 * MB), "video", false, "main").then((value) => (outcome = value));
		await act(async () => {});
		await act(async () => calls[0].reject(new Error("连接已断开，请重试")));

		assert.deepEqual(outcome, { kind: "failed", reason: "连接已断开，请重试" }, "读文件的那一轮照旧拿到失败");
		assert.equal(view.find(".ly-phone-upload").getAttribute("data-state"), "failed", "卡片留下，说清楚怎么了");
		assert.equal(view.find(".ly-phone-upload-error").textContent, "上传失败：连接已断开，请重试");
		assert.equal(view.find(".ly-phone-upload-cancel").getAttribute("aria-label"), "移除 录屏.mov");

		await click(view.find(".ly-phone-upload-retry"));
		assert.equal(calls.length, 2, "重试是再传一次，不用重新选文件");
		assert.equal(view.find(".ly-phone-upload").getAttribute("data-state"), "uploading");
		await act(async () => calls[1].resolve({ id: "u2", name: "录屏.mov", size: 40 * MB, mimeType: "video/quicktime", path: "/tmp/uploads/录屏.mov" }));
		assert.deepEqual(late, [{ name: "录屏.mov", kind: "video", upload: "u2", path: "/tmp/uploads/录屏.mov", mimeType: "video/quicktime" }], "传到了就挂回发起它的那个输入框");
		assert.equal(view.all(".ly-phone-upload").length, 0);
	} finally {
		stop();
		await view.unmount();
	}
});

test("移除 on a failed card lets it go", async () => {
	const view = await mount(h(PhoneUploads, { owner: "main" }));
	try {
		void uploadFromPhone(file("日志.zip", 30 * MB), "archive", false, "main");
		await act(async () => {});
		await act(async () => calls[0].reject(new Error("桌面端磁盘空间不足")));
		await click(view.find(".ly-phone-upload-cancel"));
		assert.equal(view.all(".ly-phone-upload").length, 0);
		assert.equal(pendingUploads().length, 0);
	} finally {
		await view.unmount();
	}
});

test("each composer shows only the uploads it started", async () => {
	const main = await mount(h(PhoneUploads, { owner: "main" }));
	const side = await mount(h(PhoneUploads, { owner: "side" }));
	try {
		void uploadFromPhone(file("设计稿.pdf", 20 * MB), "pdf", false, "side");
		await act(async () => {});
		assert.equal(main.all(".ly-phone-upload").length, 0);
		assert.equal(side.all(".ly-phone-upload").length, 1);
	} finally {
		await main.unmount();
		await side.unmount();
	}
});

test("off a phone, and for what stays inline, nothing is uploaded or shown", async () => {
	Object.defineProperty(window, "lyra", { configurable: true, value: { host: "desktop", platform: "darwin", files: {} } });
	assert.deepEqual(await uploadFromPhone(file("a.pdf", 20 * MB), "pdf", false, "main"), { kind: "inline" });
	Object.defineProperty(window, "lyra", { configurable: true, value: { host: "mobile", platform: "darwin", files: { upload: () => Promise.resolve(null) } } });
	assert.deepEqual(await uploadFromPhone(file("note.md", 2048), "text", true, "main"), { kind: "inline" }, "短文本照旧直接放进消息");
	assert.deepEqual(await uploadFromPhone(file("b.pdf", 20 * MB), "pdf", false, "main"), { kind: "unsupported" }, "旧版手机端答 null：退回原来的读法");
	assert.equal(pendingUploads().length, 0);
});
