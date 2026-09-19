import assert from "node:assert/strict";
import { test } from "node:test";
import { act, createElement as h } from "react";
import { DEFAULT_SETTINGS } from "@lyra/core";
import { PermissionPicker } from "../../src/features/modals/PermissionPicker.tsx";
import { useApp } from "../../src/store/index.ts";
import { click, mount } from "../helpers/mount.ts";

for (const confirm of [false, true]) {
	test(`permission ${confirm ? "confirmation" : "cancel"} waits for exit and completes exactly once`, async () => {
		let closed = 0;
		const saved: string[] = [];
		useApp.setState({ settings: { ...DEFAULT_SETTINGS, permissionMode: "auto" }, saveSettings: async (settings) => { saved.push(settings.permissionMode); } });
		const anchor = document.createElement("button");
		document.body.append(anchor);
		const view = await mount(h(PermissionPicker, { anchor, onClose: () => { closed++; } }));
		try {
			const danger = document.querySelector("[aria-label='权限模式'] button:has(svg.lucide-circle-alert)");
			assert.ok(danger);
			await click(danger);
			const modal = document.querySelector("[data-ly-modal]");
			assert.ok(modal);
			const buttons = modal.querySelectorAll("[data-ly-dialog-actions] button");
			assert.equal(buttons.length, 2);
			await click(buttons[confirm ? 1 : 0]);
			assert.equal(modal.classList.contains("ly-dialog-out"), true);
			assert.equal(closed, 0);
			assert.deepEqual(saved, []);
			await act(async () => { modal.dispatchEvent(new Event("animationend", { bubbles: true })); });
			assert.equal(closed, 1);
			assert.deepEqual(saved, confirm ? ["full"] : []);
			await view.unmount();
			assert.equal(closed, 1);
		} finally {
			if (view.host.isConnected) await view.unmount();
			anchor.remove();
		}
	});
}
