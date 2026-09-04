import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { McpServerConfig } from "../mcp/client.ts";
import { lyraHome } from "../session/store.ts";
import type { ProviderConfig, ThinkingLevel } from "../types.ts";
import { keepSecrets, putSecrets, secret } from "./vault.ts";

/** How much the agent may do without stopping to ask. */
export type PermissionMode =
	/** Ask before every mutating tool. */
	| "ask"
	/** Ask only for commands that are not recognised as read-only. */
	| "auto"
	/** Never ask. */
	| "full";

export interface ProjectEntry {
	id: string;
	name: string;
	path: string;
	pinned: boolean;
	lastOpenedAt: number;
}

/** Everything the appearance page controls. Applied as CSS variables at runtime. */
export interface AppearanceSettings {
	theme: "system" | "light" | "dark";
	/** Accent colour, shared by both schemes. */
	accent: string;
	lightBackground: string;
	lightForeground: string;
	darkBackground: string;
	darkForeground: string;
	uiFont: string;
	codeFont: string;
	/** Syntax highlighting theme for light mode. */
	codeLightTheme?: string;
	/** Syntax highlighting theme for dark mode. */
	codeDarkTheme?: string;
	uiFontSize: number;
	codeFontSize: number;
	/**
	 * How code is set, beyond which family it is in.
	 *
	 * A monospace face is only half of what makes code readable; the rest is how tightly it is
	 * packed. Weight matters most on a dark theme, where a light face thins out and a 500 reads as
	 * the 400 does on white. Line height is the difference between a diff you can scan and a wall.
	 * Tracking is the smallest of the three and the one people with a particular face in mind ask
	 * for first.
	 *
	 * Optional, so an existing settings file keeps the values it never had — the defaults below are
	 * what the app has been rendering all along.
	 */
	codeFontWeight?: number;
	/** A multiplier, not pixels: it has to hold at every one of the font sizes above. */
	codeLineHeight?: number;
	/** In `em`, so it tracks the font size rather than fighting it. */
	codeLetterSpacing?: number;
	/** 0–100. Scales the distance between surface layers and text. */
	contrast: number;
	/**
	 * How wide the conversation column may get, in pixels. `0` means "as wide as the window".
	 *
	 * A measure is a reading decision, not a layout constant: 640px is close to the line length
	 * prose is easiest to read at, and it is also the width at which a wide table in a reply gets
	 * cut off and a 27" display shows two empty margins wider than the text between them. Which of
	 * those matters more depends on what someone spends their day reading, so it is theirs to say.
	 *
	 * Every column that is part of the conversation reads this — the transcript, the composer, the
	 * approval card — so they cannot drift apart. Optional: a settings file written before this
	 * existed keeps the 640 it has always rendered at.
	 */
	contentWidth?: number;
	pointerCursor: boolean;
	reduceMotion: "system" | "on" | "off";
	/** Whether diffs are shown by colour or by leading +/- markers. */
	diffMarkers: "color" | "symbols";
	fontSmoothing: boolean;
	/**
	 * How much of a failed turn is shown in the transcript.
	 *
	 * `full` states the error where it happened, alongside the way to undo it. `compact` reduces it
	 * to a single line that opens on demand. The failures that dominate a long session are dropped
	 * sockets and provider hiccups — the wording is a stack of JSON nobody reads, and at full weight
	 * a morning's work reads as a wall of red for something that resolved itself on the retry.
	 */
	errorDetail?: "full" | "compact";
}

