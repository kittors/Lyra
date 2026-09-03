import { ChevronRight } from "lucide-react";
import { useState } from "react";

import type { WorkspaceDiffFile } from "../../../electron/ipc-types.ts";
import { BinaryDiff } from "./BinaryDiff.tsx";
import { DiffView } from "./DiffView.tsx";
import { iconColour, lookFor } from "../files/fileIcon.tsx";
import { SkeletonBar } from "../../ui/primitives/Skeleton.tsx";
import { Text } from "../../ui/primitives/Text.tsx";

/**
 * The last meaningful segment of a path.
 *
 * `split("/").pop()` is not enough: git reports an untracked *directory* as `.claude/`, whose
 * final segment is the empty string — which showed up in the list as a row with an icon, a
 * status letter, and no name at all.
 */
function baseName(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/** True for the trailing-slash form git uses when a whole directory is untracked. */
export function isDirectory(path: string): boolean {
  return path.endsWith("/");
}

/**
 * A list of changed files, each opening onto its own diff.
 *
 * An accordion rather than a list beside a viewer. Reading a change is *reading through* —
 * top to bottom — and being able to leave two files open next to each other is worth more than
 * jumping to one by name. It also needs no second column, which is what makes it work unchanged
 * in a 368px panel.
 *
 * Shared by all three of the panel's views, because "what changed" looks the same whether the
 * change is uncommitted, one commit old, or the distance between two branches. Only the row's
 * trailing controls differ, which is what `actions` is for.
 */
export function FileDiffList({
  files,
  actions,
  emptyLabel = "没有匹配的文件",
  initiallyOpen,
  cwd = null,
  loadingContent = false,
}: {
  files: WorkspaceDiffFile[];
  /**
   * The repository these files are in, when they are on this machine.
   *
   * Null for a pull request: those files are on a branch nobody has checked out, so a binary one
   * can be named and sized but not drawn. See `BinaryDiff`.
   */
  cwd?: string | null;
  /** Rendered at the end of a row — staging controls in the changes view, nothing elsewhere. */
  actions?: (file: WorkspaceDiffFile) => React.ReactNode;
  emptyLabel?: string;
  /** Open every file on first render. Used where the list is short by construction. */
  initiallyOpen?: boolean;
  /**
   * The rows are real but their diffs are still being read.
   *
   * The history view lists a commit's files before it has read any of them, so that the block
   * reaches its final height at once instead of jumping when the contents land. Until they do, an
   * opened file has no hunks — which is indistinguishable, from here, from a file that genuinely
   * has nothing to compare. Saying so wrongly is worse than saying nothing, hence the flag.
   */
  loadingContent?: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(() =>
    initiallyOpen ? new Set(files.map((file) => file.path)) : new Set(),
  );

  function toggle(path: string) {
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  }

  if (files.length === 0) {
    return (
      <Text as="p" size="label" tone="faint" className="px-2 py-6 text-center">
        {emptyLabel}
      </Text>
    );
  }

  return (
    <>
      {files.map((file) => {
        const expanded = open.has(file.path);
        const look = lookFor(baseName(file.path), isDirectory(file.path));
        return (
          <div key={file.path} className="group/row mb-0.5">
            {/*
             * Pinned to the top of its own file while that file is on screen.
             *
             * Scroll into a three-hundred-line diff and the question becomes "which file am
             * I in" — the name has to stay put to answer it. Each header sticks within its
             * own wrapper, so the next one pushes the last one out on the way past rather
             * than stacking up. The opaque fill is what makes that work: a transparent
             * sticky row has the diff scrolling through it.
             *
             * The fill is on `ly-pin`, which is square, rather than on the rounded row
             * inside it: a radius over a scrolling diff shows the row tints through its
             * corners, which is a red notch travelling up the header as you scroll.
             */}
            <div className="ly-pin sticky top-0 z-10">
              <div className="flex items-center gap-1 rounded-md pr-1 transition-colors hover:bg-card-hover">
                <button
                  type="button"
                  data-ly-tip={file.path}
                  onClick={() => toggle(file.path)}
                  aria-expanded={expanded}
                  className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-1 text-left"
                >
                  <ChevronRight
                    size={11}
                    strokeWidth={2.2}
                    className="shrink-0 text-ink-faint transition-transform duration-[var(--ly-t-quick)]"
                    style={expanded ? { transform: "rotate(90deg)" } : undefined}
                  />
                  <look.Icon
                    size={12.5}
                    strokeWidth={1.75}
                    className="shrink-0"
                    style={{ color: iconColour(look) }}
                  />
                  {/*
                   * The directory is what tells two `index.ts` apart, so it stays —
                   * truncated from the left, where the shared prefix is.
                   */}
                  <span
                    className="min-w-0 flex-1 truncate text-left text-detail text-ink-muted"
                    dir="rtl"
                  >
                    <span dir="ltr">{file.path}</span>
                  </span>
                  <Text size="caption" mono numeric className="shrink-0">
                    {file.added > 0 && (
                      <span className="text-ok">+{file.added}</span>
                    )}
                    {file.added > 0 && file.removed > 0 && " "}
                    {file.removed > 0 && (
                      <span className="text-danger">−{file.removed}</span>
                    )}

                  </Text>
                </button>
                {actions?.(file)}
              </div>
            </div>

            {/*
             * Flush, with no card around it.
             *
             * A rounded border here had to be clipped to stop the diff's square row tints
             * poking out of the corners — and that clip cut into the pinned line-number
             * column. Each row already has its own fill and the name above it sits on an
             * opaque strip, so the border was separating two things already legible apart.
             */}
            {expanded && (
              <div className="ly-enter mt-0.5 mb-1.5 border-y border-line-soft">
                {isDirectory(file.path) ? (
                  <Text
                    as="p"
                    size="detail"
                    tone="faint"
                    className="px-3 py-4 text-center"
                  >
                    整个目录都还没有被 Git 跟踪，暂时没有可对比的内容。
                  </Text>
                ) : file.binary ? (
                  // An image is shown, not described — see `BinaryDiff`.
                  <BinaryDiff cwd={cwd} file={file} />
                ) : file.hunks.length === 0 && loadingContent ? (
                  <div className="space-y-2 px-3 py-3" aria-hidden>
                    <SkeletonBar width="88%" height={10} />
                    <SkeletonBar width="64%" height={10} />
                    <SkeletonBar width="76%" height={10} />
                  </div>
                ) : file.hunks.length === 0 ? (
                  <Text
                    as="p"
                    size="detail"
                    tone="faint"
                    className="px-3 py-4 text-center"
                  >
                    这个文件没有可以按行对比的内容。
                  </Text>
                ) : (
                  <DiffView hunks={file.hunks} path={file.path} />
                )}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
