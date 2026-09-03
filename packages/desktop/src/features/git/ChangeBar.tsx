import { GitCommitVertical } from "lucide-react";
import { useCallback, useState } from "react";
import { CountUp } from "../../ui/primitives/CountUp.tsx";
import { useLiveRefresh } from "../../ui/hooks/useLiveRefresh.ts";
import { useDock } from "../dock/index.ts";
import { useApp } from "../../store/index.ts";
import { bridge } from "../../services/index.ts";

/**
 * How much is uncommitted, always in view.
 *
 * The agent edits files. The one thing you need to keep track of while it does — and the thing
 * that is easiest to lose track of — is how much has piled up that you have not looked at.
 * Having to open a panel to find out makes it something you ask about; sitting here, it is
 * something you notice.
 *
 * Both controls open the Git panel rather than acting here. Committing used to happen in a
 * popover hanging off this row, which could only ever stage everything and record it blind —
 * there was nowhere in it to see what was going in. Reviewing and committing are one motion, so
 * they belong in the one place that can show both.
 */
export function ChangeBar() {
  const workspace = useApp((s) => s.workspace);
  const running = useApp((s) => s.running);
  const openPane = useDock((s) => s.open);

  const [stat, setStat] = useState<{
    added: number;
    removed: number;
    files: number;
  } | null>(null);

  const cwd = workspace?.path;
  const isRepo = workspace?.isGitRepo ?? false;

  const refresh = useCallback(async () => {
    if (!cwd || !isRepo) {
      setStat(null);
      return;
    }
    const next = await bridge.git.stat(cwd);
    setStat({ added: next.added, removed: next.removed, files: next.files });
  }, [cwd, isRepo]);

  useLiveRefresh(refresh, running);

  if (!stat || stat.files === 0) return null;

  return (
    <>
      <button
        type="button"
        data-ly-tip={`${stat.files} 个文件有未提交的改动 · 点击查看`}
        onClick={() => openPane("review")}
        className="ly-scroll flex h-[26px] shrink-0 items-center gap-1.5 rounded-md px-2 text-detail transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover"
      >
        {/*
         * Travelled to, not jumped to.
         *
         * The same treatment the token counter gets: a number that lands in steps of thirty reads
         * as a glitch, and the movement is what makes it legible as counting rather than as
         * replacing.
         *
         * Below the early return rather than above it, which is why these are components. As
         * hooks they had to run before `stat` existed, so the bar's first real reading was
         * animated up from a zero that only meant "not read yet" — the numbers rolled up from
         * nothing every time a project opened. See `CountUp`.
         */}
        <CountUp
          value={stat.added}
          className="font-mono text-detail text-ok"
          format={(shown) => `+${Math.round(shown).toLocaleString()}`}
        />
        <CountUp
          value={stat.removed}
          className="font-mono text-detail text-danger"
          format={(shown) => `−${Math.round(shown).toLocaleString()}`}
        />
      </button>

      <button
        type="button"
        data-ly-tip="在 Git 面板中查看并提交"
        onClick={() => openPane("review")}
        className="flex h-[26px] shrink-0 items-center gap-1.5 rounded-md px-2 text-detail text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink"
      >
        <GitCommitVertical size={13} strokeWidth={1.8} className="shrink-0" />
        提交
      </button>
    </>
  );
}