export const DEFAULT_APPEARANCE: AppearanceSettings = {
	theme: "dark",
	accent: "#339CFF",
	lightBackground: "#FFFFFF",
	lightForeground: "#1A1C1F",
	darkBackground: "#171717",
	darkForeground: "#EDEDED",
	uiFont: '"Inter Variable", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif',
	codeFont: '"JetBrains Mono Variable", ui-monospace, "SF Mono", SFMono-Regular, Menlo, "PingFang SC", monospace',
	// Lyra's own — see `lyra-light` in `code-themes.ts`. It takes the app's background rather than
	// bringing one, so a fresh install looks like Lyra and picking any other theme is a real choice.
	codeLightTheme: "lyra-light",
	codeDarkTheme: "lyra-dark",
	uiFontSize: 13,
	codeFontSize: 12,
	codeFontWeight: 400,
	codeLineHeight: 1.6,
	codeLetterSpacing: 0,
	contrast: 60,
	// What the app has always rendered at; see `contentWidth`.
	contentWidth: 640,
	pointerCursor: false,
	reduceMotion: "system",
	diffMarkers: "color",
	// Compact by default: the common failure is transient, and its wording is JSON.
	errorDetail: "compact",
	fontSmoothing: true,
};

/**
 * How code is printed when you ask for it to be tidied.
 *
 * Its own section rather than part of 代码外观, because the two look alike and are opposites:
 * appearance changes how the bytes on disk are drawn, and this changes the bytes. One is a
 * preference, the other edits your files.
 *
 * Every value here is a fallback. A project with a `.prettierrc` or an `.editorconfig` has
 * settled its own style, and that wins outright — see `electron/ipc/format.ts`. Otherwise a
 * personal preference set on one machine would rewrite a shared repository on every save.
 */
export interface FormattingSettings {
	/** Format on ⌘S as well as on the explicit shortcut. Off by default: saving should be cheap and predictable. */
	onSave: boolean;
	tabWidth: number;
	useTabs: boolean;
	printWidth: number;
	semi: boolean;
	singleQuote: boolean;
	trailingComma: "none" | "es5" | "all";
	bracketSpacing: boolean;
	arrowParens: "always" | "avoid";
}

export const DEFAULT_FORMATTING: FormattingSettings = {
	onSave: false,
	tabWidth: 2,
	useTabs: true,
	printWidth: 120,
	semi: true,
	singleQuote: false,
	trailingComma: "all",
	bracketSpacing: true,
	arrowParens: "always",
};

export interface HookConfig {
	id: string;
	/** Shell command run at the hook point. */
	command: string;
	/** Only fire for these tool names; empty means every tool. */
	tools: string[];
	event: "before-tool" | "after-tool";
	enabled: boolean;
	/** A non-zero exit from a before-tool hook blocks the call. */
	blocking: boolean;
}

/** A prompt the app sends on its own schedule, in a fresh session each time. */
export interface ScheduledTask {
	id: string;
	name: string;
	/** Workspace the task runs in. */
	cwd: string;
	prompt: string;
	schedule: { kind: "interval"; minutes: number } | { kind: "daily"; time: string };
	enabled: boolean;
	lastRunAt?: number;
	lastSessionId?: string;
	lastError?: string;
}

export interface ScreenshotSettings {
	/** Global shortcut to trigger screen capture. e.g. "CommandOrControl+Shift+S" or "Alt+A". */
	shortcut?: string;
	/** Directory where screenshots are saved. If empty, saves to ~/Desktop or scratch directory. */
	saveLocation?: string;
	/** Whether to show the screenshot button in the composer input area (default false). */
	showInComposer?: boolean;
	/** Whether to automatically copy the screenshot image to clipboard after capture. */
	copyToClipboard?: boolean;
	/** Whether to automatically insert the captured screenshot into the active composer. */
	insertIntoComposer?: boolean;
	/** Action after capture: open the annotator/editor, or just save/copy quietly. */
	openEditor?: boolean;
}

export const DEFAULT_SCREENSHOT_SETTINGS: ScreenshotSettings = {
	shortcut: "Alt+A",
	saveLocation: "",
	showInComposer: false,
	copyToClipboard: true,
	insertIntoComposer: false,
	openEditor: true,
};

