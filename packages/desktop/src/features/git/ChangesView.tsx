/**
 * The index, as a column you read downwards.
 */
import { Check, FolderTree, List, Minus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";

import type { GitStatus, GitStatusFile, WorkspaceDiffFile } from "../../../electron/ipc-types.ts";

import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { PanelEmpty } from "../../ui/layout/PanelEmpty.tsx";

import { Scroller } from "../../ui/scroll/Scroller.tsx";

import { CommitComposer } from "./CommitComposer.tsx";
import { FileDiffList } from "./FileDiffList.tsx";
import { FileDiffTree } from "./FileDiffTree.tsx";

import { GroupHeader } from "./GroupHeader.tsx";
import { SkeletonList } from "../../ui/primitives/Skeleton.tsx";
import type { SyncPlan } from "./syncPlan.ts";
import type { Act } from "./types.ts";
import { bridge } from "../../services/index.ts";

/**
 * Staged above unstaged, with the commit box under both.
 *
 * The split is the whole reason to have an index in front of you: the top group is what the
 * next commit will contain, the bottom is what it will not. Reading down the column is reading
 * the commit you are about to make.
 */
export function ChangesView({
  status,
  cwd,
  busy,
  loading,
  act,
  plan,
  onPush,
  onPull,
}: {
  status: GitStatus | null;
  cwd: string;
  busy: boolean;
  /** The checkout moved and this is being re-read; see `switching` in `GitPanel`. */
  loading?: boolean;
  act: Act;
  /** What a clean tree should say, and what to offer doing about it. Computed in `GitPanel`. */
  plan: SyncPlan;
  onPush: () => void;
  onPull: () => void;
}) {
  const [treeView, setTreeView] = useState(false);
  const confirm = useConfirmer();
  /** The hunks, once they arrive. The rows themselves do not wait for them — see `rowsFor`. */
  const [hunks, setHunks] = useState<{ staged: WorkspaceDiffFile[]; unstaged: WorkspaceDiffFile[] }>({
    staged: [],
    unstaged: [],
  });

  /*
   * Two diffs, matching the two groups.
   *
   * The staged side is the index against HEAD and the unstaged side the working tree against
   * the index — the same split git itself makes. Fetched here rather than in the parent so a
   * staging click re-reads only what it changed.
   *
   * `status` has to be a stable object across polls that found nothing new, or this runs every
   * 1.5s and the panel spends every turn queued behind a read slower than the interval it is
   * started on. That is `sameStatus`, in the parent.
   */
  useEffect(() => {
    let live = true;
    void Promise.all([
      bridge.git.diffRefs(cwd, "HEAD", null),
      bridge.diff.workspaceDiff(cwd),
    ]).then(([indexDiff, treeDiff]) => {
      if (!live) return;
      setHunks({ staged: indexDiff.files, unstaged: treeDiff.files });
    });
    return () => {
      live = false;
    };
  }, [cwd, status]);

  const stagedPaths = status?.staged.map((file) => file.path) ?? [];
  const unstagedPaths = status?.unstaged.map((file) => file.path) ?? [];
  const nothing = stagedPaths.length === 0 && unstagedPaths.length === 0;

  /*
   * The rows come from `status`; only their contents wait for the diff.
   *
   * These used to be the diff's own file list, which meant the group heading — "未暂存 240",
   * drawn from `status` — arrived a couple of hundred milliseconds before anything under it, and
   * then two hundred rows landed at once. A count with nothing beneath it reads as a panel that
   * failed rather than one that is loading, and the rows arriving in one frame reads as a jolt.
   *
   * Everything a row shows is already in `status`: the path, what happened to it, how many lines.
   * The only thing the diff adds is the hunks, and those are not on screen until the row is
   * expanded. So the list is drawn immediately and each row picks up its hunks when they land.
   */
  const stagedRows = rowsFor(status?.staged ?? [], hunks.staged);
  const unstagedRows = rowsFor(status?.unstaged ?? [], hunks.unstaged);

  /*
   * While the checkout is moving, stand in the shape of what is coming.
   *
   * Ahead of the empty state on purpose: mid-switch there is no answer yet, and 「工作区干净」 is an
   * answer — the wrong one, stated confidently, for however long `git status` takes on a large
   * repository.
   */
  if (loading) {
    return (
      <div className="ly-enter flex-1 px-1.5 pt-2">
        <SkeletonList count={5} label="正在读取改动" />
      </div>
    );
  }

  if (nothing) {
    /*
     * Clean, and what that leaves you with.
     *
     * 「没有未提交的改动」 was the only thing this ever said, and for the commit you have just made
     * it is an answer to a question nobody asked: the tree is clean *and* the work has not left the
     * machine. What follows from a clean tree depends entirely on where the branch stands with its
     * remote, so the sentence comes from `syncPlan` — the same one the sync row is drawn from, so
     * the two cannot disagree.
     */
    return (
      <PanelEmpty
        icon={Check}
        title="工作区干净"
        action={
          plan.empty.action
            ? {
                label: plan.empty.action.label,
                onClick: plan.empty.action.kind === "push" ? onPush : onPull,
                disabled: busy,
                loading: busy,
              }
            : undefined
        }
      >
        {plan.empty.body}
      </PanelEmpty>
    );
  }

  return (
    /* `ly-enter` so the list arrives rather than replacing the skeleton in one frame. */
    <>
      <Scroller className="ly-enter flex-1" contentClassName="px-2 pb-2" top="fade" bottom="fade">
        {stagedPaths.length > 0 && (
          <div className="flex items-center justify-between">
            <GroupHeader
              label="已暂存"
              count={stagedPaths.length}
              action="取消全部"
              disabled={busy}
              onAction={() =>
                void act(() => bridge.git.unstage(cwd, stagedPaths))
              }
            />
            <button
              type="button"
              data-ly-tip={treeView ? "切换为扁平列表" : "切换为树状视图"}
              onClick={() => setTreeView((v) => !v)}
              className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-card-hover hover:text-ink"
            >
              {treeView ? <List size={13} strokeWidth={1.9} /> : <FolderTree size={13} strokeWidth={1.9} />}
            </button>
          </div>
        )}
        {stagedPaths.length > 0 && (
          treeView ? (
            <FileDiffTree
              cwd={cwd}
              files={stagedRows}
              actions={(file) => (
                <IconButton
                  icon={<Minus size={12} strokeWidth={1.9} />}
                  label="取消暂存"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void act(() => bridge.git.unstage(cwd, [file.path]))
                  }
                />
              )}
            />
          ) : (
            <FileDiffList
              cwd={cwd}
              files={stagedRows}
              actions={(file) => (
                <IconButton
                  icon={<Minus size={12} strokeWidth={1.9} />}
                  label="取消暂存"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void act(() => bridge.git.unstage(cwd, [file.path]))
                  }
                />
              )}
            />
          )
        )}

        {unstagedPaths.length > 0 && (
          <div className="flex items-center justify-between">
            <GroupHeader
              label="未暂存"
              count={unstagedPaths.length}
              action="全部暂存"
              disabled={busy}
              onAction={() =>
                void act(() => bridge.git.stage(cwd, unstagedPaths))
              }
            />
            {stagedPaths.length === 0 && (
              <button
                type="button"
                data-ly-tip={treeView ? "切换为扁平列表" : "切换为树状视图"}
                onClick={() => setTreeView((v) => !v)}
                className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors hover:bg-card-hover hover:text-ink"
              >
                {treeView ? <List size={13} strokeWidth={1.9} /> : <FolderTree size={13} strokeWidth={1.9} />}
              </button>
            )}
          </div>
        )}
        {unstagedPaths.length > 0 && (
          treeView ? (
            <FileDiffTree
              cwd={cwd}
              files={unstagedRows}
              actions={(file) => (
                <>
                  <IconButton
                    icon={<RotateCcw size={12} strokeWidth={1.9} />}
                    label="放弃改动"
                    size="sm"
                    tone="danger"
                    disabled={busy}
                    onClick={() =>
                      confirm.ask({
                        title: `放弃 ${file.path.split("/").pop()} 的改动？`,
                        detail:
                          "这个文件会回到上次提交的样子；没提交过的内容找不回来，git 里也没有它的副本。",
                        confirmLabel: "放弃改动",
                        onConfirm: () =>
                          void act(() => bridge.git.discard(cwd, [file.path])),
                      })
                    }
                  />
                  <IconButton
                    icon={<Plus size={12} strokeWidth={1.9} />}
                    label="暂存"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void act(() => bridge.git.stage(cwd, [file.path]))
                    }
                  />
                </>
              )}
            />
          ) : (
            <FileDiffList
              cwd={cwd}
              files={unstagedRows}
              actions={(file) => (
                <>
                  <IconButton
                    icon={<RotateCcw size={12} strokeWidth={1.9} />}
                    label="放弃改动"
                    size="sm"
                    tone="danger"
                    disabled={busy}
                    onClick={() =>
                      confirm.ask({
                        title: `放弃 ${file.path.split("/").pop()} 的改动？`,
                        detail:
                          "这个文件会回到上次提交的样子；没提交过的内容找不回来，git 里也没有它的副本。",
                        confirmLabel: "放弃改动",
                        onConfirm: () =>
                          void act(() => bridge.git.discard(cwd, [file.path])),
                      })
                    }
                  />
                  <IconButton
                    icon={<Plus size={12} strokeWidth={1.9} />}
                    label="暂存"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void act(() => bridge.git.stage(cwd, [file.path]))
                    }
                  />
                </>
              )}
            />
          )
        )}
      </Scroller>

      <CommitComposer
        cwd={cwd}
        stagedCount={stagedPaths.length}
        busy={busy}
        disabled={nothing}
        onCommit={(next) => act(() => bridge.git.commitStaged(cwd, next))}
      />

      {confirm.element}
    </>
  );
}

/**
 * One row per file git reported, carrying its hunks if they have arrived.
 *
 * `status` is the authority on which files are in the group and what happened to them — it is what
 * the heading counts, and drawing the rows from anything else lets the two disagree. The diff only
 * supplies what a row shows once it is expanded, so a file it has not answered for yet is a
 * perfectly good row with nothing folded inside it.
 *
 * Line counts prefer the diff's, which are computed from the comparison the panel actually shows;
 * `status` takes its own from `--numstat`, and the two have drifted apart before.
 */
function rowsFor(files: GitStatusFile[], diffed: WorkspaceDiffFile[]): WorkspaceDiffFile[] {
  const known = new Map(diffed.map((file) => [file.path, file]));
  return files.map(
    (file) =>
      known.get(file.path) ?? {
        path: file.path,
        status: file.status,
        added: file.added,
        removed: file.removed,
        hunks: [],
      },
  );
}
