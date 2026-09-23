/**
 * `koffi`, loaded the one way that works in an ES module.
 *
 * The Windows sandbox called a bare `require("koffi")`, which does not exist in an ES module — not
 * in the desktop's ESM bundle, not under `node --experimental-strip-types` either. It was never
 * noticed because the runner that would have loaded it never started (see `runner-entry.ts`), so
 * the first time anything asked for the FFI it would have been `require is not defined`.
 *
 * `createRequire(import.meta.url)` resolves from wherever this code ended up — `src/` in a checkout,
 * the bundle's own directory in the app — and walks up to the `node_modules` that has it. Loaded on
 * first use: a static import would put a native module in front of every platform's startup.
 */

import { createRequire } from "node:module";

let cached: typeof import("koffi") | undefined;

export function koffi(): typeof import("koffi") {
	cached ??= createRequire(import.meta.url)("koffi") as typeof import("koffi");
	return cached;
}