export interface Settings {
	/**
	 * Keys for the search services that want one.
	 *
	 * Optional throughout: search works without any of them through the keyless provider, and a key
	 * is an upgrade rather than a prerequisite. Read at call time so pasting one in takes effect
	 * without a restart.
	 */
	searchApiKeys?: { tavily?: string; exa?: string; brave?: string };
	/** Which search provider to use when more than one is usable. */
	searchProvider?: string | null;
	/**
	 * Internal hosts the agent may reach, named one at a time.
	 *
	 * Private addresses are refused rather than asked about, because a prompt showing
	 * `169.254.169.254` is a question almost nobody can answer. Somebody who genuinely runs a
	 * service on their own network needs a way to say so — and this is it: a decision made once,
	 * while thinking about it, rather than mid-turn.
	 *
	 * Matched by hostname. It cannot open a private address reached through a public name, which
	 * is the shape of an attack rather than a configuration anybody intends.
	 */
	allowedHosts?: string[];
	version: 1;
	providers: ProviderConfig[];
	mcpServers: McpServerConfig[];
	projects: ProjectEntry[];
	/** Pinned session IDs across projects and loose chats. */
	pinnedSessionIds?: string[];
	/** Worktrees configuration and auto-cleanup preferences. */
	worktrees?: {
		/** Managed worktrees root directory. Defaults to ~/.lyra/worktrees or sibling directory if empty. */
		rootDir?: string;
		/** Automatically create a dedicated worktree when starting a new session. */
		autoCreateOnNewSession?: boolean;
		/** Automatically fetch upstream remotes before creating a worktree. */
		fetchUpstreamBeforeCreate?: boolean;
		/** Auto clean unlinked or old worktrees exceeding limit or session deletion. */
		autoCleanOld?: boolean;
		/** Number of managed worktrees to retain before oldest are pruned. */
		keepLimit?: number;
	};
	/** Update check frequency in hours (e.g. 4, 8, 12, 24). Default is 6. */
	updateCheckIntervalHours?: number;
	/** `${providerId}/${modelId}` of the model used for new sessions. */
	defaultModelId: string | null;
	/**
	 * Models pinned to the top of the picker, in the order they were starred.
	 *
	 * A relay can serve thirty models and most people use three. Ordering the list by anything
	 * automatic — recency, frequency — makes the position of a row depend on what you did last,
	 * which is the one thing a list you aim at by muscle memory must not do. So it is stated
	 * rather than inferred, and it is stated once.
	 *
	 * Ids that no longer resolve are ignored rather than pruned: a provider switched off for the
	 * afternoon should not silently empty the shortlist.
	 */
	favoriteModelIds?: string[];
	permissionMode: PermissionMode;
	thinking: ThinkingLevel;
	/**
	 * Attempts per model request, including the first.
	 *
	 * Only the connection is retried — a stream already delivering text never is. Worth raising
	 * on a flaky relay, worth setting to 1 when you would rather see failures immediately.
	 *
	 * Five by default rather than three. A relay that has run out of credentials for a model
	 * answers 503 with a reset time just under a minute, and the waits are spaced to sit that out
	 * (see `ai/retry`) — at three attempts the budget ran out well before the outage did, and a
	 * turn that had already spent a minute reading files died for a wait it could have survived.
	 */
	retryAttempts: number;
	/** Last level chosen above "off", restored when fast mode is switched back off. */
	lastThinking?: ThinkingLevel;
	/**
	 * Language the Git panel's AI commit message is written in.
	 *
	 * Global, not per-repository: switching projects must not forget that you asked for English.
	 * A BCP-47-ish id (`zh`, `en`, `ja`, …); unknown values fall back to Chinese.
	 */
	commitLanguage?: string;
	appearance: AppearanceSettings;
	formatting: FormattingSettings;
	hooks: HookConfig[];
	scheduledTasks: ScheduledTask[];
	/**
	 * Plugin ids that are switched off; everything found on disk is on by default.
	 *
	 * `*` is a sentinel meaning "none of them", for a session that has to be reproducible and
	 * therefore cannot inherit whatever happens to be installed. It is not an id, and the settings
	 * page clears it when a plugin is switched back on.
	 */
	disabledPlugins: string[];
	/**
	 * Rules switched off by name, built-in or discovered.
	 *
	 * By name rather than by path so that turning one off survives it moving between `.lyra/rules`
	 * and, say, `.cursor/rules` — the user turned off an idea, not a file.
	 */
	disabledRules: string[];
	/**
	 * How many sub-agents may run at once. Beyond this they queue.
	 *
	 * A limit rather than a refusal, because wanting to look at eight things is a reasonable thought
	 * and running eight at once is what is not — each carries its own context and its own model
	 * calls. The number reaches the prompt too: a queue is invisible from the inside, and a model
	 * that reads the wait as slowness responds by dispatching more.
	 */
	maxConcurrentSubAgents: number;
	/**
	 * Which model answers to `@fast`, `@deep` and `@review`.
	 *
	 * Lets a sub-agent definition name what it needs rather than a specific model — the definition
	 * then works on a machine with a different set of providers, which is what makes one shareable
	 * at all. Empty entries fall through to the session's own model.
	 */
	modelRoles?: Partial<Record<"default" | "fast" | "deep" | "review", string>>;
	/**
	 * Plugin registry index URLs the user has added, browsed from the plugins page.
	 *
	 * Ours is preset. The argument against shipping one was that it would point at a collection
	 * whose contents we neither control nor can promise will stay — true of somebody else's list,
	 * and not of the registry maintained alongside this app, whose entries are rebuilt from their
	 * upstreams every day. A fresh install with no sources at all is an empty shop with no way to
	 * know a shop exists.
	 */
	pluginRegistries: string[];
	/**
	 * Where skill collections are listed.
	 *
	 * Separate from `pluginRegistries` because they are separate questions with separate answers: a
	 * plugin index says what to clone and how to run it, a skill index says which folders of
	 * `SKILL.md` a repository holds. Merging them would mean every consumer of either list first
	 * asking which sort of entry it was looking at.
	 */
	skillRegistries: string[];
	/** Rules the user chose to always allow, keyed by tool kind. */
	alwaysAllow: string[];
	sync: {
		enabled: boolean;
		port: number;
		/** Shared secret a mobile client presents to pair. Regenerated on demand. */
		token: string | null;
		/**
		 * Where the phone should be told to connect, when that is not a LAN address.
		 *
		 * The addresses this machine can enumerate are the ones it holds itself, and none of them
		 * mean anything to a phone on mobile data or on the other side of a NAT. Someone reaching
		 * this desktop through a reverse proxy, a tunnel or a port forward knows the name it answers
		 * to and this machine cannot; it is the one fact about the connection that has to be typed.
		 *
		 * A host, optionally with a scheme and a port — `lyra.example.com`, `https://lyra.example.com`,
		 * `203.0.113.9:8443`. Empty means pair over the LAN, which is the ordinary case.
		 */
		publicUrl?: string;
		/**
		 * The relay to reach this desktop through when neither side can hear the other.
		 *
		 * Distinct from `publicUrl`, which assumes something out there already routes to this
		 * machine. A relay assumes nothing: the desktop dials *out* to it and the phone dials out
		 * to it too, so it works from behind the kind of NAT that has no port to forward. Empty
		 * means no relay, and the pairing code carries a LAN or public address instead.
		 */
		relayUrl?: string;
	};
	editor: {
		defaultOpenTarget: string;
		showBottomPanel: boolean;
	};
	screenshot?: ScreenshotSettings;
	/**
	 * Personalization & custom instructions settings across all sessions.
	 */
	personalization?: {
		/** Custom instructions injected into system prompt for all sessions. */
		customInstructions?: string;
		/** Whether to enable persistent local memory extraction. */
		enableMemory?: boolean;
		/** Whether memory extraction considers MCP tools and search conversations. */
		enableToolAssistedMemory?: boolean;
		/** Tone/personality preference for agent replies. */
		tone?: "friendly" | "professional" | "concise" | "candid" | "humorous";
	};
}

