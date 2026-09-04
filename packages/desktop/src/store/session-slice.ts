/**
 * Choosing, opening and removing conversations.
 *
 * Opening one is the interesting case: the transcript is read without starting an agent, because
 * looking at a conversation should not cost the second and a half that spawning MCP servers and
 * warming an index takes. The agent starts when something is actually asked of it.
 */

import type { SessionMeta } from "@lyra/core";
import type { SessionActivity } from "@lyra/core/activity";
import { howItStopped, prune, rebuildToolRuns, todosFrom, without } from "./derive.ts";
import type { AppState } from "./index.ts";
import { useSubAgents } from "./subAgents.ts";
import { bridge } from "../services/index.ts";
import { loadCarried } from "./turn-meter.ts";

/**
 * The transcript read that is currently in flight, and the one queued behind it.
 *
 * Clicking down a list of conversations used to send one `sessions:transcript` per click. Each of
 * those reads the whole session log from disk in the main process, parses it into objects, and
 * structured-clones the result across the IPC boundary — for a long session that is several
 * megabytes, three times over. The renderer already discarded every arrival but the last; the cost
 * had been paid by then. Eighteen clicks took the main process from 156MB to 1.5GB, and a few
 * rounds of that is the "Lyra 意外退出" crash: `JavaScript heap out of memory`.
 *
 * So the clicks are folded together instead. The first one goes immediately — a single click must
 * not wait — and any that arrive while it is in flight replace each other, so exactly one more
 * request follows for wherever the user actually stopped. Two reads instead of eighteen, and the
 * selection still moves on every click because that is painted from the sidebar's own meta.
 */
let reading: string | null = null;
let queued: SessionMeta | null = null;

type Get = () => AppState;
type Set = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

/**
 * Whether this conversation runs in one of the app's own directories rather than in a project.
 *
 * 「不在项目中工作」 and a pull request review both need somewhere to run, and both get a directory
 * under the app's home. Neither is a project, and the difference has to be made here because by the
 * time you are looking at a session all you have is a path.
 */
function isProjectLess(cwd: string, scratchRoots: string[]): boolean {
	return scratchRoots
		.filter(Boolean)
		.map((root) => (root.endsWith("/") ? root : `${root}/`))
		.some((root) => cwd.startsWith(root));
}

