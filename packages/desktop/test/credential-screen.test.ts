/**
 * A message on its way into a conversation: values become marks in every text it carries, images
 * pass untouched, and a mark hands a saved credential over only when it was typed at this computer.
 */

import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { CredentialBroker, memoryStore } from "@lyra/core";
import { handOver, screenMessage, screenSteer } from "../electron/credential-screen.ts";

const broker = () =>
	new CredentialBroker({
		vault: memoryStore([{ name: "nas", kind: "password", title: "NAS", createdAt: 1, approval: "per-conversation", values: { password: "nas-pass-123" } }]),
		runtimeDir: tmpdir,
	});

test("每一段字都换掉，图片原样，显示的那一份也换", async () => {
	const credentials = broker();
	const image = { type: "image" as const, data: "AAAA", mimeType: "image/png" };
	const screened = await screenMessage("s1", [{ type: "text", text: "密码 nas-pass-123" }, image, { type: "text", text: "再说一遍 nas-pass-123" }], "密码 nas-pass-123", credentials);
	assert.deepEqual(screened.content, [{ type: "text", text: "密码 [credential:nas]" }, image, { type: "text", text: "再说一遍 [credential:nas]" }]);
	assert.equal(screened.displayText, "密码 [credential:nas]");
	assert.deepEqual(screened.named, ["nas"]);
	assert.equal(credentials.forSession("s1").reveal("nas"), undefined, "screening hands nothing over by itself");
});

test("电脑上打的引用交出去，手机上打的不交", async () => {
	const credentials = broker();
	await handOver("phone", ["nas"], "remote", credentials);
	assert.equal(credentials.forSession("phone").reveal("nas"), undefined);
	await handOver("desk", ["nas"], "local", credentials);
	assert.equal(credentials.forSession("desk").reveal("nas"), "nas-pass-123");
});

test("给子智能体插话：一句字还是一句字，换掉的值同样不进去", async () => {
	const credentials = broker();
	assert.deepEqual(await screenSteer("s1", "用 nas-pass-123 登录", undefined, "remote", credentials), { said: "用 [credential:nas] 登录" });
	const blocks = await screenSteer("s2", [{ type: "text", text: "[credential:nas]" }], { displayText: "nas-pass-123" }, "local", credentials);
	assert.deepEqual(blocks, { said: [{ type: "text", text: "[credential:nas]" }], displayText: "[credential:nas]" });
	assert.equal(credentials.forSession("s2").reveal("nas"), "nas-pass-123");
});
