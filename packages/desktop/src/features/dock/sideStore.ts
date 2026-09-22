/**
 * State for the side chat and the task queue.
 *
 * Kept apart from the main store because it is a different conversation with a different
 * lifetime: it restores from its own snapshots and never reaches the main session log.
 * Folding it into the main store would put two transcripts behind one set of message fields
 * and invite exactly the bug that makes a side-chat reply appear in the main thread.
 *
 * **每个会话一份，不是「当前那一份」。** 分屏之后屏上同时有不止一个会话，而侧边聊天面板每一屏
 * 都能开一个——从前这里只存一份对话，谁被点到就整份换成谁的，于是两屏的侧边聊天画的是同一段
 * 内容，点一下另一屏、这一屏的侧边聊天就空了。`chats` 按会话 id 存，面板按自己那一屏的会话读，
 * 两件事才对得上。读的那一侧是 `sidechat/scope.ts`。
 */

import type { SideChatUpdate, Message, MessageAttachment, QueuedTask, ThinkingLevel, UserContent } from "@lyra/core";
import { create } from "zustand";
import { reduceSideEvent, rebuildToolRuns, type SideConversation } from "./side-events.ts";

import { bridge } from "../../services/index.ts";

/**
 * What can occupy a pane. One of each at a time — two diffs of one worktree is not a thing.
 *
 * `chat` here is the *side* chat, a second conversation you can run beside the main one. The main
 * thread is `conversation`, which the dock adds to this set; the two names are close and the
 * things are not, which is worth the sentence. `files` is the tree and `file` is whichever one of
 * them is open — two panes, because they are two things you arrange separately.
 */
export type PanelKind =
	| "files"
	| "file"
	| "chat"
	/** Work the main agent delegated — see `components/subagents/`. */
	| "subagents"
	| "terminal"
	| "review"
	/**
	 * This conversation turn's recorded file diffs.
	 *
	 * Not the worktree. Git's version review is `review`; the file pane is the
	 * current contents. This one is only what the latest turn wrote.
	 */
	| "delivery"
	| "browser"
	| "tasks"
	| "trajectory";

/** Just enough of a preview for the panel to load it; the card owns the full record. */
interface BrowserPreview {
	id: string;
	sessionId: string;
	title: string;
	entry: string;
}

/**
 * 一个会话的侧边聊天。
 *
 * `SideConversation` 是能从主进程恢复出来的那部分；这里多出来的三样只活在界面上，
 * 但同样是**这一个会话**的，不是整个窗口的——两屏各自的加载状态、各自的思考等级、
 * 各自那句等着被放回输入框的话。
 */
export interface SideChatSlot extends SideConversation {
	loading: boolean;
	/**
	 * 这一侧自己的思考等级，`null` 表示跟着主会话走。
	 *
	 * 不落盘——模型是这个对话的属性（换了要记住），而想多久更像是「这一问要不要多花点时间」，
	 * 下次打开从主会话那边重新起算是对的。`sidechat.ts` 的 `ask` 早就收这个参数，不给才回落到
	 * 主会话，所以不传等于从前的行为。
	 */
	thinking: ThinkingLevel | null;
	/** Text waiting to be put back into the composer, and a counter so repeats still register. */
	draftSeed: { text: string; nonce: number } | null;
}

interface SideState {
	/** 每个会话一份。没开过的会话在这里没有条目，读出来是 `EMPTY_SLOT`。 */
	chats: Record<string, SideChatSlot>;

	/**
	 * A command the user asked to run, waiting for the terminal to pick it up.
	 *
	 * Handed over rather than executed here: the pty belongs to the terminal pane, which may not
	 * exist yet when the button is pressed. The pane clears this once it has written it, so the
	 * same command is never run twice.
	 */
	pendingCommand: string | null;
	runInTerminal(command: string): void;
	commandTaken(): void;
	/**
	 * What the browser tab is showing.
	 *
	 * A preview handed over from the transcript, a URL typed into the address bar, or nothing.
	 * Held here rather than inside the panel so "open this in the side panel" can be a single
	 * call from a card that knows nothing about how the panel is built.
	 */
	browserTarget: { kind: "preview"; preview: BrowserPreview } | { kind: "url"; url: string } | null;
	openPreview(preview: BrowserPreview): void;
	openUrl(url: string): void;

