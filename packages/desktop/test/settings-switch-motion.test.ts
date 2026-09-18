import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("settings pages arrive with a fade and a short rise, not the workspace 0.88 cut", async () => {
	const css = await readFile(new URL("../src/styles/motion.css", import.meta.url), "utf8");
	const block = css.match(/@keyframes ly-settings-in \{[\s\S]*?\}\n/)?.[0] ?? "";
	assert.match(block, /opacity:\s*0/);
	assert.match(block, /translateY\(6px\)/);
	assert.ok(!/translateY\((?:[1-9]\d|[8-9])px\)/.test(block), "a tall settings column must not shove");
	assert.match(css, /\.ly-settings-enter\[data-active="true"\]/);
	assert.match(css, /var\(--ly-t-base\)/);
});

test("the settings nav fill is a sliding pill, not a snapped row background", async () => {
	const nav = await readFile(new URL("../src/features/settings/SettingsNav.tsx", import.meta.url), "utf8");
	const shell = await readFile(new URL("../src/features/settings/SettingsShell.tsx", import.meta.url), "utf8");
	assert.match(nav, /ly-settings-nav-pill/);
	assert.match(nav, /--ly-nav-pill-y/);
	assert.ok(!/bg-card-hover text-ink/.test(nav), "the selected row must not paint its own fill");
	assert.match(shell, /data-ly-settings/);
	assert.match(shell, /pageClassName="ly-settings-enter"/);
	assert.match(shell, /<SettingsNav/);
});
