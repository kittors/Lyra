/**
 * State for the side chat and the task queue.
 *
 * Kept apart from the main store because it is a different conversation with a different
 * lifetime: this one lives in memory, dies with the app, and never reaches the session log.
 * Folding it into the main store would put two transcripts behind one set of message fields
 * and invite exactly the bug that makes a side-chat reply appear in the main thread.
 */

import type { AgentEvent, Message, QueuedTask, UserContent } from "@lyra/core";
import { create } from "zustand";
import { useDock } from "./store.ts";
import { summarizeToolCall } from "../../lib/tool-summary.ts";
import type { ToolRun } from "../../store/index.ts";
import { settleTail } from "../../lib/transcript.ts";
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

interface SideState {
	/** The session this state belongs to, so a late event from the previous one is discarded. */
	sessionId: string | null;
	messages: Message[];
	toolRuns: Record<string, ToolRun>;
	running: boolean;
	/** Painted before the round trip, replaced by the stored copy when it arrives. */
	pending: Message | null;
	tasks: QueuedTask[];
	/** Text waiting to be put back into the composer, and a counter so repeats still register. */
	draftSeed: { text: string; nonce: number } | null;
	/** Client-side cache of in-memory side chats per session for seamless switching without flicker. */
	sessionCache: Record<string, { messages: Message[]; toolRuns: Record<string, ToolRun>; running: boolean; tasks: QueuedTask[] }>;

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

	/** Point at a session and pull whatever conversation it already has. */
	attach(sessionId: string | null): Promise<void>;
	ask(content: UserContent[]): Promise<void>;
	abort(): Promise<void>;
	reset(): Promise<void>;
	/** Change a question already asked and answer from there. Everything after it is dropped. */
	editAndResend(index: number, content: UserContent[]): Promise<void>;
	cancelTask(taskId: string): Promise<void>;
	/** Take a finished row off the list. What it did, if anything, stays in the transcript. */
	dismissTask(taskId: string): Promise<void>;
	/** Put a stopped task back on the queue — interrupted by a pause, or failed. */
	resumeTask(taskId: string): Promise<void>;
	/** Hand text back to the composer — see the note on the implementation. */
	seedDraft(text: string): void;
	clearDraftSeed(): void;
	applyEvent(sessionId: string, event: AgentEvent): void;
	setTasks(tasks: QueuedTask[]): void;
}

const EMPTY = {
	messages: [] as Message[],
	toolRuns: {} as Record<string, ToolRun>,
	running: false,
	pending: null as Message | null,
	tasks: [] as QueuedTask[],
};

