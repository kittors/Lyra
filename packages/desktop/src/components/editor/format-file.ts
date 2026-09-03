/**
 * One door for "format this file", whichever engine ends up doing it.
 *
 * Three things have to agree before any text is printed: which engine owns the language, what the
 * project has committed to, and what the user has set here. The order between the last two is the
 * only real decision, and it goes to the project — a repository with a `.prettierrc` has settled
 * its style, and a personal preference in this app must not rewrite everyone else's files on
 * every save. Ours applies where the project is silent, which is most of the time.
 *
 * The engine split is not a preference either. Prettier prints JavaScript and its neighbours; Go
 * is printed by `gofmt` or it is printed wrong. See `format.ts` and `electron/format-external.ts`.
 */

import { canFormat, formatCode, type FormatOptions } from "./format.ts";
import { bridge } from "../../services/index.ts";

export type FormatOutcome =
	| { ok: true; text: string; changed: boolean; by: string; config?: string }
	/** No engine owns this language. Nothing was wrong; there is simply nothing to run. */
	| { ok: false; kind: "unsupported" }
	/** The engine exists and rejected the file — its message names the line. */
	| { ok: false; kind: "failed"; message: string }
	/** The language's tool is not on this machine; `install` says how to get it. */
	| { ok: false; kind: "missing"; tool: string; install: string };

/** The file's extension, lowercased. Empty for files that have none. */
function extensionOf(path: string): string {
	const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? "";
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(dot + 1) : "";
}

/**
 * Only the keys we know how to honour, and only when they are the right type.
 *
 * A `.prettierrc` can contain anything — plugin names, overrides, comments in JSON5 — and passing
 * the file through wholesale would hand Prettier options it would reject, turning a formatting
 * shortcut into an error on a config file nobody asked us to validate.
 */
function usableConfig(raw: Record<string, unknown> | null): Partial<FormatOptions> {
	if (!raw) return {};
	const out: Partial<FormatOptions> = {};
	if (typeof raw.tabWidth === "number") out.tabWidth = raw.tabWidth;
	if (typeof raw.useTabs === "boolean") out.useTabs = raw.useTabs;
	if (typeof raw.printWidth === "number") out.printWidth = raw.printWidth;
	if (typeof raw.semi === "boolean") out.semi = raw.semi;
	if (typeof raw.singleQuote === "boolean") out.singleQuote = raw.singleQuote;
	if (raw.trailingComma === "none" || raw.trailingComma === "es5" || raw.trailingComma === "all") {
		out.trailingComma = raw.trailingComma;
	}
	if (typeof raw.bracketSpacing === "boolean") out.bracketSpacing = raw.bracketSpacing;
	if (raw.arrowParens === "always" || raw.arrowParens === "avoid") out.arrowParens = raw.arrowParens;
	return out;
}

export async function formatFile(path: string, source: string, settings: FormatOptions): Promise<FormatOutcome> {
	const extension = extensionOf(path);

	if (canFormat(path)) {
		/*
		 * The project's config is only consulted for Prettier.
		 *
		 * The external tools read their own — `rustfmt` finds `rustfmt.toml` by itself, `gofmt` has
		 * nothing to configure — so forwarding options to them would be at best ignored and at worst
		 * a second, conflicting source of truth.
		 */
		const raw = await bridge.format.config(path).catch(() => null);
		const options = { ...settings, ...usableConfig(raw) };
		try {
			const text = await formatCode(path, source, options);
			if (text === null) return { ok: false, kind: "unsupported" };
			return { ok: true, text, changed: text !== source, by: "Prettier", config: raw?.__source as string | undefined };
		} catch (error) {
			return { ok: false, kind: "failed", message: error instanceof Error ? error.message : String(error) };
		}
	}

	const external = await bridge.format.external(extension, source);
	if (external.ok) return { ok: true, text: external.text, changed: external.text !== source, by: external.tool };
	if (external.reason === "missing") return { ok: false, kind: "missing", tool: external.tool, install: external.install };
	if (external.reason === "failed") return { ok: false, kind: "failed", message: external.message };
	return { ok: false, kind: "unsupported" };
}
