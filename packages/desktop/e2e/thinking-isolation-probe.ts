/* oxlint-disable no-console -- probe CLI that prints what it found in the window */
/**
 * Effort is per conversation — checked in a real window, through the real controls.
 *
 * The unit tests prove the storage: `SessionMeta.thinking` is written, read back and outranks the
 * global default. They cannot prove the thing that was actually reported, which is about two
 * conversations open in one app — that moving the slider in one leaves the other where it was, and
 * that coming back to the first still shows what it was set to. That needs two real sessions in one
 * real window, driven through the controls a user touches, which is this.
 *
 * Run:  node --experimental-strip-types e2e/thinking-isolation-probe.ts
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";

const MODEL_PORT = 9599;

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
							// The whole point: a model that has effort levels to choose between.
							supportsThinking: true,
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
			// The app default every new conversation starts at.
			thinking: "medium",
			retryAttempts: 1,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4521, token: null },
			appearance: { theme: "dark" },
		}),
	);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (!ok) failures++;
	console.log(
		`${ok ? "✔" : "✖"} ${label}${ok ? "" : `\n     期望 ${JSON.stringify(expected)}，实际 ${JSON.stringify(actual)}`}`,
	);
}

/** The level the composer shows, read off the button the user actually looks at. */
async function shownLabel(app: RunningApp): Promise<string | null> {
	return app.evaluate<string | null>(`(() => {
		const button = [...document.querySelectorAll("button[data-ly-tip]")]
			.find((b) => (b.getAttribute("data-ly-tip") || "").startsWith("推理强度"));
		return button ? (button.getAttribute("data-ly-tip") || "").replace("推理强度：", "") : null;
	})()`);
}

/** Move the effort slider, through the menu, as a drag would. */
async function setLevel(app: RunningApp, index: number): Promise<void> {
	await app.evaluate(`(() => {
		const button = [...document.querySelectorAll("button[data-ly-tip]")]
			.find((b) => (b.getAttribute("data-ly-tip") || "").startsWith("推理强度"));
		if (!button) throw new Error("推理强度按钮没找到");
		button.click();
		return true;
	})()`);
	await wait(500);
	await app.evaluate(`(() => {
		const slider = document.querySelector('input[type="range"][aria-label="推理强度"]');
		if (!slider) throw new Error("推理强度滑块没找到");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
		setter.call(slider, ${JSON.stringify(String(index))});
		slider.dispatchEvent(new Event("input", { bubbles: true }));
		slider.dispatchEvent(new Event("change", { bubbles: true }));
		return true;
	})()`);
	await wait(700);
	// Close the popover so the next click is not aimed through it.
	await app.evaluate(
		`(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); return true; })()`,
	);
	await wait(400);
}

/** What the main process has stored, which is the thing that has to survive a reload. */
async function storedLevels(app: RunningApp): Promise<{ id: string; title: string; thinking: string | null }[]> {
	return app.evaluate(`(async () => {
		const list = await window.lyra.sessions.list();
		return list.map((s) => ({ id: s.id, title: s.title, thinking: s.thinking ?? null }));
	})()`);
}

async function globalDefault(app: RunningApp): Promise<string> {
	return app.evaluate(`window.lyra.settings.get().then((s) => s.thinking)`);
}

/** Send something, so the conversation exists on disk and shows up in the sidebar. */
async function ask(app: RunningApp, text: string): Promise<void> {
	await app.evaluate(`(() => {
		const field = document.querySelector("main textarea");
		if (!field) throw new Error("输入框没找到");
		const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
		setter.call(field, ${JSON.stringify(text)});
		field.dispatchEvent(new Event("input", { bubbles: true }));
		field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
		return true;
	})()`);
	await wait(1500);
}

async function clickNewConversation(app: RunningApp): Promise<void> {
	await app.evaluate(`(() => {
		const hit = [...document.querySelectorAll("button, [role=button]")]
			.find((b) => (b.textContent || "").trim() === "新对话" || b.getAttribute("aria-label") === "新对话");
		if (!hit) throw new Error("「新对话」按钮没找到");
		hit.click();
		return true;
	})()`);
	await wait(1500);
}

/** Click the sidebar row for a session id — `data-ly-row` is what `SessionRow` tags itself with. */
async function openSession(app: RunningApp, id: string): Promise<boolean> {
	return app.evaluate<boolean>(`(() => {
		const row = document.querySelector('[data-ly-row="${id}"]');
		if (!row) return false;
		const hit = row.querySelector("button") || row;
		hit.click();
		return true;
	})()`);
}

async function main(): Promise<void> {
	const app = await startApp({ port: 9466, seed });
	try {
		await app.send("Emulation.setDeviceMetricsOverride", {
			width: 1280,
			height: 900,
			deviceScaleFactor: 1,
			mobile: false,
		});
		await wait(1500);

		console.log("—— 会话 A ——");
		await ask(app, "第一个会话");
		const before = await storedLevels(app);
		console.log(`  会话数=${before.length}，标签=${await shownLabel(app)}`);
		console.log(`  存储：${JSON.stringify(before)}`);

		// Top of the scale, whatever the model offers.
		await setLevel(app, 3);
		const aLabel = await shownLabel(app);
		const afterA = await storedLevels(app);
		console.log(`  调整后标签=${aLabel}`);
		console.log(`  存储：${JSON.stringify(afterA)}`);
		const sessionA = afterA[0];

		console.log("\n—— 新建会话 B ——");
		await clickNewConversation(app);
		await ask(app, "第二个会话");
		const bLabel = await shownLabel(app);
		const afterB = await storedLevels(app);
		console.log(`  B 的标签=${bLabel}`);
		console.log(`  存储：${JSON.stringify(afterB)}`);

		console.log("\n—— 回到会话 A ——");
		const reopened = await openSession(app, sessionA.id);
		await wait(1200);
		const aAgain = reopened ? await shownLabel(app) : "(侧边栏没找到会话行)";
		console.log(`  A 的标签=${aAgain}`);

		const stillDefault = await globalDefault(app);

		console.log("\n—— 断言 ——");
		check("A 调高后标签跟着变", aLabel, "高");
		check("B 是新会话，跟随全局默认「中」", bLabel, "中");
		check("A 的档位写进了它自己的会话", afterA.find((s) => s.id === sessionA?.id)?.thinking, "high");
		check("B 的会话没有被写上档位", afterB.find((s) => s.id !== sessionA?.id)?.thinking ?? null, null);
		check("调会话档位不改全局默认", stillDefault, "medium");
		check("切回 A 的侧边栏行点得到", reopened, true);
		check("切回 A 仍是「高」", aAgain, "高");
	} finally {
		await app.stop();
	}
	console.log(failures === 0 ? "\n全部通过" : `\n${failures} 条失败`);
	process.exit(failures === 0 ? 0 : 1);
}

void main();
