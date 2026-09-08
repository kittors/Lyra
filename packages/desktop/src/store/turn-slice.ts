/**
 * Saying something, and everything that follows from it.
 *
 * Sending, editing, retrying, interrupting. The composer's copy of a message is painted before
 * anything is stored — a conversation that swallows what you typed for two seconds while a session
 * is created reads as broken — and the stored copy replaces it when the runtime confirms it.
 */

import type { ApprovalDecision, Message, ThinkingLevel, UserContent } from "@lyra/core";
import { prune, without } from "./derive.ts";
import { loadCarried, relight, saveCarried } from "./turn-meter.ts";
import type { AppState } from "./index.ts";
import { bridge } from "../services/index.ts";

type Get = () => AppState;
type Set = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

export function turnSlice(set: Set, get: Get) {
	const creating = new Map<number, ReturnType<typeof bridge.sessions.create>>();
	const prompting = new Map<string, symbol>();
	return {
	async send(content: UserContent[], options: { synthetic?: boolean; carryOn?: boolean; deliver?: "steer" | "followUp"; displayText?: string; skillRef?: { name: string; path?: string; pluginId?: string }; sessionRefs?: Array<{ id: string; title: string }>; sessionId?: string } = {}) {
		const { workspace, settings, scratchCwd, selectionEpoch: epoch } = get();
		let sessionId = options.sessionId ?? get().activeSessionId;
		const cwd = workspace?.path ?? scratchCwd;
		if (!sessionId && !cwd) { await get().pickWorkspace(); return false; }
		// A second submission in the same draft shares its identity, never its title as a key.
		const inFlight = !sessionId ? creating.get(epoch) : undefined;
		if (inFlight) {
			try { sessionId = (await inFlight).meta.id; }
			catch { return false; }
		}
		/*
		 * 这次提交还归不归屏幕上这个对话。
		 *
		 * 两件事一起问。选择没被切走——新建会话那一段等待里，人可能已经开了另一个对话；以及这条
		 * 消息发的就是屏幕上这个——队列出队时是指名会话的（见 `queue-slice`），而那一刻人常常已经
		 * 在看别的对话了，乐观地把消息画进转录会画进别人的转录。
		 */
		const ownsSelection = () => get().selectionEpoch === epoch && (!options.sessionId || options.sessionId === get().activeSessionId);
		const pending: Message = {
			role: "user",
			content,
			timestamp: Date.now(),
			...(options.synthetic ? { synthetic: true } : {}),
			...(options.displayText !== undefined ? { displayText: options.displayText } : {}),
			...(options.skillRef ? { skillRef: options.skillRef } : {}),
			...(options.sessionRefs?.length ? { sessionRefs: options.sessionRefs } : {}),
		};
		const carriedMeter = sessionId ? (get().carried[sessionId] ?? loadCarried(sessionId)) : null;
		const meter = relight(options.carryOn && sessionId ? carriedMeter : null, Date.now());
		if (sessionId) saveCarried(sessionId, null);
		if (ownsSelection()) set({
			messages: [...get().messages, pending], pendingUserMessage: { sessionId: sessionId ?? null, message: pending },
			running: true, stopped: null, turnStartedAt: meter.startedAt, turnTokens: meter.tokens,
		});
		if (sessionId) set({
			turns: { ...get().turns, [sessionId]: meter }, carried: without(get().carried, sessionId),
			activity: { ...get().activity, [sessionId]: "running" },
			sessions: get().sessions.map((session) => session.id === sessionId ? { ...session, updatedAt: Date.now() } : session),
		});
		let resumePending = false;
		if (!sessionId && cwd) {
			const creation = bridge.sessions.create(cwd, settings?.defaultModelId ?? "", {
				content,
				synthetic: options.synthetic,
				displayText: options.displayText,
				skillRef: options.skillRef,
				sessionRefs: options.sessionRefs,
			});
			creating.set(epoch, creation);
			try {
				const snapshot = await creation;
				sessionId = snapshot.meta.id;
				resumePending = true;
				const listed = snapshot.meta;
				const messages = snapshot.messages;
				set({
					sessions: [listed, ...get().sessions.filter((session) => session.id !== listed.id)],
					activity: { ...get().activity, [sessionId]: "running" },
					turns: { ...get().turns, [sessionId]: meter },
					sessionCache: prune({ ...get().sessionCache, [sessionId]: {
						meta: listed, messages, toolRuns: {},
						state: { running: true, approvals: [], todos: [], compactions: [], stopped: null, retrying: null, capabilities: null, pendingUserMessage: null },
					} }, sessionId),
					...(ownsSelection() ? {
						activeSessionId: sessionId, meta: listed, messages, toolRuns: {}, approvals: [],
						loadingSession: false, pendingUserMessage: null,
					} : {}),
				});
			} catch (cause) {
				if (ownsSelection()) set({ running: false, stopped: "error", turnStartedAt: null, pendingUserMessage: null });
				get().notify(`新建会话失败：${cause instanceof Error ? cause.message : String(cause)}`, "error");
				return false;
			} finally { creating.delete(epoch); }
		}
		if (!sessionId) return false;
		const id = sessionId;
		const submission = Symbol();
		prompting.set(id, submission);
		let accepted = false;
		try {
			const meta = await bridge.agent.prompt(id, content, { ...options, resumePending });
			accepted = true;
			const cached = get().sessionCache[id];
			set({
				sessions: get().sessions.map((listed) => listed.id === id ? meta : listed),
				...(cached ? { sessionCache: { ...get().sessionCache, [id]: { ...cached, meta } } } : {}),
				...(get().activeSessionId === id ? { meta } : {}),
			});
			if (get().activeSessionId === id && get().workspace && get().workspace?.path !== meta.cwd) {
				const workspace = await bridge.workspace.info(meta.cwd);
				if (get().activeSessionId === id) set({ workspace });
			}
			const capabilities = await bridge.sessions.capabilities(id);
			if (get().activeSessionId === id) set({ capabilities });
		} catch (cause) {
			// Once acknowledged, a failed follow-up read must not invite a duplicate submission.
			if (accepted) {
				get().notify(`消息已发送，刷新会话状态失败：${cause instanceof Error ? cause.message : String(cause)}`, "error");
				return true;
			}
			// A later prompt owns this session even after its optimistic message is acknowledged.
			if (prompting.get(id) !== submission) {
				get().notify(`发送失败：${cause instanceof Error ? cause.message : String(cause)}`, "error");
				return false;
			}
			const cached = get().sessionCache[id];
			set({ activity: { ...get().activity, [id]: "failed" }, turns: without(get().turns, id),
				...(cached?.state ? { sessionCache: { ...get().sessionCache, [id]: { ...cached, state: { ...cached.state, running: false, stopped: "error", pendingUserMessage: null } } } } : {}),
			});
			if (get().activeSessionId === id) set({ running: false, stopped: "error", pendingUserMessage: null, turnStartedAt: null });
			get().notify(`发送失败：${cause instanceof Error ? cause.message : String(cause)}`, "error");
			return false;
		} finally { if (prompting.get(id) === submission) prompting.delete(id); }
		return true;
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
    const before = get();

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
      pendingUserMessage: { sessionId, message: pending },
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
    saveCarried(sessionId, null);

		try {
			await bridge.agent.editMessage(sessionId, index, content);
		} catch (cause) {
			const current = get();
			// Roll back only the unacknowledged preview, never a newer stream or another selection.
			if (current.activeSessionId === sessionId && current.pendingUserMessage?.sessionId === sessionId && current.pendingUserMessage.message === pending) {
				set({ messages: before.messages, toolRuns: before.toolRuns, approvals: before.approvals,
					running: before.running, pendingUserMessage: before.pendingUserMessage,
					turnStartedAt: before.turnStartedAt, turnTokens: before.turnTokens,
					turns: before.turns[sessionId] ? { ...current.turns, [sessionId]: before.turns[sessionId] } : without(current.turns, sessionId),
					carried: before.carried[sessionId] ? { ...current.carried, [sessionId]: before.carried[sessionId] } : without(current.carried, sessionId) });
				saveCarried(sessionId, before.carried[sessionId] ?? null);
			}
			if (get().sessionCache[sessionId]?.messages.includes(pending)) {
				set({ sessionCache: without(get().sessionCache, sessionId) });
			}
			get().notify(`编辑重发失败：${cause instanceof Error ? cause.message : String(cause)}`, "error");
		}
  },

  async abort() {
    const sessionId = get().activeSessionId;
    if (sessionId) await bridge.agent.abort(sessionId);
  },

  async respondToApproval(id: string, decision: ApprovalDecision, ownerId?: string) {
    const sessionId = ownerId ?? get().activeSessionId;
    if (!sessionId) return;
    await bridge.agent.approve(sessionId, id, decision);
    set((state) => {
      const cached = state.sessionCache[sessionId];
      return {
        ...(state.activeSessionId === sessionId ? { approvals: state.approvals.filter((request) => request.id !== id) } : {}),
        ...(cached?.state ? { sessionCache: { ...state.sessionCache, [sessionId]: { ...cached, state: { ...cached.state, approvals: cached.state.approvals.filter((request) => request.id !== id) } } } } : {}),
      };
    });
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
    if (activeSessionId) {
      /*
       * Paint this conversation's choice before the write crosses IPC.
       *
       * Writing it after `await` let the old conversation's meta arrive after `newSession` had
       * cleared it, making a blank conversation display the model that belonged to the one left
       * behind. A failed write is rolled back only while that same conversation and choice are
       * still on screen, so neither path can overwrite a conversation opened in the meantime.
       */
      if (meta) set({ meta: { ...meta, modelId } });
      try {
        await bridge.agent.setModel(activeSessionId, modelId);
      } catch (cause) {
        const current = get();
        if (
          meta &&
          current.activeSessionId === activeSessionId &&
          current.meta?.id === meta.id &&
          current.meta.modelId === modelId
        ) {
          set({ meta });
        }
        throw cause;
      }
    }
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
			const optimistic = meta ? { ...meta, thinking } : null;
			if (optimistic) set({ meta: optimistic });
			try {
				await bridge.agent.setThinking(activeSessionId, thinking);
			} catch (cause) {
				if (get().activeSessionId === activeSessionId && get().meta === optimistic) set({ meta });
				get().notify(`推理等级设置失败：${cause instanceof Error ? cause.message : String(cause)}`, "error");
			}
      return;
    }
    if (settings) await get().saveSettings({ ...settings, thinking });
  },

  async refreshSync() {
    set({ sync: await bridge.sync.status() });
  },
  };
}
