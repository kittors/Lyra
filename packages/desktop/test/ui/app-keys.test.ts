/**
 * Ctrl+N and Ctrl+, on Windows and Linux, ⌘N and ⌘, on a Mac: a new conversation and the settings,
 * from any screen. On the Windows test machine neither did anything. A key a control already took —
 * a focused terminal's Ctrl+N is readline's next-history — is left alone.
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createElement as h } from "react";
import { useAppKeys } from "../../src/app/shortcuts.ts";
import { useApp } from "../../src/store/index.ts";
import { mount, press, type Mounted } from "../helpers/mount.ts";

let view: Mounted | undefined;
const realPlatform = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(navigator), "platform");

afterEach(async () => {
	await view?.unmount();
	view = undefined;
	if (realPlatform) Object.defineProperty(Object.getPrototypeOf(navigator), "platform", realPlatform);
});

function Harness() {
	useAppKeys();
	return h("textarea");
}

function record(): { calls: string[]; restore(): void } {
	const previous = useApp.getState();
	const calls: string[] = [];
	useApp.setState({
		setView: (view: string) => calls.push(`view:${view}`),
		newSession: async () => {
			calls.push("new");
		},
	} as never);
	return { calls, restore: () => useApp.setState({ setView: previous.setView, newSession: previous.newSession }) };
}

for (const [platform, mod] of [["Win32", "ctrlKey"], ["MacIntel", "metaKey"]] as const) {
	test(`${platform}: the primary modifier with N opens a new conversation, with comma the settings`, async () => {
		Object.defineProperty(Object.getPrototypeOf(navigator), "platform", { get: () => platform, configurable: true });
		const { calls, restore } = record();
		try {
			view = await mount(h(Harness));
			const field = view.find("textarea");
			await press(field, "n", { code: "KeyN", [mod]: true });
			assert.deepEqual(calls, ["view:chat", "new"]);
			await press(field, ",", { code: "Comma", [mod]: true });
			assert.deepEqual(calls.at(-1), "view:settings");
		} finally {
			restore();
		}
	});
}

test("a key a control already took is left alone, and so are the other modifiers", async () => {
	Object.defineProperty(Object.getPrototypeOf(navigator), "platform", { get: () => "Win32", configurable: true });
	const { calls, restore } = record();
	try {
		view = await mount(h(Harness));
		const field = view.find("textarea");
		field.addEventListener("keydown", (event) => event.preventDefault(), { once: true });
		await press(field, "n", { code: "KeyN", ctrlKey: true });
		await press(field, "n", { code: "KeyN", metaKey: true });
		await press(field, "N", { code: "KeyN", ctrlKey: true, shiftKey: true });
		await press(field, "n", { code: "KeyN", ctrlKey: true, altKey: true });
		assert.deepEqual(calls, []);
	} finally {
		restore();
	}
});
