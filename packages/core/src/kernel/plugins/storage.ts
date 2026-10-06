import { SessionStore } from "../../session/store.ts";
import type { SessionStorage } from "../../session/storage.ts";
import type { Context, Plugin } from "../context.ts";
import { STORAGE } from "../services.ts";

/**
 * Where sessions are kept.
 *
 * The default is one SQLite database under `~/.lyra/sessions` (ADR-0032): append-only records
 * numbered for syncing, each written whole in its own transaction. It is a seam because "on this
 * disk" is an assumption, not a requirement — a hosted deployment keeps sessions per account, and a
 * phone keeps a cache of someone else's.
 */
export const storagePlugin: Plugin = {
	name: "storage",
	apply(ctx: Context) {
		return ctx.provide<SessionStorage>(STORAGE, new SessionStore());
	},
};
