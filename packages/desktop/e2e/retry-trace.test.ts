/**
 * 连接抖过之后，屏幕上留下什么。
 *
 * 这条测试真正要钉住的是那个「自己好了」的情形：前两次失败，第三次成功。从前这种事在界面上完全
 * 没有痕迹——`retrying` 是个瞬时状态，一有内容流进来就被抹掉——于是一次抖了三次才接上的对话，
 * 和一次一帆风顺的对话长得一模一样。而没好的那些反倒占了两行、四个可点的东西、一个红标。
 *
 * 所以这里同时看两种收场，并且盯着它们的**分量**：恢复了的那条不许出现「错」「失败」这样的字眼，
 * 也不许有红色；没救了的那条要说得清楚，但只能有一个动作。
 *
 * 真窗口、真 HTTP、真 React 树，因为这件事的一半在渲染那一侧——一条只在 store 里正确的记录，屏幕
 * 上可以什么都不显示。
 */

import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { closeListeningServer, startApp, type RunningApp } from "./app.ts";
import { cleanupFixture } from "./fixture-cleanup.ts";

let app: RunningApp;
let model: Server;

const MODEL_PORT = 9571;
let requests = 0;
/** 前几次要不要失败，由每条测试自己说了算。 */
let failuresLeft = 0;
/** 失败时发什么。默认是那个只写着一句话的流内 error——截图里的那个。 */
let failureMode: "stream-error" | "fatal" = "stream-error";

/**
 * 一次说得过去的回答，用 Anthropic 的线格式。
 *
 * 内容短，因为这条测试关心的不是模型说了什么，而是它到底说没说出来。
 */
const OK_STREAM = [
	`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 0 } } })}`,
	`event: content_block_start\ndata: ${JSON.stringify({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } })}`,
	`event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "接上了。" } })}`,
	`event: content_block_stop\ndata: ${JSON.stringify({ type: "content_block_stop", index: 0 })}`,
	`event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 4 } })}`,
	`event: message_stop\ndata: ${JSON.stringify({ type: "message_stop" })}`,
].join("\n\n");

/**
 * 中转塞在流里的那个 error 事件。
 *
 * 这是这次改动的起点：连接是通的，状态码是 200，错误写在流里面，而且经常连 message 都不给。从前
 * 它被当成「服务商本人拒绝了」，三层重试全部绕过，设置页上的无限重试形同虚设。
 */
const STREAM_ERROR = [
	`event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 10, output_tokens: 0 } } })}`,
	`event: error\ndata: ${JSON.stringify({ type: "error", error: { message: "upstream temporarily unavailable" } })}`,
].join("\n\n");

