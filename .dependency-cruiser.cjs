/**
 * The dependency rules, as something a machine checks rather than something a comment asks for.
 *
 * The boundaries in this repository are real and were written down in AGENTS.md — core is platform
 * independent, the renderer may not pull core's values into a browser bundle, and so on. What was
 * missing is anything that notices when one is crossed. The comment on `core/src/index.ts` explains
 * that importing a *value* from it blanks the window; nothing stopped anyone from doing it.
 *
 * Rules start at `warn` when their violations have not been cleaned up yet, and move to `error` in
 * the commit that empties them. A rule that is red on arrival teaches people to ignore the tool —
 * the same reason `knip` runs with `--no-exit-code` in CI.
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
	forbidden: [
		{
			name: "no-circular",
			comment:
				"A cycle between *values* is how a module ends up half-initialised at runtime: one of " +
				"the two sees `undefined` where an export should be, and the error names the property " +
				"rather than the cycle. " +
				"Type-only cycles are excluded deliberately — `Message` referring to `Provider` " +
				"referring back is ordinary, correct TypeScript that disappears at compile time, and " +
				"forbidding it would mean flattening a type model to satisfy a tool.",
			/*
			 * `warn` on arrival, and the reason is worth stating rather than assuming.
			 *
			 * There are fifty-odd of these today and the application works: the cycles are between
			 * modules that reach each other lazily, so nothing is read before it is assigned. Turning
			 * them red on the first run would mean either a week of untangling before any other rule
			 * could be enforced, or — far more likely — the whole tool being ignored. `knip` runs with
			 * `--no-exit-code` in CI for the same reason.
			 *
			 * The number is the thing to watch. It should go down as domains get their own directories,
			 * and this becomes `error` in the commit that empties it.
			 */
			severity: "warn",
			from: {},
			to: { circular: true, dependencyTypesNot: ["type-only"] },
		},

		{
			name: "core-stays-platform-free",
			comment:
				"`core` is the agent runtime that both the desktop and the phone drive. The moment it " +
				"imports either of them it stops being that, and the mobile bundle starts pulling in " +
				"Electron. AGENTS.md states this; this enforces it.",
			severity: "error",
			from: { path: "^packages/core/src" },
			to: { path: "^packages/(desktop|mobile|agent-cli|relay)/" },
		},

		{
			name: "renderer-imports-core-types-only",
			comment:
				"Importing a *value* from core's root index pulls the whole index into a browser bundle, " +
				"and the index reaches `node:fs` and `node:child_process` — the bundle then throws on the " +
				"first Node built-in and the window is blank. Types are erased at compile time and cost " +
				"nothing. The listed sub-entries are the ones written to be browser-safe.",
			severity: "error",
			from: { path: "^packages/desktop/src" },
			to: {
				path: "^packages/core/src",
				pathNot:
					"^packages/core/src/(types|tokens|activity|trajectory-view|commands-view|platform)\\.ts$" +
					"|^packages/core/src/(config/schedule|plugins/install-record|ai/thinking-options)\\.ts$",
				dependencyTypesNot: ["type-only"],
			},
		},

		{
			name: "renderer-does-not-reach-into-main",
			comment:
				"The renderer talks to the main process over IPC and nowhere else. Types crossing that " +
				"boundary are fine — `ipc-types.ts` is the description of it — but a value would be a " +
				"module from the other process linked into this bundle.",
			severity: "error",
			from: { path: "^packages/desktop/src" },
			to: { path: "^packages/desktop/electron/", dependencyTypesNot: ["type-only"] },
		},

		{
			name: "mobile-stays-off-node",
			comment:
				"Metro has no `node:` builtins. An import that reaches one fails at bundle time on a good " +
				"day and at launch on a bad one — `src/protocol.ts` exists as a hand-copy precisely to " +
				"avoid dragging core's `node:fs` into the phone.",
			severity: "error",
			from: { path: "^packages/mobile/(src|app)" },
			to: { path: "^packages/(core|desktop)/", dependencyTypesNot: ["type-only"] },
		},

		{
			name: "relay-has-no-dependencies",
			comment:
				"The relay is a single file with no runtime dependencies, deployed on someone's server. " +
				"That is its whole security story: it forwards bytes between two sockets and knows " +
				"nothing else. An import from the workspace would end that.",
			severity: "error",
			from: { path: "^packages/relay/" },
			to: { path: "^packages/(core|desktop|mobile|agent-cli)/" },
		},

		{
			name: "shared-belongs-to-neither",
			comment:
				"`shared/` is what both processes own — the tables they have to agree on. It reaches " +
				"neither of them, and nothing platform-specific: the moment it imports Electron the " +
				"renderer cannot have it, and the moment it imports the renderer the main process " +
				"cannot.",
			severity: "error",
			from: { path: "^packages/desktop/shared/" },
			to: { path: "^packages/desktop/(src|electron)/" },
		},

		{
			name: "no-orphans",
			comment: "A module nobody imports is either dead or was meant to be wired up and was not.",
			severity: "warn",
			from: {
				orphan: true,
				pathNot: [
					"\\.d\\.ts$",
					"(^|/)(index|main|preload)\\.tsx?$",
					"^packages/[^/]+/(test|e2e)/",
					"^packages/desktop/(electron\\.vite\\.config|scripts)",
					"^packages/mobile/app/",
					"^scripts/",
					"\\.(config|conf)\\.(ts|js|cjs|mjs)$",
				],
			},
			to: {},
		},
	],

	options: {
		doNotFollow: { path: "node_modules" },
		/*
		 * `specify` is what makes the type-only rules above possible: without it every import looks
		 * the same to the cruiser, and "types are free, values are not" cannot be expressed at all.
		 */
		tsPreCompilationDeps: "specify",
		tsConfig: { fileName: "tsconfig.base.json" },
		enhancedResolveOptions: {
			exportsFields: ["exports"],
			conditionNames: ["import", "require", "default", "types"],
			extensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"],
			mainFields: ["module", "main", "types"],
		},
		exclude: { path: "node_modules|\\.d\\.ts$|packages/desktop/out/" },
		reporterOptions: {
			dot: { collapsePattern: "^packages/[^/]+/(src|electron|app)/[^/]+" },
			archi: { collapsePattern: "^packages/[^/]+/(src|electron|app)/[^/]+" },
		},
	},
};
