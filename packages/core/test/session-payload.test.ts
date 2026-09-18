import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { INLINE_IMAGE_CHARS, materializeJsonlLine, parkMessage, slimJsonlLine } from "../src/session/payload.ts";
import { SessionStore } from "../src/session/store.ts";
import type { UserMessage } from "../src/types.ts";

test("slimJsonlLine drops oversized data without keeping the payload", () => {
	const blob = "A".repeat(20_000);
	const line = `{"type":"message","message":{"content":[{"type":"image","data":"${blob}","mimeType":"image/png"}]}}`;
	const slim = slimJsonlLine(line);
	assert.ok(slim.length < 200);
	assert.doesNotMatch(slim, /A{20}/);
	const parsed = JSON.parse(slim) as { message: { content: Array<{ data: string }> } };
	assert.equal(parsed.message.content[0]?.data, "");
});

test("a multi-megabyte image line slims without parsing the pixels", () => {
	const blob = "B".repeat(2_000_000);
	const line = `{"seq":1,"type":"message","message":{"role":"user","content":[{"type":"image","data":"${blob}","mimeType":"image/png"}],"timestamp":1}}`;
	const started = performance.now();
	const parsed = JSON.parse(slimJsonlLine(line)) as { message: { content: Array<{ data: string }> } };
	const elapsed = performance.now() - started;
	assert.equal(parsed.message.content[0]?.data, "");
	assert.ok(elapsed < 50, `slimmed a 2 MB line in ${elapsed.toFixed(1)}ms`);
});

test("append parks large images so the log line stays small; display load does not rehydrate", async () => {
	const root = await mkdtemp(join(tmpdir(), "ly-payload-"));
	const previous = process.env.LYRA_HOME;
	process.env.LYRA_HOME = join(root, "home");
	try {
	const store = new SessionStore(join(root, "sessions"));
	const meta = await store.create(root, "fake/model");
	const data = Buffer.alloc(6_100, 9).toString("base64");
	assert.ok(data.length > INLINE_IMAGE_CHARS);
	const message: UserMessage = {
		role: "user",
		content: [{ type: "image", mimeType: "image/png", data }],
		timestamp: 1,
	};
	await store.append(meta, { type: "message", message });
	assert.equal(message.content[0]?.type === "image" ? message.content[0].data : "", data, "live message keeps pixels");

	const raw = await readFile(join(root, "sessions", meta.projectId, `${meta.id}.jsonl`), "utf8");
	const lines = raw.trim().split("\n");
	const written = JSON.parse(lines[lines.length - 1] ?? "{}") as {
		message: { content: Array<{ data: string; media?: string }> };
	};
	assert.equal(written.message.content[0]?.data, "");
	assert.ok(written.message.content[0]?.media);

	const shown = await store.load(meta.projectId, meta.id, { display: true });
	const shownImage = shown?.messages[0];
	assert.ok(shownImage?.role === "user" && shownImage.content[0]?.type === "image");
	if (shownImage?.role === "user" && shownImage.content[0]?.type === "image") {
		assert.equal(shownImage.content[0].data, "");
		assert.ok(shownImage.content[0].media);
	}

	const full = await store.load(meta.projectId, meta.id);
	const fullImage = full?.messages[0];
	assert.ok(fullImage?.role === "user" && fullImage.content[0]?.type === "image");
	if (fullImage?.role === "user" && fullImage.content[0]?.type === "image") {
		assert.equal(fullImage.content[0].data, data);
	}
	} finally {
		if (previous === undefined) delete process.env.LYRA_HOME;
		else process.env.LYRA_HOME = previous;
	}
});

test("materializeJsonlLine writes the file and leaves a media pointer", () => {
	const home = join(tmpdir(), `ly-materialize-${Date.now()}`);
	const previous = process.env.LYRA_HOME;
	process.env.LYRA_HOME = home;
	try {
		const blob = Buffer.alloc(6_100, 7).toString("base64");
		// 带上 role：只有会画出来的图才停盘位，而真实的 message 记录本来就有这一项。
		const line = `{"type":"message","message":{"role":"user","content":[{"type":"image","data":"${blob}","mimeType":"image/png"}]}}`;
		const next = materializeJsonlLine(line);
		const parsed = JSON.parse(next) as { message: { content: Array<{ data: string; media?: string; mimeType: string }> } };
		assert.equal(parsed.message.content[0]?.data, "");
		assert.equal(parsed.message.content[0]?.mimeType, "image/png");
		assert.ok(parsed.message.content[0]?.media);
		assert.match(parsed.message.content[0]?.media ?? "", /^[a-f0-9]{40}\.png$/);
	} finally {
		if (previous === undefined) delete process.env.LYRA_HOME;
		else process.env.LYRA_HOME = previous;
	}
});

test("parkMessage does not touch a small icon", () => {
	const icon: UserMessage = {
		role: "user",
		content: [{ type: "image", mimeType: "image/png", data: "icon" }],
		timestamp: 1,
	};
	assert.equal(parkMessage(icon), icon);
});

test("只有用户消息的图停盘位，工具结果的图剥掉就算了", () => {
	/*
	 * 转录里唯一渲染图片块的是用户消息；`toolResult` 那一整条在 rows.tsx 里 return null，它带的
	 * 图一张也不会出现在屏幕上。本机扫下来会显示的 180 张，从不显示却照样解码写盘的有 440 张。
	 */
	const blob = "C".repeat(20_000);
	const of = (role: string) =>
		`{"seq":1,"type":"message","message":{"role":"${role}","content":[{"type":"image","data":"${blob}","mimeType":"image/png"}],"timestamp":1}}`;

	const user = JSON.parse(materializeJsonlLine(of("user"))) as { message: { content: Array<{ data: string; media?: string }> } };
	assert.equal(user.message.content[0]?.data, "");
	assert.match(user.message.content[0]?.media ?? "", /^[a-f0-9]{40}\.png$/, "会显示的图要留下取得回来的文件名");

	const tool = JSON.parse(materializeJsonlLine(of("toolResult"))) as { message: { content: Array<{ data: string; media?: string }> } };
	assert.equal(tool.message.content[0]?.data, "", "照样不能让这几十万字符过 IPC");
	assert.equal(tool.message.content[0]?.media, undefined, "没人看的图不该占一个文件");
});

test("认不出角色的行，按不显示处理", () => {
	// 宁可少写一个文件：数据仍在日志里，要显示时按需读那条路取得到。
	const blob = "D".repeat(20_000);
	const line = `{"seq":1,"type":"event","event":{"payload":{"data":"${blob}","mimeType":"image/png"}}}`;
	const parsed = JSON.parse(materializeJsonlLine(line)) as { event: { payload: { data: string; media?: string } } };
	assert.equal(parsed.event.payload.data, "");
	assert.equal(parsed.event.payload.media, undefined);
});
