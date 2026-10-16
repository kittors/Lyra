/**
 * A phone and the desktop it is paired with, booted the same way for every phone probe.
 *
 * A desktop on a profile of its own with sync on, a project with two conversations whose titles and
 * times read like real ones, a model that answers in Markdown — or with a command to approve when
 * the message says APPROVE — and the real mobile bridge against it (`mobile-app.ts`).
 */

import { createServer } from "node:http";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";
import { seedInteractions } from "./interaction-fixture.ts";
import { startMobile } from "./mobile-app.ts";

export const DEVICES = {
	android: { width: 393, height: 873, insets: { top: 44, right: 0, bottom: 20, left: 0 } },
	iphone: { width: 402, height: 874, insets: { top: 62, right: 0, bottom: 34, left: 0 } },
	small: { width: 360, height: 780, insets: { top: 32, right: 0, bottom: 16, left: 0 } },
} as const;
export type Device = keyof typeof DEVICES;

/** Markdown with the shapes a transcript is made of, so the reply can be judged as a reply. */
export const REPLY = [
	"看过了，问题在两处：",
	"",
	"1. 顶栏的按钮写死了 `top: 5px`，没有让出状态栏",
	"2. 主区域在手机上仍然画着桌面窗口的圆角描边",
	"",
	"```ts",
	"const top = `calc(${safeTop} + 5px)`;",
	"header.style.top = top;",
	"```",
	"",
	"| 位置 | 改前 | 改后 |",
	"| --- | --- | --- |",
	"| 顶栏 | 5px | 安全区 + 5px |",
	"| 描边 | 1px | 无 |",
	"",
	"改完在真机上再量一遍。",
].join("\n");

export async function bootPhone({ desktopPort, phonePort, syncPort, token, theme }: { desktopPort: number; phonePort: number; syncPort: number; token: string; theme: "dark" | "light" }): Promise<{
	desktop: RunningApp;
	phone: Awaited<ReturnType<typeof startMobile>>;
	stop: () => Promise<void>;
}> {
	const SYNC_PORT = syncPort;
	const TOKEN = token;
	const model = createServer((request, response) => {
		let raw = "";
		request.on("data", (chunk) => { raw += chunk; });
		request.on("end", () => {
			// A message saying APPROVE gets a command that has to be approved; the result gets the reply.
			const recent = JSON.stringify((JSON.parse(raw || "{}") as { messages?: unknown[] }).messages?.slice(-3) ?? []);
			const tool = recent.includes("APPROVE") && !recent.includes('"tool_result"');
			response.writeHead(200, { "content-type": "text/event-stream" });
			const emit = (event: { type: string; [key: string]: unknown }) => response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
			emit({ type: "message_start", message: { id: "bench", role: "assistant", content: [], usage: { input_tokens: 10, output_tokens: 0 } } });
			if (tool) {
				emit({ type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "push-1", name: "bash", input: {} } });
				emit({ type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: JSON.stringify({ command: "git push --force-with-lease origin fix/mobile-shell", description: "强制推送改写过的提交" }) } });
			} else {
				emit({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
				emit({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: REPLY } });
			}
			emit({ type: "content_block_stop", index: 0 });
			emit({ type: "message_delta", delta: { stop_reason: tool ? "tool_use" : "end_turn" }, usage: { output_tokens: 10 } });
			emit({ type: "message_stop" });
			response.end();
		});
	});
	await new Promise<void>((resolve) => model.listen(0, "127.0.0.1", resolve));
	const address = model.address();
	if (!address || typeof address === "string") throw new Error("model server");
	const now = Date.now();
	const desktop = await startApp({
		port: desktopPort,
		seed: async (home) => {
			await seedInteractions(home, address.port);
			const file = join(home, "settings.json");
			const settings = JSON.parse(await readFile(file, "utf8"));
			Object.assign(settings.projects[0], { name: "Kinova" });
			Object.assign(settings.providers[0], { name: "DeepSeek" });
			Object.assign(settings.providers[0].models[0], { name: "DeepSeek V4", modelId: "deepseek-v4", supportsThinking: true });
			Object.assign(settings, { uiLocale: "zh-CN", thinking: "medium", permissionMode: "ask", appearance: { theme, reduceMotion: "off" }, sync: { enabled: true, port: SYNC_PORT, token: TOKEN } });
			await writeFile(file, JSON.stringify(settings));
			// Real-looking titles and times: the fixture's ids and its 1970 timestamps read as "58 years ago".
			const titles: Record<string, string> = { "qa-long": "重构会话列表的滚动恢复", "qa-short": "手机端安全区适配" };
			const sessions = join(home, "sessions");
			for (const dir of await readdir(sessions, { withFileTypes: true })) {
				if (!dir.isDirectory()) continue;
				for (const name of await readdir(join(sessions, dir.name))) {
					const path = join(sessions, dir.name, name);
					let text = await readFile(path, "utf8");
					for (const [id, title] of Object.entries(titles)) text = text.replaceAll(`"title":"${id}"`, `"title":"${title}"`);
					text = text.replaceAll('"projectName":"交互验证"', '"projectName":"Kinova"').replaceAll('"createdAt":1,"updatedAt":2', `"createdAt":${now - 7_200_000},"updatedAt":${now - 1_800_000}`);
					await writeFile(path, text);
				}
			}
			let index = await readFile(join(sessions, "index.json"), "utf8");
			for (const [id, title] of Object.entries(titles)) index = index.replaceAll(`"title":"${id}"`, `"title":"${title}"`);
			index = index.replaceAll('"projectName":"交互验证"', '"projectName":"Kinova"').replaceAll('"createdAt":1,"updatedAt":2', `"createdAt":${now - 7_200_000},"updatedAt":${now - 1_800_000}`);
			await writeFile(join(sessions, "index.json"), index);
		},
	});
	const phone = await startMobile(desktop.home, { host: "127.0.0.1", port: SYNC_PORT, token: TOKEN, platform: "darwin" }, phonePort);
	return {
		desktop,
		phone,
		stop: async () => {
			await phone.stop().catch(() => {});
			await desktop.stop().catch(() => {});
			model.close();
		},
	};
}
