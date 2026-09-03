/**
 * What the window knows about the work this session has delegated.
 *
 * Two halves, kept apart on purpose. The roster — who is running, how long, how many tool calls —
 * arrives as an event on every change, because it is a dozen small rows and the whole point is
 * that it is live. The transcripts are pulled per sub-agent and then kept up to date by the
 * messages that stream in, because a delegated run can read forty files and broadcasting all of
 * that on every change would put the run on the wire dozens of times over.
 *
 * Keyed by nothing: there is one session in front of you, and the roster is that session's. When
 * it changes, this is emptied — a sub-agent belongs to the conversation that dispatched it, and
 * showing one under another conversation would be a lie about where the work came from.
 */

import { create } from "zustand";
import type { Message, SubAgentSummary } from "@lyra/core";
import { bridge } from "../services/index.ts";

interface SubAgentState {
	/** The roster, oldest first — the order a tab strip reads in. */
	agents: SubAgentSummary[];
	/** Transcripts, by sub-agent id, for the ones that have been opened. */
	transcripts: Record<string, Message[]>;
	/** Which one the pane is showing, or null for none open yet. */
	focused: string | null;
	/**
	 * Ids whose transcript has been asked for but not yet arrived.
	 *
	 * Held so a second click while the first read is in flight does not ask again, and so the pane
	 * can say "loading" rather than "empty" — which for a sub-agent that has genuinely said nothing
	 * yet are two different and equally believable states.
	 */
	loading: string[];

	/** Take the roster the session just broadcast. */
	sync(agents: SubAgentSummary[]): void;
	/** One message, as the sub-agent writes it. Ignored for a transcript nobody has opened. */
	append(id: string, message: Message): void;
	focus(id: string | null): void;
	/** Read one sub-agent's transcript. Idempotent while a read is in flight. */
	load(sessionId: string, id: string): Promise<void>;
	/** A different conversation is in front of you; this one's delegated work is not. */
	clear(): void;
}

export const useSubAgents = create<SubAgentState>((set, get) => ({
	agents: [],
	transcripts: {},
	focused: null,
	loading: [],

	sync(agents) {
		const { focused } = get();
		set({
			agents,
			/*
			 * Keep looking at what you were looking at.
			 *
			 * The roster is re-sent on every tool call of every sub-agent, so anything derived from
			 * it here has to be stable — moving the pane to the newest one because a *sibling* made
			 * a tool call would make reading a long run impossible.
			 */
			focused: focused && agents.some((one) => one.id === focused) ? focused : (focused ?? null),
		});
	},

	append(id, message) {
		const existing = get().transcripts[id];
		// Nothing has been opened for this one, so there is no list to keep in step. Opening it
		// later reads the whole thing, including this.
		if (!existing) return;
		set({ transcripts: { ...get().transcripts, [id]: [...existing, message] } });
	},

	focus(id) {
		set({ focused: id });
	},

	async load(sessionId, id) {
		const { transcripts, loading } = get();
		if (transcripts[id] || loading.includes(id)) return;
		set({ loading: [...loading, id] });
		try {
			const detail = await bridge.subAgents.detail(sessionId, id);
			/*
			 * Merged, not replaced.
			 *
			 * Messages can stream in while the read is in flight, and `append` drops them because
			 * there is no list yet. Taking whichever is longer is enough: both are prefixes of the
			 * same transcript, and the read is the one that started earlier.
			 */
			const arrived = detail?.messages ?? [];
			const since = get().transcripts[id] ?? [];
			set({ transcripts: { ...get().transcripts, [id]: arrived.length >= since.length ? arrived : since } });
		} finally {
			set({ loading: get().loading.filter((each) => each !== id) });
		}
	},

	clear() {
		set({ agents: [], transcripts: {}, focused: null, loading: [] });
	},
}));

/** Running first, then the most recently finished — which is the order they are worth reading in. */
export function rosterOrder(agents: SubAgentSummary[]): SubAgentSummary[] {
	return [...agents].sort((a, b) => {
		if (a.status === "running" && b.status !== "running") return -1;
		if (b.status === "running" && a.status !== "running") return 1;
		return a.startedAt - b.startedAt;
	});
}