/**
 * Where the preset sources point.
 *
 * The registry is a platform now rather than a JSON file in a git repository, and the difference
 * shows up in three places a user notices: it is not `raw.githubusercontent.com`, which returns 429
 * often enough that the marketplace used to fail to load; its entries carry a built archive and a
 * SHA-256, so installing is a verified download rather than a clone that depends on the upstream
 * being reachable; and it counts what is inside each bundle, so the catalogue can say how many
 * skills something has before it is installed.
 *
 * The path is `/v1/index` because that endpoint answers in the *old* file format. A copy of the app
 * that predates any of this can be pointed here and simply work.
 */
const REGISTRY_ORIGIN = "https://market.07230805.xyz";

/**
 * Where the platform answered before it had a domain of its own.
 *
 * Still live, and deliberately so: the address is written into every existing user's settings file,
 * and a `workers.dev` subdomain that stops resolving on the day the real one appears would empty
 * their marketplace before their copy of the app has had a chance to rewrite the setting. The
 * Worker serves both; this is only here to move people off it.
 */
const WORKERS_DEV_ORIGIN = "https://lyra-registry.gj7nrhnb9j.workers.dev";

/** Plugins and MCP servers. */
export const DEFAULT_PLUGIN_REGISTRY = `${REGISTRY_ORIGIN}/v1/index`;

