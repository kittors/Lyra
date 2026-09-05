/**
 * The registry: run every provider, merge what they found, and be able to say why.
 *
 * The whole of the interesting behaviour is in `load`, and it is short because the hard parts are
 * decisions rather than code:
 *
 *   A provider that throws must not take the others down. Discovery walks other people's
 *   directories, and one of them will eventually be a broken symlink or a file the user cannot
 *   read. The failure becomes a diagnostic and the rest of the load proceeds.
 *
 *   Dropping an item and suppressing one are different operations. Both remove it from the
 *   result; only one lets a lower-priority item of the same name take its place. Conflating them
 *   is how switching off a project skill silently promotes your personal one.
 *
 *   Losers are kept. A settings page that can only show what won cannot answer the question people
 *   actually ask, which is why the thing they wrote is not running.
 */

import { capabilityOf } from "./kinds.ts";
import type {
	Capability,
	CapabilityId,
	CapabilityProvider,
	CapabilityResult,
	Diagnostic,
	DiscoveryContext,
	LoadOptions,
	ProviderId,
	ProviderInfo,
	SourceMeta,
	Sourced,
} from "./types.ts";

export type Disposer = () => void;

export interface RegistryDeps {
	/** Lyra's configuration root. */
	home: string;
	/** The operating system's home directory. */
	userHome: string;
	/** Resolve the repository root for a working directory, if there is one. */
	repoRoot?(cwd: string): Promise<string | null> | string | null;
	/**
	 * Override how a kind is keyed and validated.
	 *
	 * The shipped table is the answer for the shipped kinds. This exists so that a test can put a
	 * validator on a kind that has none — otherwise the rejection path is unreachable from outside
	 * and would be pinned only by tests that assert nothing.
	 */
	capabilities?: Partial<Record<CapabilityId, Capability<never>>>;
}

const TRACE = process.env.LYRA_TRACE === "capability";

export class CapabilityRegistry {
	private readonly providers: CapabilityProvider[] = [];
	private readonly deps: RegistryDeps;

	constructor(deps: RegistryDeps) {
		this.deps = deps;
	}

	register(provider: CapabilityProvider): Disposer {
		if (this.providers.some((p) => p.id === provider.id)) {
			throw new Error(`Capability provider "${provider.id}" is already registered.`);
		}
		this.providers.push(provider);
		/*
		 * Sort on insert rather than on load. Load happens per session and per kind; registration
		 * happens once. Doing it here also makes the order a property of the list rather than of
		 * whoever called load, which matters for the tie-break: equal priorities keep registration
		 * order, and that is the documented way `LYRA.md` beats `AGENTS.md`.
		 */
		this.providers.sort((a, b) => b.priority - a.priority);
		return () => {
			const at = this.providers.indexOf(provider);
			if (at >= 0) this.providers.splice(at, 1);
		};
	}

	providersFor(kind?: CapabilityId): ProviderInfo[] {
		return this.providers
			.filter((p) => !kind || p.supplies.includes(kind))
			.map((p) => ({
				id: p.id,
				label: p.label,
				describe: p.describe,
				priority: p.priority,
				supplies: p.supplies,
				foreign: p.foreign === true,
			}));
	}

