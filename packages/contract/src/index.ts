/**
 * The boundary between the renderer and the main process.
 *
 * See `methods.ts` for what is here and why it is one file rather than three.
 */

export { CHANNELS, METHODS, REMOTE_METHODS, methodFor, type Method, type Reach } from "./methods.ts";
export * from "./args.ts";