/** The same catalogue's skill collections, which the app configures as a separate source. */
export const DEFAULT_SKILL_REGISTRY = `${REGISTRY_ORIGIN}/v1/index?kind=skill`;

/**
 * Sources that were preset by an older version and should move with it.
 *
 * A user who never touched the setting is still pointed at wherever that version pointed — leaving
 * them there means an address change ships and nobody gets it. Only these exact strings are
 * replaced; anything a user added themselves is theirs.
 *
 * Two generations of preset are listed. The `raw.githubusercontent.com` pair is the file-based
 * index that used to get rate-limited; the `workers.dev` pair is the platform before it had a
 * domain. Both still resolve, so nothing breaks for someone who never launches the new version —
 * this only spares them from browsing a catalogue at an address that is no longer the real one.
 */
export const SUPERSEDED_REGISTRIES: Record<string, string> = {
	"https://raw.githubusercontent.com/kittors/Lyra-Plugins/main/registry.json": DEFAULT_PLUGIN_REGISTRY,
	"https://raw.githubusercontent.com/kittors/Lyra-Plugins/main/skills.json": DEFAULT_SKILL_REGISTRY,
	[`${WORKERS_DEV_ORIGIN}/v1/index`]: DEFAULT_PLUGIN_REGISTRY,
	[`${WORKERS_DEV_ORIGIN}/v1/index?kind=skill`]: DEFAULT_SKILL_REGISTRY,
};

/** Rewrite the preset sources in a stored list, leaving everything else alone. */
export function migrateRegistries(urls: string[]): string[] {
	const moved = urls.map((url) => SUPERSEDED_REGISTRIES[url] ?? url);
	// A user who had both the old and the new would otherwise end up with the new one twice.
	return [...new Set(moved)];
}

export const DEFAULT_SETTINGS: Settings = {
	version: 1,
	providers: [],
	mcpServers: [],
	projects: [],
	defaultModelId: null,
	permissionMode: "auto",
	thinking: "medium",
	commitLanguage: "zh",
	retryAttempts: 5,
	appearance: DEFAULT_APPEARANCE,
	formatting: DEFAULT_FORMATTING,
	hooks: [],
	scheduledTasks: [],
	disabledPlugins: [],
	disabledRules: [],
	maxConcurrentSubAgents: 4,
	modelRoles: {},
	pluginRegistries: [DEFAULT_PLUGIN_REGISTRY],
	skillRegistries: [DEFAULT_SKILL_REGISTRY],
	alwaysAllow: [],
	sync: { enabled: false, port: 4517, token: null },
	editor: { defaultOpenTarget: "Zed", showBottomPanel: true },
	screenshot: DEFAULT_SCREENSHOT_SETTINGS,
	searchApiKeys: {},
	allowedHosts: [],
	personalization: {
		customInstructions: "",
		enableMemory: true,
		enableToolAssistedMemory: true,
		tone: "friendly",
	},
};

