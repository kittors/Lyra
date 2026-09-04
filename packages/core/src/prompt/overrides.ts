/**
 * Prompt blocks a project can replace with a file.
 *
 * The narrow start on purpose: one block, `identity`, because it is the one people actually want
 * to change and because replacing it is safe in a way replacing `boundaries` would not be.
 *
 * `appendSystemPrompt` already existed and is not the same thing. Appending gives the model two
 * statements about who it is, and the second does not cancel the first — it produces a prompt that
 * argues with itself. Replacing is what somebody writing "you are our team's reviewer, not a
 * general assistant" means.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Blocks a project may replace. Deliberately not `boundaries`: those are ours to keep. */
export type OverridableBlock = "identity";

/**
 * Read `<cwd>/.lyra/prompts/<block>.md`, or empty when there is none.
 *
 * Bounded, because this text goes into every request in the project and an accident — a log file
 * renamed, a paste gone wrong — should cost one truncated prompt rather than every turn's budget.
 */
export async function readPromptOverride(cwd: string, block: OverridableBlock): Promise<string> {
	const raw = await readFile(join(cwd, ".lyra", "prompts", `${block}.md`), "utf8").catch(() => null);
	return raw === null ? "" : raw.slice(0, 8000).trim();
}
