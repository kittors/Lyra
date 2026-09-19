/**
 * Which terminals are open, and which one you are looking at.
 *
 * The shells themselves live in the main process and outlive everything here — this is only the
 * tab strip's view of them.
 *
 * One list, not one per project. It used to be keyed by project directory, which tied the strip to
 * whatever the rest of the window happened to be showing: changing projects swapped the terminals
 * for a different set, and moving to no project at all emptied it — while every one of those shells
 * carried on running, unreachable. A terminal is not a view of the project, it is a thing you
 * started and are using; closing a folder in an editor does not close the build you are watching.
 *
 * The project still decides where a *new* shell starts — the current one, or home when there is
 * none — and that is the whole of the relationship between them. See `TerminalTabs`.
 *
 * Outside React because two components need it — the strip in the pane's header and the pane
 * itself — and they are not in a position to pass it between them.
 */

import { create } from "zustand";
import type { TerminalTab } from "../../electron/ipc-types.ts";

interface TerminalsState {
	/** Every terminal, in the order they were opened. */
	tabs: TerminalTab[];
	/** Which one the pane is showing. */
	active: string;
	activeByScope: Record<string, string>;

	/** Take what the main process reports as the truth of what is running. */
	sync(tabs: TerminalTab[]): void;
	add(tab: TerminalTab, scope?: string): void;
	remove(id: string): void;
	select(id: string, scope?: string): void;
}

/** Shared by the main and detached renderers, validated against the live shell list on attach. */
export function savedTerminal(scope: string | undefined): string | null {
	return typeof window === "undefined" ? null : window.localStorage.getItem(`ly:terminal-selection:${scope ?? "@window"}`);
}

function saveTerminal(scope: string | undefined, id: string): void {
	if (typeof window !== "undefined") window.localStorage.setItem(`ly:terminal-selection:${scope ?? "@window"}`, id);
}

export const useTerminals = create<TerminalsState>((set, get) => ({
	tabs: [],
	active: "",
	activeByScope: {},

	sync: (tabs) => {
		const active = get().active;
		set({
			tabs,
			activeByScope: Object.fromEntries(Object.entries(get().activeByScope).filter(([, id]) => tabs.some((tab) => tab.id === id))),
			// The tab that was showing may have exited while the pane was away.
			active: tabs.some((tab) => tab.id === active) ? active : (tabs[0]?.id ?? ""),
		});
	},

	add: (tab, scope) => {
		set({ tabs: [...get().tabs.filter((entry) => entry.id !== tab.id), tab] });
		get().select(tab.id, scope);
	},

	remove: (id) => {
		const rest = get().tabs.filter((tab) => tab.id !== id);
		const active = get().active;
		set({
			tabs: rest,
			activeByScope: Object.fromEntries(Object.entries(get().activeByScope).map(([scope, active]) => [scope, active === id ? "" : active])),
			/*
			 * Closing the tab you are on moves to a neighbour, not to nothing.
			 *
			 * The first survivor is close enough: with two or three tabs any choice is the one
			 * next to it, and a pane that went blank because the last click removed what it was
			 * showing would be the worse answer by far.
			 */
			active: id === active ? (rest[0]?.id ?? "") : active,
		});
	},

	select: (id, scope) => {
		if (!get().tabs.some((tab) => tab.id === id)) return;
		saveTerminal(scope, id);
		set(scope === undefined ? { active: id } : { activeByScope: { ...get().activeByScope, [scope]: id } });
	},
}));
