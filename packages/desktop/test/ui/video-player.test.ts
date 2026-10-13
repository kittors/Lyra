/**
 * The app's video player, in the states a person meets it in: before anything plays (the first frame
 * and a play mark, the length once it is known), playing, muted, a file that cannot be played, and
 * the two larger sizes — the app's window from the full-screen button, the screen from the menu.
 * The system's own controls never appear — the bar is the app's.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import { translate } from "../../src/i18n/translate.ts";
import { VideoPlayer } from "../../src/ui/media/VideoPlayer.tsx";
import { click, mount } from "../helpers/mount.ts";

/** happy-dom's media element plays nothing; this one says it did, the way Chromium's would. */
function playable(video: HTMLVideoElement) {
	let paused = true;
	Object.defineProperty(video, "paused", { configurable: true, get: () => paused });
	Object.defineProperty(video, "ended", { configurable: true, get: () => false });
	video.play = async () => {
		paused = false;
		video.dispatchEvent(new Event("play"));
	};
	video.pause = () => {
		paused = true;
		video.dispatchEvent(new Event("pause"));
	};
}

test("before playing: the first frame as the poster, a play mark, the app's bar and not the system's", async () => {
	const view = await mount(h(VideoPlayer, { src: "ly-media://m/clip.mp4", label: "a fox" }));
	try {
		const video = view.find<HTMLVideoElement>("video");
		assert.equal(video.hasAttribute("controls"), false, "no system controls");
		assert.match(video.getAttribute("src") ?? "", /clip\.mp4#t=0\.001$/);
		assert.equal(view.find("[data-ly-video-player]").getAttribute("data-ly-video-player"), "paused");
		assert.equal(view.find("[data-ly-video-play]").getAttribute("aria-label"), translate("video.play"));
		Object.defineProperty(video, "duration", { configurable: true, value: 65 });
		await act(async () => void video.dispatchEvent(new Event("loadedmetadata")));
		assert.equal(view.find("[data-ly-video-time]").textContent, "0:00 / 1:05");
		assert.equal(view.find('[role="slider"]').getAttribute("aria-valuemax"), "65");
	} finally {
		await view.unmount();
	}
});

test("pressing play plays: the mark goes, the bar says pause; M mutes from the keyboard", async () => {
	const view = await mount(h(VideoPlayer, { src: "ly-media://m/clip.mp4" }));
	try {
		const video = view.find<HTMLVideoElement>("video");
		playable(video);
		await act(async () => view.find<HTMLButtonElement>("[data-ly-video-play]").click());
		assert.equal(view.find("[data-ly-video-player]").getAttribute("data-ly-video-player"), "playing");
		assert.equal(view.host.querySelector("[data-ly-video-play]"), null);
		assert.ok(view.all(".ly-video-btn").some((button) => button.getAttribute("aria-label") === translate("video.pause")));

		await act(async () => {
			video.dispatchEvent(new KeyboardEvent("keydown", { key: "m", bubbles: true }));
			video.dispatchEvent(new Event("volumechange"));
		});
		assert.equal(video.muted, true);
		assert.ok(view.all(".ly-video-btn").some((button) => button.getAttribute("aria-label") === translate("video.unmute")));
	} finally {
		await view.unmount();
	}
});

test("a file that cannot be played says so instead of showing a dead bar", async () => {
	const view = await mount(h(VideoPlayer, { src: "ly-media://m/broken.mp4" }));
	try {
		await act(async () => void view.find("video").dispatchEvent(new Event("error")));
		assert.equal(view.find("[data-ly-video-player]").getAttribute("data-ly-video-player"), "failed");
		assert.ok(view.text().includes(translate("video.unplayable")));
		assert.equal(view.host.querySelector(".ly-video-bar"), null);
	} finally {
		await view.unmount();
	}
});

const player = (view: { find: (selector: string) => HTMLElement }) => view.find("[data-ly-video-player]");
const press = (target: EventTarget, key: string, more: KeyboardEventInit = {}) =>
	act(async () => void target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...more })));

/**
 * The full-screen API as Chromium has it, which happy-dom does not: a request makes the element the
 * full-screen one and says so, and leaving says so again — the way Esc does it, from outside the page.
 */
function screenApi(enabled = true) {
	let element: Element | null = null;
	const asked: Element[] = [];
	const announce = () => document.dispatchEvent(new Event("fullscreenchange"));
	Object.defineProperty(document, "fullscreenEnabled", { configurable: true, get: () => enabled });
	Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => element });
	Object.defineProperty(document, "exitFullscreen", {
		configurable: true,
		value: async () => {
			element = null;
			announce();
		},
	});
	Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
		configurable: true,
		value: async function (this: HTMLElement) {
			asked.push(this);
			element = asked.at(-1) ?? null;
			announce();
		},
	});
	return {
		asked,
		leave: () => act(async () => document.exitFullscreen()),
		restore() {
			for (const name of ["fullscreenEnabled", "fullscreenElement", "exitFullscreen"]) Reflect.deleteProperty(document, name);
			Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen");
		},
	};
}

