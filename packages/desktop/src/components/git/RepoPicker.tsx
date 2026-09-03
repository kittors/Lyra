/**
 * Which repository the panel is looking at.
 */
import { Check, ChevronDown, Folder, GitBranchPlus } from "lucide-react";

import type { RepoRef } from "../../../electron/git.ts";

import { MENU_MAX_HEIGHT, MenuBody, MenuItem, Popover, usePopover } from "../../ui/overlay/Popover.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { Text } from "../../ui/primitives/Text.tsx";


/**
 * The repository this panel is looking at, and everywhere else it could look.
 *
 * A workspace is a folder someone opened. Plenty of them hold several repositories — a frontend
 * beside a backend, services versioned apart on purpose — and any repository may have worktrees,
 * which are further checkouts of the same history on other branches. All of it was being found
 * and none of it was reachable: the panel picked whichever repository sorted first and gave no
 * way to say otherwise.
 *
 * Worktrees are nested under the repository they belong to rather than listed as peers, because
 * that is what they are. Sharing one history is the whole point of a worktree, and a flat list
 * would put two checkouts of the same project side by side as though they were separate work.
 */
export function RepoPicker({
  repos,
  trees,
  selected,
  onSelect,
}: {
  repos: RepoRef[];
  trees: Record<string, RepoRef[]>;
  selected: string | null;
  onSelect: (path: string) => void;
}) {
  const menu = usePopover();
  const everything = repos.flatMap((repo) => [repo, ...(trees[repo.path] ?? [])]);
  const current = everything.find((entry) => entry.path === selected) ?? repos[0];
  const total = everything.length;

  return (
    <>
      <button
        type="button"
        onClick={menu.toggle}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        data-ly-tip={`${repos.length} 个仓库${
          total > repos.length ? ` · ${total - repos.length} 个工作树` : ""
        } · 点击切换`}
        data-ly-tip-side="bottom"
        className={`ly-scroll flex h-8 shrink-0 items-center gap-1.5 border-b border-line-soft px-2.5 text-left transition-colors ${
          menu.open ? "bg-card-hover" : "hover:bg-card-hover"
        }`}
      >
        {current?.worktree ? (
          <GitBranchPlus size={12.5} strokeWidth={1.8} className="shrink-0 text-ink-faint" />
        ) : (
          <Folder size={12.5} strokeWidth={1.8} className="shrink-0 text-ink-faint" />
        )}
        <ScrollText text={current?.label ?? "仓库"} className="ly-fade-tail min-w-0 flex-1 text-label" />
        {/* A bare total says nothing about what it counts; the split does. */}
        <Text size="caption" tone="faint" className="shrink-0 tabular-nums">
          {repos.length}
          {total > repos.length && <span className="pl-1">+{total - repos.length}</span>}
        </Text>
        <ChevronDown size={12} strokeWidth={1.9} className="shrink-0 text-ink-faint" />
      </button>

      {menu.open && (
        <Popover
          anchor={menu.anchor}
          onClose={menu.close}
          placement="bottom"
          align="start"
          width="wide"
          maxHeight={MENU_MAX_HEIGHT}
          label="切换仓库"
        >
          {/*
           * The app's own menu parts, not a hand-rolled list.
           *
           * This was a bare scrolling div with rows built here — which meant its own row height,
           * its own padding and a scrollbar the rest of the app does not show, sitting a few
           * pixels away from menus that had all three settled long ago. The surface brings the
           * hidden bar and the faded edge now; `MenuItem` brings the two-line row this needs.
           */}
          <MenuBody>
            {repos.map((repo) => (
              <div key={repo.path}>
                <MenuItem
                  icon={<Folder size={13} strokeWidth={1.8} />}
                  detail={repo.branch ?? "游离 HEAD"}
                  selected={repo.path === selected}
                  title={repo.path}
                  trailing={repo.path === selected ? <Check size={12.5} strokeWidth={2.2} /> : undefined}
                  onClick={() => {
                    onSelect(repo.path);
                    menu.close();
                  }}
                >
                  {repo.label}
                </MenuItem>
                {(trees[repo.path] ?? []).map((tree) => (
                  <MenuItem
                    key={tree.path}
                    // A worktree is a checkout of the repository above it; the mark says which.
                    icon={<GitBranchPlus size={13} strokeWidth={1.8} />}
                    detail={tree.branch ?? "游离 HEAD"}
                    selected={tree.path === selected}
                    title={tree.path}
                    trailing={tree.path === selected ? <Check size={12.5} strokeWidth={2.2} /> : undefined}
                    onClick={() => {
                      onSelect(tree.path);
                      menu.close();
                    }}
                  >
                    {tree.label}
                  </MenuItem>
                ))}
              </div>
            ))}
          </MenuBody>
        </Popover>
      )}
    </>
  );
}
