/**
 * Text greys and weights where Windows draws the type.
 *
 * YaHei has Light, Regular and Bold only. The interface's 500 is its Regular there, so the faint grey
 * chosen on a Mac measured 2.5:1 on white — the sidebar's empty hint, the composer's placeholder,
 * the off switch's 关 all washed out — and the 600 above it jumped straight to Bold, beside Latin
 * that Segoe UI Variable drew heavier than the Han. `applyAppearance` darkens the two greys on a
 * light theme and draws every weight a step lighter when the preload has marked the window as
 * drawn by Windows.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_APPEARANCE, type AppearanceSettings } from "@lyra/core";
import { applyAppearance } from "../../src/features/settings/theme.ts";

function greys(platform: string | undefined, theme: AppearanceSettings["theme"]) {
	// The bridge only hears about the window's theme; an empty one is enough for that call to be skipped.
	if (!Reflect.has(window, "lyra")) Reflect.set(window, "lyra", {});
	const root = document.documentElement;
	if (platform === undefined) delete root.dataset.lyPlatform;
	else root.dataset.lyPlatform = platform;
	applyAppearance({ ...DEFAULT_APPEARANCE, theme });
	const read = (name: string) => root.style.getPropertyValue(name).trim();
	return { background: read("--color-shell"), muted: read("--color-ink-muted"), faint: read("--color-ink-faint") };
}

/** WCAG contrast of two `#rrggbb` colours. */
function contrast(a: string, b: string): number {
	const luminance = (hex: string) => {
		const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
		return 0.2126 * r + 0.7152 * g + 0.0722 * b;
	};
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}

test("on Windows a light theme's text greys step toward the ink, and the faint one clears 3:1", (t) => {
	try {
		const mac = greys("darwin", "light");
		const windows = greys("win32", "light");
		t.diagnostic(JSON.stringify({ mac, windows }));
		assert.ok(contrast(windows.faint, windows.background) >= 3, `faint grey on Windows: ${contrast(windows.faint, windows.background).toFixed(2)}:1`);
		assert.ok(contrast(windows.faint, windows.background) > contrast(mac.faint, mac.background));
		assert.ok(contrast(windows.muted, windows.background) > contrast(mac.muted, mac.background));
		// Muted stays above faint, or the two steps become one.
		assert.ok(contrast(windows.muted, windows.background) > contrast(windows.faint, windows.background));
	} finally {
		greys(undefined, DEFAULT_APPEARANCE.theme);
		Reflect.deleteProperty(window, "lyra");
	}
});

test("a Mac, a phone (no mark) and every dark theme keep the greys they had", () => {
	try {
		const unmarked = greys(undefined, "light");
		assert.deepEqual(greys("darwin", "light"), unmarked);
		assert.deepEqual(greys("linux", "light"), unmarked);
		assert.deepEqual(greys("win32", "dark"), greys(undefined, "dark"));
	} finally {
		greys(undefined, DEFAULT_APPEARANCE.theme);
		Reflect.deleteProperty(window, "lyra");
	}
});

test("on Windows every weight is drawn a step lighter, never below 400; elsewhere as chosen", () => {
	const drawn = (platform: string | undefined, uiFontWeight: number) => {
		if (!Reflect.has(window, "lyra")) Reflect.set(window, "lyra", {});
		const root = document.documentElement;
		if (platform === undefined) delete root.dataset.lyPlatform;
		else root.dataset.lyPlatform = platform;
		applyAppearance({ ...DEFAULT_APPEARANCE, uiFontWeight });
		return root.style.getPropertyValue("--ly-ui-weight").trim();
	};
	try {
		assert.equal(drawn("win32", 500), "400", "the default body weight is Regular in both scripts");
		assert.equal(drawn("win32", 600), "500");
		assert.equal(drawn("win32", 400), "400", "never below Regular");
		assert.equal(drawn("darwin", 500), "500");
		assert.equal(drawn(undefined, 500), "500");
	} finally {
		greys(undefined, DEFAULT_APPEARANCE.theme);
		Reflect.deleteProperty(window, "lyra");
	}
});
