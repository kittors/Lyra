import type {
  AgentEvent,
  Message,
  SessionMeta,
  Settings,
  ThinkingLevel,
  ToolResult,
  UserContent,
} from "@lyra/core";
import { type SessionActivity } from "@lyra/core/activity";
import { applyAgentEvent } from "./apply-event.ts";
import type { TurnStop } from "./derive.ts";
import { sessionSlice } from "./session-slice.ts";
import { turnSlice } from "./turn-slice.ts";
import { workspaceSlice } from "./workspace-slice.ts";
import type { TodoItem } from "@lyra/core";
import { create } from "zustand";
import type {
  AgentCapabilities,
  SyncStatus,
  WorkspaceInfo,
} from "../../electron/ipc-types.ts";
/*
 * `sideStore.ts` directly, not the domain's index.
 *
 * The index re-exports the dock's panels, which are `.tsx`, and the store is imported by tests that
 * run under `--experimental-strip-types` — which does not handle JSX. Going through the front door
 * here would drag a component tree into a module that only wants one atom of state, and the failure
 * is `Unknown file extension ".tsx"` in a test that has nothing to do with the dock.
 *
 * The rule this bends is `features-through-the-front-door`, and it is bent knowingly: `store/` is
 * below the features rather than beside them, so it is not one domain reaching into another.
 */
import { useSide } from "../features/dock/sideStore.ts";
import { bridge } from "../services/index.ts";

/**
 * `plugins` is the catalogue, not the plugin *settings*.
 *
 * The two are deliberately separate places for the same subject, because they answer different
 * questions. This one is where you go to find something you do not have yet — it browses, it is
 * mostly other people's work, and the unit is a bundle with a name and a picture. The settings
 * section is where you go to deal with what you already installed: toggles, versions, which MCP
 * servers a bundle brought with it, where its directory is. Sending the sidebar's 插件 straight
 * to a settings pane made the first question unanswerable from anywhere.
 */
export type View = "chat" | "settings" | "pull-requests" | "scheduled" | "plugins";

export type SettingsSection =
  | "general"
  | "appearance"
  | "formatting"
  | "personalization"
  | "models"
  | "browser"
  | "screenshot"
  | "plugins"
  | "skills"
  | "agents"
  | "mcp"
  | "commands"
  | "hooks"
  | "index"
  | "search"
  | "access"
  | "forges"
  | "usage"
  | "sync"
  | "worktrees"
  | "about"
  | "archived";

export interface ToolRun {
  toolCallId: string;
  toolName: string;
  summary: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "error";
  result?: ToolResult;
  startedAt: number;
  finishedAt?: number;
}

export interface PendingApproval {
  id: string;
  kind: string;
  title: string;
  detail: string;
  /** Why the asker is asking, in its own words. Present when a model requested an escalation. */
  reason?: string;
  /** What an "always" answer gets remembered against. */
  subject?: string;
}

export interface AppState {
  ready: boolean;
  view: View;
  settingsSection: SettingsSection;
  /**
   * Which bundle the catalogue should be showing, by key, or null for the grid.
   *
   * Up here rather than inside the view because it is now reached from two places: clicking a
   * card, and 管理 on a row in settings — which has to leave the settings window entirely, and
   * cannot hand a parameter to a view it is not rendering.
   */
  pluginFocus: string | null;
  /**
   * Bumped whenever something was installed, uninstalled, or written to disk under the extension
   * directories — the signal every list that scans disk re-reads on.
   *
   * Four places show the same installed things from two angles: the catalogue's grid, its
   * installed strip, 设置 › 插件, and the tab counts above it. Each used to scan on its own and
   * re-scan on its own triggers, so installing from one left the other three showing what was
   * true a moment ago. There is no file watcher and there does not need to be: the only thing
   * that changes those directories is this app, and it knows when it did.
   */
  extensionsNonce: number;