	/** Pull whatever conversation this session already has. Safe to call for several at once. */
	attach(sessionId: string | null, force?: boolean): Promise<void>;
	ask(sessionId: string | null, content: UserContent[], meta?: SideSendMeta): Promise<void>;
	abort(sessionId: string | null): Promise<void>;
	reset(sessionId: string | null): Promise<void>;
	/** Change a question already asked and answer from there. Everything after it is dropped. */
	editAndResend(sessionId: string | null, index: number, content: UserContent[], meta?: SideSendMeta): Promise<void>;
	setModel(sessionId: string | null, modelId: string | null): Promise<void>;
	setThinking(sessionId: string | null, level: ThinkingLevel | null): void;
	cancelTask(sessionId: string | null, taskId: string): Promise<void>;
	/** Take a finished row off the list. What it did, if anything, stays in the transcript. */
	dismissTask(sessionId: string | null, taskId: string): Promise<void>;
	/** Put a stopped task back on the queue — interrupted by a pause, or failed. */
	resumeTask(sessionId: string | null, taskId: string): Promise<void>;
	/** Hand text back to the composer — see the note on the implementation. */
	seedDraft(sessionId: string | null, text: string): void;
	clearDraftSeed(sessionId: string | null): void;
	applyEvent(sessionId: string, event: SideChatUpdate & { sideRevision?: number }): void;
	setTasks(sessionId: string, tasks: QueuedTask[]): void;
}

/**
 * 一条侧边聊天消息里「给人看的那一份」。
 *
 * 和主会话存的是同一组字段（`displayText` + `attachments`），只是从这一侧递进去。
 *
 * 不导出：输入框那边交过来的是 `composer` 的 `OutgoingMeta`，两者字段相同，按结构对得上。
 * 把它也导出去，就成了同一个概念在两个域里各有一个名字——knip 当场报的就是这件事。
 */
interface SideSendMeta {
	displayText: string;
	attachments: MessageAttachment[];
}

/** 空的就不要往消息上挂空字段——`undefined` 会被序列化成一个真的 key。 */
function displayOf(meta?: SideSendMeta): { displayText?: string; attachments?: MessageAttachment[] } {
	if (!meta) return {};
	return {
		displayText: meta.displayText,
		...(meta.attachments.length > 0 ? { attachments: meta.attachments } : {}),
	};
}

const reads = new Map<string, { events: (SideChatUpdate & { sideRevision?: number })[] }>();

const EMPTY: SideConversation = {
	modelId: null,
	error: null,
	messages: [],
	toolRuns: {},
	running: false,
	pending: null,
	tasks: [],
};

/**
 * 没开过的那个会话读出来的东西。
 *
 * 一个常量而不是每次新建一个：selector 直接把它交给组件，每次换一个新对象等于每次都「变了」，
 * React 会一直重画。
 */
const EMPTY_SLOT: SideChatSlot = { ...EMPTY, loading: false, thinking: null, draftSeed: null };

/** 这个会话的那一份。问一个没开过的会话不是错，答案是空的。 */
export function sideChatOf(state: { chats: Record<string, SideChatSlot> }, sessionId: string | null): SideChatSlot {
	return (sessionId ? state.chats[sessionId] : undefined) ?? EMPTY_SLOT;
}

