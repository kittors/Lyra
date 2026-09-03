/**
 * Code syntax highlight themes palette.
 * Inspired by Claude Code theme selections and modern editor palettes.
 */

export interface CodeThemeSpec {
	id: string;
	label: string;
	mode: "light" | "dark";
	/**
	 * The surface code is drawn on, and the colour of text no rule claimed.
	 *
	 * Read by every code surface in the app — the editor, fenced blocks, the terminal, diffs —
	 * via `--ly-code-bg` / `--ly-code-fg`. They were labelled "preview color" for a long time and
	 * used by nothing but the settings swatch, which is why choosing a theme changed the token
	 * colours and left every background on the app's own white.
	 */
	background: string;
	foreground: string;
	/**
	 * Take the surface from the app rather than from these two fields.
	 *
	 * For the default theme only. Its whole point is to look like Lyra, and Lyra's background is
	 * whatever the user set on the appearance page — a fixed `#FFFFFF` here would ignore a tinted
	 * background and put a hard white rectangle in the middle of it. The fields above are still
	 * filled in, as the value the settings swatch previews and as a fallback.
	 */
	inherit?: boolean;
	/** Diff added row background */
	addedBg: string;
	/** Diff removed row background */
	removedBg: string;
	/** Token colors */
	tokens: {
		keyword: string;
		string: string;
		number: string;
		comment: string;
		function: string;
		type: string;
		variable: string;
		operator: string;
		punctuation: string;
		tag: string;
		attribute: string;
	};
}

export const LIGHT_CODE_THEMES: CodeThemeSpec[] = [
	{
		/*
		 * Lyra's own, and the default.
		 *
		 * The token colours are the terminal's ANSI palette, not a new invention. That palette is
		 * already Lyra's answer to "what colour is a string, a number, an error" — it was tuned for
		 * this background, and reusing it means `git diff`'s green in the terminal and a type name
		 * in the editor are the same green. A second hand-picked set would drift from it on the
		 * first tweak to either.
		 *
		 * `inherit` keeps the surface the app's own, so this theme adds colour to code without
		 * repainting the window. Anything else is a choice the user made.
		 */
		id: "lyra-light",
		label: "Lyra 默认",
		mode: "light",
		inherit: true,
		background: "#ffffff",
		foreground: "#1a1c1f",
		addedBg: "rgba(51, 128, 63, 0.12)",
		removedBg: "rgba(200, 64, 47, 0.10)",
		tokens: {
			keyword: "#2b62c6",
			string: "#0f7d78",
			number: "#9a6a00",
			comment: "#8a8a8a",
			function: "#8a45a5",
			type: "#33803f",
			variable: "#1a1c1f",
			operator: "#5f5f5f",
			punctuation: "#5f5f5f",
			tag: "#2b62c6",
			attribute: "#9a6a00",
		},
	},
	{
		id: "solarized-light",
		label: "Solarized Light",
		mode: "light",
		background: "#fdf6e3",
		foreground: "#657b83",
		addedBg: "rgba(133, 153, 0, 0.16)",
		removedBg: "rgba(220, 50, 47, 0.14)",
		tokens: {
			keyword: "#859900",
			string: "#2aa198",
			number: "#d33682",
			comment: "#8a938e",
			function: "#268bd2",
			type: "#b58900",
			variable: "#657b83",
			operator: "#859900",
			punctuation: "#657b83",
			tag: "#268bd2",
			attribute: "#b58900",
		},
	},
	{
		id: "claude-light",
		label: "Claude Light",
		mode: "light",
		background: "#faf8f5",
		foreground: "#2c2a29",
		addedBg: "rgba(46, 125, 50, 0.14)",
		removedBg: "rgba(211, 47, 47, 0.12)",
		tokens: {
			keyword: "#9b3f18",
			string: "#2d7d46",
			number: "#b85d19",
			comment: "#8c877d",
			function: "#1c6db2",
			type: "#7b4f9d",
			variable: "#2c2a29",
			operator: "#8c877d",
			punctuation: "#767168",
			tag: "#c2410c",
			attribute: "#9b3f18",
		},
	},
	{
		id: "github-light",
		label: "GitHub Light",
		mode: "light",
		background: "#ffffff",
		foreground: "#24292f",
		addedBg: "rgba(46, 160, 67, 0.15)",
		removedBg: "rgba(255, 129, 130, 0.2)",
		tokens: {
			keyword: "#cf222e",
			string: "#0a3069",
			number: "#0550ae",
			comment: "#6e7781",
			function: "#8250df",
			type: "#953800",
			variable: "#24292f",
			operator: "#cf222e",
			punctuation: "#57606a",
			tag: "#116329",
			attribute: "#0550ae",
		},
	},
	{
		id: "pierre-light",
		label: "Pierre Light",
		mode: "light",
		background: "#f4f1ea",
		foreground: "#383630",
		addedBg: "rgba(76, 175, 80, 0.15)",
		removedBg: "rgba(244, 67, 54, 0.14)",
		tokens: {
			keyword: "#a3451e",
			string: "#457b54",
			number: "#b8621b",
			comment: "#8c867a",
			function: "#2962ff",
			type: "#6a4c93",
			variable: "#383630",
			operator: "#78716c",
			punctuation: "#78716c",
			tag: "#a3451e",
			attribute: "#b8621b",
		},
	},
	{
		id: "one-light",
		label: "One Light",
		mode: "light",
		background: "#fafafa",
		foreground: "#383a42",
		addedBg: "rgba(80, 161, 79, 0.16)",
		removedBg: "rgba(228, 86, 73, 0.15)",
		tokens: {
			keyword: "#a626a4",
			string: "#50a14f",
			number: "#986801",
			comment: "#8b8c93",
			function: "#4078f2",
			type: "#c18401",
			variable: "#383a42",
			operator: "#0184bc",
			punctuation: "#383a42",
			tag: "#e45649",
			attribute: "#986801",
		},
	},
	{
		id: "catppuccin-latte",
		label: "Catppuccin Latte",
		mode: "light",
		background: "#eff1f5",
		foreground: "#4c4f69",
		addedBg: "rgba(64, 160, 43, 0.16)",
		removedBg: "rgba(210, 15, 57, 0.15)",
		tokens: {
			keyword: "#8839ef",
			string: "#40a02b",
			number: "#fe640b",
			comment: "#7c7f93",
			function: "#1e66f5",
			type: "#179299",
			variable: "#4c4f69",
			operator: "#04a5e5",
			punctuation: "#6c6f85",
			tag: "#d20f39",
			attribute: "#fe640b",
		},
	},
	{
		id: "vitesse-light",
		label: "Vitesse Light",
		mode: "light",
		background: "#ffffff",
		foreground: "#393a34",
		addedBg: "rgba(21, 128, 61, 0.14)",
		removedBg: "rgba(185, 28, 28, 0.12)",
		tokens: {
			keyword: "#2e8b57",
			string: "#b56959",
			number: "#2f6f9f",
			comment: "#8a998a",
			function: "#598bb5",
			type: "#2e808f",
			variable: "#393a34",
			operator: "#758575",
			punctuation: "#889888",
			tag: "#1e7a68",
			attribute: "#b56959",
		},
	},
	{
		id: "min-light",
		label: "Min Light",
		mode: "light",
		background: "#ffffff",
		foreground: "#212121",
		addedBg: "rgba(34, 197, 94, 0.15)",
		removedBg: "rgba(239, 68, 68, 0.14)",
		tokens: {
			keyword: "#3730a3",
			string: "#15803d",
			number: "#61728a",
			comment: "#9097a3",
			function: "#1d4ed8",
			type: "#4b5563",
			variable: "#111827",
			operator: "#6b7280",
			punctuation: "#9ca3af",
			tag: "#111827",
			attribute: "#4b5563",
		},
	},
];

