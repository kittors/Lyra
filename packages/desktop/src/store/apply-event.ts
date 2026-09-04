/**
 * Folding an agent event into the store.
 *
 * The largest thing the store does, and the one most worth reading on its own: every event the
 * runtime emits arrives here, for every conversation at once — including the ones nobody is
 * looking at. Which is why it starts by updating per-session activity and only then asks whether
 * the event belongs to the conversation on screen.
 */

import type { AgentEvent, Message } from "@lyra/core";
import { nextActivity } from "@lyra/core/activity";
import { coalesce, flushCoalesced } from "./coalesce.ts";
import { applyToolEvent } from "./apply-tool.ts";
import { howItStopped, without } from "./derive.ts";
import { freeze, relight, saveCarried } from "./turn-meter.ts";
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
import { useSubAgents } from "./subAgents.ts";
import type { AppState } from "./index.ts";
import { settleTail } from "../lib/transcript.ts";
import { bridge } from "../services/index.ts";

type Get = () => AppState;
type Set = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

/** Events that can only arrive over a connection that is working again. */
const RECONNECTED = new Set<AgentEvent["type"]>([
  "message_start",
  "message_update",
  "message_end",
  "tool_start",
  "tool_update",
  "tool_end",
]);

/**
 * Events after which a parked transcript no longer describes its conversation.
 *
 * `message_update` is deliberately absent: it only ever arrives between a `message_start` and a
 * `message_end`, both of which are here, so the cache is already gone by the time one lands.
 */
const TOUCHES_TRANSCRIPT = new Set<AgentEvent["type"]>([
  "message_start",
  "message_end",
  "tool_start",
  "tool_end",
  "rewound",
  "compacted",
]);

