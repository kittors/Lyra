/**
 * Runtime theming.
 *
 * Tailwind's `@theme` block emits the design tokens as CSS variables on `:root`. Overriding
 * those same variables at runtime is what makes the appearance page actually do something —
 * every surface in the app already reads from them.
 *
 * Only three colours are configurable (accent, background, foreground). The rest of the scale
 * is derived, so a user picking a background cannot end up with unreadable text or invisible
 * borders: surfaces step away from the background and text steps toward the foreground, both
 * scaled by the contrast slider.
 */

import type { AppearanceSettings } from "@lyra/core";
import { sharedHighlightStyle } from "./code/highlight.ts";
import { findCodeTheme } from "./code/themes.ts";
import { contentMeasure } from "./content-width.ts";
import { bridge } from "../services/index.ts";

interface Rgb {
	r: number;
	g: number;
	b: number;
}

export function applyAppearance(input: AppearanceSettings): void {
	/*
	 * The defaults are *not* merged in here, deliberately.
	 *
	 * That would mean importing a value from "@lyra/core", and the package root reaches `node:fs`
	 * — see the note in `ScheduledView.tsx`. The bundle would load and then throw on the first Node
	 * builtin, which is a worse failure than the one it set out to fix. Completeness is guaranteed
	 * at the two doors instead: `migrateAppearance` for settings read off disk, and `sync-rpc.ts`
	 * for settings arriving from a phone. What is left here is `parseHex` refusing to throw, so a
	 * field that slips through both is a wrong colour rather than a blank screen.
	 */
	const appearance = input;
	const root = document.documentElement;
	const dark = resolveDark(appearance.theme);

	const background = parseHex(dark ? appearance.darkBackground : appearance.lightBackground) ?? {
		r: 23,
		g: 23,
		b: 23,
	};
	const foreground = parseHex(dark ? appearance.darkForeground : appearance.lightForeground) ?? {
		r: 237,
		g: 237,
		b: 237,
	};
	const accent = appearance.accent;

	// 0–100 maps to a 0.5×–1.5× multiplier on every derived step.
	const strength = 0.5 + appearance.contrast / 100;

	/*
	 * Surfaces and rules are scaled apart, and only on a light theme.
	 *
	 * Both used to come off the same curve, which produced a scale where the rule (#ececed) was
	 * *paler* than the card it was meant to divide (#f0f0f0) — a border lighter than its own
	 * surface separates nothing, so every layer had to earn its separation by getting greyer
	 * instead. Stacked three deep that is where "the whole app looks grey" comes from.
	 *
	 * So on light: surfaces stay close to the page and the rules step well clear of it, which is
	 * how the apps this is measured against read as clean — white panels, visible hairlines.
	 * Dark themes already work the other way round: a surface lifts off the page by getting
	 * lighter, which is the same direction its text goes, and there the shared curve is correct.
	 */
	const SURFACE_ON_LIGHT = 0.45;
	const RULE_ON_LIGHT = 1.7;

	const surface = (step: number) =>
		toHex(mix(background, foreground, Math.min(0.9, step * strength * (dark ? 1 : SURFACE_ON_LIGHT))));
	const rule = (step: number) =>
		toHex(mix(background, foreground, Math.min(0.9, step * strength * (dark ? 1 : RULE_ON_LIGHT))));
	const text = (weight: number) => toHex(mix(background, foreground, Math.min(1, weight)));
	/** A wash of the foreground at a given opacity — reads against any backdrop, including none. */
	const veil = (alpha: number) => `color-mix(in srgb, ${toHex(foreground)} ${(alpha * 100).toFixed(1)}%, transparent)`;

	/**
	 * Fields read as paper: lighter than the page, never darker.
	 *
	 * Every other surface steps from the background toward the foreground, which is correct for
	 * cards and panels. Applied to an input on a light theme it goes the wrong way — the
	 * composer came out grey against a white page, when the thing you type into should be the
	 * brightest surface on screen. Dark themes step toward the foreground as usual; light ones
	 * step toward white, so a tinted background still yields a field that sits above it.
	 */
	const paper = dark ? surface(0.035) : toHex(mix(background, { r: 255, g: 255, b: 255 }, 0.65));

	/**
	 * Menus and popovers: the surface that floats above everything else.
	 *
	 * Same problem as `paper`, one step further. A menu derived by stepping toward the
	 * foreground came out darker than the page it floats over, and blurring a dark translucent
	 * panel over a light page just produces grey. Floating things are lighter than what they
	 * cover, in either theme.
	 */
	const float_ = dark ? surface(0.1) : toHex(mix(background, { r: 255, g: 255, b: 255 }, 0.8));

	const lightTheme = findCodeTheme(appearance.codeLightTheme, "light");
	const darkTheme = findCodeTheme(appearance.codeDarkTheme, "dark");
	/** Whichever of the two is in force right now, and the surface it resolves to. */
	const codeTheme = dark ? darkTheme : lightTheme;
	const codeSurface = codeTheme.inherit ? toHex(background) : codeTheme.background;
	const codeInk = codeTheme.inherit ? toHex(foreground) : codeTheme.foreground;

	const tokens: Record<string, string> = {
		"--color-shell": toHex(background),
		"--color-sidebar": surface(0.042),
		"--color-panel": surface(0.04),
		"--color-card": surface(0.06),
		"--color-card-hover": veil(dark ? 0.062 : 0.05),
		"--color-input": paper,
		"--color-elevated": veil(dark ? 0.1 : 0.085),
		"--color-float": float_,
		"--color-line": rule(0.075),
		"--color-line-soft": rule(0.05),
		"--color-ink": toHex(foreground),
		"--color-ink-muted": text(0.62),
		"--color-ink-faint": text(0.4),
		"--color-accent": accent,
		"--color-info": accent,
		"--ly-ui-font": appearance.uiFont,
		"--ly-code-font": appearance.codeFont,
		"--ly-ui-size": `${appearance.uiFontSize}px`,
		"--ly-code-size": `${appearance.codeFontSize}px`,
		/*
		 * The conversation's measure, read by every column that is part of it.
		 *
		 * One variable rather than one number per component: the transcript, the composer and the
		 * approval card have to agree, and they are three files that would otherwise be changed
		 * separately and eventually not.
		 */
		"--ly-content": contentMeasure(appearance.contentWidth),
		/*
		 * How code is set, beyond the family.
		 *
		 * Fallbacks rather than `??` on the settings object: these fields were added after the fact,
		 * and a settings file written before they existed has to keep rendering the way it did.
		 */
		"--ly-code-weight": String(appearance.codeFontWeight ?? 400),
		"--ly-code-line-height": String(appearance.codeLineHeight ?? 1.6),
		"--ly-code-tracking": `${appearance.codeLetterSpacing ?? 0}em`,
		/*
		 * The surface code is drawn on, which the theme has always declared and nothing ever read.
		 *
		 * `background` and `foreground` sat in `code-themes.ts` labelled "preview color" and were
		 * used by exactly one thing: the swatch on the settings page. So picking Solarized Light
		 * showed a warm yellow sample and left every real surface on the app's own white — the
		 * setting appeared to do nothing, because the most visible half of it did nothing.
		 *
		 * Every surface that draws code reads these: the editor and its gutter, fenced blocks in
		 * a reply, the diff viewer, and the terminal. That last one cannot use a variable — xterm
		 * paints to a canvas — so `TerminalPane` reads these two back out and pushes them in.
		 *
		 * `inherit` is what keeps 「Lyra 默认」 from repainting the window: it takes the app's own
		 * background, including a tinted one, so only the syntax colours come from the theme.
		 * Choosing Solarized Light is then an actual choice with an actual consequence, rather
		 * than something the app did to itself on first launch.
		 */
		"--ly-code-bg": codeSurface,
		"--ly-code-fg": codeInk,
		/*
		 * The gutter and the chrome around the code, one step off the code's own surface.
		 *
		 * Flat-on-flat loses the line numbers into the text when a theme's background is close to
		 * its foreground. Mixed rather than a second declared colour, so it follows any theme —
		 * including one added later — without needing a value per theme.
		 */
		"--ly-code-bg-soft": `color-mix(in srgb, ${codeInk} 5%, ${codeSurface})`,
		"--ly-diff-added-bg": dark ? darkTheme.addedBg : lightTheme.addedBg,
		"--ly-diff-removed-bg": dark ? darkTheme.removedBg : lightTheme.removedBg,
	};

	for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);

	// Update shared highlight style in DOM
	sharedHighlightStyle(appearance.codeLightTheme, appearance.codeDarkTheme);

	/*
	 * The window itself has to know the theme, for two separate reasons.
	 *
	 * Windows and Linux draw their own controls into the title strip, which would otherwise
	 * stay dark over a light theme. And on every platform the window paints a backing colour
	 * that shows through whenever a resize outruns the renderer's reflow — dragging an edge
	 * quickly is exactly that, and a stale colour there is the black frame that flashes.
	 */
	bridge.setWindowTheme?.({ color: toHex(background), symbolColor: text(0.62) });

	root.classList.toggle("dark", dark);
	root.classList.toggle("light", !dark);
	/*
	 * Declared, not just implied by the class.
	 *
	 * The editor's syntax colours are written with `light-dark()`, which resolves against this
	 * property and nothing else — without it every token would take the light branch on a dark
	 * theme. It also gets form controls and scrollbars right for free.
	 */
	root.style.colorScheme = dark ? "dark" : "light";
	root.dataset.diffMarkers = appearance.diffMarkers;
	root.dataset.pointerCursor = String(appearance.pointerCursor);
	root.dataset.fontSmoothing = String(appearance.fontSmoothing);
	root.dataset.reduceMotion = appearance.reduceMotion;
}

