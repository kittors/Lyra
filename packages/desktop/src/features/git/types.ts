/**
 * Shared shapes for the git panel.
 */

/**
 * Run a git operation and say whether it worked.
 *
 * Every mutating button goes through one of these so that refreshing afterwards, and reporting
 * the failure, happen in one place rather than at each call site.
 */
export type Act = (operation: () => Promise<{ ok: boolean; error?: string }>) => Promise<boolean>;