test("the full-screen button fills the app's window, not the screen, and Esc steps back without reaching what is behind", async () => {
	const screen = screenApi();
	const behind: string[] = [];
	const listen = (event: KeyboardEvent) => behind.push(event.key);
	window.addEventListener("keydown", listen);
	const view = await mount(h(VideoPlayer, { src: "ly-media://m/clip.mp4", label: "a fox" }));
	try {
		assert.equal(player(view).getAttribute("data-size"), "inline");
		await click(view.find("[data-ly-video-full]"));
		assert.equal(player(view).getAttribute("data-size"), "window");
		assert.equal(player(view).getAttribute("popover"), "manual", "lifted into the top layer");
		assert.equal(player(view).getAttribute("role"), "dialog");
		assert.equal(player(view).getAttribute("aria-modal"), "true");
		assert.equal(screen.asked.length, 0, "the screen is not taken");
		assert.equal(view.find("[data-ly-video-full]").getAttribute("aria-label"), translate("video.exitFullscreen"));

		// In 创作 the same Esc closes the whole view: the player has it first, and keeps it.
		await press(document.body, "Escape");
		assert.equal(player(view).getAttribute("data-size"), "inline");
		assert.equal(player(view).hasAttribute("popover"), false);
		assert.equal(player(view).getAttribute("role"), "group");
		assert.deepEqual(behind, []);

		await press(document.body, "Escape");
		assert.deepEqual(behind, ["Escape"], "back inline, Esc is the page's again");

		// F and a double click on the picture do what the button does.
		await press(view.find("video"), "f");
		assert.equal(player(view).getAttribute("data-size"), "window");
		await act(async () => void view.find("video").dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
		assert.equal(player(view).getAttribute("data-size"), "inline");
	} finally {
		window.removeEventListener("keydown", listen);
		await view.unmount();
		screen.restore();
	}
});

test("covering the window it takes the keys: one left on the page behind still reaches it, focus comes back, Tab goes round", async () => {
	const screen = screenApi();
	const outside = document.createElement("button");
	document.body.append(outside);
	const view = await mount(h(VideoPlayer, { src: "ly-media://m/clip.mp4" }));
	try {
		const video = view.find<HTMLVideoElement>("video");
		await click(view.find("[data-ly-video-full]"));

		await act(async () => outside.focus());
		assert.equal(document.activeElement, video, "focus sent behind the player comes back to it");

		await press(document.body, "m");
		await act(async () => void video.dispatchEvent(new Event("volumechange")));
		assert.equal(video.muted, true, "a key on the page behind is the player's");

		const more = view.find<HTMLButtonElement>("[data-ly-video-more]");
		const first = view.find<HTMLButtonElement>("[data-ly-video-play]");
		await act(async () => more.focus());
		await press(more, "Tab");
		assert.equal(document.activeElement, first, "Tab from the last control goes round to the first");
		await press(first, "Tab", { shiftKey: true });
		assert.equal(document.activeElement, more, "and Shift-Tab back again");
	} finally {
		outside.remove();
		await view.unmount();
		screen.restore();
	}
});

test("taking the whole screen is in the menu, and leaving it goes back to the size it was asked from", async () => {
	const screen = screenApi();
	const view = await mount(h(VideoPlayer, { src: "ly-media://m/clip.mp4" }));
	try {
		await click(view.find("[data-ly-video-full]"));
		await click(view.find("[data-ly-video-more]"));
		const item = view.find("[data-ly-video-screen]");
		assert.match(item.textContent ?? "", new RegExp(translate("video.screenFull")));
		assert.match(item.textContent ?? "", new RegExp(translate("video.screenFullDetail")));
		assert.equal(document.activeElement, item, "the opened menu has the focus");

		await click(item);
		assert.deepEqual(screen.asked, [player(view)]);
		assert.equal(player(view).getAttribute("data-size"), "screen");
		assert.equal(player(view).hasAttribute("popover"), false, "out of the window's top layer, into the screen's");
		assert.equal(view.host.querySelector("[data-ly-video-menu]"), null, "the menu goes once it is used");
		assert.equal(document.activeElement, view.find("[data-ly-video-more]"), "and the focus goes back to the button that opened it");
		assert.equal(view.find("[data-ly-video-full]").getAttribute("aria-label"), translate("video.screenExit"));

		// Esc in full screen is the browser's own; what the player sees is the change.
		await screen.leave();
		assert.equal(player(view).getAttribute("data-size"), "window", "back to the window it was asked from");
		assert.equal(player(view).getAttribute("popover"), "manual");

		await press(document.body, "Escape");
		assert.equal(player(view).getAttribute("data-size"), "inline");

		// From inline, straight back to inline.
		await click(view.find("[data-ly-video-more]"));
		await click(view.find("[data-ly-video-screen]"));
		assert.equal(player(view).getAttribute("data-size"), "screen");
		await screen.leave();
		assert.equal(player(view).getAttribute("data-size"), "inline");
	} finally {
		await view.unmount();
		screen.restore();
	}
});

test("Esc with the menu open closes the menu only, and hands focus back to its button", async () => {
	const screen = screenApi();
	const behind: string[] = [];
	const listen = (event: KeyboardEvent) => behind.push(event.key);
	window.addEventListener("keydown", listen);
	const view = await mount(h(VideoPlayer, { src: "ly-media://m/clip.mp4" }));
	try {
		await click(view.find("[data-ly-video-more]"));
		assert.ok(view.host.querySelector("[data-ly-video-menu]"));
		await press(document.activeElement ?? document.body, "Escape");
		assert.equal(view.host.querySelector("[data-ly-video-menu]"), null);
		assert.equal(document.activeElement, view.find("[data-ly-video-more]"));
		assert.equal(player(view).getAttribute("data-size"), "inline");
		assert.deepEqual(behind, []);
	} finally {
		window.removeEventListener("keydown", listen);
		await view.unmount();
		screen.restore();
	}
});

test("where the screen cannot be taken, there is no menu offering it", async () => {
	const screen = screenApi(false);
	const view = await mount(h(VideoPlayer, { src: "ly-media://m/clip.mp4" }));
	try {
		assert.equal(view.host.querySelector("[data-ly-video-more]"), null);
		assert.ok(view.host.querySelector("[data-ly-video-full]"), "filling the window needs nothing from the platform");
	} finally {
		await view.unmount();
		screen.restore();
	}
});
