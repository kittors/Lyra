/**
 * What has already happened, with the graph beside it.
 */
import { GitCommitHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { GitCommit, WorkspaceDiffFile } from "../../../electron/ipc-types.ts";

import { PanelEmpty } from "../PanelEmpty.tsx";
import { SkeletonBar } from "../Skeleton.tsx";

import { Scroller } from "../Scroller.tsx";
import { ScrollText } from "../ScrollText.tsx";
import { Text } from "../Text.tsx";

import { CommitGraph, CommitThroughGraph, LANE_WIDTH } from "./CommitGraph.tsx";
import { withContents } from "./diff-merge.ts";
import { FileDiffList } from "./FileDiffList.tsx";
import { buildGraph, graphWidth } from "./graph.ts";
import { relativeTime } from "./relative-time.ts";
import { bridge } from "../../services/index.ts";

/** Fixed, because the graph has to know it to line its strokes up across rows. */
const ROW_HEIGHT = 46;

/**
 * How long a read may take before it is worth showing a placeholder for.
 *
 * Roughly the point where a delay stops reading as the click itself and starts reading as a
 * wait. Under it, saying nothing and then showing the answer is smoother than showing a
 * placeholder of the wrong height and then correcting it.
 */
const SLOW_ENOUGH_MS = 120;

/** The open commit and everything known about it so far. */
interface Expansion {
	sha: string;
	/** What changed. Empty until the listing arrives; contents fill in after. */
	files: WorkspaceDiffFile[];
	/** The list of files has not arrived yet, so there is nothing to lay out. */
	listing: boolean;
	/** The list is up, the diffs behind it are still being read. */
	reading: boolean;
	/** The wait passed `SLOW_ENOUGH_MS` and is worth acknowledging. */
	slow: boolean;
}

/**
 * The log, drawn as the graph it is.
 *
 * A flat list of subjects cannot answer the questions people actually bring to a history: where
 * did this branch off, when did it come back, what was on main while this was happening. Those
 * are shape, not text — so the shape is drawn. Each lane keeps one colour from the commit that
 * starts it to the merge that ends it, which is what makes a column followable.
 */
export function HistoryView({ cwd }: { cwd: string }) {
  const [commits, setCommits] = useState<GitCommit[]>([]);
  /*
   * One piece of state for the open commit, carrying which commit it is about.
   *
   * These were five separate values, and the loading flags were reset inside the effect — which
   * runs after the render that opened the row. So the first frame of every expansion was drawn with
   * the *previous* expansion's flags: the placeholder appeared for one frame before the code that
   * suppresses it had run, measurably, at 74px before dropping to nothing.
   *
   * Tying them together and stamping them with the sha makes that unrepresentable. A frame either
   * has this commit's state or it has none, and the reducer below can ignore anything arriving for
   * a commit that is no longer open without a separate guard for each request.
   */
  const [expansion, setExpansion] = useState<Expansion | null>(null);

  useEffect(() => {
    void bridge.git.log(cwd, 80).then(setCommits);
  }, [cwd]);

  /*
   * The file list first, the diffs after.
   *
   * Asking for both at once is what made expanding feel like a jolt. `commitDiff` reads every
   * changed file's two blobs and diffs each of them, which on this repository's largest commit is
   * 125 files and 557ms — so the block was laid out at the placeholder's 74px, held there for half
   * a second, and then jumped to 3974px. Nothing dropped a frame; the height simply arrived in two
   * instalments, and the second was fifty times the first.
   *
   * `commitDiffSummary` answers the part that decides the layout — which files, how many lines —
   * from `--name-status` and `--numstat` alone, measured at ~40ms. The rows are then real from the
   * start, at their final height, and the contents fill in underneath without moving anything.
   */
  const openSha = expansion?.sha ?? null;
  useEffect(() => {
    if (!openSha) return;
    let live = true;
    let contentArrived = false;
    /** Applied only if this commit is still the open one, which is the whole point of the stamp. */
    const update = (change: (current: Expansion) => Expansion) =>
      setExpansion((current) => (current && current.sha === openSha ? change(current) : current));

    const announce = setTimeout(() => {
      if (live) update((current) => ({ ...current, slow: true }));
    }, SLOW_ENOUGH_MS);

    void bridge.git
      .commitDiffSummary(cwd, openSha)
      .then((summary) => {
        // A small commit can have its diffs back first; the list must not overwrite them.
        if (!live || contentArrived) return;
        update((current) => ({ ...current, files: summary.files, listing: false }));
      })
      .catch(() => {});

    void bridge.git
      .commitDiff(cwd, openSha)
      .then((result) => {
        if (!live) return;
        contentArrived = true;
        update((current) => ({
          ...current,
          files: withContents(current.files, result.files),
          listing: false,
          reading: false,
        }));
      })
      .catch(() => {
        if (live) update((current) => ({ ...current, listing: false, reading: false }));
      });

    return () => {
      live = false;
      clearTimeout(announce);
    };
  }, [cwd, openSha]);

  const rows = useMemo(() => buildGraph(commits), [commits]);
  const width = useMemo(() => graphWidth(rows, LANE_WIDTH), [rows]);

  if (commits.length === 0) {
    return (
      <PanelEmpty icon={GitCommitHorizontal} title="没有提交">
        这个仓库还没有任何提交。
      </PanelEmpty>
    );
  }

  return (
    <Scroller className="flex-1" contentClassName="px-1.5 pb-2" top="none" bottom="none">
      {rows.map((row) => {
        const commit = row.commit;
        const state = expansion && expansion.sha === commit.sha ? expansion : null;
        const expanded = state !== null;
        return (
          <div key={commit.sha}>
            {/*
             * The graph column and the text share a row, and the graph is told the row's height
             * so its lines meet the ones above and below exactly.
             */}
            <div className="flex items-stretch">
              <CommitGraph row={row} height={ROW_HEIGHT} width={width} />
              <button
                type="button"
                onClick={() =>
                  setExpansion(
                    expanded
                      ? null
                      : { sha: commit.sha, files: [], listing: true, reading: true, slow: false },
                  )
                }
                aria-expanded={expanded}
                style={{ height: ROW_HEIGHT }}
                /* `ly-scroll` is what lets the subject scroll on hover — the marquee keys off an
                 * ancestor carrying it, which is why the same component scrolls in the sidebar
                 * and merely clipped here. */
                className="ly-scroll flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 text-left transition-colors hover:bg-card-hover"
              >
                <span className="min-w-0 flex-1">
                  {/*
                   * Scrolled on hover rather than cut off. A commit subject is the one line that
                   * says what a commit was for, and the useful half is regularly past the ellipsis
                   * — the same reason session titles in the sidebar scroll instead of truncating.
                   */}
                  <ScrollText text={commit.subject} className="ly-fade-tail block text-label" />
                  <span className="flex items-center gap-1.5">
                    <Text size="caption" tone="faint" mono>
                      {commit.shortSha}
                    </Text>
                    <Text size="caption" tone="faint" className="truncate">
                      {commit.author} · {relativeTime(commit.date)}
                    </Text>
                  </span>
                </span>
                {/*
                 * Badges give way before the subject does.
                 *
                 * A branch name like `origin/fix/forwarded-chain-diagnostics` is wider than half
                 * this panel, and as an unshrinkable box it pushed the whole row past the panel's
                 * edge — subject, refs and all, running out of the window. They shrink three times
                 * as readily as the subject, so the line stays inside and the name that got cut is
                 * a hover away.
                 */}
                {commit.refs.length > 0 && (
                  <span className="flex min-w-0 shrink-[3] gap-1 overflow-hidden">
                    {commit.refs.slice(0, 2).map((ref) => (
                      <Text
                        key={ref}
                        size="caption"
                        tone="muted"
                        title={ref}
                        className="max-w-[132px] shrink truncate rounded border border-line px-1 py-px"
                      >
                        {ref}
                      </Text>
                    ))}
                  </span>
                )}
              </button>
            </div>
            {/*
             * The breathing room below an expansion is padding on the text side, not a margin on
             * the row.
             *
             * As a margin it sat outside the box the graph column stretches to, so the lane stopped
             * six pixels short of the next commit's line and left a visible break in what is meant
             * to read as one continuous branch. Same gap on screen either way; this way the graph
             * spans it.
             */}
            {state && (state.slow || !state.listing) && (
              <div className="ly-enter flex items-stretch">
                <CommitThroughGraph row={row} width={width} />
                <div className="min-w-0 flex-1 pb-1.5 pl-2 pr-1">
                  {state.listing ? (
                    <div className="space-y-2 py-2.5 pr-2" aria-hidden>
                      <div className="flex items-center gap-2">
                        <SkeletonBar width="12px" height={12} className="shrink-0 !rounded-xs" />
                        <SkeletonBar width="65%" height={10} />
                      </div>
                      <div className="flex items-center gap-2">
                        <SkeletonBar width="12px" height={12} className="shrink-0 !rounded-xs" />
                        <SkeletonBar width="82%" height={10} />
                      </div>
                      <div className="flex items-center gap-2">
                        <SkeletonBar width="12px" height={12} className="shrink-0 !rounded-xs" />
                        <SkeletonBar width="48%" height={10} />
                      </div>
                    </div>
                  ) : (
                    <FileDiffList
                      files={state.files}
                      loadingContent={state.reading}
                      emptyLabel="这次提交没有文件改动"
                    />
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </Scroller>
  );
}

/** Fixed, because the graph has to know it to line its strokes up across rows. */
