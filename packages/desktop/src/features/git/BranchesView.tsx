/**
 * Branches, and the diff between any two of them.
 */
import { Input } from "../../ui/inputs/NativeField.tsx";
import { ArrowLeft, GitBranchPlus, FolderGit2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { GitStatus, WorkspaceDiffFile } from "../../../electron/ipc-types.ts";
import type { BranchList, RepoRef } from "../../../electron/git.ts";

import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";

import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { SkeletonList, useSlowLoad } from "../../ui/primitives/Skeleton.tsx";
import { Text } from "../../ui/primitives/Text.tsx";
import { IconButton } from "../../ui/primitives/IconButton.tsx";

import { FileDiffList } from "./FileDiffList.tsx";

import { BranchRow } from "./BranchRow.tsx";
import { GroupHeader } from "./GroupHeader.tsx";
import type { Act } from "./types.ts";
import { bridge } from "../../services/index.ts";
import { useI18n } from "../../i18n/index.ts";

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
	const { t } = useI18n();
  const [branches, setBranches] = useState<BranchList | null>(null);
  const slow = useSlowLoad(branches === null);
  const [revision, setRevision] = useState(0);
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

  const load = useCallback(() => setRevision((value) => value + 1), []);
  useEffect(() => {
    let live = true;
    void bridge.git.branches(cwd).then((result) => { if (live) setBranches(result); });
    return () => { live = false; };
  }, [cwd, revision, status?.branch]);

  useEffect(() => {
    setDiff(null);
    if (!compare) return;
    let live = true;
    void bridge.git
      .diffRefs(cwd, compare.base, compare.head)
      .then((result) => live && setDiff(result));
    return () => {
      live = false;
    };
  }, [cwd, compare]);

  if (branches === null) return slow ? <SkeletonList count={5} label={t("branches.reading")} /> : null;
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
    <Scroller className="flex-1" contentClassName="px-1.5 pb-2">
      {compare ? (
        <>
          <div className="flex items-center gap-1.5 px-1 py-1.5">
            <Text size="label" tone="muted" className="min-w-0 truncate">
              <span className="text-ink">{compare.base}</span>
              <span className="px-1 text-ink-faint">→</span>
              <span className="text-ink">{compare.head}</span>
            </Text>
			<IconButton size="sm" icon={<ArrowLeft size={13} />} label={t("branches.back")} onClick={() => setCompare(null)} />
            {diff && (
              <Text size="caption" mono numeric className="ml-auto shrink-0">
                <span className="text-ok">+{diff.added}</span>{" "}
                <span className="text-danger">−{diff.removed}</span>
              </Text>
            )}
          </div>
          <FileDiffList
            files={diff?.files ?? []}
            emptyLabel={diff ? t("branches.identical") : t("branches.comparing")}
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
							<GroupHeader label={t("common.workspace")} count={checkouts.length} />
              {checkouts.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  data-ly-tip={entry.path}
                  aria-current={entry.path === cwd ? "location" : undefined}
                  onClick={() => onSelectRepo(entry.path)}
                  className={`ly-scroll flex w-full items-center gap-1.5 rounded-md py-1 pr-1.5 text-left transition-colors ${
                    entry.worktree ? "pl-5" : "pl-1.5"
                  } ${entry.path === cwd ? "text-accent" : "text-ink-muted hover:text-ink"}`}
                >
                  {entry.worktree ? (
                    <GitBranchPlus size={12} strokeWidth={1.8} className={`shrink-0 ${entry.path === cwd ? "text-accent" : "text-ink-faint"}`} />
                  ) : (
                    <FolderGit2 size={12} strokeWidth={1.8} className={`shrink-0 ${entry.path === cwd ? "text-accent" : "text-ink-faint"}`} />
                  )}
                  {/* The name identifies the checkout; the branch qualifies it. Names keep their
                   * width and branches give theirs up, or `CliRelay-wt-audit` becomes `CliR…`. */}
                  <ScrollText text={entry.label} className={`min-w-0 shrink text-label ${entry.path === cwd ? "text-accent" : "text-ink-muted"}`} />
                  <ScrollText text={entry.branch ?? t("sync.detached")} className={`ml-auto min-w-0 shrink-[4] text-caption ${entry.path === cwd ? "text-accent" : "text-ink-faint"}`} />

                </button>
              ))}
            </>
          )}

          <GroupHeader
            label={t("common.local")}
            count={branches.local.length}
						actions={
							<IconButton
								label={creating ? t("branches.cancelNew") : t("branches.new")}
								icon={creating ? <X size={13} strokeWidth={1.9} /> : <GitBranchPlus size={13} strokeWidth={1.9} />}
								size="sm"
								disabled={busy}
								onClick={() => {
									setCreating(!creating);
									setName("");
								}}
							/>
						}
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
              <Input
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("branches.namePlaceholder")}
                className="h-[26px] min-w-0 flex-1 rounded-md border border-line bg-input px-2 text-detail text-ink placeholder:text-ink-faint focus:border-ink-faint"
              />
              <button
                type="submit"
                aria-label={t("branches.createAndSwitch")}
                data-ly-tip={t("branches.createAndSwitch")}
                disabled={busy || !name.trim()}
                className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md bg-ink text-detail font-medium text-shell disabled:opacity-40"
              >
                <GitBranchPlus size={14} />
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
                        title: t("branches.deleteConfirm", { branch }),
                        detail:
                          t("branches.deleteDetail"),
                        confirmLabel: t("common.delete"),
                        onConfirm: () =>
                          void act(() =>
                            bridge.git.deleteBranch(cwd, branch),
                          ).then(load),
                      })
              }
            />
          ))}

          {remotes.length > 0 && (
						<GroupHeader label={t("common.remote")} count={remotes.length} />
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
