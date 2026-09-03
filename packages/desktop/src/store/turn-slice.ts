/**
 * Saying something, and everything that follows from it.
 *
 * Sending, editing, retrying, interrupting. The composer's copy of a message is painted before
 * anything is stored — a conversation that swallows what you typed for two seconds while a session
 * is created reads as broken — and the stored copy replaces it when the runtime confirms it.
 */

import type { ApprovalDecision, Message, ThinkingLevel, Usage, UserContent } from "@lyra/core";
import { without } from "./derive.ts";
import { relight } from "./turn-meter.ts";
import type { AppState } from "./index.ts";
import { bridge } from "../services/index.ts";

const ZERO_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	total: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

type Get = () => AppState;
type Set = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

export function turnSlice(set: Set, get: Get) {
  return {
  async send(content: UserContent[], options: { synthetic?: boolean; carryOn?: boolean } = {}) {
    const { workspace, settings, scratchCwd } = get();
    let sessionId = get().activeSessionId;
    /*
     * A project if there is one, a scratch directory if there is not.
     *
     * Not every conversation is about a checkout. A review is of a branch that may not be on this
     * machine, and 「不在项目中工作」 is the user saying there is no project on purpose. Both used
     * to end here: with no workspace this opened a directory picker and dropped the message, which
     * made the second one a dead end and the first one impossible.
     *
     * Only a conversation with nowhere at all to run still asks.
     */
    const cwd = workspace?.path ?? scratchCwd;
    if (!sessionId && !cwd) {
      await get().pickWorkspace();
      return;
    }

    /*
     * Paint the message before anything is stored.
     *
     * Creating a session takes around two seconds — skills, MCP servers, the symbol index.
     * Until that returned, the composer had cleared and nothing had appeared in its place,
     * which reads as a swallowed message. The agent's own copy replaces this one when
     * `message_start` arrives.
     */
    const pending: Message = {
      role: "user",
      content,
      timestamp: Date.now(),
      // Composed by the app rather than typed — 「继续」. The transcript hides these; see `rows.tsx`.
      ...(options.synthetic ? { synthetic: true } : {}),
    };
    /*
     * 继续 carries the clock and the tokens across the pause; anything else starts them at zero.
     *
     * `relight` handles both, which is why it is called unconditionally: with nothing carried it is
     * an ordinary start. The frozen copy is consumed here — a resume happens once, and leaving it
     * in place would add the same minutes to the turn after this one as well.
     *
     * Written into `turns` and not only into the pair the running line reads, because `agent_start`
     * decides whether a turn is a continuation by looking there ("kept if it is already running").
     * Setting only the mirror is what let the event that arrives two seconds later overwrite the
     * carried clock with `Date.now()` and put the count back to zero.
     */
    const meter = relight(options.carryOn && sessionId ? get().carried[sessionId] : null, Date.now());
    set({
      messages: [...get().messages, pending],
      pendingUserMessage: pending,
      running: true,
      turnStartedAt: meter.startedAt,
      turnTokens: meter.tokens,
      ...(sessionId
        ? { turns: { ...get().turns, [sessionId]: meter }, carried: without(get().carried, sessionId) }
        : {}),
      /*
       * Touched now, so the sidebar moves it now.
       *
       * The list is re-read from disk when a turn *ends*, which is the only thing that used to
       * update this — so writing to a conversation from yesterday left it sitting under 「昨天」 for
       * however long the turn took, while its own transcript was on screen filling up. The band a
       * conversation is in answers "when did I last touch this", and the answer changed the moment
       * the message was sent.
       *
       * Optimistic, like the message above it: the read at `agent_end` replaces it with the stored
       * timestamp, which is this one give or take the round trip.
       */
      sessions: get().sessions.map((each) =>
        each.id === sessionId ? { ...each, updatedAt: Date.now() } : each,
      ),
    });

    // This is where a blank conversation becomes a real one — the first message is the
    // first thing worth storing, so it is also the first thing that creates a session.
    if (!sessionId) {
      try {
        const snapshot = await bridge.sessions.create(
          cwd!,
          settings?.defaultModelId ?? "",
        );
        sessionId = snapshot.meta.id;
        /*
         * One message, because one was just sent.
         *
         * `create` returns the session as it was created — empty, `messageCount: 0` — and the
         * prompt that follows is what puts a message in it. The sidebar lists a conversation once
         * it has one, with an exemption for the session you are currently in, and between those
         * two facts sat the bug: the row was on screen only because it was selected, so clicking
         * any other conversation dropped it out of the list entirely. It came back whenever the
         * turn ended and the list was re-read from disk — which, on a turn that takes a minute,
         * is a minute of the conversation you just started not existing.
         *
         * Counting the message the composer already sent is the honest fix: the stored count is
         * stale rather than zero, and the refresh at `agent_end` replaces it with the real one.
         */
        const listed = {
          ...snapshot.meta,
          messageCount: 1,
          usage: snapshot.meta.usage ?? ZERO_USAGE,
        };
        set({
          activeSessionId: sessionId,
          meta: listed,
          toolRuns: {},
          approvals: [],
          loadingSession: false,
          /*
           * Straight into the list rather than waiting on a round trip: `agent:prompt` does not
           * resolve until the turn ends, which would leave the row you are actively talking to
           * missing from the sidebar for the whole reply. The title arrives with the refresh at
           * `agent_end`.
           *
           * Filtered by id first. Prepending unconditionally assumes this session cannot already
           * be listed, which is true of the id but not of the array: anything that rebuilds the
           * list — a refresh landing between `create` writing the index and this line running —
           * puts it there first, and the sidebar then shows the same conversation twice until the
           * next rebuild quietly drops one. Cheap, and it makes the invariant hold by construction
           * rather than by timing.
           */
          sessions: [listed, ...get().sessions.filter((s) => s.id !== listed.id)],
        });
        void bridge.sessions
          .capabilities(sessionId)
          .then((capabilities) => {
            if (get().activeSessionId === sessionId) set({ capabilities });
          });
      } catch (cause) {
        set({
          running: false,
          turnStartedAt: null,
          pendingUserMessage: null,
          messages: get().messages.filter((m) => m !== pending),
          notices: [
            ...get().notices,
            {
              id: `${Date.now()}-${Math.random()}`,
              level: "error" as const,
              message: `新建会话失败：${cause instanceof Error ? cause.message : String(cause)}`,
            },
          ],
        });
        return;
      }
    }

    await bridge.agent.prompt(sessionId, content, options);
  },

  /**
   * Run the turn again, from the message that started it.
   *
   * Failures are usually transport-level — a dropped socket, a relay hiccup — and the right
   * response is to send exactly the same thing again. Implemented on top of `editMessage`
   * because re-asking a question *is* replacing it with itself: everything after has to go,
   * for the same reason it does when the wording changes.
   */
  async retryFrom(index: number) {
    const messages = get().messages;
    for (let i = Math.min(index, messages.length - 1); i >= 0; i--) {
      const message = messages[i];
      if (message.role === "user" && !message.synthetic) {
        await get().editMessage(i, message.content);
        return;
      }
    }
  },

  async editMessage(index: number, content: UserContent[]) {
    const sessionId = get().activeSessionId;
    if (!sessionId || get().running) return;

    /*
     * Optimistic, and destructive on purpose.
     *
     * The reply being replaced is on screen right now; leaving it there while the new turn
     * spins up would show an answer to a question that has already been withdrawn. Cutting
     * first makes the screen agree with what is about to be sent.
     */
    const pending: Message = {
      role: "user",
      content,
      timestamp: Date.now(),
    };
    set({
      messages: [...get().messages.slice(0, index), pending],
      pendingUserMessage: pending,
      toolRuns: {},
      approvals: [],
      running: true,
      turnStartedAt: Date.now(),
      turnTokens: 0,
      /*
       * From zero, and the carried meter goes with the reply it belonged to.
       *
       * 重试 is the opposite of 继续: it throws away what the turn did and asks again, paying for it
       * a second time. Carrying the paused turn's minutes and tokens into that would report the
       * discarded work as part of the work that replaced it.
       */
      turns: { ...get().turns, [sessionId]: { startedAt: Date.now(), tokens: 0 } },
      carried: without(get().carried, sessionId),
      // The cached copy is now wrong; it will be rebuilt from the events that follow.
      sessionCache: without(get().sessionCache, sessionId),
    });

    await bridge.agent.editMessage(sessionId, index, content);
  },

  async abort() {
    const sessionId = get().activeSessionId;
    if (sessionId) await bridge.agent.abort(sessionId);
  },

  async respondToApproval(id: string, decision: ApprovalDecision) {
    const sessionId = get().activeSessionId;
    if (!sessionId) return;
    set({ approvals: get().approvals.filter((a) => a.id !== id) });
    await bridge.agent.approve(sessionId, id, decision);
  },

  /**
   * Choose the model this conversation runs on, at any point in it.
   *
   * This used to refuse once a conversation had started, because stored messages carry
   * provider-specific handles — the `signature` on a thinking block, the encrypted reasoning
   * payload replayed on the next turn — and handing one provider's handle to another is rejected
   * outright rather than ignored. That is a real hazard, but refusing the switch was the wrong
   * answer to it: the handles are droppable, and what they buy is continuity of the model's own
   * chain of thought, not the conversation itself.
   *
   * So the switch goes through and `stripStaleHandles` clears the handles written before it. What
   * is lost is the earlier reasoning context, which the warning below says plainly — the visible
   * transcript, and everything the new model reads, is unchanged.
   */
  async setModel(modelId: string, options: { asDefault?: boolean } = {}) {
    const { activeSessionId, settings, meta } = get();
    const midConversation = get().messages.length > 0 && meta?.modelId !== modelId;
    if (activeSessionId)
      await bridge.agent.setModel(activeSessionId, modelId);
    if (meta) set({ meta: { ...meta, modelId } });
    /*
     * The app default is a separate decision, and used to be made for you.
     *
     * Every pick wrote `defaultModelId`, so trying a cheaper model on one question silently
     * re-aimed every conversation started afterwards. A conversation with no session yet is the
     * exception: there is nothing else for the choice to land on, and it is about to become the
     * model the new session is created with.
     */
    if (settings && (options.asDefault || !activeSessionId))
      await get().saveSettings({ ...settings, defaultModelId: modelId });
    if (midConversation) {
      get().notify(
        "已切换模型。之前的推理上下文无法跨模型沿用，接下来的回答可能变差；重开一个对话效果最好。",
        "warn",
      );
    }
  },

  /**
   * The reasoning level for the conversation on screen.
   *
   * With no session yet there is nothing to write it to, so it lands on the app default — which
   * is also what that conversation will be created with, so the control means the same thing in
   * both cases. `meta` is updated straight away rather than waiting for the round trip: this is
   * read by the composer's label, and a control that lags a frame behind the press reads as one
   * that did not take.
   */
  async setThinking(thinking: ThinkingLevel) {
    const { activeSessionId, meta, settings } = get();
    if (activeSessionId) {
      if (meta) set({ meta: { ...meta, thinking } });
      await bridge.agent.setThinking(activeSessionId, thinking);
      return;
    }
    if (settings) await get().saveSettings({ ...settings, thinking });
  },

  async refreshSync() {
    set({ sync: await bridge.sync.status() });
  },
  };
}