export function applyAgentEvent(sessionId: string, event: AgentEvent, set: Set, get: Get): void {
  /*
   * Every conversation's state, not just the one on screen.
   *
   * Turns run in conversations you are not looking at — a scheduled task, the phone, an agent
   * that stopped to ask permission twenty minutes ago. The events for those already arrive
   * here and were being dropped; folding each one into a per-session activity is what lets
   * the list say which is which.
   */
  {
    const current = get().activity[sessionId] ?? null;
    const settled = nextActivity(event, current);
    /*
     * A conversation you are watching cannot finish unread.
     *
     * `visibleActivity` hides `done` for the conversation on screen, which looked like enough —
     * but hiding is not clearing. The mark stayed in the map, and the instant you clicked away it
     * became a conversation you had never looked at, complete with the dot. Sitting through a
     * turn and then being told you missed it is the opposite of what the mark is for.
     *
     * Only the finished states. `running` and `waiting` are about what is still to come and are
     * worth carrying out of the conversation with you.
     */
    const finished = settled === "done" || settled === "failed";
    const next = finished && sessionId === get().activeSessionId ? null : settled;

    if (next !== current) {
      const activity = { ...get().activity };
      if (next) activity[sessionId] = next;
      else delete activity[sessionId];
      set({ activity });
    }
  }

  /*
   * The same, for the turn meter: every conversation's clock, not just the one on screen.
   *
   * It lives here rather than in the branches below because those return early for anything that
   * is not the active session — which is exactly the case this exists for. A turn running in a
   * conversation you are not watching has an elapsed time and a token count the whole time; it was
   * simply nobody's job to write them down, so coming back to it showed a blank where the clock
   * should be.
   */
  {
    /*
     * Only the four events that move a meter touch the map.
     *
     * Every event used to copy it and write it back, whether or not anything in it had changed —
     * and most events are `message_update`, which arrives many times a second per running
     * conversation and has nothing to say about a clock. A new object is a new identity, so each
     * one made every selector in the window run again to discover that nothing had happened. With
     * several conversations working at once that is the bulk of the store's traffic.
     */
    const meter = get().turns[sessionId];
    let next: { startedAt: number; tokens: number } | undefined = meter;
    /*
     * What a turn that stopped part-way leaves behind for 继续 to pick up.
     *
     * `undefined` means "do not touch what is stored", which is every event but the one that ends a
     * turn; `null` means "there is nothing to carry", which is how a turn that finished properly
     * clears the one before it.
     */
    let carriedNext: { elapsedMs: number; tokens: number } | null | undefined;
    if (event.type === "agent_start") {
      // Kept if it is already running: a continuation is the same turn, not a new one.
      next = { startedAt: meter?.startedAt ?? Date.now(), tokens: meter?.tokens ?? 0 };
    } else if (event.type === "message_end" && event.message.role === "assistant") {
      /*
       * Counted when the reply ends, because that is when there is anything to count.
       *
       * This used to read `message_start`, where `usage.total` is always zero: the adapters fill in
       * `input`/`output` as they go and total them once the stream closes. So the map's count never
       * moved off zero — and since the map is mirrored onto the pair the running line reads, every
       * new reply in a turn overwrote the real figure with it. A turn doing five rounds of tool work
       * counted up to 31.4k, blinked back to 0, counted up again, blinked back: the number was not
       * merely wrong, it was unreadable.
       *
       * One accumulator now, here, for every session rather than only the one on screen. The
       * mirroring below is what carries it to the line.
       */
      if (meter) next = { ...meter, tokens: meter.tokens + event.message.usage.total };
    } else if (event.type === "retry" && event.resume) {
      /*
       * A turn being picked back up after the connection died, which arrives *after* `agent_end`
       * has already stood the clock down. Start it again rather than leaving the line blank for
       * the whole wait — the same reading the running row takes of `resume`.
       *
       * `carried` is what makes it the same turn rather than a new one: `agent_end` has just frozen
       * this meter, and relighting from the frozen copy carries the minutes and the tokens the turn
       * had already spent before the socket died. Without it a turn that dropped twice reported the
       * length of whichever leg happened to be last.
       */
      next = meter ?? relight(get().carried[sessionId], Date.now());
    } else if (event.type === "agent_end") {
      next = undefined;
      /*
       * Frozen for 继续, but only for the two endings 继续 is offered for.
       *
       * `aborted` and `error` are the stops that leave a piece of work half done — the same two
       * `grouping.ts` reads off the transcript when it decides that a 继续 belongs to the turn
       * before it. Keeping the pair in step is the point: they are the live and the settled account
       * of one number, and if they disagreed the elapsed time would jump the moment the turn ended.
       *
       * `done`, `max_turns` and `stalled` clear it instead. A turn that reached its own end is over;
       * anything carried past it would be added to whatever ran next, under a total nobody could
       * account for.
       */
      const stoppedShort = event.reason === "aborted" || event.reason === "error";
      // The map is the only account of this turn — the line's pair is mirrored from it — so what is
      // frozen here is exactly the elapsed time and the count the reader was looking at.
      carriedNext = stoppedShort ? freeze(meter, Date.now()) : null;
    }

    if (next !== meter) {
      const turns = { ...get().turns };
      if (next) turns[sessionId] = next;
      else delete turns[sessionId];
      set({ turns });
      // And mirror it onto the pair the running line reads, while this is the one on screen.
      if (sessionId === get().activeSessionId) {
        set({ turnStartedAt: next?.startedAt ?? null, turnTokens: next?.tokens ?? 0 });
      }
    }

    if (carriedNext !== undefined) {
      const carried = { ...get().carried };
      if (carriedNext) carried[sessionId] = carriedNext;
      else delete carried[sessionId];
      saveCarried(sessionId, carriedNext);
      set({ carried });
    }
  }

  if (sessionId !== get().activeSessionId) {
    /*
     * A conversation that has moved on cannot be served from what was parked for it.
     *
     * The cache exists so that going back somewhere you have already been does not flash a
     * skeleton — which is right, and was being applied to conversations that had since said
     * something new. A turn finishing in the background put a green dot on the row and left the
     * stale transcript in here, so clicking it showed the state from before the turn ran, with
     * nothing to say so, until the re-read landed. Being shown old content presented as current
     * is worse than being shown a placeholder for a moment.
     *
     * Dropped rather than updated: the events do not carry enough to rebuild a transcript that
     * this window never watched, and the re-read that follows every open is authoritative anyway.
     * Only the events that actually change what a transcript says — a title arrives constantly and
     * changes nothing about the messages.
     */
    if (TOUCHES_TRANSCRIPT.has(event.type) && get().sessionCache[sessionId]) {
      set({ sessionCache: without(get().sessionCache, sessionId) });
    }

    if (event.type === "title") {
      set({
        sessions: get().sessions.map((s) =>
          s.id === sessionId ? { ...s, title: event.title } : s,
        ),
      });
      return;
    }
    // A turn driven from the phone still has to move the session up the sidebar and
    // update its title, even though its transcript is not on screen.
    if (event.type === "agent_end" || event.type === "turn_end") {
      void bridge.sessions
        .list()
        .then((sessions) => set({ sessions }));
    }
    return;
  }

  /*
   * The reconnection worked, and nothing else was ever going to say so.
   *
   * `retrying` was cleared only when a turn started or ended, so one dropped socket pinned
   * "连接中断，N 秒后重试" to the running line for the rest of the turn — still sitting there a
   * minute later beside a reply that had long since arrived, claiming a wait that was over.
   * Anything streaming in is the proof: the connection is back, so the notice goes.
   */
  if (get().retrying && RECONNECTED.has(event.type)) set({ retrying: null });

  /*
   * Anything that is not a streamed update lands after the one still waiting.
   *
   * Without this a held update could be applied on the next frame — after the `message_end` that
   * settles it, or after the tool card that follows it — and overwrite the newer state with the
   * older one.
   */
  if (event.type !== "message_update") flushCoalesced();

  switch (event.type) {
    case "agent_start":
      set({
        running: true,
        retrying: null,
        stopped: null,
        /*
         * An unanswered offer does not survive into the next turn.
         *
         * It is about the exchange that had just happened. Left up, it would sit under a reply to
         * a different question — still offering to save a rule about something the conversation
         * has moved past, and still looking like it is about what is on screen now.
         */
        ruleOffer: null,
        // The composer already started the clock when it sent, and the ~2s of session
        // setup before the agent starts is part of the wait. Overwriting it here made
        // the elapsed time jump backwards. A turn driven from the phone or the
        // scheduler has no composer, so it starts the clock here instead.
        turnStartedAt: get().turnStartedAt ?? Date.now(),
        /*
         * The count is the meter's to set, and it has already set it, a few lines up.
         *
         * A flat zero here was the third place this turn's tokens were decided and the last one to
         * run, so it quietly undid the others: the block above deliberately keeps a continuation's
         * total — "a continuation is the same turn, not a new one" — and this threw that away on
         * the very next statement. A turn resumed after a pause went back to zero however carefully
         * the total had been carried to it.
         */
      });
      break;

    case "message_start": {
      const messages = get().messages;

      // The composer already painted this one; swap in the stored copy rather than
      // showing it twice. Matched by reference, so sending the same text again is
      // still two messages.
      const pending = get().pendingUserMessage;
      if (
        event.message.role === "user" &&
        pending &&
        messages.includes(pending)
      ) {
        set({
          messages: messages.map((m) => (m === pending ? event.message : m)),
          pendingUserMessage: null,
        });
        break;
      }

      // A message_start for a message already in the list happens on reconnect; ignore it.
      if (
        event.message.role === "assistant" &&
        messages[messages.length - 1]?.role === "assistant"
      ) {
        const last = messages[messages.length - 1];
        if (last.role === "assistant" && last.stopReason === "pending") break;
      }
      set({ messages: [...messages, event.message] });
      break;
    }

    case "message_update": {
      // Held until the next frame; see `coalesce`. The newest update is the only one worth having.
      coalesce(() => {
        const messages = [...get().messages];
        const index = messages.length - 1;
        if (index >= 0 && messages[index].role === "assistant") messages[index] = event.message;
        else messages.push(event.message);
        set({ messages });
      });
      break;
    }

    case "message_end": {
      const messages = [...get().messages];

      /*
       * The composer's copy is still standing in for this one.
       *
       * `message_start` normally swaps it out, but on a brand-new conversation that event
       * arrives before `sessions.create` has returned — so the store does not yet know which
       * session it belongs to and drops it. Without this, the stored copy is appended next to
       * the copy the composer painted and the message appears twice, every first message.
       */
      const pending = get().pendingUserMessage;
      if (event.message.role === "user" && pending && messages.includes(pending)) {
        set({
          messages: messages.map((m) => (m === pending ? event.message : m)),
          pendingUserMessage: null,
        });
        break;
      }

      const index = findMessageSlot(messages, event.message);
      if (index >= 0) messages[index] = event.message;
      else messages.push(event.message);
      /*
       * The tokens are not added here any more; the meter block at the top of this function does it.
       *
       * There used to be two accumulators for one number — this one, and the per-session map — kept
       * by different events and disagreeing by an entire turn's output. Whichever wrote last won,
       * and the map wrote last on every new reply. Counting in the place that serves every session
       * is also what makes the count right for conversations that are running off screen.
       */
      set({ messages });
      break;
    }

    case "tool_start":
    case "tool_update":
    case "tool_end":
      applyToolEvent(event, set, get);
      break;

    case "approval_request":
      set({
        approvals: [
          ...get().approvals,
          {
            id: event.requestId,
            kind: event.kind,
            title: event.title,
            detail: event.detail,
            ...(event.reason ? { reason: event.reason } : {}),
            subject: event.subject,
          },
        ],
      });
      break;

    case "rewound":
      // The agent discarded a tail of history; match it exactly rather than guessing
      // from the messages that arrive next.
      set({ messages: get().messages.slice(0, event.messageCount) });
      break;

    case "title": {
      // Rename in place: the list is sorted by recency and this is not a new use.
      const meta = get().meta;
      set({
        meta: meta ? { ...meta, title: event.title } : meta,
        sessions: get().sessions.map((s) =>
          s.id === sessionId ? { ...s, title: event.title } : s,
        ),
      });
      break;
    }

    case "tasks":
      // Reached only for the session on screen, which is the one whose queue is shown.
      useSide.getState().setTasks(event.tasks);
      break;

    /*
     * Delegated work, live.
     *
     * The whole roster on every change rather than a diff: it is a dozen rows, it is only sent
     * when something moved, and a window that has been away is correct on the first one it gets
     * instead of having to have seen every event since.
     */
    case "subagents":
      useSubAgents.getState().sync(event.agents);
      break;

    /*
     * One message from inside a sub-agent.
     *
     * Kept out of the main transcript deliberately: it belongs to a conversation of its own, and
     * merging it here is exactly the context pollution delegation exists to avoid. Dropped unless
     * that sub-agent's transcript has been opened — opening it later reads the whole thing.
     */
    case "subagent_message":
      useSubAgents.getState().append(event.id, event.message);
      break;

    case "retry":
      // Stamped on arrival: the delay is counted from now, and the countdown reads the clock.
      set({
        retrying: {
          attempt: event.attempt,
          until: Date.now() + event.delayMs,
          reason: event.reason,
          resume: event.resume === true,
        },
        /*
         * A resume arrives after `agent_end`, which has already stood the window down.
         *
         * Leaving it down would give a minute of blank, idle-looking window between a turn that
         * visibly failed and one that silently starts again — the exact stretch during which the
         * user concludes it is dead and starts over by hand. The turn is not over; put the line
         * back and let it count.
         */
        ...(event.resume
          ? { running: true, turnStartedAt: get().turnStartedAt ?? Date.now() }
          : {}),
      });
      break;

    case "compacted":
      /*
       * A marker in the transcript, not a toast.
       *
       * Everything above this point is a summary as far as the model is concerned. That is a
       * property of the conversation and belongs in it — a notice would say it once and then
       * take the explanation away with it.
       */
      set({
        compactions: [
          ...get().compactions,
          { at: get().messages.length, before: event.before, after: event.after },
        ],
        compactedAt: Date.now(),
      });
      break;

    case "notice":
      set({
        notices: [
          ...get().notices,
          {
            id: `${Date.now()}-${Math.random()}`,
            level: event.level,
            message: event.message,
          },
        ],
      });
      break;

    case "capabilities_changed": {
      /*
       * 磁盘上的技能或规则变了，这个会话已经重新读过了。
       *
       * 说出来，而且要说变了什么。一句「能力已更新」在换分支的时候等于没说——那会换掉半个目录。
       * 三个数都是 0 也是一个真实的情况：有人改了某条规则的正文，而名单没变——那时不说话，
       * 因为「改的东西已经生效了」并不值得打断谁。
       */
      const parts = [
        event.skills !== 0 ? `技能 ${event.skills > 0 ? "+" : ""}${event.skills}` : null,
        event.rules !== 0 ? `规则 ${event.rules > 0 ? "+" : ""}${event.rules}` : null,
        event.agents !== 0 ? `子代理 ${event.agents > 0 ? "+" : ""}${event.agents}` : null,
      ].filter(Boolean);
      if (parts.length > 0) {
        const named = event.added.length > 0 ? `：${event.added.join("、")}` : "";
        get().notify(`${parts.join("，")}${named}`);
      }
      break;
    }

    case "rule_suggested":
      /*
       * A question, not a record — which is why it is state rather than a message.
       *
       * Everything above this point has already returned for sessions that are not on screen, and
       * that is the behaviour this one needs: an offer about a conversation somebody is not
       * looking at would be answered with no idea what it referred to. The session spends its
       * budget either way, which is the honest cost — it did ask.
       */
      set({
        ruleOffer: { name: event.name, body: event.body, condition: event.condition, scope: event.scope },
      });
      break;

    case "agent_end": {
      /*
       * Settled first, then read — in that order, because the answer depends on it.
       *
       * `settleTail` is what turns the half-written reply into an `aborted` one; asking the old
       * list how the turn stopped would be asking a message that still says `pending`.
       */
      const settled = settleTail(get().messages, event);
      set({
        running: false,
        retrying: null,
        approvals: [],
        compactedAt: null,
        pendingUserMessage: null,
        turnStartedAt: null,
        messages: settled,
        stopped: howItStopped(settled, event.reason),
      });
      void bridge.sessions
        .list()
        .then((sessions) => set({ sessions }));
      break;
    }
  }
}

/** Match an incoming final message to the slot its streaming version occupies. */
function findMessageSlot(messages: Message[], incoming: Message): number {
  if (incoming.role === "toolResult") {
    return messages.findIndex((m) => m.role === "toolResult" && m.toolCallId === incoming.toolCallId);
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const candidate = messages[i];
    if (candidate.role !== incoming.role) continue;
    if (candidate.role === "assistant" && incoming.role === "assistant") {
      // The streamed placeholder is the only assistant message still pending.
      if (candidate.stopReason === "pending" || candidate.timestamp === incoming.timestamp) return i;
      return -1;
    }
    if (candidate.timestamp === incoming.timestamp) return i;
  }
  return -1;
}