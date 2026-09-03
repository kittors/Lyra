/**
 * What a conversation offers after the request itself failed.
 *
 * The case this exists for: a relay answers 503 because it has run out of credentials for a model,
 * after the turn has already read half a codebase. What used to happen was that the failed reply
 * put 重试 under the error text and nothing else appeared — and 重试 throws the turn away and pays
 * for it again. The work was on disk the whole time; nothing said so.
 *
 * A real window, a real HTTP failure, and the real React tree, because the bug lived in the seam:
 * `howItStopped` read a turn that ended in an error as a turn that had finished, so the row that
 * offers 继续 was never rendered at all.
 */

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";

let app: RunningApp;
let model: Server;

const MODEL_PORT = 9569;
/** How many times the model has been asked, so "did it ask again" is answerable. */
let requests = 0;

/**
 * The relay's own 503, reproduced exactly.
 *
 * The wait is in the body rather than in a `Retry-After` header, which is the shape that made
 * retrying useless — see `ai/retry`. Kept verbatim here so this stays a test about a real reply.
 */
const UNAVAILABLE = JSON.stringify({
	error: {
		code: "model_unavailable",
		message: "All credentials for model scripted are temporarily unavailable",
		model: "scripted",
		reset_seconds: 54,
		reset_time: "53s",
	},
});

function startModel(): Server {
	const server = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			requests++;
			// Every attempt fails: the turn has to actually end in an error for this to be about it.
			res.writeHead(503, { "content-type": "application/json" });
			res.end(UNAVAILABLE);
		});
	});
	server.listen(MODEL_PORT, "127.0.0.1");
	return server;
}

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "one.ts"), "export const one = 1\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [
				{
					id: "local",
					name: "Local",
					baseUrl: `http://127.0.0.1:${MODEL_PORT}`,
					api: "anthropic-messages",
					apiKey: "not-a-key",
					enabled: true,
					models: [
						{
							id: "local/scripted",
							providerId: "local",
							modelId: "scripted",
							name: "Scripted",
							contextWindow: 200000,
							maxOutputTokens: 8192,
							supportsThinking: false,
							supportsImages: false,
							supportsTools: true,
						},
					],
				},
			],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: "local/scripted",
			permissionMode: "full",
			thinking: "off",
			// One attempt: this is about what is offered after it fails, not about the retrying.
			retryAttempts: 1,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4523, token: null },
			appearance: { theme: "dark" },
		}),
	);
}

before(async () => {
	model = startModel();
	app = await startApp({ port: 9457, seed });
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
	await new Promise((r) => setTimeout(r, 600));
});

after(async () => {
	await app?.stop();
	await closeListeningServer(model);
});

async function ask(text: string): Promise<void> {
	await app.evaluate(`(() => {
		const field = document.querySelector("main textarea");
		if (!field) throw new Error("找不到输入框——选择器过时了，这条测试在测别的东西");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, ${JSON.stringify(text)});
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		return true;
	})()`);
}

const transcript = () => app.evaluate<string>(`(document.querySelector("main")?.innerText ?? "")`);

/** Wait for the transcript to contain something, rather than for a fixed time. */
async function until(text: string, tries = 60): Promise<boolean> {
	for (let i = 0; i < tries; i++) {
		if ((await transcript()).includes(text)) return true;
		await new Promise((r) => setTimeout(r, 250));
	}
	return false;
}

test("a failed request offers to carry on, not only to start over", async () => {
	await ask("读一下这个项目");
	/*
	 * 按界面上真的会出现的字找，不是按错误码。
	 *
	 * 这里原本等的是 `model_unavailable`——供应商返回的那个 code。它从来没有被显示给用户看：
	 * 界面说的是「这一轮出错了」和「上次请求失败，进度已保留」，而那才是这条测试关心的东西
	 * （失败被报告了，且报告的方式让人知道进度还在）。这条测试从写下那天起就是红的，红的原因
	 * 与被测的行为无关。
	 */
	assert.ok(
		await until("这一轮出错了"),
		`the failure is reported (asked ${requests} time(s))`,
	);

	const offer = await transcript();
	/*
	 * The one that was missing. 重试 was always there — it comes with the failed message — and on a
	 * turn that had done real work it is the wrong half of the offer to be given alone.
	 */
	assert.ok(offer.includes("继续"), `继续 is offered after a failure:\n${offer.slice(-400)}`);
	assert.ok(offer.includes("上次请求失败"), "and the row says what happened rather than calling it an interruption");
});

test("重试 asks before throwing the turn away", async () => {
	const before = await transcript();
	assert.ok(before.includes("这一轮出错了"), "the failed turn is still on screen");

	// The inline 重试, the one that sits under the error text.
	const pressed = await app.evaluate<boolean>(`(() => {
		const buttons = [...document.querySelectorAll("main button")].filter((b) => b.textContent?.trim() === "重试");
		if (buttons.length === 0) return false;
		buttons[0].click();
		return true;
	})()`);
	assert.ok(pressed, "重试 is on screen");

	await new Promise((r) => setTimeout(r, 400));
	const asking = await app.evaluate<string>(`document.body.innerText`);
	assert.ok(asking.includes("重新生成这次回答"), `it asks first:\n${asking.slice(-300)}`);
	assert.ok(asking.includes("token"), "and says what it costs");

	// Backing out leaves everything exactly as it was.
	const asked = requests;
	await app.evaluate(`(() => {
		const buttons = [...document.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "取消");
		buttons[buttons.length - 1]?.click();
		return true;
	})()`);
	await new Promise((r) => setTimeout(r, 400));
	assert.equal(requests, asked, "cancelling asked the model nothing");
	// 同上：按界面上真的写着的字找，而不是按供应商返回的错误码。
	assert.ok((await transcript()).includes("这一轮出错了"), "and the turn is still there to carry on from");
});
