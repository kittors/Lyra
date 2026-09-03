import { Activity, ArrowDownToLine, ArrowUpFromLine, GitBranch, GitCommitHorizontal, GitCompare, RefreshCw, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLiveRefresh } from "../../ui/hooks/useLiveRefresh.ts";
import { useDock } from "../dock/index.ts";
import { kinds } from "../dock/index.ts";
import { paneVisible } from "../dock/index.ts";
import { useLayout } from "../../app/layout.tsx";
import { syncPlan, type SyncButton } from "./syncPlan.ts";
import { Spinner } from "../../ui/motion/loaders.tsx";

import type { GitStatus } from "../../../electron/ipc-types.ts";
import type { RepoRef } from "../../../electron/git.ts";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { PanelEmpty } from "../../ui/layout/PanelEmpty.tsx";

import { Text } from "../../ui/primitives/Text.tsx";
import { useApp } from "../../store/index.ts";

import { BranchesView } from "./BranchesView.tsx";
import { ChangesView } from "./ChangesView.tsx";
import { HistoryView } from "./HistoryView.tsx";
import { PipelinesView } from "./PipelinesView.tsx";
import { ReleaseModal } from "./ReleaseModal.tsx";
import { RepoPicker } from "./RepoPicker.tsx";
import { sameStatus } from "./sameStatus.ts";
import { SkeletonList, useSlowLoad } from "../../ui/primitives/Skeleton.tsx";
import { CountUp } from "../../ui/primitives/CountUp.tsx";
import { useNarrow } from "../../ui/hooks/useNarrow.ts";
import { bridge } from "../../services/index.ts";

type View = "changes" | "history" | "branches" | "pipelines";

/**
 * How often the panel asks the remote what it has, unprompted.
 *
 * What it is watching for is someone else pushing, which is not a per-second question — and every
 * tick is a network call on a laptop that may be on a phone tether. Long enough to be free,
 * short enough that 「远端领先 3 个提交」 shows up while it still matters.
 */
const QUIET_FETCH_INTERVAL_MS = 5 * 60_000;

/**
 * One of the two sync controls: an icon, or a word when the row can spare the space.
 *
 * The row is icons by default because that is what fits, and a badge is enough to say a number is
 * involved. But 「推送 1」 is a sentence and `↑¹` is a puzzle, so when there is room the one control
 * worth pressing spells itself out. Only that one — three words in a row would be a toolbar
 * shouting, and the point of the emphasis is that exactly one thing stands out.
 */
function SyncControl({
	icon,
	word,
	state,
	running,
	disabled,
	roomForWords,
	onClick,
}: {
	icon: React.ReactNode;
	/** The verb, for the wide form. */
	word: string;
	state: SyncButton;
	running: boolean;
	disabled: boolean;
	roomForWords: boolean;
	onClick: () => void;
}) {
	const [hovered, setHovered] = useState(false);
	const label = running ? `取消${word}` : state.tip;
	const currentIcon = running ? (hovered ? <X size={12} strokeWidth={2} className="text-ink" /> : <Spinner size={12} />) : icon;

	// Words only for the emphasised control, only when it is idle, and only when the row is wide
	// enough that spelling it out does not push the branch name out of view.
	if (!roomForWords || !state.emphasis || running) {
		return (
			<span
				onMouseEnter={() => setHovered(true)}
				onMouseLeave={() => setHovered(false)}
				className="inline-flex"
			>
				<IconButton
					icon={currentIcon}
					label={label}
					size="sm"
					disabled={disabled}
					explainDisabled={state.disabled}
					emphasis={state.emphasis}
					badge={running ? null : state.count}
					onClick={onClick}
				/>
			</span>
		);
	}
	return (
		<button
			type="button"
			aria-label={label}
			data-ly-tip={label}
			data-ly-count={state.count === null ? undefined : String(state.count)}
			disabled={disabled}
			onClick={onClick}
			onMouseEnter={() => setHovered(true)}
			onMouseLeave={() => setHovered(false)}
			className="flex h-[22px] shrink-0 items-center gap-1 rounded-md px-1.5 text-caption font-medium text-ink transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover active:bg-elevated disabled:opacity-40"
		>
			{currentIcon}
			<span className="tabular-nums">{state.count === null ? word : `${word} ${state.count}`}</span>
		</button>
	);
}