export const DARK_CODE_THEMES: CodeThemeSpec[] = [
	{
		// The dark half of the pair above — the same ANSI slots, dark-theme values.
		id: "lyra-dark",
		label: "Lyra 默认",
		mode: "dark",
		inherit: true,
		background: "#171717",
		foreground: "#ededed",
		addedBg: "rgba(127, 201, 138, 0.14)",
		removedBg: "rgba(240, 113, 113, 0.13)",
		tokens: {
			keyword: "#79b8ff",
			string: "#6fd2c8",
			number: "#e3c07b",
			comment: "#6b6b6b",
			function: "#c39ac9",
			type: "#7fc98a",
			variable: "#d6d6d6",
			operator: "#a0a0a0",
			punctuation: "#a0a0a0",
			tag: "#79b8ff",
			attribute: "#e3c07b",
		},
	},
	{
		id: "github-dark",
		label: "GitHub Dark",
		mode: "dark",
		background: "#0d1117",
		foreground: "#c9d1d9",
		addedBg: "rgba(46, 160, 67, 0.22)",
		removedBg: "rgba(248, 81, 73, 0.22)",
		tokens: {
			keyword: "#ff7b72",
			string: "#a5d6ff",
			number: "#79c0ff",
			comment: "#8b949e",
			function: "#d2a8ff",
			type: "#ffa657",
			variable: "#c9d1d9",
			operator: "#ff7b72",
			punctuation: "#8b949e",
			tag: "#7ee787",
			attribute: "#79c0ff",
		},
	},
	{
		id: "claude-dark",
		label: "Claude Dark",
		mode: "dark",
		background: "#1e1e1e",
		foreground: "#e3e1de",
		addedBg: "rgba(74, 222, 128, 0.18)",
		removedBg: "rgba(248, 113, 113, 0.2)",
		tokens: {
			keyword: "#f97583",
			string: "#9ecbff",
			number: "#ffab70",
			comment: "#797672",
			function: "#b392f0",
			type: "#79b8ff",
			variable: "#e3e1de",
			operator: "#f97583",
			punctuation: "#9e9a94",
			tag: "#85e89d",
			attribute: "#ffab70",
		},
	},
	{
		id: "github-dark-dimmed",
		label: "GitHub Dark Dimmed",
		mode: "dark",
		background: "#22272e",
		foreground: "#adbac7",
		addedBg: "rgba(52, 125, 57, 0.28)",
		removedBg: "rgba(182, 35, 36, 0.28)",
		tokens: {
			keyword: "#f47067",
			string: "#96d0ff",
			number: "#6cb6ff",
			comment: "#768390",
			function: "#dcbdfb",
			type: "#f69d50",
			variable: "#adbac7",
			operator: "#f47067",
			punctuation: "#768390",
			tag: "#8ddb8c",
			attribute: "#6cb6ff",
		},
	},
	{
		id: "pierre-dark",
		label: "Pierre Dark",
		mode: "dark",
		background: "#181816",
		foreground: "#dfded8",
		addedBg: "rgba(76, 175, 80, 0.22)",
		removedBg: "rgba(239, 83, 80, 0.22)",
		tokens: {
			keyword: "#ff8a65",
			string: "#a5d6a7",
			number: "#ffcc80",
			comment: "#75746f",
			function: "#90caf9",
			type: "#ce93d8",
			variable: "#dfded8",
			operator: "#a1887f",
			punctuation: "#9e9d98",
			tag: "#ef9a9a",
			attribute: "#ffcc80",
		},
	},
	{
		id: "one-dark-pro",
		label: "One Dark Pro",
		mode: "dark",
		background: "#282c34",
		foreground: "#abb2bf",
		addedBg: "rgba(152, 195, 121, 0.2)",
		removedBg: "rgba(224, 108, 117, 0.22)",
		tokens: {
			keyword: "#c678dd",
			string: "#98c379",
			number: "#d19a66",
			comment: "#7f848e",
			function: "#61afef",
			type: "#e5c07b",
			variable: "#abb2bf",
			operator: "#56b6c2",
			punctuation: "#abb2bf",
			tag: "#e06c75",
			attribute: "#d19a66",
		},
	},
	{
		id: "dracula",
		label: "Dracula",
		mode: "dark",
		background: "#282a36",
		foreground: "#f8f8f2",
		addedBg: "rgba(80, 250, 123, 0.2)",
		removedBg: "rgba(255, 85, 85, 0.24)",
		tokens: {
			keyword: "#ff79c6",
			string: "#f1fa8c",
			number: "#bd93f9",
			comment: "#6272a4",
			function: "#50fa7b",
			type: "#8be9fd",
			variable: "#f8f8f2",
			operator: "#ff79c6",
			punctuation: "#f8f8f2",
			tag: "#ff79c6",
			attribute: "#50fa7b",
		},
	},
	{
		id: "dracula-soft",
		label: "Dracula Soft",
		mode: "dark",
		background: "#282a36",
		foreground: "#e2e2dc",
		addedBg: "rgba(80, 250, 123, 0.16)",
		removedBg: "rgba(255, 85, 85, 0.18)",
		tokens: {
			keyword: "#e880b9",
			string: "#e6ed93",
			number: "#b89fe6",
			comment: "#69779b",
			function: "#6fe891",
			type: "#96e1f0",
			variable: "#e2e2dc",
			operator: "#e880b9",
			punctuation: "#cfd0ca",
			tag: "#e880b9",
			attribute: "#6fe891",
		},
	},
	{
		id: "catppuccin-mocha",
		label: "Catppuccin Mocha",
		mode: "dark",
		background: "#1e1e2e",
		foreground: "#cdd6f4",
		addedBg: "rgba(166, 227, 161, 0.2)",
		removedBg: "rgba(243, 139, 168, 0.22)",
		tokens: {
			keyword: "#cba6f7",
			string: "#a6e3a1",
			number: "#fab387",
			comment: "#6c7086",
			function: "#89b4fa",
			type: "#f9e2af",
			variable: "#cdd6f4",
			operator: "#89dceb",
			punctuation: "#9399b2",
			tag: "#f38ba8",
			attribute: "#fab387",
		},
	},
	{
		id: "nord",
		label: "Nord",
		mode: "dark",
		background: "#2e3440",
		foreground: "#d8dee9",
		addedBg: "rgba(163, 190, 140, 0.22)",
		removedBg: "rgba(191, 97, 106, 0.24)",
		tokens: {
			keyword: "#81a1c1",
			string: "#a3be8c",
			number: "#b48ead",
			comment: "#6f7c96",
			function: "#88c0d0",
			type: "#8fbcbb",
			variable: "#d8dee9",
			operator: "#81a1c1",
			punctuation: "#eceff4",
			tag: "#bf616a",
			attribute: "#d08770",
		},
	},
];

export function findCodeTheme(id?: string, mode?: "light" | "dark"): CodeThemeSpec {
	const list = mode === "light" ? LIGHT_CODE_THEMES : DARK_CODE_THEMES;
	const match = list.find((t) => t.id === id);
	if (match) return match;
	return mode === "light" ? LIGHT_CODE_THEMES[0] : DARK_CODE_THEMES[0];
}
