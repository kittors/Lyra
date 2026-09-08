/**
 * One branch, with what it is ahead and behind by.
 */

import { translate } from "../../i18n/translate.ts";
import { GitBranch, GitCompare, GitPullRequestArrow, ArrowRightLeft, Trash2 } from "lucide-react";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { Text } from "../../ui/primitives/Text.tsx";

export function BranchRow({
  name,
  current,
  busy,
  remote,
  onSwitch,
  onCompare,
  onDelete,
}: {
  name: string;
  current: boolean;
  busy: boolean;
  remote?: boolean;
  onSwitch: () => void;
  onCompare?: () => void;
  /** Takes the event, because what confirms it hangs off the button that was clicked. */
  onDelete?: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className="ly-scroll group/branch flex items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors">
      <GitBranch
        size={12}
        strokeWidth={1.8}
        className={`shrink-0 ${current ? "text-accent" : "text-ink-faint"}`}
      />
      <ScrollText text={name} className={`min-w-0 flex-1 text-label ${current ? "text-ink" : "text-ink-muted"}`} />
      {current ? (
        <Text size="caption" tone="faint" className="w-9 shrink-0 text-right">
          {translate("branchRow.current")}
        </Text>
      ) : (
        /*
         * Revealed on hover, like the archive control in the sidebar's session list.
         * Three permanent buttons per row would turn a list you read into a control panel.
         */
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-[var(--ly-t-quick)] group-hover/branch:opacity-100 has-[:focus-visible]:opacity-100">
          {onCompare && (
            <IconButton
              icon={<GitCompare size={12} strokeWidth={1.9} />}
              label={translate("branchRow.compare")}
              size="sm"
              onClick={onCompare}
            />
          )}
          {onDelete && (
            <IconButton
              icon={<Trash2 size={12} strokeWidth={1.9} />}
              label={translate("branchRow.delete")}
              size="sm"
              tone="danger"
              onClick={onDelete}
            />
          )}
          <IconButton
            size="sm"
            icon={remote ? <GitPullRequestArrow size={13} strokeWidth={1.9} /> : <ArrowRightLeft size={13} strokeWidth={1.9} />}
            label={translate(remote ? "branchRow.checkoutRemote" : "branchRow.switchTo")}
            disabled={busy}
            onClick={onSwitch}
          />
        </span>
      )}
    </div>
  );
}

/** Coarse on purpose: the exact minute of a commit is never the question in a list. */