/**
 * Is the git panel actually on screen?
 *
 * Being mounted is not the same thing: the dock hides a pane with a `hidden` class rather than
 * unmounting it, so this component keeps running behind a maximised neighbour and in every other
 * tab of a narrow window. The background fetch has to stop for those, or it goes on making network
 * calls for a panel nobody is looking at.
 */
function useGitPaneOnScreen(): boolean {
  const tree = useDock((s) => s.tree);
  const maximized = useDock((s) => s.maximized);
  const focused = useDock((s) => s.focused);
  const { compact } = useLayout();

  return paneVisible("review", {
    present: kinds(tree),
    maximized: maximized?.panes ?? null,
    compact,
    focused,
  });
}

const VIEWS: { id: View; label: string; icon: typeof GitCompare }[] = [
  { id: "changes", label: "改动", icon: GitCompare },
  { id: "history", label: "历史", icon: GitCommitHorizontal },
  { id: "branches", label: "分支", icon: GitBranch },
  { id: "pipelines", label: "流水线", icon: Activity },
];

/**
 * Git, as a place rather than a button.
 *
 * Committing used to live in a popover hanging off the composer's status bar: one message field
 * and one button that staged everything. That is the shape of a shortcut, and it can only ever
 * be a shortcut — there is nowhere in it to see what you are about to commit, to leave half of
 * it out, to look at what happened yesterday, or to compare two branches. Those are the reasons
 * you open a git client, and none of them fit above a text field.
 *
 * Three views, because there are three questions: what is changing now, what changed before,
 * and what else is going on. They share one file list, since "what changed" renders the same
 * whether the change is uncommitted, a commit old, or the distance between two branches.
 */