export function settingsPath(): string {
	return join(lyraHome(), "settings.json");
}

/** Where a provider's key is filed in the vault. */
const providerSecretId = (providerId: string): string => `provider:${providerId}`;

/**
 * Put the API keys back on the providers, from the vault.
 *
 * The rest of the app reads `provider.apiKey` and always has; keeping that true means the change
 * of where the key is *stored* stops at this file rather than reaching every request builder and
 * settings pane. What comes off disk has an empty `apiKey`, and this fills it in.
 *
 * A key still sitting in `settings.json` is honoured rather than ignored — that is what every
 * install written by an earlier build looks like, and refusing it would log everyone out of their
 * model providers to fix a problem about writing them down. `saveSettings` moves it on the next
 * write; `migrateSecrets` moves it without waiting for one.
 */
async function withKeys(settings: Settings): Promise<Settings> {
	if (settings.providers.length === 0) return settings;
	const providers = await Promise.all(
		settings.providers.map(async (provider) => {
			const stored = await secret(providerSecretId(provider.id));
			// `stored` wins: it is the newer of the two whenever both exist.
			return stored === null ? provider : { ...provider, apiKey: stored };
		}),
	);
	return { ...settings, providers };
}

export async function loadSettings(): Promise<Settings> {
	return withKeys(await readSettingsFile());
}

/**
 * The settings a particular project sees: the global file with `<cwd>/.lyra/config.json` over it.
 *
 * Separate from `loadSettings` rather than folded into it, because most callers have no project —
 * the settings page, a migration, the CLI before a directory is chosen — and giving them a `cwd`
 * they do not have would be inventing one.
 *
 * The project layer cannot carry credentials or providers (`sanitizeProjectConfig`): that file is
 * checked into the repository, so anything in it is shared with everyone who clones it.
 */
export async function loadSettingsFor(cwd: string | null): Promise<{ settings: Settings; refused: string[]; error?: string }> {
	const global = await loadSettings();
	if (!cwd) return { settings: global, refused: [] };

	const { loadProjectLayer, mergeLayer } = await import("./layers.ts");
	const project = await loadProjectLayer(cwd);
	if (Object.keys(project.config).length === 0) {
		return { settings: global, refused: project.refused, error: project.error };
	}

	/*
	 * Merged as data and then re-normalised, rather than assigned field by field.
	 *
	 * `normalizeSettings` is where every bound and fallback lives — a project setting
	 * `maxConcurrentSubAgents: 500` has to meet the same ceiling a global one does, and a field-by-
	 * field merge would be a second place those rules have to be kept in step.
	 */
	const merged = mergeLayer(global as unknown as Record<string, unknown>, project.config);
	return { settings: normalizeSettings(merged), refused: project.refused, error: project.error };
}

/**
 * Settings exactly as written, with whatever `apiKey` the file happens to hold.
 *
 * Separate from `loadSettings` because the migration needs to see the plaintext that is still on
 * disk, and because `saveSettings` needs to compare against what was there without the vault's
 * answer masking it.
 */
async function readSettingsFile(): Promise<Settings> {
	const raw = await readFile(settingsPath(), "utf8").catch(() => null);
	if (!raw) return { ...DEFAULT_SETTINGS };
	try {
		return normalizeSettings(JSON.parse(raw) as Partial<Settings>);
	} catch {
		return { ...DEFAULT_SETTINGS };
	}
}