export const useSide = create<SideState>((set, get) => ({
	browserTarget: null,
	sessionId: null,
	sessionCache: {},
	// Not in `EMPTY`: switching conversations should not throw away half-typed text, and the seed
	// is consumed by the composer within a tick of being set anyway.
	draftSeed: null,
	...EMPTY,

	openPreview: (preview) => set({ browserTarget: { kind: "preview", preview } }),
	openUrl: (url) => set({ browserTarget: { kind: "url", url } }),
	pendingCommand: null,
	runInTerminal: (command) => {
		set({ pendingCommand: command });
		// Make sure there is a terminal to pick it up. `open` focuses one that already exists
		// rather than adding a second, so a command run twice does not split the dock in two.
		useDock.getState().open("terminal");
	},
	commandTaken: () => set({ pendingCommand: null }),

	async attach(sessionId) {
		const currentSessionId = get().sessionId;
		if (currentSessionId === sessionId) return;

		// Save current session's state into sessionCache before switching
		if (currentSessionId) {
			set((s) => ({
				sessionCache: {
					...s.sessionCache,
					[currentSessionId]: {
						messages: s.messages,
						toolRuns: s.toolRuns,
						running: s.running,
						tasks: s.tasks,
					},
				},
			}));
		}

		// Restore cached data immediately if available to prevent flicker
		const cached = sessionId ? get().sessionCache[sessionId] : null;
		set({
			sessionId,
			messages: cached?.messages ?? [],
			toolRuns: cached?.toolRuns ?? {},
			running: cached?.running ?? false,
			pending: null,
			tasks: cached?.tasks ?? [],
		});
		if (!sessionId) return;

		const [state, tasks] = await Promise.all([
			bridge.sideChat.state(sessionId),
			bridge.tasks.list(sessionId),
		]);
		// A second switch while this was in flight wins.
		if (get().sessionId !== sessionId) return;
		const nextMessages = state?.messages ?? [];
		const nextRunning = state?.running ?? false;
		const nextToolRuns = state ? rebuildToolRuns(state.messages) : {};
		set((s) => ({
			messages: nextMessages,
			running: nextRunning,
			toolRuns: nextToolRuns,
			tasks,
			sessionCache: {
				...s.sessionCache,
				[sessionId]: {
					messages: nextMessages,
					toolRuns: nextToolRuns,
					running: nextRunning,
					tasks,
				},
			},
		}));
	},

	async ask(content) {
		const sessionId = get().sessionId;
		if (!sessionId || get().running) return;

		/*
		 * Paint it first.
		 *
		 * The first question of a session activates the main agent behind the scenes, which
		 * takes a second or more. Without this the composer would clear and nothing would take
		 * its place for that whole time.
		 */
		const pending: Message = { role: "user", content, timestamp: Date.now() };
		set({ messages: [...get().messages, pending], pending, running: true });
		await bridge.sideChat.ask(sessionId, content);
	},

	/**
	 * Change a question already asked, and answer from there.
	 *
	 * Everything after it goes, because it was a reply to wording that no longer exists — the same
	 * rule the main conversation follows. Painted immediately for the same reason `ask` is: the
	 * round trip is long enough that a composer clearing to nothing reads as a lost message.
	 */
	async editAndResend(index, content) {
		const sessionId = get().sessionId;
		if (!sessionId || get().running) return;
		const kept = get().messages.slice(0, index);
		const pending: Message = { role: "user", content, timestamp: Date.now() };
		set({ messages: [...kept, pending], pending, running: true });
		await bridge.sideChat.editAndResend(sessionId, index, content);
	},

	async abort() {
		const sessionId = get().sessionId;
		if (sessionId) await bridge.sideChat.abort(sessionId);
		set({ running: false });
	},

	async reset() {
		const sessionId = get().sessionId;
		set({ ...EMPTY, tasks: get().tasks });
		if (sessionId) await bridge.sideChat.reset(sessionId);
	},

	async cancelTask(taskId) {
		const sessionId = get().sessionId;
		if (!sessionId) return;
		// Optimistic: the card should stop saying "queued" on the click, not on the round trip.
		set({
			tasks: get().tasks.map((t) => (t.id === taskId && t.status === "queued" ? { ...t, status: "cancelled" } : t)),
		});
		await bridge.tasks.cancel(sessionId, taskId);
	},

	async resumeTask(taskId) {
		const sessionId = get().sessionId;
		if (!sessionId) return;
		// Optimistic: the row should stop saying "interrupted" on the click.
		set({
			tasks: get().tasks.map((t) => (t.id === taskId ? { ...t, status: "queued" as const, cancelledBy: undefined } : t)),
		});
		await bridge.tasks.resume(sessionId, taskId);
	},

	async dismissTask(taskId) {
		const sessionId = get().sessionId;
		if (!sessionId) return;
		// Optimistic, same as cancelling: the row goes on the click.
		set({ tasks: get().tasks.filter((t) => t.id !== taskId) });
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
	seedDraft(text) {
		set({ draftSeed: { text, nonce: get().draftSeed ? get().draftSeed!.nonce + 1 : 1 } });
	},

	clearDraftSeed: () => set({ draftSeed: null }),

	setTasks: (tasks) => set({ tasks }),

	applyEvent(sessionId, event) {
		// Events from a session we have since navigated away from would paint into the wrong
		// conversation.
		if (sessionId !== get().sessionId) return;

		switch (event.type) {
			case "agent_start":
				set({ running: true });
				break;

			case "message_start": {
				const messages = get().messages;
				// The composer already painted this one; swap in the real copy rather than
				// showing it twice. Matched by reference, so asking the same thing twice is
				// still two messages.
				const pending = get().pending;
				if (event.message.role === "user" && pending && messages.includes(pending)) {
					set({ messages: messages.map((m) => (m === pending ? event.message : m)), pending: null });
					break;
				}
				set({ messages: [...messages, event.message] });
				break;
			}

			case "message_update": {
				const messages = [...get().messages];
				const index = messages.length - 1;
				if (index >= 0 && messages[index].role === "assistant") messages[index] = event.message;
				else messages.push(event.message);
				set({ messages });
				break;
			}

			case "message_end": {
				const messages = [...get().messages];
				const index = findSlot(messages, event.message);
				if (index >= 0) messages[index] = event.message;
				else messages.push(event.message);
				set({ messages });
				break;
			}

			case "tool_start":
				set({
					toolRuns: {
						...get().toolRuns,
						[event.toolCallId]: {
							toolCallId: event.toolCallId,
							toolName: event.toolName,
							summary: event.summary,
							args: event.args,
							status: "running",
							startedAt: Date.now(),
						},
					},
				});
				break;

			case "tool_end": {
				const run = get().toolRuns[event.toolCallId];
				set({
					toolRuns: {
						...get().toolRuns,
						[event.toolCallId]: {
							...(run ?? {
								toolCallId: event.toolCallId,
								toolName: event.toolName,
								summary: event.toolName,
								args: {},
								startedAt: Date.now(),
							}),
							status: event.isError ? "error" : "done",
							result: event.result,
							finishedAt: Date.now(),
						},
					},
				});
				break;
			}

			case "agent_end":
				// Same reason as the main store: a dropped connection never sends `message_end`,
				// so the last reply would stay marked as still being written.
				set({ running: false, pending: null, messages: settleTail(get().messages, event) });
				break;
		}
	},
}));

/** Match an incoming final message to the slot its streaming version occupies. */
function findSlot(messages: Message[], incoming: Message): number {
	if (incoming.role === "toolResult") {
		return messages.findIndex((m) => m.role === "toolResult" && m.toolCallId === incoming.toolCallId);
	}
	for (let i = messages.length - 1; i >= 0; i--) {
		const candidate = messages[i];
		if (candidate.role !== incoming.role) continue;
		if (candidate.role === "assistant" && incoming.role === "assistant") {
			if (candidate.stopReason === "pending" || candidate.timestamp === incoming.timestamp) return i;
			return -1;
		}
		if (candidate.timestamp === incoming.timestamp) return i;
	}
	return -1;
}

/** Rebuild tool cards when re-attaching to a conversation that ran while the panel was closed. */
function rebuildToolRuns(messages: Message[]): Record<string, ToolRun> {
	const runs: Record<string, ToolRun> = {};
	for (const message of messages) {
		if (message.role === "assistant") {
			for (const block of message.content) {
				if (block.type !== "toolCall") continue;
				runs[block.id] = {
					toolCallId: block.id,
					toolName: block.name,
					summary: summarizeToolCall(block.name, block.arguments),
					args: block.arguments,
					status: "running",
					startedAt: message.timestamp,
				};
			}
		} else if (message.role === "toolResult") {
			const run = runs[message.toolCallId];
			if (run) {
				run.status = message.isError ? "error" : "done";
				run.result = { content: message.content, details: message.details, isError: message.isError };
				run.finishedAt = message.timestamp;
			}
		}
	}
	return runs;
}
