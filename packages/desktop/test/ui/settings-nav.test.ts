import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { Settings2, Palette, Camera } from "lucide-react";
import { SettingsNav } from "../../src/features/settings/SettingsNav.tsx";
import { mount, click } from "../helpers/mount.ts";

const groups = [
	{
		labelKey: "settings.group.basic" as const,
		items: [
			{ id: "general" as const, labelKey: "settings.general" as const, icon: Settings2 },
			{ id: "appearance" as const, labelKey: "settings.appearance" as const, icon: Palette },
			{ id: "screenshot" as const, labelKey: "settings.screenshot" as const, icon: Camera },
		],
	},
];

test("the nav pill sits on the current row and follows a click", async () => {
	let section: "general" | "appearance" | "screenshot" = "general";
	const view = await mount(
		h(SettingsNav, {
			groups,
			section,
			compact: false,
			label: (key: string) => key,
			onPick: (id) => {
				if (id === "general" || id === "appearance" || id === "screenshot") section = id;
			},
		}),
	);
	try {
		const pill = view.host.querySelector(".ly-settings-nav-pill");
		assert.ok(pill);
		const general = view.host.querySelector('[aria-current="page"]');
		assert.ok(general);
		assert.equal(general?.textContent, "settings.general");
		const shot = [...view.host.querySelectorAll("button")].find((button) => button.textContent === "settings.screenshot");
		assert.ok(shot);
		await click(shot);
		assert.equal(section, "screenshot");
	} finally {
		await view.unmount();
	}
});