/**
 * A settings object as written, brought up to the shape the app expects.
 *
 * Split out of `readSettingsFile` so that every layer goes through it. A project's
 * `.lyra/config.json` setting `maxConcurrentSubAgents: 500` has to meet the same ceiling a global
 * one does, and merging layers field by field would put those bounds in a second place that has to
 * be kept in step with this one.
 */
export function normalizeSettings(parsed: Partial<Settings>): Settings {
		// Merge against defaults so a settings file written by an older build keeps working.
		return {
			...DEFAULT_SETTINGS,
			...parsed,
			sync: { ...DEFAULT_SETTINGS.sync, ...parsed.sync },
			editor: { ...DEFAULT_SETTINGS.editor, ...parsed.editor },
			screenshot: { ...DEFAULT_SCREENSHOT_SETTINGS, ...parsed.screenshot },
			personalization: { ...DEFAULT_SETTINGS.personalization, ...parsed.personalization },
			appearance: migrateAppearance({ ...DEFAULT_APPEARANCE, ...parsed.appearance }),
			// Merged rather than taken whole, so a settings file written before this section existed
			// gains the new keys instead of arriving with `undefined` where a number is expected.
			formatting: { ...DEFAULT_FORMATTING, ...parsed.formatting },
			hooks: parsed.hooks ?? [],
			scheduledTasks: parsed.scheduledTasks ?? [],
			disabledPlugins: parsed.disabledPlugins ?? [],
			disabledRules: parsed.disabledRules ?? [],
			maxConcurrentSubAgents:
				typeof parsed.maxConcurrentSubAgents === "number" && parsed.maxConcurrentSubAgents >= 1
					? Math.min(16, Math.floor(parsed.maxConcurrentSubAgents))
					: 4,
			modelRoles:
				parsed.modelRoles && typeof parsed.modelRoles === "object"
					? Object.fromEntries(
							Object.entries(parsed.modelRoles as Record<string, unknown>).filter(
								([key, value]) => ["default", "fast", "deep", "review"].includes(key) && typeof value === "string" && value,
							),
						)
					: {},
			/*
			 * A missing list gets the default; an empty one is left empty.
			 *
			 * The two are different intentions written the same way in JSON, and only one of them is
			 * the user's: never having been asked, versus having removed every source deliberately.
			 * `??` distinguishes them exactly.
			 */
			/*
			 * Read through the rename, so an existing install moves off the file-based index.
			 *
			 * Anyone who never touched this setting is still pointed at `raw.githubusercontent.com`,
			 * which is the address that returns 429 — shipping the replacement without this would mean
			 * the fix reaches only new installs. Only the two strings we ourselves preset are rewritten;
			 * see `SUPERSEDED_REGISTRIES`.
			 */
			pluginRegistries: migrateRegistries(parsed.pluginRegistries ?? [DEFAULT_PLUGIN_REGISTRY]),
			skillRegistries: migrateRegistries(parsed.skillRegistries ?? [DEFAULT_SKILL_REGISTRY]),
			providers: parsed.providers ?? [],
			mcpServers: parsed.mcpServers ?? [],
			projects: parsed.projects ?? [],
			alwaysAllow: parsed.alwaysAllow ?? [],
		};
}

/**
 * Font stacks that were once the default, and are no longer.
 *
 * Settings are written out in full, so every existing install has the old system stack recorded
 * as if it had been chosen deliberately — a new default would never reach anyone. Anything still
 * holding a value this list knows about is taken to have never made a choice, and moves on.
 * A stack the user actually typed is not in the list, and stays.
 */
const SUPERSEDED_FONTS: Record<"uiFont" | "codeFont", string[]> = {
	uiFont: ['-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", sans-serif'],
	codeFont: ['ui-monospace, "SF Mono", SFMono-Regular, Menlo, monospace'],
};

