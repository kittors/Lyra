/**
 * The capability layer's front door: a registry with every shipped provider on it.
 *
 * Assembling the list here rather than at each call site is what makes "add a source" a one-line
 * change. The order in the array is the tie-break for equal priorities, and it is load-bearing in
 * exactly one place today — see `LYRA.md` versus `AGENTS.md` in the plan — so it is written as an
 * ordered list rather than derived from anything.
 */

import { CapabilityRegistry, type RegistryDeps } from "./registry.ts";
import { builtinProvider } from "./providers/builtin.ts";
import { claudeProvider } from "./providers/claude.ts";
import { findRepoRoot } from "./fs.ts";
import { FOREIGN_PROVIDERS } from "./providers/foreign.ts";
import { managedProvider } from "./providers/managed.ts";
export { FOREIGN_USER_SOURCES } from "./providers/foreign.ts";
import { nativeProvider } from "./providers/native.ts";
import type { CapabilityProvider } from "./types.ts";

export { CapabilityRegistry } from "./registry.ts";
export * from "./types.ts";

/** Every provider that ships, highest priority first. */
export const BUILTIN_PROVIDERS: CapabilityProvider[] = [
	nativeProvider,
	claudeProvider,
	...(FOREIGN_PROVIDERS as CapabilityProvider[]),
	managedProvider as CapabilityProvider,
	builtinProvider,
];

export function createRegistry(deps: RegistryDeps): CapabilityRegistry {
	/*
	 * `repoRoot` 给默认。
	 *
	 * 没有它，每个 provider 拿到的都是 null，而 context-file 和 `.agent(s)` 目录的
	 * 「向上遍历到仓库根」就没有可以停下的地方——要么只读 cwd 一层，要么走到 `/`。
	 * 这个默认存在之前，注册表这条路上的「向上遍历」是一句写在计划里的话。
	 */
	const registry = new CapabilityRegistry({ repoRoot: findRepoRoot, ...deps });
	for (const provider of BUILTIN_PROVIDERS) registry.register(provider);
	return registry;
}
