/**
 * node-pty, loaded when the first terminal is opened rather than when the app starts.
 *
 * It was a static import at the top of `main.ts`, so loading it was part of loading the main
 * process. The Linux packages compile it on Ubuntu 24.04, where `pty.node` comes out needing
 * glibc 2.34 (`forkpty` moved into libc there); on Ubuntu 20.04, Debian 11 and RHEL 8 the dynamic
 * loader refused it, the import threw, and the app never opened a window — one native module for
 * one panel taking everything else down with it.
 *
 * Loaded here, a failure is an error from `spawn`, which `terminal-registry.ts` turns into a tab
 * that says what went wrong. A failed load is not remembered: nothing is cached until it succeeds,
 * so a fixed install does not need a restart to be noticed.
 */

import type { IPty } from "node-pty";

export type SpawnPty = (file: string, args: string[], options: Record<string, unknown>) => IPty;

export function lazyPty(load: () => { spawn: SpawnPty }, explain: (error: unknown) => string): SpawnPty {
	let loaded: { spawn: SpawnPty } | null = null;
	return (file, args, options) => {
		if (!loaded) {
			try {
				loaded = load();
			} catch (error) {
				throw new Error(explain(error), { cause: error });
			}
		}
		return loaded.spawn(file, args, options);
	};
}
