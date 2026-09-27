/**
 * Where it may write, and what it may reach.
 *
 * Two questions about places rather than commands. Both have the same shape of answer: the project
 * and the scratch areas are where work happens, and everything else is worth a moment of someone's
 * attention.
 */

import { PROTECTED_PATH } from "./risk-tables.ts";
import { SAFE, risky, underScratchRoot, type RiskVerdict } from "./risk-shared.ts";

/**
 * Whether writing to this path needs a decision.
 *
 * Inside the project, writing is the work and is not worth interrupting. Outside it — a system
 * directory, someone's SSH keys — is a different act entirely, whoever asked for it.
 */
export function assessWrite(path: string, cwd: string): RiskVerdict {
	const normalised = path.replace(/\/+$/, "");
	/*
	 * Asked first, because on macOS the system temp directory lives under `/var` — which the
	 * protected-path list quite rightly covers. A file inside a directory whose entire purpose is
	 * scratch is not the case that list is about, and checking in the other order made every
	 * temporary file look like an attempt on the system.
	 */
	if (underScratchRoot(normalised, cwd)) return SAFE;
	if (PROTECTED_PATH.test(` ${normalised}`)) return risky("write-sensitive-path");
	if (/(^|\/)\.(zshrc|bashrc|profile|zprofile)$/.test(normalised)) return risky("shell-startup");
	if (!normalised.startsWith(`${cwd.replace(/\/+$/, "")}/`) && normalised !== cwd.replace(/\/+$/, "")) {
		return risky("write-outside-project");
	}
	return SAFE;
}