/** Re-apply on system scheme changes while the theme is set to follow the system. */
export function watchSystemTheme(getAppearance: () => AppearanceSettings): () => void {
	const query = window.matchMedia("(prefers-color-scheme: dark)");
	const onChange = () => {
		if (getAppearance().theme === "system") applyAppearance(getAppearance());
	};
	query.addEventListener("change", onChange);
	return () => query.removeEventListener("change", onChange);
}

function resolveDark(theme: AppearanceSettings["theme"]): boolean {
	if (theme === "dark") return true;
	if (theme === "light") return false;
	return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function parseHex(hex: string | undefined | null): Rgb | null {
	// Null rather than a throw for anything that is not a colour, including nothing at all: every
	// caller already has a fallback for an unparseable one, and none of them expect an exception.
	if (typeof hex !== "string") return null;
	const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
	if (!match) return null;
	let value = match[1];
	if (value.length === 3) value = value.split("").map((c) => c + c).join("");
	return {
		r: Number.parseInt(value.slice(0, 2), 16),
		g: Number.parseInt(value.slice(2, 4), 16),
		b: Number.parseInt(value.slice(4, 6), 16),
	};
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
	const t = Math.max(0, Math.min(1, amount));
	return {
		r: Math.round(from.r + (to.r - from.r) * t),
		g: Math.round(from.g + (to.g - from.g) * t),
		b: Math.round(from.b + (to.b - from.b) * t),
	};
}

function toHex({ r, g, b }: Rgb): string {
	return `#${[r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Whether motion is currently switched off, for the animations CSS cannot express.
 *
 * The stylesheet handles its own under `:root[data-reduce-motion]`, but a rewrite that steps
 * through intermediate strings is state, not style — there is no duration to shorten, only frames
 * to not run. Read at the moment it matters rather than subscribed to: these are one-shot
 * animations, and one that has already started can finish.
 */
export function motionReduced(): boolean {
	const setting = document.documentElement.dataset.reduceMotion;
	if (setting === "on") return true;
	if (setting === "off") return false;
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Readable text colour for a swatch, so a hex chip stays legible on any background. */
export function contrastingInk(hex: string): string {
	const rgb = parseHex(hex);
	if (!rgb) return "#ffffff";
	// Relative luminance, sRGB coefficients.
	const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
	return luminance > 0.6 ? "#1a1c1f" : "#ffffff";
}