	async load<T>(kind: CapabilityId, options: LoadOptions<T>): Promise<CapabilityResult<T>> {
		const started = Date.now();
		const capability = this.deps.capabilities?.[kind] ?? capabilityOf(kind);
		const diagnostics: Diagnostic[] = [];
		const timings: CapabilityResult<T>["timings"] = [];
		const watched = new Set<string>();

		const selected = this.providers.filter((provider) => {
			if (!provider.supplies.includes(kind)) return false;
			if (options.only) return options.only.has(provider.id);
			return !options.disabledProviders?.has(provider.id);
		});

		const repoRoot = options.cwd ? ((await this.deps.repoRoot?.(options.cwd)) ?? null) : null;

		/*
		 * Providers run in parallel and are awaited together, so one slow directory walk does not
		 * serialise behind another. They are independent by construction — a provider is handed a
		 * context and returns items, with nothing shared — so the only ordering that matters is the
		 * priority order applied to the results, below.
		 */
		const results = await Promise.all(
			selected.map(async (provider) => {
				const at = Date.now();
				const ctx: DiscoveryContext = {
					cwd: options.cwd,
					home: this.deps.home,
					userHome: this.deps.userHome,
					repoRoot,
					/*
					 * Naming a provider explicitly turns its user-level directory on. The reason to
					 * ask for `cursor` by name is to look at Cursor's configuration, and the opt-out
					 * exists to stop it applying by surprise, not to stop it being asked for.
					 */
					userSourceEnabled:
						provider.foreign !== true || options.only?.has(provider.id) === true || options.enabledUserSources?.has(provider.id) === true,
					signal: options.signal,
				};
				try {
					const result = await provider.load(kind, ctx);
					timings.push({ provider: provider.id, ms: Date.now() - at, count: result.items.length });
					for (const dir of result.watched ?? []) watched.add(dir);
					if (result.diagnostics) diagnostics.push(...result.diagnostics);
					return { provider, items: result.items as Sourced<T>[] };
				} catch (error) {
					/*
					 * A provider that throws is a bug in that provider, and the rest of the load is
					 * still worth having. The diagnostic names the provider because otherwise the
					 * only visible symptom is a capability that quietly stopped existing.
					 */
					timings.push({ provider: provider.id, ms: Date.now() - at, count: 0 });
					diagnostics.push({
						path: provider.id,
						message: `来源“${provider.label}”加载 ${kind} 时失败：${error instanceof Error ? error.message : String(error)}`,
						severity: "error",
						hint: "其余来源不受影响；这一个的条目这次没有加载。",
					});
					return { provider, items: [] as Sourced<T>[] };
				}
			}),
		);

		const items: Sourced<T>[] = [];
		const all: CapabilityResult<T>["all"] = [];
		const contributors = new Set<ProviderId>();
		/** key → the source that won it, so a loser can point at the winner. */
		const owners = new Map<string, SourceMeta>();
		/** Items that hold their key without appearing, for `equivalent` comparisons. */
		const held: Sourced<T>[] = [];

		for (const { provider, items: found } of results) {
			for (const item of found) {
				if (!item?.provenance) {
					diagnostics.push({
						path: provider.id,
						message: `来源“${provider.label}”返回了一个没有 provenance 的条目，已丢弃。`,
						severity: "error",
					});
					continue;
				}
				contributors.add(provider.id);

				const itemId = capability.itemId?.(item as never);
				/*
				 * `disabledItems` and `exclude` drop the item without holding its key, so a
				 * lower-priority item of the same name moves up. `suppress` holds the key.
				 */
				if (itemId && options.disabledItems?.has(itemId)) continue;
				if (options.exclude?.(item)) continue;

				const key = capability.key(item as never);
				const suppressed = options.suppress?.(item) === true;

				if (key !== undefined) {
					const owner = owners.get(key);
					const asked = options.preferred?.get(`${kind}:${key}`) === item.provenance.path;
					if (owner && !asked) {
						all.push({ ...item, shadowedBy: owner });
						continue;
					}
					if (owner && asked) {
						/*
						 * The user named this file. Providers arrive in priority order, so the holder
						 * is already filed as the winner: take it back out, file it as beaten by this
						 * one, and repoint every loser that was told the old holder had won.
						 */
						const demote = (list: Sourced<T>[]) => {
							const at = list.findIndex((existing) => capability.key(existing as never) === key);
							if (at === -1) return;
							const [beaten] = list.splice(at, 1);
							const shown = all.indexOf(beaten);
							if (shown !== -1) all.splice(shown, 1);
							all.push({ ...beaten, shadowedBy: item.provenance });
						};
						demote(items);
						demote(held);
						for (const entry of all) {
							if (entry.shadowedBy && capability.key(entry as never) === key) entry.shadowedBy = item.provenance;
						}
					}
					const twin = [...items, ...held].find((existing) => capability.equivalent?.(existing as never, item as never));
					if (twin) {
						all.push({ ...item, shadowedBy: twin.provenance });
						continue;
					}
					owners.set(key, item.provenance);
				}

				if (suppressed) {
					held.push(item);
					all.push(item);
					continue;
				}

				const invalid = capability.validate?.(item as never);
				if (invalid) {
					/*
					 * A rejected item still holds its key. It was found, it has that name, and
					 * letting a lower-priority one take its place would answer "why is my broken
					 * skill not running" with a different skill running instead.
					 */
					diagnostics.push({ path: item.provenance.path, message: invalid, severity: "error" });
					all.push(item);
					continue;
				}

				items.push(item);
				all.push(item);
			}
		}

		if (TRACE) {
			const slow = [...timings].sort((a, b) => b.ms - a.ms);
			console.error(`[capability] ${kind}: ${Date.now() - started}ms  ${slow.map((t) => `${t.provider}=${t.ms}ms/${t.count}`).join(" ")}`);
		}

		return {
			items,
			all,
			diagnostics,
			contributors: [...contributors],
			watched: [...watched],
			elapsedMs: Date.now() - started,
			timings,
		};
	}
}