  settings: Settings | null;
  sessions: SessionMeta[];
  workspace: WorkspaceInfo | null;
  /** Every directory project-less conversations are stored under, so the sidebar can exclude them. */
  scratchRoots: string[];
  /**
   * The working directory for a conversation that is not in a project.
   *
   * A session always needs somewhere to run. When there is no project — a review of a repository
   * that is not checked out here, or 「不在项目中工作」 — this is where it runs instead, and it is
   * what makes those two cases work at all rather than silently swallowing the first message.
   */
  scratchCwd: string | null;
  /**
   * The project 「聊天」 took the window away from, so 「项目」 can put it back.
   *
   * Switching to the chat half of the sidebar on a blank conversation switches the conversation
   * itself out of the project — see `adoptSidebarTab`. Without somewhere to remember what it was,
   * switching back would leave the window in no project at all, having quietly closed one nobody
   * asked to close.
   */
  parkedProject: string | null;
  /**
   * Text to put in the composer, for callers that are not the composer.
   *
   * Opening a review's conversation fills in what to ask rather than asking it: the user should
   * see the question, be able to change it, and press send themselves. Consumed on read.
   *
   * `replace` decides what happens to whatever is already in the field, and the two callers want
   * opposite things. A review or an error arrives while you may be part-way through typing, and
   * discarding that would lose work — those append. A suggestion card is a choice between four
   * alternatives, so pressing a second one means "that one instead": appending there stacks three
   * unrelated requests into one message nobody wrote.
   */
  /**
   * Text to put in the composer, for callers that are not the composer.
   *
   * Opening a review's conversation fills in what to ask rather than asking it: the user should
   * see the question, be able to change it, and press send themselves. Consumed on read.
   *
   * `replace` decides what happens to whatever is already in the field, and the two callers want
   * opposite things. A review or an error arrives while you may be part-way through typing, and
   * discarding that would lose work — those append. A suggestion card is a choice between four
   * alternatives, so pressing a second one means "that one instead": appending there stacks three
   * unrelated requests into one message nobody wrote.
   */
  composerDraft: { text: string; replace: boolean };
  setComposerDraft(text: string, replace?: boolean): void;

  /**
   * Unsent drafts in the composer, keyed by session id or blank conversation key:
   * - `new:project:<path>` for blank session in a specific project
   * - `new:scratch` for blank session without a project (Chat / 不在项目中工作)
   * - `<sessionId>` for drafts typed in an existing session
   */
  drafts: Record<string, { text: string; attachments: { id: string; name: string; mimeType: string; data?: string; text?: string; isText?: boolean }[] }>;
  setDraft(key: string, draft: { text: string; attachments?: { id: string; name: string; mimeType: string; data?: string; text?: string; isText?: boolean }[] } | null): void;

