/**
 * Main-process text in the interface language, seen in the real window.
 *
 * Boots the built app on a throwaway profile with the interface set to English and goes down two
 * real paths: the file-operation IPC, and the pull request pane. The profile holds one GitHub
 * account whose token can no longer be opened — what a copied home directory looks like — so the
 * pane shows the main process's own words for that. Then switches the language to Japanese through
 * the settings IPC — no restart — and asks both again. What was said, and a screenshot of the pane
 * in each language, are written to ~/Desktop/主进程本地化测试/, or to the folder given.
 *
 *   node --experimental-strip-types e2e/main-locale-probe.ts [out-dir]
 */

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { startApp, type RunningApp } from "./app.ts";

const OUT = process.argv[2] ?? join(homedir(), "Desktop", "主进程本地化测试");
const OUTSIDE = "/definitely/not/an/open/project";

/**
 * Click a `selector` whose label or text is `name`, with the mouse: the first one that is on top
 * at its own centre, waited for, since a language change repaints every label a frame or two late.
 */
async function clickNamed(app: RunningApp, selector: string, name: string): Promise<void> {
	const deadline = Date.now() + 5_000;
	let at: { x: number; y: number } | null = null;
	while (!at && Date.now() < deadline) {
		at = await app.evaluate<{ x: number; y: number } | null>(`(() => {
			for (const el of document.querySelectorAll(${JSON.stringify(selector)})) {
				if ((el.getAttribute("aria-label") || el.textContent || "").trim() !== ${JSON.stringify(name)}) continue;
				const box = el.getBoundingClientRect();
				const x = box.left + box.width / 2, y = box.top + box.height / 2;
				const hit = document.elementFromPoint(x, y);
				if (box.width > 0 && hit && (hit === el || el.contains(hit))) return { x, y };
			}
			return null;
		})()`);
		if (!at) await new Promise((resolve) => setTimeout(resolve, 200));
	}
	if (!at) {
		const seen = await app.evaluate<string[]>(`[...document.querySelectorAll("button[aria-label]")].map((b) => b.getAttribute("aria-label")).slice(0, 60)`);
		assert.fail(`nothing called ${name} is under the pointer; labelled buttons: ${seen.join(" | ")}`);
	}
	for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
		await app.send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1 });
	}
}

/** The message the pull request pane shows, once it is `expected`. */
async function paneMessage(app: RunningApp, expected: string): Promise<string> {
	const deadline = Date.now() + 20_000;
	let last = "";
	while (Date.now() < deadline) {
		last = await app.evaluate<string>(`(() => {
			const box = [...document.querySelectorAll("p")].find((p) => p.className.includes("text-accent") && p.className.includes("rounded-[9px]"));
			return box ? box.textContent.trim() : "";
		})()`);
		if (last === expected) return last;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	await shot(app, "failed.png");
	const screen = await app.evaluate<string>(`document.body.innerText.slice(0, 1200)`);
	throw new Error(`the pane said ${JSON.stringify(last)}, not ${JSON.stringify(expected)}. On screen:\n${screen}`);
}

async function shot(app: RunningApp, name: string): Promise<void> {
	const { data } = await app.send<{ data: string }>("Page.captureScreenshot", { format: "png" });
	await writeFile(join(OUT, name), Buffer.from(data, "base64"));
}

await mkdir(OUT, { recursive: true });
const app = await startApp({
	port: 9372,
	seed: async (home) => {
		await writeFile(join(home, "settings.json"), JSON.stringify({ uiLocale: "en" }));
		// Sealed, but not by this profile's key: `unseal` gives up quietly and the keychain is never asked.
		const account = { id: "probe", kind: "github", label: "kittors", baseUrl: "https://github.com", login: "kittors", avatarUrl: null, addedAt: 1, enabled: true };
		const token = `v1:${randomBytes(48).toString("base64")}`;
		await writeFile(join(home, "forges.json"), JSON.stringify({ version: 1, entries: [{ account, token, encrypted: true }] }));
	},
});
const said: Record<string, unknown> = {};
try {
	said.fileEn = await app.evaluate(`window.lyra.files.create(${JSON.stringify(OUTSIDE)}, "a.txt", "file")`);
	assert.deepEqual(said.fileEn, { ok: false, error: "That path is not inside an open project", code: "denied" });
	await clickNamed(app, "button", "Pull requests");
	said.paneEn = await paneMessage(app, "The token for kittors can no longer be read — enter it again in Settings");
	await shot(app, "1-pull-requests-en.png");

	await app.evaluate(`(async () => {
		const settings = await window.lyra.settings.get();
		await window.lyra.settings.save({ ...settings, uiLocale: "ja" });
	})()`);
	said.fileJa = await app.evaluate(`window.lyra.files.create(${JSON.stringify(OUTSIDE)}, "a.txt", "file")`);
	assert.deepEqual(said.fileJa, { ok: false, error: "このパスは開いているプロジェクトの中にありません", code: "denied" });
	said.listJa = await app.evaluate(`window.lyra.git.myPullRequests()`);
	await clickNamed(app, "button", "更新");
	said.paneJa = await paneMessage(app, "kittors のトークンを読み取れなくなりました。設定で入力し直してください");
	await shot(app, "2-pull-requests-ja.png");

	await writeFile(join(OUT, "probe-result.json"), `${JSON.stringify(said, null, "\t")}\n`);
	process.stdout.write(`${JSON.stringify(said, null, 2)}\n`);
} finally {
	await app.stop();
}
