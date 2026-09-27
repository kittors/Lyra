/**
 * A solo view puts the workspace away on its first frame, and gives it back on its first frame.
 *
 * 已安排, 插件 and 拉取请求 put the workspace away with `visibility: hidden` rather than tearing it
 * down (see `Workspace` in `src/app/App.tsx`). That reaches only what inherits it: an element that
 * transitions `visibility` stays visible for the length of its transition, and `transition-all`
 * transitions it. The suggestion cards, the send button and the title bar's panel buttons all had
 * it, and went on painting over the view that had replaced them for 150–220ms — then, on the way
 * back, turned up a frame after the rest of the conversation.
 *
 * Asserted over the whole workspace rather than those three, because the next `transition-all`
 * will be somewhere else. Read per painted frame from the computed style: a screenshot taken a
 * moment later is always clean.
 */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";
import { landsOn } from "./lands-on.ts";

let app: RunningApp;

async function seed(home: string): Promise<void> {
	const project = join(home, "project");
	await mkdir(project, { recursive: true });
	await writeFile(join(project, "readme.md"), "# put away\n");
	await writeFile(join(home, "window.json"), JSON.stringify({ width: 1280, height: 900, x: 0, y: 0 }));
	await writeFile(
		join(home, "settings.json"),
		JSON.stringify({
			version: 1,
			providers: [],
			mcpServers: [],
			projects: [{ id: "e2e", name: "project", path: project, pinned: true, lastOpenedAt: 1 }],
			defaultModelId: null,
			permissionMode: "auto",
			thinking: "off",
			retryAttempts: 1,
			hooks: [],
			scheduledTasks: [],
			disabledPlugins: [],
			alwaysAllow: [],
			sync: { enabled: false, port: 4533, token: null },
		}),
	);
}

before(async () => {
	app = await startApp({ port: 9741, seed });
});

after(async () => {
	await app?.stop();
});

const WORKSPACE = `document.querySelector('[data-view="chat"]')`;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(expression: string, what: string): Promise<void> {
	const deadline = Date.now() + 20_000;
	while (Date.now() < deadline) {
		if (await app.evaluate<boolean>(`Boolean(${expression})`)) return;
		await pause(100);
	}
	throw new Error(`timed out waiting for ${what}`);
}

/** A real press on a sidebar entry: the sidebar answers pointer events, not synthetic clicks. */
async function clickSidebar(label: string): Promise<void> {
	const at = await app.evaluate<{ x: number; y: number }>(`(() => {
		const el = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').trim().startsWith(${JSON.stringify(label)}) && b.checkVisibility({ visibilityProperty: true }));
		if (!el) throw new Error(${JSON.stringify(`no sidebar entry ${label}`)});
		const r = el.getBoundingClientRect();
		const x = r.x + r.width / 2, y = r.y + r.height / 2;
		${landsOn(label)}
		return { x, y };
	})()`);
	await app.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
	await app.send("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", clickCount: 1 });
	await app.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", clickCount: 1 });
}

/**
 * Arm a check that runs on the first painted frame, after the next click, in which the workspace
 * computes `settled` (hidden going away, visible coming back).
 *
 * Going away, it lists what under the workspace still computes visible on that frame. Coming back,
 * it holds on to what computes hidden on that frame and lists which of those turn visible within
 * half a second — the ones that arrived late.
 */
async function armFirstFrame(settled: "hidden" | "visible"): Promise<void> {
	await app.evaluate(`(() => {
		const box = ${WORKSPACE};
		const settled = ${JSON.stringify(settled)};
		const state = window.__putAway = { done: false, frames: 0, found: [] };
		const name = (el) => el.tagName.toLowerCase() + [...el.attributes].filter((a) => a.name === 'class' || a.name.startsWith('data-')).map((a) => a.name === 'class' ? '.' + a.value.trim().split(' ').filter(Boolean).slice(0, 4).join('.') : '[' + a.name + ']').join('');
		const visible = (el) => getComputedStyle(el).visibility === 'visible';
		window.addEventListener('click', () => {
			const check = () => {
				state.frames++;
				if (getComputedStyle(box).visibility !== settled) {
					if (state.frames < 120) requestAnimationFrame(check);
					else state.done = true;
					return;
				}
				const all = [...box.querySelectorAll('*')];
				if (settled === 'hidden') {
					state.found = all.filter(visible).map(name);
					state.done = true;
					return;
				}
				const hidden = all.filter((el) => !visible(el));
				setTimeout(() => {
					state.found = hidden.filter((el) => el.isConnected && visible(el)).map(name);
					state.done = true;
				}, 500);
			};
			requestAnimationFrame(check);
		}, { capture: true, once: true });
	})()`);
}

async function firstFrame(): Promise<{ frames: number; found: string[] }> {
	await waitFor(`window.__putAway && window.__putAway.done`, "the first-frame check");
	return app.evaluate(`window.__putAway`);
}

/** Every distinct element once, with a count, so a failure reads as a list of culprits. */
function summary(found: string[]): string {
	const counts = new Map<string, number>();
	for (const name of found) counts.set(name, (counts.get(name) ?? 0) + 1);
	return [...counts].slice(0, 20).map(([name, n]) => `\n  ${n}× ${name}`).join("");
}

test("the first frame of 已安排 has nothing of the workspace on it", async () => {
	// The composer and the title bar's panel buttons are what painted through before; wait for them.
	await waitFor(`${WORKSPACE}?.querySelector('button[data-composer-send]') && ${WORKSPACE}?.querySelector('[data-ly-toolbar-button]')`, "the conversation");
	await pause(800);

	await armFirstFrame("hidden");
	await clickSidebar("已安排");
	const { frames, found } = await firstFrame();

	assert.ok(frames < 120, "the workspace was never put away — the click did not reach 已安排");
	assert.equal(found.length, 0, `still painting on the first frame the workspace was hidden:${summary(found)}`);
});

test("coming back, nothing in the workspace arrives a frame late", async () => {
	await pause(500);
	await armFirstFrame("visible");
	await clickSidebar("新对话");
	const { frames, found } = await firstFrame();

	assert.ok(frames < 120, "the workspace never came back — the click did not reach 新对话");
	assert.equal(found.length, 0, `hidden on the workspace's first frame back, visible after:${summary(found)}`);
});