export function GitPanel() {
  const workspace = useApp((s) => s.workspace);
  const running = useApp((s) => s.running);
  const [view, setView] = useState<View>("changes");
  /*
   * Which repository the panel is looking at.
   *
   * A workspace is a folder someone opened, and it is perfectly ordinary for one to hold
   * several repositories — a frontend beside a backend, or services versioned apart on purpose.
   * Assuming the root was the repository meant everything else was invisible.
   */
  const [repos, setRepos] = useState<RepoRef[]>([]);
  /** True until the first scan finishes, so "no repository" is only said once it is known. */
  const [scanning, setScanning] = useState(true);
  /** Bumped to re-run the scan after something changes what it would find. */
  const [rescan, setRescan] = useState(0);
  /** Worktrees per repository, keyed by the repository's path. */
  const [trees, setTrees] = useState<Record<string, RepoRef[]>>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState<GitStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [narrowNav, navRef] = useNarrow(330);
  /*
   * Whether the sync row can spell out the step it is offering.
   *
   * Measured on the row rather than on the window: the same panel runs narrow in a split dock and
   * across half a wide screen. 260 because 「推送 1」 costs about 30px more than the icon alone, and
   * below that the branch name — which is the thing that says where you are — starts losing
   * characters to pay for it.
   */
  const [narrowSyncRow, syncRowRef] = useNarrow(260);
  const roomForWords = !narrowSyncRow;

  /*
   * Rescan when the workspace changes; the selection follows unless it is still valid.
   *
   * Each repository is asked for its worktrees at the same time. A worktree has a `.git` of its
   * own, so the directory scan finds it and would list it a second time as a repository in its
   * own right — the same branch of the same history appearing twice, under two names. Anything
   * claimed by a repository as a worktree is therefore removed from the top level and shown
   * beneath the repository it belongs to.
   */
  const workspacePath = workspace?.path ?? null;
  useEffect(() => {
    if (!workspacePath) {
      setRepos([]);
      setTrees({});
      setScanning(false);
      return;
    }
    let cancelled = false;
    setScanning(true);
    void (async () => {
      const found = await bridge.git.repos(workspacePath);
      const lists = await Promise.all(
        found.map(async (repo) => [repo.path, await bridge.git.worktrees(repo.path)] as const),
      );
      if (cancelled) return;

      const linked = new Map<string, RepoRef[]>();
      const claimed = new Set<string>();
      for (const [root, all] of lists) {
        const attached = all.filter((tree) => tree.worktree);
        linked.set(root, attached);
        for (const tree of attached) claimed.add(tree.path);
      }
      const roots = found.filter((repo) => !claimed.has(repo.path));

      setRepos(roots);
      setTrees(Object.fromEntries(roots.map((repo) => [repo.path, linked.get(repo.path) ?? []])));
      setSelected((current) => {
        const reachable = [...roots.map((r) => r.path), ...claimed];
        return current && reachable.includes(current) ? current : (roots[0]?.path ?? null);
      });
      setScanning(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [workspacePath, rescan]);

  /*
   * Only a real repository, never the workspace root as a stand-in.
   *
   * Falling back to the folder meant every panel below this had something to work with, so a
   * directory with no version control at all rendered as a repository with no branch: a dash
   * where the name goes, pull and push buttons that could not do anything, and "工作区干净"
   * announcing that nothing had changed in a history that did not exist.
   */
  const cwd = selected;

  /*
   * Go and read it, and keep the object we already had when nothing moved.
   *
   * A poll that returns an equal-but-new object is a change as far as React is concerned, so every
   * 1.5s tick re-ran `ChangesView`'s effect — which fetches the whole working-tree diff. That read
   * is slower than the interval it is started on, so the panel spent every turn queued behind
   * itself, which is what "the git panel stutters and takes ages" was. See `sameStatus`.
   */
  const read = useCallback(async () => {
    if (!cwd) {
      setStatus(null);
      return;
    }
    const next = await bridge.git.status(cwd);
    setStatus((current) => (sameStatus(current, next) ? current : next));
  }, [cwd]);

  /*
   * The same read, shared by whoever asks for it at the same moment.
   *
   * Two effects want a status the instant this mounts — the branch watcher below and
   * `useLiveRefresh` — so opening the panel spawned two identical `git status` processes and raced
   * their answers.
   *
   * Deliberately *not* what `act` uses. Sharing is only correct for callers that want "a status",
   * and an operation that has just staged a file wants "the status *after* that" — handing it a
   * read already in flight when the click landed would show the list from before its own change.
   */
  const inflight = useRef<Promise<void> | null>(null);
  const refresh = useCallback(() => {
    if (inflight.current) return inflight.current;
    const flight = read().finally(() => {
      inflight.current = null;
    });
    inflight.current = flight;
    return flight;
  }, [read]);

  /*
   * Re-read from scratch when the checkout moves under us, and say so while it happens.
   *
   * Switching branch changes every answer this panel gives, and `git status` on a large repository
   * takes long enough to notice — during which the list on screen belongs to the branch you just
   * left. Showing the old branch's files under the new branch's name is worse than showing
   * nothing: it is wrong, and nothing about it says so.
   *
   * Only on a real move. The poll behind `useLiveRefresh` runs every 1.5s while a turn works, and
   * flashing a skeleton at that rate would make the panel unreadable — those re-reads replace the
   * list in place, which is right for "the agent just edited a file".
   */
  const branch = workspace?.branch ?? null;
  const [switching, setSwitching] = useState(false);
  useEffect(() => {
    if (!cwd) return;
    let alive = true;
    setSwitching(true);
    void refresh().finally(() => {
      if (alive) setSwitching(false);
    });
    return () => {
      alive = false;
    };
  }, [cwd, branch, refresh]);

  /*
   * Live while the agent works, not once it has finished.
   *
   * The edits this panel exists to show arrive throughout a turn, and re-reading only when the turn
   * settled meant watching an agent rewrite a file and seeing nothing here for minutes. See
   * `useLiveRefresh` for why this polls rather than listening to tool results.
   */
  useLiveRefresh(refresh, running);

  /** Wraps an operation so every one of them reports the same way and re-reads after. */
  const act = useCallback(
    async (operation: () => Promise<{ ok: boolean; error?: string }>) => {
      setBusy(true);
      setError(null);
      const result = await operation();
      if (!result.ok) setError(result.error ?? "操作失败");
      // `read`, not `refresh`: this one has to see what the operation just did — see above.
      await read();
      setBusy(false);
      return result.ok;
    },
    [read],
  );

  /*
   * The remote calls, which are the only ones that can hang.
   *
   * `sync` holds which of the three is running, so the row can spin that one and disable the other
   * two, and `token` is how the call is reached to cancel it — an `AbortSignal` cannot cross IPC,
   * so its name does instead. Pressing the spinning button again sends the name back.
   */
  const [sync, setSync] = useState<"pull" | "push" | "fetch" | null>(null);
  const token = useRef<string | null>(null);

  const remote = useCallback(
    async (kind: "pull" | "push" | "fetch", call: (id: string) => Promise<{ ok: boolean; error?: string; cancelled?: boolean }>) => {
      // Already running: this press means stop, not start again.
      if (sync) {
        if (token.current) void bridge.git.cancelRemote(token.current);
        return;
      }
      const id = `${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      token.current = id;
      setSync(kind);
      setError(null);
      const result = await call(id);
      token.current = null;
      // A cancellation says nothing: the person watching is the one who stopped it.
      if (!result.ok && !result.cancelled) setError(result.error ?? "操作失败");
      await read();
      setSync(null);
    },
    [read, sync],
  );

  /*
   * Ask the remote what it has, without anyone noticing.
   *
   * `ahead` and `behind` are computed against the remote-tracking refs, which only move when
   * something fetches — so on a panel that never did, `behind` could not become non-zero at all and
   * `ahead` described whenever the repository was last touched by hand. This is what makes those
   * two numbers about the present.
   *
   * Silent in every direction: no spinner, no disabled buttons, and failures are dropped on the
   * floor. Being offline is the ordinary condition of a laptop, not an error worth a red bar, and a
   * background refresh that interrupts is worse than one that quietly does not happen.
   */
  const quietFetch = useCallback(async () => {
    if (!cwd) return;
    const result = await bridge.git.fetch(cwd, undefined, true);
    if (result.ok) await read();
  }, [cwd, read]);

  /*
   * Once on arrival, then every few minutes for as long as anyone is looking.
   *
   * "Looking" has to be asked of the dock rather than inferred from being mounted: a hidden pane is
   * hidden with a `hidden` class, so this component stays alive behind a maximised neighbour and in
   * every other tab of a narrow window. Left to unmount, the timer would go on fetching for panels
   * nobody has on screen.
   *
   * Five minutes because the thing being watched is other people pushing, which is not a per-second
   * question — and because each tick is a network call on someone's laptop.
   */
  const onScreen = useGitPaneOnScreen();
  useEffect(() => {
    if (!cwd || !onScreen) return;
    void quietFetch();
    const timer = setInterval(() => void quietFetch(), QUIET_FETCH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [cwd, onScreen, quietFetch]);

  /*
   * Above every early return, because it is a hook.
   *
   * There are three exits below this line — no workspace, still scanning, no checkout — and a hook
   * placed after them runs on some renders and not others. React counts hooks per render and
   * refuses a count that changes: switching between conversations flips `workspace` and `scanning`
   * often enough that clicking down a list of them was enough to take the window out with
   * "Rendered fewer hooks than expected" (#310).
   *
   * Nothing below needs it before this point, and computing a count from a null status is free.
   */
  const changeCount =
    (status?.staged.length ?? 0) + (status?.unstaged.length ?? 0);

  /*
   * Everything the sync row and the empty state say, worked out in one place.
   *
   * Memoised because it is read by two children and rebuilt objects would defeat their memos; and
   * derived rather than stored so there is exactly one answer on screen at a time — the row and the
   * empty state disagreeing about whether a push is due is the failure this replaces.
   */
  const plan = useMemo(() => syncPlan(status, { running }), [status, running]);
  /*
   * Nothing is known yet: the repositories are still being found, or the one that was found has
   * not answered about its state.
   *
   * Both are the same situation and the panel has to treat them alike, which it did not. Once the
   * scan finished it drew the whole panel from a null status, so a repository with two hundred
   * uncommitted files announced 「工作区干净 · 没有未提交的改动」 and took it back 76ms later —
   * measured, frame by frame. A wrong answer stated confidently is worse than no answer, and the
   * count above the tabs then travelled up from zero as though two hundred files had just been
   * changed while you watched.
   */
  const unread = scanning || (cwd !== null && status === null);
  /*
   * A placeholder only for a wait long enough to be one.
   *
   * These reads are now fast enough to finish inside a couple of frames on an ordinary repository,
   * and a skeleton that appears and goes in 70ms is a flicker — which reads as a glitch, not as
   * progress. `useSlowLoad` holds it back until the wait is real; under the threshold the panel
   * simply arrives.
   */
  const slowUnread = useSlowLoad(unread);
  const slowSwitch = useSlowLoad(switching);

  if (!workspace) {
    return (
      <PanelEmpty icon={GitBranch} title="Git">
        先打开一个项目。
      </PanelEmpty>
    );
  }

  /*
   * Say nothing until there is something to say — but draw the shape of it.
   *
   * This used to be a bare `<div className="flex-1" />` while the scan ran: an empty rectangle for
   * however long it took, then a fully populated panel in one frame, with nothing in between to
   * say a load was happening. The skeleton stands in the same boxes the rows will occupy, so the
   * arrival is the content landing rather than the layout appearing.
   *
   * Under `useSlowLoad`'s threshold there is still nothing, deliberately: a wait nobody noticed
   * should not be announced.
   */
  if (unread) {
    return slowUnread ? (
      <div className="ly-enter flex-1 px-1.5 pt-2">
        <SkeletonList count={5} label="正在读取仓库" />
      </div>
    ) : (
      <div className="flex-1" />
    );
  }

  /*
   * git could not answer, which is not the same as answering no.
   *
   * The panel used to draw the sentence below for both, so a repository git had refused to read —
   * one owned by another user, or with no git on the path at all — was described as having no
   * version control, under a button offering to initialise it. Two wrong claims and one dangerous
   * suggestion. When the main process could not get an answer it now says what stopped it and
   * offers to have the Agent diagnose/fix it rather than misleading the user.
   */
  if (workspace.gitProblem) {
    return (
      <PanelEmpty icon={GitBranch} title="Git 仓库异常">
        <span className="block text-ink-muted">{workspace.gitProblem}</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            useApp
              .getState()
              .setComposerDraft(
                `当前项目的 Git 状态异常，无法正常读取仓库信息。\n报错详情：${workspace.gitProblem}\n\n请帮我分析原因并修复此 Git 问题（例如检查 PATH、目录安全配置 safe.directory、或者修复损坏的索引等）。`,
                true,
              );
          }}
          className="mt-3 flex h-[28px] items-center gap-1.5 rounded-md bg-ink px-3 text-detail font-medium text-shell transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Sparkles size={13} strokeWidth={2} />
          让 Agent 诊断并修复
        </button>
      </PanelEmpty>
    );
  }

  if (!cwd) {
    return (
      <PanelEmpty icon={GitBranch} title="未检测到 Git 仓库">
        <span className="block text-ink-muted">当前目录尚未建立 Git 版本控制。</span>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void act(() => bridge.git.init(workspace.path)).then((ok) => {
                // Re-scan rather than assume: the new repository has to come back through the
                // same path as any other, or the panel would be showing something it invented.
                if (ok) setRescan((n) => n + 1);
              });
            }}
            className="h-[28px] rounded-md bg-ink px-3 text-detail font-medium text-shell transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            初始化仓库
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              useApp
                .getState()
                .setComposerDraft(
                  `请帮我检查当前目录（${workspace.path}）的 Git 仓库状态，并协助我完成 Git 版本控制的初始化与初始提交配置。`,
                  true,
                );
            }}
            className="flex h-[28px] items-center gap-1.5 rounded-md border border-line bg-card px-3 text-detail font-medium text-ink transition-colors hover:bg-card-hover disabled:opacity-40"
          >
            <Sparkles size={13} strokeWidth={2} className="text-accent" />
            让 Agent 处理
          </button>
        </div>
      </PanelEmpty>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/*
       * Which checkout everything below is about.
       *
       * Only when there is a choice to make. One repository with no worktrees is the common case
       * and needs no row telling you so — the branch line underneath already says where you are.
       */}
      {(repos.length > 1 || Object.values(trees).some((list) => list.length > 0)) && (
        <RepoPicker
          repos={repos}
          trees={trees}
          selected={cwd}
          onSelect={setSelected}
        />
      )}

      {/*
       * Where you are, and the three things you do with a remote.
       *
       * The tag that used to sit at the end of this row is gone — cutting a release is not a fourth
       * step of syncing, and at 12px it read as one more grey diamond in a row of grey diamonds. It
       * lives in the pipelines view now, which is where the rest of releasing already was.
       *
       * What each control says about itself comes from `syncPlan`; nothing is decided here.
       */}
      {/*
       * `data-ly-sync`: the row's state, readable from outside.
       *
       * What this row claims — which single control is the next step, and what the branch line says
       * about where you are — is only checkable against the thing actually drawn. The same reason
       * `data-ly-run` exists on a tool group.
       */}
      <div
        ref={syncRowRef}
        className="flex h-8 shrink-0 items-center gap-1.5 px-2.5"
        data-ly-sync={status?.remoteState ?? "none"}
        data-ly-branch={`${plan.branch}${plan.detail ? ` · ${plan.detail}` : ""}`}
      >
        <GitBranch
          size={12.5}
          strokeWidth={1.8}
          className="shrink-0 text-ink-faint"
        />
        <Text size="label" tone="muted" className="min-w-0 truncate">
          <span className="text-ink">{plan.branch}</span>
          {plan.detail && <span className="pl-1.5 text-ink-faint">{plan.detail}</span>}
        </Text>
        {/* The counts used to be repeated here in small grey text. They are on the buttons now,
            where the thing you would do about them is. */}
        <div className="min-w-1 flex-1" />
        <SyncControl
          icon={<ArrowDownToLine size={12} strokeWidth={1.9} />}
          word="拉取"
          state={plan.pull}
          running={sync === "pull"}
          // Only the one that is running stays pressable, and pressing it again cancels it.
          disabled={plan.pull.disabled || busy || (sync !== null && sync !== "pull")}
          roomForWords={roomForWords}
          onClick={() => void remote("pull", (id) => bridge.git.pull(cwd, id))}
        />
        <SyncControl
          icon={<ArrowUpFromLine size={12} strokeWidth={1.9} />}
          word={plan.push.count === null && plan.branch !== "—" && status?.remoteState === "no-upstream" ? "发布" : "推送"}
          state={plan.push}
          running={sync === "push"}
          disabled={plan.push.disabled || busy || (sync !== null && sync !== "push")}
          roomForWords={roomForWords}
          onClick={() => void remote("push", (id) => bridge.git.push(cwd, id))}
        />
        <IconButton
          icon={<RefreshCw size={12} strokeWidth={1.9} className={sync === "fetch" ? "ly-spin" : undefined} />}
          /*
           * Two things at once, and it has to be both.
           *
           * Asking the remote is the half that was missing — without a fetch, `ahead` and `behind`
           * describe whenever the repository was last touched by hand. Re-reading the local status
           * is the half that was already here and still matters: `useLiveRefresh` only polls while
           * a turn is running, so an edit made in another editor is invisible until something asks.
           */
          label={sync === "fetch" ? "取消刷新" : "刷新（询问远端）"}
          size="sm"
          disabled={busy || (sync !== null && sync !== "fetch")}
          onClick={() =>
            void remote("fetch", async (id) => {
              const result = await bridge.git.fetch(cwd, id);
              // `remote` re-reads afterwards either way, so a fetch that failed still refreshes
              // what is true locally.
              return result;
            })
          }
        />
      </div>

      {/* One row of views, counted where a count means something. */}
      <div ref={navRef} className="flex shrink-0 items-center gap-0.5 px-1.5 pb-1.5">
        {VIEWS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            data-ly-tip={narrowNav ? `${entry.label}${entry.id === "changes" && changeCount > 0 ? ` (${changeCount})` : ""}` : undefined}
            onClick={() => setView(entry.id)}
            className={`flex h-[26px] shrink-0 items-center gap-1.5 rounded-md text-detail transition-colors duration-[var(--ly-t-quick)] ${
              narrowNav ? "px-2" : "px-2.5"
            } ${
              view === entry.id
                ? "bg-card-hover text-ink"
                : "text-ink-muted hover:bg-card-hover/60"
            }`}
          >
            <entry.icon size={12.5} strokeWidth={1.8} className="shrink-0" />
            {!narrowNav && <span className="truncate">{entry.label}</span>}
            {entry.id === "changes" && changeCount > 0 && (
              <CountUp value={changeCount} className="text-ink-faint tabular-nums" />
            )}
          </button>
        ))}
      </div>

      {error && (
        <div className="mx-1.5 mb-1.5 shrink-0 rounded-lg border border-danger/25 bg-danger/8 px-2.5 py-1.5">
          <Text
            size="detail"
            tone="danger"
            className="break-words whitespace-pre-wrap"
          >
            {error}
          </Text>
        </div>
      )}

      {/*
       * Keyed on the branch, so a switch replays the entry animation.
       *
       * Without it the list simply contains different files a moment later, with nothing to say
       * that the ground moved — which is the one thing worth signalling when the branch changed
       * underneath it. Re-mounting is affordable here: the view holds no scroll position or
       * selection worth carrying across a branch it no longer belongs to.
       */}
      {view === "changes" && (
        <ChangesView
          key={status?.branch ?? "detached"}
          loading={slowSwitch}
          status={status}
          /*
           * The repository being looked at, not the folder that was opened.
           *
           * These are the same thing right up until a workspace holds more than one repository, or
           * the picker is pointed at a linked worktree — and then every file operation in here was
           * going to a different checkout than the status above it was read from. Harmless while
           * the view only listed files; not harmless now that it has a 推送 button.
           */
          cwd={cwd}
          busy={busy || sync !== null}
          act={act}
          plan={plan}
          onPush={() => void remote("push", (id) => bridge.git.push(cwd, id))}
          onPull={() => void remote("pull", (id) => bridge.git.pull(cwd, id))}
        />
      )}
      {view === "history" && <HistoryView cwd={cwd} />}
      {view === "branches" && (
        <BranchesView
          cwd={cwd}
          status={status}
          busy={busy}
          act={act}
          repos={repos}
          trees={trees}
          onSelectRepo={setSelected}
        />
      )}
      {view === "pipelines" && (
        <PipelinesView
          cwd={cwd}
          onOpenRelease={() => setReleaseOpen(true)}
        />
      )}

      {releaseOpen && (
        // Same reason as `ChangesView`: release from the repository on screen, not from the folder
        // the workspace happens to be rooted at.
        <ReleaseModal
          cwd={cwd}
          onClose={() => {
            setReleaseOpen(false);
            void read();
          }}
        />
      )}
    </div>
  );
}