/**
 * Settings that no longer exist, dropped rather than carried forever.
 *
 * The file is merged over the defaults and written back out in full, so a key nothing reads any
 * more still survives every save — and the next person to grep for it finds it live in real
 * settings files and has to work out whether it means anything. It does not.
 *
 * `translucentSidebar` turned the sidebar into macOS vibrancy. It was removed because a translucent
 * pane cannot be matched by anything opaque drawn on top of it: a pinned row has to hide the list
 * going under it, and no colour CSS can name is the colour of a pane showing the desktop through.
 * Every held row was a visible slab, and which shade of wrong depended on the wallpaper.
 */
const REMOVED_APPEARANCE = ["translucentSidebar"] as const;

export function migrateAppearance(appearance: AppearanceSettings): AppearanceSettings {
	const next = { ...appearance };
	for (const key of ["uiFont", "codeFont"] as const) {
		if (SUPERSEDED_FONTS[key].includes(next[key])) next[key] = DEFAULT_APPEARANCE[key];
	}
	for (const key of REMOVED_APPEARANCE) delete (next as Record<string, unknown>)[key];
	return next;
}

/**
 * Write the settings, with the API keys taken out of them.
 *
 * The keys go to the vault and the file gets an empty string in their place. `settings.json` is
 * the most-travelled file this app owns — it is synced to the phone, copied between machines and
 * pasted into bug reports — and it was written world-readable with every provider key in it.
 *
 * Removed providers are forgotten in the same pass. A key whose provider is gone is a secret with
 * nothing to spend it on, and leaving it behind would mean deleting a provider does not delete its
 * credential.
 */
export async function saveSettings(settings: Settings): Promise<void> {
	const keys: Record<string, string> = {};
	for (const provider of settings.providers) keys[providerSecretId(provider.id)] = provider.apiKey ?? "";
	await putSecrets(keys);
	await keepSecrets((id) => !id.startsWith("provider:") || id in keys);

	const path = settingsPath();
	await mkdir(lyraHome(), { recursive: true });
	const tmp = `${path}.${process.pid}.tmp`;
	const scrubbed: Settings = {
		...settings,
		providers: settings.providers.map((provider) => ({ ...provider, apiKey: "" })),
	};
	await writeFile(tmp, JSON.stringify(scrubbed, null, 2), "utf8");
	/*
	 * 0600, which it never was.
	 *
	 * The keys are out of it now, but what is left still describes every project on this machine
	 * and every endpoint it talks to. It was 0644 — readable by every other account on the box —
	 * for no reason other than that nothing ever set it.
	 */
	await chmod(tmp, 0o600).catch(() => {});
	await rename(tmp, path);
}

/**
 * Move any key still written in `settings.json` into the vault, once.
 *
 * `saveSettings` does this too, but only when something is saved — and somebody who never opens
 * the settings page would keep their keys in a world-readable file indefinitely. Called at
 * startup, where it is a no-op on every launch after the first.
 *
 * Returns how many were moved, which the caller logs and the tests assert on.
 */
export async function migrateSecrets(): Promise<number> {
	const onDisk = await readSettingsFile();
	const plaintext = onDisk.providers.filter((provider) => provider.apiKey);
	if (plaintext.length === 0) return 0;
	// Through `withKeys` so a provider already in the vault is not overwritten by the stale copy
	// the file still carries.
	await saveSettings(await withKeys(onDisk));
	return plaintext.length;
}

/** Find a model across all configured providers by its `${providerId}/${modelId}` id. */
export function resolveModel(settings: Settings, id: string | null) {
	if (!id) return null;
	for (const provider of settings.providers) {
		if (!provider.enabled) continue;
		const model = provider.models.find((m) => m.id === id);
		if (model) return { provider, model };
	}
	return null;
}

/** Every enabled model, flattened for the model picker. */
export function availableModels(settings: Settings) {
	return settings.providers
		.filter((p) => p.enabled)
		.flatMap((p) => p.models.map((m) => ({ provider: p, model: m })));
}
