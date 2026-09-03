/**
 * One branch, with what it is ahead and behind by.
 */

import { GitBranch, GitCompare, Trash2 } from "lucide-react";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
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
    <div className="group/branch flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors hover:bg-card-hover">
      <GitBranch
        size={12}
        strokeWidth={1.8}
        className={`shrink-0 ${current ? "text-accent" : "text-ink-faint"}`}
      />
      <Text
        size="label"
        tone={current ? "default" : "muted"}
        className="min-w-0 flex-1 truncate"
      >
        {name}
      </Text>
      {current ? (
        <Text size="caption" tone="faint" className="shrink-0 pr-1">
          当前
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
              label="与当前分支比较"
              size="sm"
              onClick={onCompare}
            />
          )}
          <button
            type="button"
            disabled={busy}
            onClick={onSwitch}
            className="h-[22px] rounded px-1.5 text-caption text-ink-muted transition-colors hover:bg-elevated hover:text-ink disabled:opacity-40"
          >
            {remote ? "检出" : "切换"}
          </button>
          {onDelete && (
            <IconButton
              icon={<Trash2 size={12} strokeWidth={1.9} />}
              label="删除分支"
              size="sm"
              tone="danger"
              onClick={onDelete}
            />
          )}
        </span>
      )}
    </div>
  );
}

/** Coarse on purpose: the exact minute of a commit is never the question in a list. */
