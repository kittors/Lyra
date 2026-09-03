/**
 * Branches, and the diff between any two of them.
 */
import { Check, GitBranchPlus, FolderGit2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { GitStatus, WorkspaceDiffFile } from "../../../electron/ipc-types.ts";
import type { BranchList, RepoRef } from "../../../electron/git.ts";

import { useConfirmer } from "../Confirm.tsx";
import { Scroller } from "../Scroller.tsx";

import { Text } from "../Text.tsx";

import { FileDiffList } from "./FileDiffList.tsx";

import { BranchRow } from "./BranchRow.tsx";
import { GroupHeader } from "./GroupHeader.tsx";
import type { Act } from "./types.ts";
import { bridge } from "../../services/index.ts";

/**
 * Branches, and the diff between any two of them.
 *
 * Comparison is the reason this view exists rather than a switcher in a menu: "how does mine
 * differ from main" is a question you ask before merging, and answering it anywhere else means
 * leaving the app for a terminal.
 */
export function BranchesView({
  cwd,
  status,
  busy,
  act,
  repos,
  trees,
  onSelectRepo,
}: {
  cwd: string;
  status: GitStatus | null;
  busy: boolean;
  act: Act;
  repos: RepoRef[];
  trees: Record<string, RepoRef[]>;
  onSelectRepo: (path: string) => void;
}) {
  const [branches, setBranches] = useState<BranchList>({
    current: null,
    local: [],
    remote: [],
  });
  const [compare, setCompare] = useState<{ base: string; head: string } | null>(
    null,
  );
  const [diff, setDiff] = useState<{
    files: WorkspaceDiffFile[];
    added: number;
    removed: number;
  } | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const confirm = useConfirmer();
  /** Repositories and their worktrees, flattened in display order. */
  const checkouts = repos.flatMap((repo) => [repo, ...(trees[repo.path] ?? [])]);

  const load = useCallback(() => {
    void bridge.git.branches(cwd).then(setBranches);
  }, [cwd]);

  useEffect(load, [load, status?.branch]);

  useEffect(() => {
    if (!compare) return setDiff(null);
    let live = true;
    void bridge.git
      .diffRefs(cwd, compare.base, compare.head)
      .then((result) => live && setDiff(result));
    return () => {
      live = false;
    };
  }, [cwd, compare]);

  const current = branches.current;
  /*
   * The upstream belongs in this list even though the switcher filters it out.
   *
   * `listBranches` drops remote branches that already have a local counterpart, which is right
   * for a switcher — checking out `origin/main` when you have `main` is a detached head nobody
   * asked for. But "what do I have that the remote does not" is the most common comparison
   * there is, and dropping the upstream makes it the one comparison you cannot run.
   */
  const remotes =
    status?.upstream && !branches.remote.includes(status.upstream)
      ? [status.upstream, ...branches.remote]
      : branches.remote;

  return (
    <Scroller className="flex-1" contentClassName="px-1.5 pb-2" top="none" bottom="none">
      {compare ? (
        <>
          <div className="flex items-center gap-1.5 px-1 py-1.5">
            <button
              type="button"
              onClick={() => setCompare(null)}
              className="rounded px-1 text-caption text-ink-faint transition-colors hover:text-ink"
            >
              ← 返回
            </button>
            <Text size="label" tone="muted" className="min-w-0 truncate">
              <span className="text-ink">{compare.base}</span>
              <span className="px-1 text-ink-faint">→</span>
              <span className="text-ink">{compare.head}</span>
            </Text>
            {diff && (
              <Text size="caption" mono numeric className="ml-auto shrink-0">
                <span className="text-ok">+{diff.added}</span>{" "}
                <span className="text-danger">−{diff.removed}</span>
              </Text>
            )}
          </div>
          <FileDiffList
            files={diff?.files ?? []}
            emptyLabel={diff ? "两个分支没有差异" : "正在比较…"}
          />
        </>
      ) : (
        <>
          {/*
           * Every checkout in the workspace, before its branches.
           *
           * A repository's branches only make sense once you know which repository you are
           * looking at, and a folder someone opened may hold several — plus a worktree for each,
           * which is a further checkout of the same history on another branch. This list used to
           * exist only as a picker in the panel's title row, where it went unnoticed twice; the
           * question "where am I working" belongs on the page that answers "on what branch".
           */}
          {checkouts.length > 1 && (
            <>
              <GroupHeader label="工作区" count={checkouts.length} action="" disabled onAction={() => {}} />
              {checkouts.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  data-ly-tip={entry.path}
                  onClick={() => onSelectRepo(entry.path)}
                  className={`flex w-full items-center gap-1.5 rounded-md py-1 pr-1.5 text-left transition-colors ${
                    entry.worktree ? "pl-5" : "pl-1.5"
                  } ${entry.path === cwd ? "bg-card-hover" : "hover:bg-card-hover"}`}
                >
                  {entry.worktree ? (
                    <GitBranchPlus size={12} strokeWidth={1.8} className="shrink-0 text-ink-faint" />
                  ) : (
                    <FolderGit2 size={12} strokeWidth={1.8} className="shrink-0 text-ink-faint" />
                  )}
                  {/* The name identifies the checkout; the branch qualifies it. Names keep their
                   * width and branches give theirs up, or `CliRelay-wt-audit` becomes `CliR…`. */}
                  <Text size="label" tone={entry.path === cwd ? "default" : "muted"} className="min-w-0 shrink truncate">
                    {entry.label}
                  </Text>
                  <Text size="caption" tone="faint" className="ml-auto min-w-0 shrink-[4] truncate">
                    {entry.branch ?? "游离 HEAD"}
                  </Text>
                  {entry.path === cwd && <Check size={12} strokeWidth={2.2} className="shrink-0 text-accent" />}
                </button>
              ))}
            </>
          )}

          <GroupHeader
            label="本地"
            count={branches.local.length}
            action={creating ? "取消" : "新建"}
            disabled={busy}
            onAction={() => {
              setCreating(!creating);
              setName("");
            }}
          />

          {creating && (
            <form
              className="flex items-center gap-1.5 px-1 pb-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                void act(() =>
                  bridge.git.createBranch(cwd, name),
                ).then((ok) => {
                  if (ok) {
                    setCreating(false);
                    setName("");
                    load();
                  }
                });
              }}
            >
              <input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="新分支名"
                className="h-[26px] min-w-0 flex-1 rounded-md border border-line bg-input px-2 text-detail text-ink placeholder:text-ink-faint focus:border-ink-faint"
              />
              <button
                type="submit"
                disabled={busy || !name.trim()}
                className="h-[26px] shrink-0 rounded-md bg-ink px-2.5 text-detail font-medium text-shell disabled:opacity-40"
              >
                创建并切换
              </button>
            </form>
          )}

          {branches.local.map((branch) => (
            <BranchRow
              key={branch}
              name={branch}
              current={branch === current}
              busy={busy}
              onSwitch={() =>
                void act(() => bridge.git.switchBranch(cwd, branch))
              }
              onCompare={
                current && branch !== current
                  ? () => setCompare({ base: branch, head: current })
                  : undefined
              }
              /*
               * The app's own confirmation, not the browser's.
               *
               * `window.confirm` draws a Chromium dialog: system fonts, an OS-blue button, the
               * word "localhost" across the top, and it freezes the renderer while it is up. It
               * was the one place in the app that asked a question in someone else's voice.
               */
              onDelete={
                branch === current
                  ? undefined
                  : () =>
                      confirm.ask({
                        title: `删除分支 ${branch}？`,
                        detail:
                          "只删本地这一份。没有合并进别的分支的提交会跟着消失，除非你还记得它们的哈希。",
                        confirmLabel: "删除",
                        onConfirm: () =>
                          void act(() =>
                            bridge.git.deleteBranch(cwd, branch),
                          ).then(load),
                      })
              }
            />
          ))}

          {remotes.length > 0 && (
            <GroupHeader
              label="远程"
              count={remotes.length}
              action=""
              disabled
              onAction={() => {}}
            />
          )}
          {remotes.map((branch) => (
            <BranchRow
              key={branch}
              name={branch}
              current={false}
              busy={busy}
              remote
              onSwitch={() =>
                void act(() => bridge.git.switchBranch(cwd, branch))
              }
              onCompare={
                current
                  ? () => setCompare({ base: branch, head: current })
                  : undefined
              }
            />
          ))}
        </>
      )}

      {confirm.element}
    </Scroller>
  );
}