  activeSessionId: string | null;
  meta: SessionMeta | null;
  messages: Message[];
  /** True between clicking a session and its transcript arriving. Drives the loading state. */
  loadingSession: boolean;
  /**
   * The message the composer painted before the agent confirmed it, held by reference so the
   * stored copy can replace it instead of appearing twice.
   */
  pendingUserMessage: Message | null;
  /**
   * Transcripts already read this run, keyed by session id.
   *
   * Re-opening a session still re-reads its log — that is how a turn driven from the phone
   * shows up — but the cached copy goes on screen straight away, so switching back to
   * somewhere you have already been does not flash a skeleton at you.
   */
  sessionCache: Record<
    string,
    {
      meta: SessionMeta;
      messages: Message[];
      toolRuns: Record<string, ToolRun>;
      scrollTop?: number;
      pinnedToBottom?: boolean;
    }
  >;
  running: boolean;
  /**
   * When the turn in progress began, and what it has spent so far.
   *
   * A long turn is mostly silence — tool calls scrolling past with no sense of how long this
   * has been going or what it is costing. Both are tracked from the agent's own events so the
   * indicator reports the real thing rather than a guess.
   */
  /**
   * The turn meter for the conversation on screen: when it started, and what it has spent.
   *
   * Mirrors `turns[activeSessionId]` so the running line can read two plain values. See `turns`
   * for why the real copy is per-session.
   */
  turnStartedAt: number | null;
  turnTokens: number;
  /**
   * The same meter, for every conversation that has a turn in flight.
   *
   * Turns run in conversations you are not looking at, and the pair above is one value for the
   * whole app — so opening another conversation used to leave this one's clock reading whatever
   * the last turn to start had set, and clearing it on the way in traded a wrong number for no
   * number at all. Neither is what a conversation still working should say about itself.
   *
   * Keyed by session because that is what the fact belongs to. `apply-event` maintains it for
   * every session including the ones off screen, and `openSession` reads this one's back out.
   */
  turns: Record<string, { startedAt: number; tokens: number }>;
  /**
   * The same meter for turns that stopped part-way, frozen so 继续 can pick it back up.
   *
   * A pause is a gap in one piece of work, not the end of it. Without this, `agent_end` dropped the
   * meter and the send that follows lit a new one — so a task paused once reported the length and
   * the tokens of its second leg alone, and the tokens-per-second computed from them described a
   * stretch of work that never happened.
   *
   * Elapsed rather than a start time: see `turn-meter.ts`. Kept per session, like `turns`, and
   * cleared when a turn ends properly or the conversation moves on to a new question — a meter that
   * outlived the work it measured would silently add itself to whatever ran next.
   */
  carried: Record<string, { elapsedMs: number; tokens: number }>;
  /**
   * When the history was last summarised, so the running line can mention it and move on.
   *
   * A rule across the transcript said the same thing permanently, which is more attention than the
   * fact deserves: what was compacted is a property of the request, not of the conversation anyone
   * is reading. It belongs where the other things the turn is doing are said, and it belongs there
   * for as long as they are.
   */
  compactedAt: number | null;
  /** Keyed by toolCallId so results can land on the card the model is still streaming. */
  toolRuns: Record<string, ToolRun>;
  approvals: PendingApproval[];
  /** Per-conversation state for the sidebar; absent means idle. */
  activity: Record<string, SessionActivity>;
  /**
   * The connection dropped and this turn is being retried.
   *
   * Belongs to the turn, so it is cleared when one starts or ends rather than dismissed. Before
   * this it went to the corner of the window with the notices, where it outlived the turn it
   * described and sat next to messages that had nothing to do with it.
   *
   * `until` is an instant rather than the delay it was born as: the countdown on screen needs to
   * know when the wait ends, and a duration measured from an event that has already been
   * delivered, queued and rendered is stale by the time anything can read it.
   *
   * `resume` is the turn being picked back up rather than a request being sent again — a longer
   * wait, and one that says something different, because by then the turn has already ended and
   * what is being promised is that the work survived it.
   */
  retrying: { attempt: number; until: number; reason: string; resume: boolean } | null;
  /**
   * The agent's own plan for this piece of work, as it last wrote it.
   *
   * `todo_write` replaces the whole list every call, so the newest result is the whole truth and
   * there is nothing to merge. Kept beside the transcript rather than read out of it: it is the
   * current state of the work, and hunting back through tool cards for the last one is exactly
   * the reading the list exists to save.
   */
  todos: TodoItem[];
  /**
   * The last turn stopped without finishing, and how.
   *
   * A reply left `pending` in the log means the process holding it went away mid-turn — the app
   * was quit, it crashed, the machine slept. Reopening such a conversation showed the last
   * half-written message and no explanation, as if the agent had simply gone quiet.
   *
   * Pressing stop lands here too, and used not to: this was computed once, when a session was
   * opened, so a turn paused in the conversation you were sitting in left the state saying the
   * turn had ended normally. Nothing offered to resume it, because as far as the window was
   * concerned there was nothing to resume.
   */
  stopped: TurnStop;
  /** Where history was summarised, by position in the transcript. */
  compactions: { at: number; before: number; after: number }[];
  notices: { id: string; level: "info" | "warn" | "error"; message: string }[];
  /**
   * A correction the runtime thinks could become a rule, waiting to be answered.
   *
   * One at a time and not kept in the transcript. An offer is about the exchange that just
   * happened, and one still sitting there three turns later would be asking about something the
   * person has moved on from — so a new turn clears it whether or not it was answered.
   */
  ruleOffer: { name: string; body: string; condition?: string; scope?: string } | null;
  capabilities: AgentCapabilities | null;
  sync: SyncStatus | null;

  bootstrap(): Promise<void>;
  setView(view: View): void;
  setSettingsSection(section: SettingsSection): void;
  /** Open one bundle's page in the catalogue, or return to the grid with null. */
  setPluginFocus(key: string | null): void;
  /** Say that what is installed has changed, so every list showing it re-reads. */
  bumpExtensions(): void;
  saveSettings(settings: Settings): Promise<void>;