export function sessionSlice(set: Set, get: Get) {
  return {
  /**
   * Start a blank conversation.
   *
   * Nothing is written yet. A session used to be created on this click, which meant every
   * press of "新对话" left a titleless, messageless row in the sidebar and a file on disk —
   * and pressing it twice produced two. A blank conversation is a UI state, not a stored
   * object; `send` turns it into one the moment there is something to store.
   */
  async newSession() {
    // A scratch directory counts: a conversation with no project is still a conversation.
    if (!get().workspace && !get().scratchCwd) {
      await get().pickWorkspace();
      return;
    }
    set({
      activeSessionId: null,
      meta: null,
      messages: [],
      toolRuns: {},
      approvals: [],
      running: false,
      todos: [],
      turnStartedAt: null,
      turnTokens: 0,
      // Belongs to the turn being left behind; carrying it over would report this conversation's
      // connection as broken on the strength of another one's — or, for `stopped`, offer to
      // resume a blank conversation on the strength of a pause in the last one.
      retrying: null,
      stopped: null,
      ruleOffer: null,
      loadingSession: false,
      pendingUserMessage: null,
      capabilities: null,
      view: "chat",
    });

    /*
     * Delegated work belongs to the conversation that dispatched it.
     *
     * A blank new conversation has dispatched nothing yet; clear any leftover roster.
     */
    useSubAgents.getState().clear();

    /*
     * Out of the last conversation's directory, back to the shared one — after the window has
     * already cleared, not before.
     *
     * `scratchCwd` says where the *next* conversation runs, and opening a project-less one points
     * it at that conversation's own directory. For a pull request review that directory holds the
     * review — its PR.md, whatever was checked out to answer the question — and starting a new
     * conversation there hands all of it to a question that has nothing to do with that review.
     * Projects do not have this problem: 新对话 in a project is meant to be in that project.
     *
     * It used to be awaited above the `set`, which made the whole of 新对话 wait on a round trip
     * to decide something the blank conversation does not need until its first message. Nothing
     * reads `scratchCwd` between here and then.
     */
    if (!get().workspace) {
      void bridge.git.generalScratch().then(
        (general) => {
          // Only if nothing has moved on in the meantime — a conversation opened during the round
          // trip owns this field now, and overwriting it would point it at the wrong directory.
          if (general && !get().workspace && !get().activeSessionId) set({ scratchCwd: general });
        },
        () => {},
      );
    }
  },


  async openSession(meta: SessionMeta) {
    /*
     * Select first, load second.
     *
     * Opening a stored session replays its whole log and spins up its MCP servers, which
     * can take a second or more. Waiting for that before touching state meant a click
     * produced no feedback at all — the row you pressed stayed unselected and the old
     * transcript stayed on screen, so it read as a dropped click. The sidebar's own copy
     * of the meta is enough to paint the selection immediately.
     */
    const cache = { ...get().sessionCache };

    // Park the transcript being left behind, so coming back to it needs no round trip.
    const leaving = get().activeSessionId;
    const leavingMeta = get().meta;
    if (
      leaving &&
      leaving !== meta.id &&
      leavingMeta &&
      get().messages.length > 0
    ) {
      cache[leaving] = {
        meta: leavingMeta,
        messages: get().messages,
        toolRuns: get().toolRuns,
        scrollTop: cache[leaving]?.scrollTop,
        pinnedToBottom: cache[leaving]?.pinnedToBottom,
      };
    }

    const cached = cache[meta.id];
    /*
     * Which mode this conversation is in, decided from its own directory.
     *
     * A conversation carries where it runs, and opening one has to make the app agree with it.
     * Before this, opening a project-less conversation left whichever project was open still
     * showing in the composer — so the chip named a project the conversation had nothing to do
     * with, and 新对话 from there started the next conversation *in* that project.
     *
     * Both halves are set here rather than only the one that changes: leaving `scratchCwd` behind
     * when moving into a project, or leaving `workspace` behind when moving out of one, is the
     * same bug in the other direction.
     */
    const projectLess = isProjectLess(meta.cwd, get().scratchRoots);
    set({
      /*
       * Opening it is reading it, and reading a result clears it.
       *
       * `done` and `failed` mean "finished since you last looked". The list used to hide them
       * for whichever conversation was on screen and put them straight back the moment you
       * moved on — a green dot on something read half an hour ago, for as long as the app
       * stayed open. Hiding is a render-time trick; this is the state actually changing.
       *
       * `running` and `waiting` survive, because they are about the future rather than the
       * past: a conversation still working, or still blocked on approval, is not finished by
       * being looked at.
       */
      activity: readOutcome(get().activity, meta.id),
      sessionCache: prune(cache, meta.id),
      activeSessionId: meta.id,
      meta: cached?.meta ?? meta,
      messages: cached?.messages ?? [],
      toolRuns: cached?.toolRuns ?? {},
      approvals: [],
      running: false,
      todos: [],
      /*
       * This conversation's own meter, not whichever one last started a turn.
       *
       * The pair is one value for the whole app while any number of conversations can be running,
       * so leaving it alone showed the other conversation's numbers under this one's name — 41s /
       * 439.8k reading as 5s / 16.4k. Clearing it instead traded a wrong number for no number, and
       * a turn that is still working with a blank where its clock should be is the worse of the
       * two: the one thing a long turn needs to say is how long it has been going.
       *
       * So it is read back from `turns`, which `apply-event` keeps for every session including the
      /*
       * Load in-memory carried or persisted carried meter across restarts so continued turns work.
       */
      carried: {
        ...get().carried,
        ...(get().carried[meta.id] || !loadCarried(meta.id)
          ? {}
          : { [meta.id]: loadCarried(meta.id)! }),
      },
      turnStartedAt: get().turns[meta.id]?.startedAt ?? null,
      turnTokens: get().turns[meta.id]?.tokens ?? 0,
      // Belongs to the turn being left behind; see the note in `newSession`.
      retrying: null,
      stopped: null,
      // Asked about a correction in the conversation being left, and about nothing in this one.
      ruleOffer: null,
      // Only a session with nothing to show is "loading"; a cached one is already on screen
      // and re-reads quietly behind it.
      loadingSession: !cached,
      pendingUserMessage: null,
      view: "chat",
      ...(projectLess ? { workspace: null, scratchCwd: meta.cwd } : { scratchCwd: null }),
    });

    /*
     * Delegated work belongs to the conversation that dispatched it.
     *
     * The roster arrives by event and only for the session that is running, so a stale one would
     * simply sit there — showing sub-agents from the conversation you just left, under the name of
     * the one you just opened.
     */
    useSubAgents.getState().clear();

    /*
     * The project, on its own errand — the transcript must never wait for it.
     *
     * These two used to go out under one `Promise.all`, so the conversation appeared only once
     * *both* had answered. Reading a transcript takes a few milliseconds and reading a project took
     * over 1.5 seconds on a repository with a couple of hundred uncommitted files, so every switch
     * sat on the conversation you were leaving for the length of a git call it had nothing to do
     * with. Measured before and after, on the same seeded project: 1.6s to 25ms. Whichever answers
     * first now paints.
     *
     * Only asked when there is a project to ask about, and only when it is not the one already
     * open. A project-less conversation runs in one of the app's own directories, which is a real
     * directory — `workspace.info` answers about it perfectly happily, with a name taken from the
     * folder: `general`, or `acme-widgets-42`. Handing that back as the workspace is how a
     * conversation explicitly in no project ended up displaying one, named after a path nobody
     * chose. And clicking down one project's own list asks about the same path every time, which
     * can only ever replace the record with an identical copy.
     */
    if (!projectLess && get().workspace?.path !== meta.cwd) {
      void bridge.workspace.info(meta.cwd).then((workspace) => {
        // Null stays null: `?? get().workspace` would put back the project that was open before.
        if (workspace && get().activeSessionId === meta.id) set({ workspace });
      });
    }

    /*
     * `transcript`, not `open`: reading a conversation must not start an agent for it.
     *
     * Starting one loads skills and spawns MCP child processes — over a second, and pure waste
     * when the click was "let me see what this said". The agent comes up on the first message.
     *
     * One read at a time; the newest pending click wins. Returning here is not dropping the click
     * — the selection and the meta are already on screen from the state written above, and the
     * read in flight will pick this up when it finishes. What is skipped is only the megabytes of
     * duplicated work.
     */
    if (reading !== null) {
      queued = meta;
      return;
    }
    reading = meta.id;

    let snapshot: Awaited<ReturnType<typeof bridge.sessions.transcript>>;
    try {
      snapshot = await bridge.sessions.transcript(meta.projectId, meta.id);
    } finally {
      reading = null;
      // Whatever was clicked last while this was running is the one that still wants reading.
      const next = queued;
      queued = null;
      if (next && next.id !== meta.id) void get().openSession(next);
    }

    // A second click while this was in flight wins; discard the stale arrival.
    if (get().activeSessionId !== meta.id) return;
    if (!snapshot) {
      set({ loadingSession: false });
      return;
    }

    const toolRuns = rebuildToolRuns(snapshot.messages);
    set({
      meta: snapshot.meta,
      messages: snapshot.messages,
      // Replayed from the log rather than the event stream: reopening a conversation does not
      // re-run its tools, so the plan has to be recovered from where the tool wrote it.
      todos: todosFrom(snapshot.messages),
      // Replayed from the log: the summary itself is not in the transcript, only the fact.
      compactions: (snapshot.compactions ?? []).map((at) => ({ at, before: 0, after: 0 })),
      // No event to go on here, so the transcript answers on its own: a reply the log records as
      // `aborted` was stopped by hand, however long ago.
      stopped: snapshot.running ? null : howItStopped(snapshot.messages),
      running: snapshot.running,
      approvals: snapshot.pendingApprovals,
      toolRuns,
      loadingSession: false,
      sessionCache: {
        ...get().sessionCache,
        [meta.id]: {
          meta: snapshot.meta,
          messages: snapshot.messages,
          toolRuns,
          scrollTop: get().sessionCache[meta.id]?.scrollTop,
          pinnedToBottom: get().sessionCache[meta.id]?.pinnedToBottom,
        },
      },
    });

    // Restore sub-agents for this session if available
    void bridge.subAgents.list(snapshot.meta.id).then((subAgentsList) => {
      if (get().activeSessionId === snapshot.meta.id && Array.isArray(subAgentsList)) {
        useSubAgents.getState().sync(subAgentsList);
      }
    });

    // Capabilities describe a running agent; a transcript read from disk has none until the
    // session is activated, which the first message does.
    const capabilities = await bridge.sessions.capabilities(
      snapshot.meta.id,
    );
    if (get().activeSessionId === meta.id) set({ capabilities });
  },

  async deleteSession(meta: SessionMeta) {
    set({
      sessionCache: without(get().sessionCache, meta.id),
      drafts: without(get().drafts, meta.id),
    });
    await bridge.sessions.remove(meta.projectId, meta.id);
    const sessions = await bridge.sessions.list();
    set({ sessions });
    if (get().activeSessionId === meta.id) {
      set({
        activeSessionId: null,
        meta: null,
        messages: [],
        toolRuns: {},
        approvals: [],
        loadingSession: false,
        pendingUserMessage: null,
      });
      useSubAgents.getState().clear();
    }
  },

  async setSessionArchived(meta: SessionMeta, archived: boolean) {
    if (archived) {
      set({
        sessionCache: without(get().sessionCache, meta.id),
        drafts: without(get().drafts, meta.id),
      });
    }
    // Optimistic: the row should leave the sidebar on the click, not on the round trip.
    set({
      sessions: get().sessions.map((s) =>
        s.id === meta.id ? { ...s, archived } : s,
      ),
    });
    if (archived && get().activeSessionId === meta.id) {
      set({
        activeSessionId: null,
        meta: null,
        messages: [],
        toolRuns: {},
        approvals: [],
        loadingSession: false,
        pendingUserMessage: null,
      });
      useSubAgents.getState().clear();
    }
    set({
      sessions: await bridge.sessions.setArchived(
        meta.projectId,
        meta.id,
        archived,
      ),
    });
  },

  async deleteArchivedSessions() {
    set({ sessions: await bridge.sessions.removeArchived() });
  },

  /**
   * One conversation's figures, read back from disk.
   *
   * The list is only re-read when a turn *ends* (`agent_end` in `apply-event.ts`), so for as long
   * as a turn runs, the count and the usage on its row are whatever they were when the last one
   * finished. On a conversation that has never finished a turn there is nothing to be stale from:
   * `send` puts `messageCount: 1` and an empty usage on the row it creates, so a session an hour
   * into its first turn still reads 「1 条消息、0」 — which is what the hover card was showing.
   *
   * The store on the other side has the real numbers all along: every message committed to the log
   * updates them (`SessionStore.appendExclusive`). Nothing was writing them down here.
   *
   * Only the two figures, deliberately. Taking the whole record would bring `updatedAt` with it,
   * and the sidebar is sorted by that — pulling the row out from under a pointer that is resting on
   * it, to show a fresher number, would be a worse trade than the stale number.
   */
  async refreshSessionStats(sessionId: string) {
    const latest = (await bridge.sessions.list()).find((s) => s.id === sessionId);
    if (!latest) return;
    set({
      sessions: get().sessions.map((s) =>
        s.id === sessionId
          ? { ...s, messageCount: latest.messageCount, usage: latest.usage }
          : s,
      ),
    });
  },
  };
}

/**
 * Drop a finished outcome for one conversation, leaving anything still in progress alone.
 *
 * Returns the same object when there is nothing to clear, so opening a conversation that had no
 * mark does not hand React a new map and re-render every row in the list.
 */
function readOutcome(
  activity: Record<string, SessionActivity>,
  id: string,
): Record<string, SessionActivity> {
  const current = activity[id];
  if (current !== "done" && current !== "failed") return activity;
  const next = { ...activity };
  delete next[id];
  return next;
}
