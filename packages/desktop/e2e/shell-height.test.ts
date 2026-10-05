/**
 * The shell fills the window — and keeps its box while settings is in front of it.
 *
 * Both of these were broken by one change in v0.8.14, which mounted the workspace inside a wrapper
 * so it could stay alive behind the settings screen. The wrapper asked for `flex-1` from `#root`,
 * which is not a flex container, so it fell to `height: auto`: `ChatShell`'s `h-full` had no
 * percentage to resolve against, the transcript grew to whatever it contained, and the composer
 * went off the bottom of the window. On an empty conversation it merely floated halfway up the
 * screen; on a real one there was no input box at all.
 *
 * So the assertion is on the shell's *height*, not on whether the composer rendered. It rendered
 * the whole time. A test that only looked for it, or only checked that it was inside the viewport,
 * would have gone green on the broken build — the empty-transcript case above is exactly that.
 *
 * The second assertion is the reason the wrapper exists. Leaving settings used to remount the
 * conversation, and a freshly built list has no height for a cached scroll offset to apply to, so
 * it landed at the top every time. Staying mounted fixes that only if the box survives: hidden by
 * `visibility`, whose box keeps its height and its `scrollTop`, and never by `display`, which
 * throws both away — along with the `scrollHeight` the composer measures itself against.
 */

import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { startApp, type RunningApp } from "./app.ts";

let app: RunningApp;

before(async () => {
	app = await startApp({ port: 9482 });
});

after(async () => {
	await app?.stop();
});

const settle = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Geometry {
	composer: boolean;
	/** The workspace shell's height, which is the property that actually failed. */
	shell: number | null;
	/** How far down the window the composer's bottom edge sits. */
	composerBottom: number | null;
	viewport: number;
}

async function geometry(): Promise<Geometry> {
	return app.evaluate(`(() => {
		const shell = [...document.querySelectorAll(".ly-shell")].find((el) => el.querySelector("textarea"));
		const field = shell?.querySelector("textarea");
		const box = field?.getBoundingClientRect();
		return {
			composer: !!field,
			shell: shell ? Math.round(shell.getBoundingClientRect().height) : null,
			composerBottom: box ? Math.round(box.bottom) : null,
			viewport: window.innerHeight,
		};
	})()`);
}

/** The sidebar's bottom row is the way in to settings; the first item on its own nav is the way out. */
async function toSettings(): Promise<void> {
	await app.evaluate(`(() => {
		document.querySelector("[data-ly-open-settings]")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		return true;
	})()`);
	await settle(1000);
}

async function toWorkspace(): Promise<void> {
	await app.evaluate(`(() => {
		[...document.querySelectorAll("button")]
			.find((b) => b.textContent?.trim() === "返回工作区")
			?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		return true;
	})()`);
	await settle(1000);
}

test("the shell is as tall as the window, and the composer is in it", async () => {
	const g = await geometry();
	assert.equal(g.composer, true, "the composer is mounted");
	assert.equal(g.shell, g.viewport, "the shell fills the window rather than falling to its content height");
	assert.ok(
		g.composerBottom !== null && g.composerBottom <= g.viewport && g.composerBottom > g.viewport / 2,
		`the composer sits at the bottom of the window, not floating in it (bottom ${g.composerBottom} of ${g.viewport})`,
	);
});

test("settings hides the workspace without taking its box away", async () => {
	await toSettings();

	const hidden = await app.evaluate<{ shells: number; visibility: string | null; height: number | null }>(`(() => {
		const shells = [...document.querySelectorAll(".ly-shell")];
		const chat = shells.find((el) => el.querySelector("textarea"));
		return {
			shells: shells.length,
			visibility: chat ? getComputedStyle(chat.parentElement ?? chat).visibility : null,
			height: chat ? Math.round(chat.getBoundingClientRect().height) : null,
		};
	})()`);

	assert.equal(hidden.shells, 2, "both shells are mounted — the workspace is not unmounted behind settings");
	assert.equal(hidden.visibility, "hidden", "put away by visibility, which keeps the box and its scroll offset");
	assert.ok((hidden.height ?? 0) > 0, "the hidden workspace still has a height to restore a scroll position into");
});

test("and coming back leaves the shell exactly as it was", async () => {
	await toWorkspace();

	const g = await geometry();
	assert.equal(g.composer, true, "the composer survived the round trip");
	assert.equal(g.shell, g.viewport, "the shell still fills the window");
	assert.ok(
		g.composerBottom !== null && g.composerBottom <= g.viewport && g.composerBottom > g.viewport / 2,
		`the composer is back at the bottom (bottom ${g.composerBottom} of ${g.viewport})`,
	);
});
