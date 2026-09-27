/**
 * The composer on a phone: which files leave as uploads, and what the prompt says about them.
 *
 * The bridge's side of an upload is tested in `mobile/test/bridge-wire.test.ts`, the desktop's in
 * `sync-uploads.test.ts`, the two together in `sync-link.test.ts`. This is the renderer's part.
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { uploadFromPhone, wantsUpload } from "../src/features/composer/attachments/phone-upload.ts";
import { pickedFrom } from "../src/features/composer/attachments/picked.ts";
import { buildOutgoing } from "../src/features/composer/outgoing.ts";
import { attachmentOnDesktop, isAttachmentBody } from "../src/lib/attachment-placeholders.ts";

const scope = globalThis as { window?: unknown; lyra?: unknown };

function host(lyra: Record<string, unknown>) {
	scope.window = { lyra };
}

afterEach(() => {
	delete scope.window;
	delete scope.lyra;
});

const MB = 1024 * 1024;

test("what leaves a phone as an upload: large images, large text, and anything it cannot read itself", () => {
	assert.equal(wantsUpload(3 * MB, "image", false), false, "a photo the model can look at goes inline");
	assert.equal(wantsUpload(12 * MB, "image", false), true);
	assert.equal(wantsUpload(100 * 1024, "text", true), false, "a short text is cheaper inline");
	assert.equal(wantsUpload(20 * MB, "text", true), true);
	assert.equal(wantsUpload(200 * 1024, "pdf", false), true, "the phone cannot extract a PDF; the desktop's tools can");
	assert.equal(wantsUpload(300 * MB, "video", false), true);
});

test("on the desktop nothing is uploaded: the file is already on this disk", async () => {
	host({ host: "desktop", files: { upload: () => assert.fail("must not upload") } });
	assert.deepEqual(await uploadFromPhone(new File([new Uint8Array(20 * MB)], "big.log"), "text", true), { kind: "inline" });
});

test("on a phone, a large file comes back as the desktop's upload", async () => {
	const seen: string[] = [];
	host({
		host: "mobile",
		files: {
			upload: async (file: File, options: { name: string }) => {
				seen.push(options.name);
				return { id: "a".repeat(32), name: file.name, size: file.size, mimeType: "text/plain", path: "/lyra/uploads/a/big.log" };
			},
		},
	});
	const outcome = await uploadFromPhone(new File([new Uint8Array(20 * MB)], "big.log"), "text", true);
	assert.deepEqual(outcome, { kind: "uploaded", file: { upload: "a".repeat(32), path: "/lyra/uploads/a/big.log", mimeType: "text/plain" } });
	assert.deepEqual(seen, ["big.log"]);
});

test("an older phone app says it cannot upload by answering null, and a failure keeps its reason", async () => {
	host({ host: "mobile", files: { upload: async () => null } });
	assert.deepEqual(await uploadFromPhone(new File(["x"], "a.pdf"), "pdf", false), { kind: "unsupported" });
	host({ host: "mobile", files: { upload: async () => { throw new Error("桌面端磁盘空间不足"); } } });
	assert.deepEqual(await uploadFromPhone(new File(["x"], "a.pdf"), "pdf", false), { kind: "failed", reason: "桌面端磁盘空间不足" });
});

test("a path that is a promise is no path: an older phone app's floor answered pathForDrop that way", () => {
	host({ host: "mobile", files: { pathForDrop: () => Promise.resolve(null) } });
	const file = new File(["x"], "shot.png");
	assert.deepEqual(pickedFrom([file] as unknown as FileList), [{ file }]);
});

test("an uploaded file is spelled as where the desktop keeps it, and named by its upload", async () => {
	const uploaded = { name: "big.log", mimeType: "text/plain", kind: "text", isText: false, path: "/lyra/uploads/a/big.log", upload: "a".repeat(32) };
	const outgoing = await buildOutgoing({ text: "why does it fail", attachments: [uploaded] as never, sessionRefs: [] }, "/tmp");
	assert.ok(outgoing);
	const note = outgoing.content.find((block) => block.type === "text" && block.text.includes("big.log"));
	assert.ok(note && note.type === "text");
	assert.match(note.text, /uploaded from the phone to \/lyra\/uploads\/a\/big\.log/);
	assert.ok(isAttachmentBody(note.text), "an edit of this message carries the note across like any attachment body");
	assert.deepEqual(outgoing.attachments, [{ name: "big.log", kind: "text", mimeType: "text/plain", path: "/lyra/uploads/a/big.log", upload: "a".repeat(32) }]);
	assert.equal(attachmentOnDesktop("x", "/p").startsWith("\n\n[Attached file: x"), true);
});
