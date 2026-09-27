/**
 * The pieces every risk question is built from.
 *
 * A verdict, the two ways of making one, and the answer to "is this inside somewhere work happens".
 * Here rather than in either half so that neither has to import the other — the command rules and
 * the path rules are siblings, not layers.
 */

import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { within } from "../platform.ts";
import { riskReason, type RiskCode, type RiskParams } from "./risk-reasons.ts";

export interface RiskVerdict {
	risky: boolean;
	/** What specifically is dangerous, in the rules' own wording — for anything that shows it as is. */
	reason?: string;
	/** Which rule said so. The approval card is written from this, in the interface's language. */
	code?: RiskCode;
	/** The values the rule's sentence needs. */
	params?: RiskParams;
}

export const SAFE: RiskVerdict = { risky: false };

export const risky = (code: RiskCode, params?: RiskParams): RiskVerdict => ({
	risky: true,
	reason: riskReason(code, params),
	code,
	...(params ? { params } : {}),
});

/**
 * The places work legitimately happens.
 *
 * The project, the system temp directory, and the app's own scratch and preview directories. The
 * last two matter for the same reason as the first: we create them, and we put their paths in the
 * system prompt telling the agent to use them. Asking a person whether the agent may write to the
 * directory we just told it to write to is not a safety question, it is a bug — and one that turns
 * an unattended run into a run that stops on the first scratch file.
 *
 * `~/.lyra` as a whole is deliberately not here: settings and session logs live there too, and
 * those are worth a question.
 */
export function scratchRoots(cwd?: string): string[] {
	const home = process.env.LYRA_HOME || join(homedir(), ".lyra");
	/*
	 * `/tmp` by name as well as by API.
	 *
	 * On macOS `tmpdir()` is the per-user `/var/folders/...` directory, while everything people
	 * and models actually type is `/tmp` — a different path that is equally temporary. Listing
	 * only the API answer meant the rule looked right in tests and still stopped the real command
	 * that prompted it.
	 */
	const roots = [tmpdir(), "/tmp", "/private/tmp", join(home, "scratch"), join(home, "previews")];
	if (cwd) roots.push(cwd);
	// A root of `/` would make every path on the machine "scratch"; drop it rather than trust it.
	return roots.map((root) => root.replace(/\/+$/, "")).filter((root) => root.length > 1);
}

/**
 * Somewhere a scratch file legitimately lives.
 *
 * The system temp directory counts alongside the project, because the agent is *told* to put
 * scratch there — a preview, a log, a throwaway script. Refusing to let it tidy up after itself
 * would mean asking a person about `rm -f /tmp/its-own-log-*.log`, which is not a decision anyone
 * can make better than the rule can.
 *
 * The root itself is never "inside" it: `/tmp/x` is housekeeping, `/tmp` is somebody else's files
 * too. Nor is anything outside these two trees — home, `/etc`, another project.
 */
/**
 * A wildcard that empties a scratch directory wholesale.
 *
 * `/tmp/inkwell-*.log` is the agent's own files; `/tmp/*` is everyone's. The system temp directory
 * is shared with every other process on the machine, so "somewhere you may write" does not extend
 * to "somewhere you may empty" — the same distinction as `rm -rf dist` versus `rm -rf *`.
 *
 * The line is whether the wildcard segment says anything: a bare `*` names nothing in particular,
 * a pattern with literal characters names a family of files.
 */
export function wipesScratchRoot(target: string, cwd?: string): boolean {
	const path = target.replace(/^['"]|['"]$/g, "");
	const segments = path.split("/");
	const last = segments[segments.length - 1];
	if (!/^\*+$/.test(last)) return false;
	const prefix = segments.slice(0, -1).join("/");
	return scratchRoots(cwd).includes(prefix);
}

export function underScratchRoot(target: string, cwd?: string): boolean {
	const path = target.replace(/^['"]|['"]$/g, "");
	/*
	 * `isAbsolute`, not `startsWith("/")`.
	 *
	 * A scratch root on Windows is `C:\Users\…\Temp`, which does not begin with a slash — so the
	 * old guard rejected every real path there before any root was even considered, and nothing on
	 * that platform was ever recognised as scratch. `isAbsolute` accepts both spellings, including
	 * the `/tmp/...` a model writes into a command regardless of which machine it is on.
	 */
	if (!isAbsolute(path)) return false;
	return scratchRoots(cwd).some((root) => within(root, path));
}
