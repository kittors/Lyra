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
import { FOREIGN_PROVIDERS } from "./providers/foreign.ts";
import { nativeProvider } from "./providers/native.ts";
import type { CapabilityProvider } from "./types.ts";

export { CapabilityRegistry } from "./registry.ts";
export * from "./types.ts";

/** Every provider that ships, highest priority first. */
export const BUILTIN_PROVIDERS: CapabilityProvider[] = [
	nativeProvider,
	claudeProvider,
	...(FOREIGN_PROVIDERS as CapabilityProvider[]),
	builtinProvider,
];

export function createRegistry(deps: RegistryDeps): CapabilityRegistry {
	const registry = new CapabilityRegistry(deps);
	for (const provider of BUILTIN_PROVIDERS) registry.register(provider);
	return registry;
}
