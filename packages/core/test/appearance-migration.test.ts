/**
 * What happens to an appearance file written by an older version.
 *
 * Settings are merged over the defaults and written back out in full, so nothing ever falls out of
 * a settings file on its own: a key removed from the type keeps being read, kept and saved, and
 * turns up years later in a real profile looking like it means something. Dropping it is a
 * migration like any other, and the boundary — drop the dead key, touch nothing the user chose —
 * is what these check.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { DEFAULT_APPEARANCE, migrateAppearance } from "../src/config/settings.ts";

test("a setting that no longer exists is dropped rather than carried", () => {
	const stored = { ...DEFAULT_APPEARANCE, translucentSidebar: true } as Record<string, unknown>;
	const next = migrateAppearance(stored as never) as Record<string, unknown>;

	assert.ok(!("translucentSidebar" in next), "the key is gone, not merely ignored");
	// Everything else survives untouched: this is a deletion, not a reset.
	assert.deepEqual(next, { ...DEFAULT_APPEARANCE });
});

test("and it is dropped whatever it was set to", () => {
	for (const value of [true, false, undefined]) {
		const next = migrateAppearance({ ...DEFAULT_APPEARANCE, translucentSidebar: value } as never) as Record<
			string,
			unknown
		>;
		assert.ok(!("translucentSidebar" in next), `still gone for ${String(value)}`);
	}
});

test("a file that never had it is unchanged", () => {
	assert.deepEqual(migrateAppearance({ ...DEFAULT_APPEARANCE }), { ...DEFAULT_APPEARANCE });
});

test("choices the user actually made are left alone", () => {
	const mine = {
		...DEFAULT_APPEARANCE,
		theme: "light" as const,
		accent: "#FF00AA",
		contrast: 59,
		uiFontSize: 15,
		translucentSidebar: true,
	} as Record<string, unknown>;

	const next = migrateAppearance(mine as never) as Record<string, unknown>;
	assert.ok(!("translucentSidebar" in next));
	assert.equal(next.theme, "light");
	assert.equal(next.accent, "#FF00AA");
	assert.equal(next.contrast, 59);
	assert.equal(next.uiFontSize, 15);
});

test("曾经的默认 Inter 跟着换成现在的默认", () => {
	const next = migrateAppearance({
		...DEFAULT_APPEARANCE,
		uiFont: '"Inter Variable", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
	});
	assert.equal(next.uiFont, DEFAULT_APPEARANCE.uiFont);
	assert.match(next.uiFont, /PingFang SC/);
	assert.doesNotMatch(next.uiFont, /Inter Variable|IBM Plex Sans Variable/);
});

test("曾经的默认 IBM Plex 跟着换成现在的默认", () => {
	const next = migrateAppearance({
		...DEFAULT_APPEARANCE,
		uiFont: '"IBM Plex Sans Variable", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
	});
	assert.equal(next.uiFont, DEFAULT_APPEARANCE.uiFont);
	assert.match(next.uiFont, /PingFang SC/);
});

test("自己写过的字体栈不动", () => {
	const mine = '"Inter Variable", "Comic Sans MS", sans-serif';
	assert.equal(migrateAppearance({ ...DEFAULT_APPEARANCE, uiFont: mine }).uiFont, mine);
});

test("曾经的默认 13px 跟着换成现在的 14px", () => {
	assert.equal(DEFAULT_APPEARANCE.uiFontSize, 14);
	assert.equal(migrateAppearance({ ...DEFAULT_APPEARANCE, uiFontSize: 13 }).uiFontSize, 14);
	assert.equal(migrateAppearance({ ...DEFAULT_APPEARANCE, uiFontSize: 15 }).uiFontSize, 15);
});

test("没表过态的人跟着系统走，表过态的人不动", () => {
	/*
	 * 主进程一侧一直是这个行为——`electron/window.ts` 读不到设置时按 `nativeTheme.shouldUseDarkColors`
	 * 画启动屏。而默认值此前是 `dark`，于是系统是浅色的机器上，启动屏按系统画成浅色、渲染进程一加载
	 * 又被拽回深色，开机第一眼是一次闪烁。两边得说同一件事。
	 */
	assert.equal(DEFAULT_APPEARANCE.theme, "system", "没选过主题就跟着系统");

	// 而选过的人，选的还在——`normalizeSettings` 的合并方向是「默认在下、存的在上」。
	for (const chosen of ["light", "dark", "system"] as const) {
		assert.equal({ ...DEFAULT_APPEARANCE, theme: chosen }.theme, chosen);
	}
});
