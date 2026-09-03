/**
 * The rules the stylesheet keeps for itself.
 *
 * Three of these are about the design system holding: a colour, a duration or a curve written by
 * hand is one that will not follow the theme, will not follow the 「减少动态效果」 setting, and
 * cannot be changed anywhere. The rest is formatting, which `.editorconfig` already handles — so
 * most of `stylelint-config-standard` is turned off rather than argued with.
 *
 * Tailwind v4 puts a lot of its own at-rules in the file. They are listed rather than allowed
 * wholesale, so a typo in one is still an error.
 */

export default {
	extends: ["stylelint-config-standard"],
	rules: {
		"at-rule-no-unknown": [
			true,
			{
				ignoreAtRules: [
					"theme",
					"layer",
					"apply",
					"variant",
					"custom-variant",
					"utility",
					"source",
					"plugin",
					"config",
					"reference",
					"property",
				],
			},
		],

		/*
		 * Colours come from the theme, not from the keyboard.
		 *
		 * Every surface in this app reads a CSS variable so that the appearance page can actually
		 * change it — 「只暴露三个颜色，其余按对比度滑块派生」 only works if nothing has its own idea.
		 * A hand-written hex is a surface that ignores the user's choice, and it is invisible until
		 * somebody picks a light theme.
		 *
		 * `tokens.css` and `themes/` are where the literals belong; they are exempt below.
		 */
		/*
		 * `#000` and `#fff` are still allowed, and only those two.
		 *
		 * A `mask-image` gradient uses them as an alpha channel — `#000` means "keep this part",
		 * and no theme colour can stand in for it. Everything with an actual hue has to come from
		 * a token, which is the case this rule is for.
		 */
		"color-no-hex": true,
		"color-named": "never",

		/*
		 * Transitions come from the three duration tokens.
		 *
		 * A hand-written `200ms` on a transition does not shorten under 「减少动态效果」 — that
		 * setting works by zeroing `--ly-t-*` — so it is not merely inconsistent, it ignores an
		 * accessibility preference on that one element while every other element honours it.
		 *
		 * `animation` is deliberately not covered. A keyframe animation has a period that is part of
		 * what it *is* — a breathing mark at 2.4s, a shimmer at 1.4s — and those are not three
		 * values on a scale. The global reduce-motion rule takes care of them by clamping
		 * `animation-duration` for everything at once.
		 */
		"declaration-property-value-disallowed-list": {
			// A bare number with a unit. `var(--ly-t-base)` contains no digits outside the name,
			// but `0.01ms` and `220ms` do — match those and nothing else.
			"/^transition$/": ["/(^|[\\s,])[0-9.]+m?s\\b/", "/cubic-bezier\\(/"],
			// `0s` and `0.01ms` are deliberate suppression — a drag freezing transitions, and the
			// reduce-motion switch. Only a real duration typed by hand is the problem.
			"/^transition-duration$/": ["/\\b[1-9]\\d*m?s\\b/"],
			"/^transition-timing-function$/": ["/cubic-bezier/"],
		},

		"declaration-no-important": null,

		/*
		 * Class names are `ly-…`, plus what other people's stylesheets bring.
		 *
		 * CodeMirror, xterm and KaTeX are styled by overriding their own class names; those are not
		 * ours to rename.
		 */
		/*
		 * Ours are `ly-…`. The rest of this list is other people's.
		 *
		 * CodeMirror, xterm, KaTeX and docx-preview are styled by overriding the class names they
		 * emit — not ours to rename. Tailwind's own utilities appear wherever a rule has to reach
		 * one (`.group`, `.truncate`, `.hover`), and `drag-region` / `no-drag` are the two names
		 * Electron's title bar dragging is expressed with.
		 */
		"selector-class-pattern": [
			"^(ly-[a-z0-9-]+|is-[a-z-]+|dark|light|cm-.*|xterm.*|katex.*|docx.*|prose-dw|group|hover|truncate|drag-region|no-drag|group\\/[a-z-]+)$",
			{ resolveNestedSelectors: true },
		],
		"custom-property-pattern": "^(ly|color|font|text|radius|sheet|tw)-",

		// Formatting is `.editorconfig`'s job. These only produce noise in a review.
		/*
		 * Blank lines inside a rule are how `tokens.css` groups itself — surfaces, then rules, then
		 * ink, then motion. `--fix` removed all of them and turned a readable table into a wall.
		 * Grouping is meaning, not formatting.
		 */
		"declaration-empty-line-before": null,
		"custom-property-empty-line-before": null,
		"comment-empty-line-before": null,
		"rule-empty-line-before": null,
		"at-rule-empty-line-before": null,
		"declaration-block-single-line-max-declarations": null,
		"no-descending-specificity": null,
		/*
		 * Deliberate. The same selector appears twice where the second one is under a media query
		 * or a theme, and keeping them apart reads better than one rule with everything in it —
		 * the reduce-motion variant of a rule belongs next to the reduce-motion block, not inside
		 * the rule it modifies.
		 */
		"no-duplicate-selectors": null,
		"alpha-value-notation": null,
		"color-function-notation": null,
		"value-keyword-case": null,
		"property-no-vendor-prefix": null,
		"selector-not-notation": null,
		"media-feature-range-notation": null,
	},

	overrides: [
		{
			/*
			 * Syntax colours, which are a palette rather than a theme.
			 *
			 * These are the editor's token colours expressed as classes, and they are the same in
			 * both themes via `light-dark()`. Deriving them from the three configurable colours
			 * would produce a highlighter nobody can read — a palette needs hues that are distinct
			 * from each other, not from the background.
			 */
			files: ["**/styles/code-tokens.css"],
			rules: { "color-no-hex": null },
		},
		{
			/*
			 * The one file that reaches Tailwind's own class names.
			 *
			 * `.hover\:bg-card` is a utility the markup carries, and this file cancels it on a phone
			 * — a device with no pointer leaves hover states stuck on. Reaching a utility by name is
			 * unusual and deliberate; the naming rule is about *our* classes.
			 */
			files: ["**/styles/phone.css"],
			rules: { "selector-class-pattern": null },
		},
		{
			/*
			 * Masks, where `#000` and `#fff` are an alpha channel rather than a colour.
			 *
			 * A `mask-image` gradient reads only the alpha of each stop; `#000` there means "keep
			 * this part of the element" and no theme colour can stand in for it. Asking these files
			 * to use a token would be asking the wrong question.
			 */
			files: [
				"**/styles/scroll.css",
				"**/styles/marquee.css",
				"**/styles/thinking-ticker.css",
				"**/styles/components.css",
				"**/styles/tabs.css",
				"**/styles/base.css",
				"**/styles/misc.css",
				"**/styles/phone.css",
			],
			rules: { "color-no-hex": null },
		},
		{
			// Where the literals are supposed to be: this is the definition, not a use of it.
			files: ["**/styles/tokens.css", "**/styles/themes/*.css", "**/styles/fonts.css"],
			rules: {
				"color-no-hex": null,
				"color-named": null,
				"declaration-property-value-disallowed-list": null,
			},
		},
		{
			// The keyframes themselves, and the reduce-motion switch, are the motion system.
			files: ["**/styles/motion.css"],
			rules: { "declaration-property-value-disallowed-list": null },
		},
	],
};