  pickWorkspace(): Promise<void>;
  openWorkspace(path: string): Promise<void>;
  /** Re-read git state for the current project, after a branch switch or an external change. */
  refreshWorkspace(): Promise<void>;
  /**
   * Which branch a switch is currently trying to reach, or null when none is.
   *
   * Not the name itself. Writing the target straight into the workspace made a refused switch look
   * like a successful one that then bounced back — the chip read `plugins` for a moment and
   * snapped to `main`, which is worse than no feedback at all: it says the thing happened and then
   * unsays it. This drives a loading state instead, so the name on screen is only ever a branch
   * git has actually confirmed.
   */
  switchingBranch: string | null;
  setSwitchingBranch(branch: string | null): void;
  /** Work without a project. Sessions still run; they just have no repo behind them. */
  clearWorkspace(): Promise<void>;
  /**
   * Follow the sidebar into the half it just switched to — but only on a blank conversation.
   *
   * 「项目」 and 「聊天」 are two ways of listing the same conversations, and switching between them
   * is normally just that: a way of looking. But on a window with nothing open yet, the half you
   * are in is also the only statement you have made about what you want to do next, and the
   * composer was ignoring it — 「聊天」 with an empty list still said 「选择项目」, and 新对话 from
   * there opened a directory picker.
   *
   * Never over a conversation that exists. Leaving a project clears what is on screen, and doing
   * that because someone glanced at their recent chats would be closing their work to answer a
   * question they did not ask.
   */
  adoptSidebarTab(tab: "projects" | "chats"): Promise<void>;
  /** Rename a project, or drop it from the list without touching anything on disk. */
  renameProject(path: string, name: string): Promise<void>;
  setProjectPinned(path: string, pinned: boolean): Promise<void>;
  setSessionPinned(sessionId: string, pinned: boolean): Promise<void>;
  renameSession(session: SessionMeta, title: string): Promise<void>;
  moveSessionProject(session: SessionMeta, targetPath: string): Promise<void>;
  removeProject(path: string): Promise<void>;
  /** Archive every session belonging to one project. */
  archiveProjectSessions(path: string): Promise<void>;
  newSession(): Promise<void>;
  openSession(meta: SessionMeta): Promise<void>;
  deleteSession(meta: SessionMeta): Promise<void>;
  setSessionArchived(meta: SessionMeta, archived: boolean): Promise<void>;
  deleteArchivedSessions(): Promise<void>;
  /** Re-read one conversation's message count and usage from disk. See the action for why. */
  refreshSessionStats(sessionId: string): Promise<void>;

  /**
   * `synthetic` marks a message the app composed on the user's behalf — 「继续」.
   *
   * It reaches the model like any other, and the transcript does not draw it: putting words in
   * someone's mouth in their own voice is worse than the button having no visible effect.
   */
  /**
   * `carryOn` says this send continues a turn that stopped rather than starting a new one, so its
   * clock and token count are picked up from where the pause left them. See `turn-meter.ts`.
   */
  send(content: UserContent[], options?: { synthetic?: boolean; carryOn?: boolean; deliver?: "steer" | "followUp" }): Promise<void>;
  /** Replace a message and re-run from there; everything after it is discarded. */
  editMessage(index: number, content: UserContent[]): Promise<void>;
  /** Re-send the user message that produced the reply at `index`. */
  retryFrom(index: number): Promise<void>;
  abort(): Promise<void>;
  respondToApproval(
    id: string,
    decision: "once" | "always" | "reject",
  ): Promise<void>;
  /**
   * Run this conversation on a different model.
   *
   * `asDefault` additionally makes it what new conversations start on — a separate decision, and
   * one that used to be taken silently on every pick. See the note in `turn-slice`.
   */
  setModel(modelId: string, options?: { asDefault?: boolean }): Promise<void>;
  /** How hard this conversation asks the model to think. Falls back to the app default. */
  setThinking(thinking: ThinkingLevel): Promise<void>;
  refreshSync(): Promise<void>;
  dismissNotice(id: string): void;
  notify(message: string, level?: "info" | "warn" | "error"): void;
  applyEvent(sessionId: string, event: AgentEvent): void;
}

/** Set by the first `bootstrap`, never cleared: there is one renderer per window. */
let booted = false;

