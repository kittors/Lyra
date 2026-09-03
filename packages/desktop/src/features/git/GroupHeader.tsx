/**
 * A labelled divider between groups of rows.
 *
 * Shared by the changes and branches views, which both present lists that would run together
 * without one.
 */

import { Text } from "../../ui/primitives/Text.tsx";

export function GroupHeader({
  label,
  count,
  action,
  disabled,
  onAction,
}: {
  label: string;
  count: number;
  action: string;
  disabled: boolean;
  onAction: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 px-1 pt-2 pb-1">
      <Text size="caption" tone="faint" weight="medium">
        {label}
      </Text>
      <Text size="caption" tone="faint" numeric>
        {count}
      </Text>
      <div className="min-w-1 flex-1" />
      <button
        type="button"
        disabled={disabled}
        onClick={onAction}
        className="rounded px-1 text-caption text-ink-faint transition-colors hover:text-ink disabled:opacity-40"
      >
        {action}
      </button>
    </div>
  );
}

/**
 * The log, drawn as the graph it is.
 *
 * A flat list of subjects cannot answer the questions people actually bring to a history: where
 * did this branch off, when did it come back, what was on main while this was happening. Those
 * are shape, not text — so the shape is drawn. Each lane keeps one colour from the commit that
 * starts it to the merge that ends it, which is what makes a column followable.
 */
