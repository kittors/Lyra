/**
 * How the renderer talks to the main process.
 *
 * One import for callers: `import { bridge } from "@/services"`. The two files behind it answer
 * different questions — `bridge.ts` is *how* (and the only place `window.lyra` is named),
 * `host.ts` is *whether* (which methods answer in this host, and why not when they do not).
 */

export { bridge, bridgeAvailable } from "./bridge.ts";
export { available, host, onPhone, unavailableBecause, type Host } from "./host.ts";
