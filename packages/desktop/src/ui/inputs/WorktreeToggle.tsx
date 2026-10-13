/**
 * This conversation in a worktree of its own, or in the project itself.
 *
 * Chosen per conversation, before its first message — the only moment the choice means anything, since
 * a conversation that has run cannot be moved into a copy afterwards. It starts from
 * `worktrees.autoCreateOnNewSession`, which is now only the default: that setting used to be the only
 * way to choose at all, all or nothing for every conversation after it.
 *
 * A toggle beside the project and branch, not a menu: there are two answers, and both are visible in
 * one glance — the mark alone, or the mark and its name in the accent colour. The fork is the mark the
 * sidebar puts on a conversation that got one (`SessionStatus`), and not the branch chip's beside it.
 *
 * Down here rather than in a domain because two ask the question — the composer, for the conversation
 * being written, and a suggested conversation's card, for the one it starts — and a domain's front door
 * that both import closed a dependency loop through the dock. It is a switch: a mark, a name, two tips.
 */

import { GitFork } from "lucide-react";
import { useI18n } from "../../i18n/index.ts";

export function WorktreeToggle({
	on,
	onChange,
	size = "composer",
}: {
	on: boolean;
	onChange: (on: boolean) => void;
	/**
	 * `sm` beside a `Button size="sm"`, as on a suggestion card: 26px and its corners, where the composer's
	 * controls are 28px pills. Not a utility on top of `ly-composer-control` — that rule is unlayered CSS
	 * and would win over it.
	 */
	size?: "composer" | "sm";
}) {
	const { t } = useI18n();
	const tip = on ? t("composer.worktreeOn") : t("composer.worktreeOff");
	return (
		<button
			type="button"
			data-ly-worktree-toggle=""
			aria-pressed={on}
			aria-label={tip}
			data-ly-tip={tip}
			onClick={() => onChange(!on)}
			className={`${size === "sm" ? "h-[26px] rounded-lg" : "ly-composer-control rounded-full"} flex shrink-0 items-center gap-1 px-2 text-label transition-[color,background-color] duration-[var(--ly-t-quick)] ${
				on ? "text-accent hover:bg-card-hover" : "text-ink-muted hover:bg-card-hover hover:text-ink"
			}`}
		>
			<GitFork size={16} strokeWidth={1.8} aria-hidden />
			{on && <span>{t("composer.worktree")}</span>}
		</button>
	);
}
