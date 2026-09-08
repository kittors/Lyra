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
import { cleanupFixture } from "./fixture-cleanup.ts";

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
			/*
			 * 一次就够：这条测试问的是失败之后给什么，不是重试本身。
			 *
			 * 从前写的是 `retryAttempts: 1`，那个老字段只管得住 `upstream` 一条规则（见
			 * `normalizeRetryPolicy`），而且这个 503 的正文里写着 `reset_seconds: 54`——服务器说的
			 * 等待时间现在真的生效了，于是第一次重试就等五十四秒，测试等不到结果。两条规则都写死
			 * 成不重试，问的才是它想问的那件事。
			 */
			retryPolicy: {
				network: { retries: 0, strategy: "fixed", intervalMs: 1000, maxIntervalMs: 1000 },
				upstream: { retries: 0, strategy: "fixed", intervalMs: 1000, maxIntervalMs: 1000 },
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
	app = await startApp({ port: 9457, seed });
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
	 * 这里原本等的是 `model_unavailable`——供应商返回的那个 code，从来没有显示给用户看过。后来
	 * 改成等「这一轮出错了」，而那句话现在也没有了：失败和「正在重连」合成了同一条记录，由
	 * `HiccupTrace` 一个人说完。503 落进分类器的 `upstream`，说出来是「服务暂时不可用」。
	 */
	assert.ok(
		await until("服务暂时不可用"),
		`the failure is reported (asked ${requests} time(s))`,
	);

	const offer = await transcript();
	/*
	 * The one that was missing. 重试 was always there — it comes with the failed message — and on a
	 * turn that had done real work it is the wrong half of the offer to be given alone.
	 */
	assert.ok(offer.includes("继续"), `继续 is offered after a failure:\n${offer.slice(-400)}`);
	// 同一件事只说一遍：`ResumeRow` 的那行让位给了上面那条记录，否则屏幕上又是两行讲同一件事。
	assert.ok(!offer.includes("上次请求失败"), `失败只由一条记录来说：\n${offer.slice(-400)}`);
	assert.ok(!offer.includes("这一轮出错了"), "红字加展开箭头那一套已经撤了");

	/*
	 * 输入框右下角那个按钮，说的必须是同一件事。
	 *
	 * 它以前自己判断该不该显示「继续」，判断反了：条件里的 `!stopped` 把真正把活留在半路的几种
	 * 情况——你按的暂停、被关掉的窗口、失败的请求——全挡在外面，于是这一行写着「上次请求失败 ·
	 * 继续」，而右下角还是一支发送箭头。两处说法不一致，按哪个都像是猜。
	 */
	const button = await app.evaluate<{ mode: string; label: string; d: string; fill: string } | null>(`(() => {
		const all = [...document.querySelectorAll("[data-composer-send]")];
		const b = all[all.length - 1];
		const p = b?.querySelector("svg path");
		return b && p ? { mode: b.dataset.composerSend, label: b.getAttribute("aria-label"), d: p.getAttribute("d"), fill: p.getAttribute("fill") ?? "" } : null;
	})()`);
	assert.ok(button, "the composer's send button is on screen");
	assert.equal(button.mode, "continue", `按钮认出这一轮还有活没干完：${JSON.stringify(button)}`);
	assert.equal(button.label, "接着做完没做完的部分", "按钮和上面那行说的是同一件事");
	// 实心，和它轮流出现的停止键一样——描边的三角和实心的方块在同一个圆里换来换去是两种画法。
	assert.equal(button.fill, "currentColor", `继续是实心的：${JSON.stringify(button)}`);
	assert.ok(!button.d.includes("M12 19V5"), `而不是那支向上的发送箭头：${JSON.stringify(button)}`);
});

/**
 * 一句失败旁边不该站着一个「丢掉重来」。
 *
 * 从前这里测的是那个内联的「重试」会先问一句再动手——问得对，可它根本不该在那儿：它和「继续」
 * 并排、长得像同一类东西，而两者是相反的，按错就是把一轮已经花掉几十万 token 的工作再买一次。
 * 现在那条记录上只有一个动作，就是安全的那个；重新生成仍然在，在消息自己的操作里。
 */
test("一句失败旁边只有一个动作，而且是安全的那个", async () => {
	const before = await transcript();
	assert.ok(before.includes("服务暂时不可用"), "the failed turn is still on screen");

	const actions = await app.evaluate<string[]>(`(() => {
		const trace = document.querySelector("[data-hiccup-trace]");
		if (!trace) return [];
		return [...trace.querySelectorAll("button")].map((b) => b.textContent?.trim() ?? "");
	})()`);
	assert.ok(actions.includes("继续"), `记录上给的是「继续」：${JSON.stringify(actions)}`);
	assert.ok(!actions.includes("重试"), `而不是并排的「重试」：${JSON.stringify(actions)}`);

	// 问过之后什么都没发生：这一轮还在，可以接着做。
	const asked = requests;
	await new Promise((r) => setTimeout(r, 300));
	assert.equal(requests, asked, "光是看着不会让它再问一次模型");
	assert.ok((await transcript()).includes("服务暂时不可用"), "and the turn is still there to carry on from");
});