export const useSide = create<SideState>((set, get) => {
	/** 只动这一个会话那一份，别的原样留着。 */
	const patch = (sessionId: string, changes: Partial<SideChatSlot> | ((slot: SideChatSlot) => Partial<SideChatSlot>)) => {
		set((state) => {
			const slot = state.chats[sessionId] ?? EMPTY_SLOT;
			return { chats: { ...state.chats, [sessionId]: { ...slot, ...(typeof changes === "function" ? changes(slot) : changes) } } };
		});
	};

	return {
		chats: {},
		browserTarget: null,

		openPreview: (preview) => set({ browserTarget: { kind: "preview", preview } }),
		openUrl: (url) => set({ browserTarget: { kind: "url", url } }),
		pendingCommand: null,
		/*
		 * 只记下这条命令，开终端是调用方的事。
		 *
		 * 从前这里顺手把终端开出来，而「开在哪」在分屏之后不再有唯一答案——它得问「人在哪一屏」，
		 * 那是 `openScopedPanel` 的事，而这个文件是 dock 的底层状态，反过来依赖它会连成一个环
		 * （sideStore → popout → store → tree → sideStore，`pnpm arch` 当场报 no-circular）。
		 *
		 * 两个调用方（文件树的「在终端打开」、代码块的「在终端运行」）各自负责叫出一个终端来接。
		 */
		runInTerminal: (command) => {
			set({ pendingCommand: command });
		},
		commandTaken: () => set({ pendingCommand: null }),

		/**
		 * 把这个会话的侧边对话拉过来。
		 *
		 * 幂等且可并存：分屏时两屏各 attach 各的，互不影响。同一个会话正在拉的时候再叫一次会
		 * 被挡掉（`reads`），`force` 是「刚刚重置过，必须重读」。
		 */
		async attach(sessionId, force = false) {
			if (!sessionId) return;
			if (reads.has(sessionId) && !force) return;
			/*
			 * 只有从没拉过的那一次才算「加载中」。
			 *
			 * `loading` 的用途是「还没有东西可画」——面板据此画加载行，输入框据此变灰。而回到一屏
			 * 时这一份**已经在手上**，再标一次加载，界面就闪一下、输入框灰一下。
			 *
			 * 灰那一下不只是难看：`disabled` 的 textarea 接不住点击的默认聚焦行为，于是分屏里点
			 * 另一屏的侧边输入框，第一下永远落空，要点第二下才能打字。实测焦点直接留在 `body`，
			 * 而那个 textarea 自始至终是同一个节点——不是被换掉，是那一瞬间它不接受焦点。
			 */
			if (!get().chats[sessionId]) patch(sessionId, { loading: true });
			const read = { events: [] as (SideChatUpdate & { sideRevision?: number })[] };
			reads.set(sessionId, read);
			try {
				const [snapshot, tasks] = await Promise.all([bridge.sideChat.state(sessionId), bridge.tasks.list(sessionId)]);
				if (reads.get(sessionId) !== read) return;
				let next: SideConversation = { ...EMPTY, modelId: snapshot?.modelId ?? null, messages: snapshot?.messages ?? [], running: snapshot?.running ?? false, tasks,
					toolRuns: snapshot ? rebuildToolRuns(snapshot.messages) : {} };
				// Replay only events newer than the snapshot, preserving both old history and live deltas.
				for (const event of read.events) {
					if (event.sideRevision === undefined || event.sideRevision > (snapshot?.revision ?? 0)) next = reduceSideEvent(next, event);
				}
				// 界面上那几样（想多久、等着放回输入框的话）不在快照里，是这一屏自己的，留着。
				patch(sessionId, (slot) => ({ ...next, loading: false, thinking: slot.thinking, draftSeed: slot.draftSeed }));
			} catch (error) {
				if (reads.get(sessionId) === read) patch(sessionId, { loading: false, error: String(error) });
			} finally { if (reads.get(sessionId) === read) reads.delete(sessionId); }
		},

		setThinking(sessionId, level) {
			if (!sessionId) return;
			patch(sessionId, { thinking: level });
		},

		async setModel(sessionId, modelId) {
			if (!sessionId) return;
			try { await bridge.sideChat.setModel(sessionId, modelId); }
			catch (error) { get().applyEvent(sessionId, { type: "notice", level: "error", message: String(error) }); }
		},

		async ask(sessionId, content, meta) {
			if (!sessionId) return;
			const slot = sideChatOf(get(), sessionId);
			if (slot.running || slot.loading) return;

			/*
			 * Paint it first.
			 *
			 * The first question of a session activates the main agent behind the scenes, which
			 * takes a second or more. Without this the composer would clear and nothing would take
			 * its place for that whole time.
			 */
			/*
			 * 先画出来的那一条，带的也是给人看的那一份。
			 *
			 * 不带的话，消息会先以「附件正文摊在气泡里」的样子出现，等主进程回存之后再换成胶囊——
			 * 同一条消息在眼前变了一次形。
			 */
			const pending: Message = { role: "user", content, timestamp: Date.now(), ...displayOf(meta) };
			patch(sessionId, { messages: [...slot.messages, pending], pending, running: true, error: null });
			const thinking = sideChatOf(get(), sessionId).thinking;
			try { await bridge.sideChat.ask(sessionId, content, { ...(thinking ? { thinking } : {}), ...displayOf(meta) }); }
			catch (error) { get().applyEvent(sessionId, { type: "notice", level: "error", message: String(error) }); get().applyEvent(sessionId, { type: "agent_end", reason: "error", error: String(error) }); }
		},

		/**
		 * Change a question already asked, and answer from there.
		 *
		 * Everything after it goes, because it was a reply to wording that no longer exists — the same
		 * rule the main conversation follows. Painted immediately for the same reason `ask` is: the
		 * round trip is long enough that a composer clearing to nothing reads as a lost message.
		 */
		async editAndResend(sessionId, index, content, meta) {
			if (!sessionId) return;
			const slot = sideChatOf(get(), sessionId);
			if (slot.running || slot.loading) return;
			const kept = slot.messages.slice(0, index);
			const pending: Message = { role: "user", content, timestamp: Date.now(), ...displayOf(meta) };
			patch(sessionId, { messages: [...kept, pending], pending, running: true, error: null });
			try { await bridge.sideChat.editAndResend(sessionId, index, content, displayOf(meta)); }
			catch (error) { get().applyEvent(sessionId, { type: "notice", level: "error", message: String(error) }); get().applyEvent(sessionId, { type: "agent_end", reason: "error", error: String(error) }); }
		},

		async abort(sessionId) {
			if (!sessionId) return;
			try { await bridge.sideChat.abort(sessionId); }
			catch (error) { get().applyEvent(sessionId, { type: "notice", level: "error", message: String(error) }); }
		},

		async reset(sessionId) {
			if (!sessionId || sideChatOf(get(), sessionId).loading) return;
			patch(sessionId, { loading: true, error: null });
			try {
				await bridge.sideChat.reset(sessionId);
				await get().attach(sessionId, true);
			} catch (error) {
				patch(sessionId, { loading: false });
				get().applyEvent(sessionId, { type: "notice", level: "error", message: String(error) });
			}
		},

		async cancelTask(sessionId, taskId) {
			if (!sessionId) return;
			// Optimistic: the card should stop saying "queued" on the click, not on the round trip.
			patch(sessionId, (slot) => ({
				tasks: slot.tasks.map((t) => (t.id === taskId && t.status === "queued" ? { ...t, status: "cancelled" } : t)),
			}));
			await bridge.tasks.cancel(sessionId, taskId);
		},

		async resumeTask(sessionId, taskId) {
			if (!sessionId) return;
			// Optimistic: the row should stop saying "interrupted" on the click.
			patch(sessionId, (slot) => ({
				tasks: slot.tasks.map((t) => (t.id === taskId ? { ...t, status: "queued" as const, cancelledBy: undefined } : t)),
			}));
			await bridge.tasks.resume(sessionId, taskId);
		},

		async dismissTask(sessionId, taskId) {
			if (!sessionId) return;
			// Optimistic, same as cancelling: the row goes on the click.
			patch(sessionId, (slot) => ({ tasks: slot.tasks.filter((t) => t.id !== taskId) }));
			await bridge.tasks.dismiss(sessionId, taskId);
		},

		/**
		 * Put a task's text back where it was written, so it can be changed and sent again.
		 *
		 * Withdrawing a task should not throw away what it said — that is the whole reason to withdraw
		 * one rather than let it run. The composer holds its own text, so this is a seed it picks up
		 * rather than a value it is given; the counter is what makes withdrawing the same text twice
		 * register as two separate events.
		 */
		seedDraft(sessionId, text) {
			if (!sessionId) return;
			patch(sessionId, (slot) => ({ draftSeed: { text, nonce: slot.draftSeed ? slot.draftSeed.nonce + 1 : 1 } }));
		},

		clearDraftSeed(sessionId) {
			if (!sessionId) return;
			patch(sessionId, { draftSeed: null });
		},

		setTasks: (sessionId, tasks) => patch(sessionId, { tasks }),

		applyEvent(sessionId, event) {
			// 正在拉快照的会话，事件先攒着，等快照回来再按 revision 决定放不放。
			reads.get(sessionId)?.events.push(event);
			patch(sessionId, (slot) => reduceSideEvent(slot, event));
		},
	};
});
