/**
 * What a capability is, where one comes from, and what happens when two of them collide.
 *
 * Before this file, adding a place to look for skills meant a new loop, a new precedence rule and
 * a new diagnostic type, written next to the four that already existed and agreeing with them only
 * by hand. Five such loops had drifted apart in exactly the ways you would expect: one reported
 * shadowing, three did it silently; two deduplicated case-sensitively and one did not; the
 * agent loader put built-ins first, which meant a custom definition of the same name could never
 * win, and nothing anywhere said so.
 *
 * The shapes here exist so that a source is a value rather than a code path.
 */

/**
 * The kinds of thing a project can contribute.
 *
 * The list is closed on purpose. A capability is a promise that something will be found, merged
 * and shadowed a particular way, and an open string type turns a typo into a capability that is
 * silently never supplied by anyone.
 */
export type CapabilityId =
	| "skill"
	| "command"
	| "rule"
	| "agent"
	| "context-file"
	| "mcp"
	| "extension"
	| "prompt"
	| "tool"
	| "hook"
	| "theme"
	| "settings"
	| "snippet"
	| "resource";

export type ProviderId = string;

/** Where an item came from. Carried on every item so that "why is this here" has an answer. */
/**
 * 一份项目指令文件：`AGENTS.md`、`CLAUDE.md`、`LYRA.md`。
 *
 * `name` 是相对仓库根的路径，`depth` 是离 cwd 几层。注册表按 `scope:depth` 去重——同一层
 * 只留一份、跨层都留，见 `kinds.ts` 里那段关于 monorepo 根 AGENTS.md 静默失效的注释。
 */
export interface ContextFile {
	name: string;
	path: string;
	content: string;
	scope: "project";
	depth: number;
}

export interface SourceMeta {
	provider: ProviderId;
	providerLabel: string;
	path: string;
	scope: "builtin" | "user" | "project";
	/**
	 * Directory distance from the working directory for project-scoped sources; the cwd itself
	 * is 0. Context files use it to keep one file per level while keeping every level.
	 */
	depth?: number;
}

export interface Diagnostic {
	path: string;
	message: string;
	severity: "error" | "warning" | "info";
	/** What to do about it, when there is something to do. */
	hint?: string;
}

/** An item with its origin attached. */
export type Sourced<T> = T & { readonly provenance: SourceMeta };

/**
 * A kind of capability: what we are looking for, and how two of them are told apart.
 */
export interface Capability<T = unknown> {
	id: CapabilityId;
	/**
	 * The deduplication key. `undefined` means this item never collides with anything — it is
	 * always kept, and never keeps anything else out.
	 */
	key(item: T): string | undefined;
	/**
	 * Different keys, same thing. Used where a rename should not produce a duplicate: the same MCP
	 * server declared under two names is one server, and connecting to it twice is a bug the user
	 * experiences as a duplicated tool list.
	 */
	equivalent?(a: T, b: T): boolean;
	/** A string here means the item is invalid: it is dropped and the string becomes a diagnostic. */
	validate?(item: T): string | undefined;
	/** A stable id for turning a single item off, e.g. `skill:pdf`. */
	itemId?(item: T): string | undefined;
}

/**
 * Everything a provider is allowed to know.
 *
 * Deliberately not the settings object. A provider that reads settings cannot be tested without
 * constructing one, and the decisions that live in settings — which providers are on, which items
 * are off — belong to the registry, which applies them uniformly instead of trusting a dozen
 * providers to each remember.
 */
export interface DiscoveryContext {
	cwd: string | null;
	/** Lyra's own configuration root (`lyraHome()`). */
	home: string;
	/** The operating system's home directory, where other tools keep their user-level config. */
	userHome: string;
	repoRoot: string | null;
	/**
	 * Whether this provider may read its user-level directory this time.
	 *
	 * Project-level directories are always read: a `.cursor/rules` checked into a repository is
	 * something the team wrote for this code. User-level ones are not, because your private Cursor
	 * rules following you into someone else's repository is a surprise nobody asked for.
	 */
	userSourceEnabled: boolean;
	signal?: AbortSignal;
}

export interface ProviderResult<T = unknown> {
	items: Sourced<T>[];
	/** Parse failures and malformed files. Returned, never thrown — one bad file is not an outage. */
	diagnostics?: Diagnostic[];
	/** Directories actually read, so that changes to them can be watched. */
	watched?: string[];
}

/**
 * A place to look.
 *
 * One provider supplies several kinds — `.claude/` holds commands and skills and instructions —
 * so `supplies` is a list and `load` is told which kind is being asked for. The alternative,
 * registering the same directory scanner once per kind, is how omp does it and means N nearly
 * identical registrations plus N walks of the same tree.
 */
export interface CapabilityProvider<T = unknown> {
	id: ProviderId;
	/** Shown in the settings UI. */
	label: string;
	/** One line saying which directories it reads. */
	describe: string;
	/** Higher loads first. 100 native · 90 plugins · 50–80 other tools · 10–40 shared conventions · 1 built-in. */
	priority: number;
	supplies: CapabilityId[];
	/** True for other tools' configuration, whose user-level directories are opt-in. */
	foreign?: boolean;
	load(kind: CapabilityId, ctx: DiscoveryContext): Promise<ProviderResult<T>>;
}

export interface LoadOptions<T = unknown> {
	cwd: string | null;
	/** Only these providers. Naming a provider also enables its user-level directory. */
	only?: ReadonlySet<ProviderId>;
	/** Providers the user switched off. */
	disabledProviders?: ReadonlySet<ProviderId>;
	/** Foreign providers whose user-level directories the user opted into. */
	enabledUserSources?: ReadonlySet<ProviderId>;
	/** Item ids the user switched off. Dropped items do NOT hold their key. */
	disabledItems?: ReadonlySet<string>;
	/**
	 * Which file should win a name, as `kind:name` → path. Written by 「改用那个」 on the settings
	 * page, where the loser of a same-name conflict is one click from becoming the winner.
	 *
	 * By path, because that is the only thing that tells two files of one name apart — provider
	 * and scope both repeat. A preference naming a path that is not among the candidates does
	 * nothing, so preferring `~/.claude/skills/pdf` changes nothing in a project with no `pdf`.
	 */
	preferred?: ReadonlyMap<string, string>;
	/**
	 * Items to drop that DO hold their key, so nothing of the same name takes their place.
	 *
	 * The distinction matters and is the reason both exist. Turning off a project skill called
	 * `deploy` should not silently promote your personal `deploy` — you switched off that name,
	 * not that file. Excluding one for an unrelated reason (it is already loaded elsewhere) should.
	 */
	suppress?: (item: Sourced<T>) => boolean;
	/** Items to drop that do NOT hold their key. */
	exclude?: (item: Sourced<T>) => boolean;
	signal?: AbortSignal;
}

export interface CapabilityResult<T = unknown> {
	/** The valid, deduplicated items in precedence order. */
	items: Sourced<T>[];
	/** Everything found, including what lost. The settings page needs the losers. */
	all: (Sourced<T> & { shadowedBy?: SourceMeta })[];
	diagnostics: Diagnostic[];
	/** Providers that actually contributed something. */
	contributors: ProviderId[];
	/** Directories worth watching for changes. */
	watched: string[];
	elapsedMs: number;
	/** Per-provider timings, for `LYRA_TRACE=capability`. */
	timings: { provider: ProviderId; ms: number; count: number }[];
}

export interface ProviderInfo {
	id: ProviderId;
	label: string;
	describe: string;
	priority: number;
	supplies: CapabilityId[];
	foreign: boolean;
}