export const useApp = create<AppState>((set, get) => ({
  ready: false,
  view: "chat",
  settingsSection: "models",
  pluginFocus: null,
  extensionsNonce: 0,
  settings: null,
  sessions: [],
  workspace: null,
  switchingBranch: null,
  scratchRoots: [],
  scratchCwd: null,
  parkedProject: null,
  composerDraft: { text: "", replace: false },
  drafts: {},
  activeSessionId: null,
  meta: null,
  messages: [],
  loadingSession: false,
  pendingUserMessage: null,
  sessionCache: {},
  running: false,
  turnStartedAt: null,
  turnTokens: 0,
  turns: {},
  carried: {},
  compactedAt: null,
  toolRuns: {},
  approvals: [],
  activity: {},
  retrying: null,
  stopped: null,
  compactions: [],
  todos: [],
  notices: [],
  ruleOffer: null,
  capabilities: null,
  sync: null,

  async bootstrap() {
    /*
     * Once per process, however many times it is called.
     *
     * The effect that calls this runs twice under StrictMode, and the second run subscribed a
     * second listener to the same event channel — so every message was applied twice and the
     * first one in a conversation appeared twice on screen. Guarding the whole function rather
     * than just the subscription keeps the session list and workspace lookups from being done
     * twice as well.
     */
    if (booted) return;
    booted = true;

    const [settings, sessions] = await Promise.all([
      bridge.settings.get(),
      bridge.sessions.list(),
    ]);
    const lastProject = settings.projects
      .slice()
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)[0];
    const workspace = lastProject
      ? await bridge.workspace.info(lastProject.path)
      : null;
    // Where pull request conversations live, so the sidebar can leave them out. One call, at
    // boot: it is derived from the app's home and cannot change while running.
    // Where project-less conversations live, so the sidebar can leave them out. One call, at
    // boot: it is derived from the app's home and cannot change while running.
    const scratchRoots = await bridge.git.scratchRoots().catch(() => []);
    set({ settings, sessions, workspace, scratchRoots, ready: true });

    /*
     * Settings the window did not write itself.
     *
     * Installing an MCP bundle adds its servers, uninstalling one takes them away, an approval
     * appends to `alwaysAllow`, sync rotates its token — all of that happens in the main process,
     * which has always broadcast the result. Nothing listened, so the window kept showing the
     * settings it last saved: a server installed from the catalogue simply was not on the MCP
     * page, and the two halves of the same subject disagreed until the app was restarted.
     *
     * Also bumps `extensionsNonce`, because a change to `mcpServers` usually means a directory
     * appeared or vanished as well, and the lists that scan disk have no other way to hear it.
     */
    bridge.settings.onChanged((next) =>
      set((state) => ({ settings: next, extensionsNonce: state.extensionsNonce + 1 })),
    );

    bridge.agent.onEvent(({ sessionId, event }) =>
      get().applyEvent(sessionId, event),
    );
    // The side chat is a separate conversation on a separate channel, for the same reason
    // it is a separate store: its replies must never land in the main transcript.
    bridge.sideChat.onEvent(({ sessionId, event }) =>
      useSide.getState().applyEvent(sessionId, event),
    );
    void get().refreshSync();
  },

  setView: (view) => set({ view }),
  setComposerDraft: (text, replace = false) => set({ composerDraft: { text, replace } }),
  setDraft: (key, draft) =>
    set((state) => {
      if (!draft || (!draft.text.trim() && (!draft.attachments || draft.attachments.length === 0))) {
        if (!state.drafts[key]) return state;
        const copy = { ...state.drafts };
        delete copy[key];
        return { drafts: copy };
      }
      return {
        drafts: {
          ...state.drafts,
          [key]: {
            text: draft.text,
            attachments: draft.attachments ?? [],
          },
        },
      };
    }),
  setSettingsSection: (settingsSection) => set({ settingsSection }),
  setPluginFocus: (pluginFocus) => set({ pluginFocus }),
  bumpExtensions: () => set((state) => ({ extensionsNonce: state.extensionsNonce + 1 })),

  async saveSettings(settings) {
    const saved = await bridge.settings.save(settings);
    set({ settings: saved });
  },

  ...workspaceSlice(set, get),
  ...sessionSlice(set, get),
  ...turnSlice(set, get),

  dismissNotice: (id) =>
    set({ notices: get().notices.filter((n) => n.id !== id) }),

  notify: (message, level = "info") =>
    set({
      notices: [
        ...get().notices,
        { id: `${Date.now()}-${Math.random()}`, level, message },
      ],
    }),

  applyEvent(sessionId, event) {
    applyAgentEvent(sessionId, event, set, get);
  },
}));