function startModel(): Server {
	const server = createServer((req, res) => {
		req.resume();
		req.on("end", () => {
			requests++;
			if (failuresLeft > 0) {
				failuresLeft--;
				if (failureMode === "fatal") {
					// 密钥不对：分类器判成 fatal，一次都不该重试。
					res.writeHead(401, { "content-type": "application/json" });
					res.end(JSON.stringify({ error: { message: "invalid api key" } }));
					return;
				}
				res.writeHead(200, { "content-type": "text/event-stream" });
				res.end(`${STREAM_ERROR}\n\n`);
				return;
			}
			res.writeHead(200, { "content-type": "text/event-stream" });
			res.end(`${OK_STREAM}\n\n`);
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
			/*
			 * 间隔取下限，次数够用就好。
			 *
			 * 1 秒是 `normalizeRule` 允许的最小值；三次重试各等一秒，这条测试就不必坐等半分钟。
			 */
			retryPolicy: {
				network: { retries: 4, strategy: "fixed", intervalMs: 1000, maxIntervalMs: 1000 },
				upstream: { retries: 4, strategy: "fixed", intervalMs: 1000, maxIntervalMs: 1000 },
			},
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
	app = await startApp({ port: 9459, seed });
	await app.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
	await new Promise((r) => setTimeout(r, 600));
});

after(async () => {
	await cleanupFixture(() => app?.stop(), () => closeListeningServer(model));
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

/** 那条记录现在是什么样——文字、收场、以及它到底红不红。 */
const trace = () =>
	app.evaluate<{ text: string; outcome: string; colour: string; lines: number } | null>(`(() => {
		const row = document.querySelector("[data-hiccup]");
		if (!row) return null;
		const label = row.querySelector("[data-ly-tip], span");
		const style = label ? getComputedStyle(label) : null;
		return {
			text: row.innerText.replace(/\\s+/g, " ").trim(),
			outcome: row.dataset.hiccup ?? "",
			colour: style?.color ?? "",
			lines: Math.round((label?.getBoundingClientRect().height ?? 0) / parseFloat(style?.lineHeight || "16")),
		};
	})()`);

async function until(check: () => Promise<boolean>, tries = 80): Promise<boolean> {
	for (let i = 0; i < tries; i++) {
		if (await check()) return true;
		await new Promise((r) => setTimeout(r, 250));
	}
	return false;
}

test("流内 error 事件会被重试，而且真的接上了", async () => {
	failureMode = "stream-error";
	failuresLeft = 2;
	requests = 0;

	await ask("说句话");

	assert.ok(
		await until(async () => (await transcript()).includes("接上了。")),
		`前两次失败之后第三次成功了（问了 ${requests} 次）`,
	);
	/*
	 * 这一条就是整件事的分水岭。
	 *
	 * 改之前这种失败一次都不会重试——`requests` 会停在 1，屏幕上是一句 `Unknown provider error`。
	 */
	assert.equal(requests, 3, "两次失败各重试了一次");
});

test("自己好了的，只留一行灰字，不出现任何像报错的字眼", async () => {
	const row = await trace();
	assert.ok(row, "抖过就该留下痕迹，哪怕最后接上了");
	assert.equal(row.outcome, "recovered");
	assert.match(row.text, /重连 2 次后恢复/);

	// 用户的原话：重试解决了就不该出现明显的错误提示。
	assert.ok(!row.text.includes("错"), `恢复了不该说「错」：${row.text}`);
	assert.ok(!row.text.includes("失败"), `恢复了不该说「失败」：${row.text}`);

	/*
	 * 也不该是红的。
	 *
	 * 从前那个红三角是这次改动的直接起因，所以这里不看类名而看真正算出来的颜色——类名可以改，
	 * 屏幕上是不是红的不能靠猜。
	 */
	const [r, g, b] = (row.colour.match(/\d+/g) ?? []).map(Number);
	assert.ok(!(r > 150 && r > g * 1.6 && r > b * 1.6), `恢复了的那行不该是红的，实际是 ${row.colour}`);
});

test("恢复之后，转录里没有任何失败的痕迹在喊", async () => {
	const text = await transcript();
	assert.ok(!text.includes("这一轮出错了"), "那句话连同它的红三角和展开箭头一起撤了");
	assert.ok(!text.includes("上次请求失败"), "也没有第二行讲同一件事");
	assert.ok(text.includes("接上了。"), "而回答本身在那儿");
});

test("再长的错误也只占一行，原文收在悬停和展开里", async () => {
	const row = await trace();
	assert.ok(row);
	// 一行就是一行——一句长错误不能把整条转录顶宽或顶高。
	assert.ok(row.lines <= 1, `记录占了 ${row.lines} 行`);

	const overflow = await app.evaluate<{ clipped: boolean; hasTip: boolean }>(`(() => {
		const label = document.querySelector("[data-hiccup] [data-ly-tip]");
		if (!label) return { clipped: false, hasTip: false };
		return {
			clipped: getComputedStyle(label).textOverflow === "ellipsis",
			hasTip: Boolean(label.getAttribute("data-ly-tip")),
		};
	})()`);
	assert.ok(overflow.clipped, "超出的部分用省略号收掉");
	assert.ok(overflow.hasTip, "而完整的说法在悬停里");
});

test("密钥不对时当场停下，一次都不重试，并且指路", async () => {
	failureMode = "fatal";
	failuresLeft = 99;
	requests = 0;

	await ask("再说一句");
	assert.ok(await until(async () => (await trace())?.outcome === "gave_up"), "停下来了");
	/*
	 * 反转默认值之后最要紧的一条：不能什么都重试。
	 *
	 * 密钥被拒绝重试一百次也还是同一个答复，而开着无限重试的窗口会就这么转下去。
	 */
	assert.equal(requests, 1, "一次都没有重试");

	const row = await trace();
	assert.match(row?.text ?? "", /密钥被拒绝/);
	assert.match(row?.text ?? "", /去设置/, "并且给出下一步，而不是只说坏了");
});
