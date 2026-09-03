/**
 * Which panels the side panel can show.
 *
 * The list was a literal inside the component and a matching `if` chain further down, which meant
 * adding a panel touched both and nothing else could add one at all. Here each panel is a record —
 * label, icon, shortcut, when it is unavailable, and what to render — so the component only has to
 * loop, and a plugin can contribute one by registering it.
 *
 * `availability` is a predicate over the app state rather than a boolean, because whether a panel
 * can open changes while the app runs: the terminal needs a workspace, the side chat needs a
 * conversation, and both arrive after the panel list is first built.
 */

import type { ComponentType } from "react";
import type { GitCompare } from "lucide-react";
import type { DropSide } from "../tree.ts";
import type { PanelKind } from "../sideStore.ts";

interface PanelAvailability {
	/** Inside one of the user's projects. The files and the repository mean something. */
	workspace: boolean;
	/**
	 * Somewhere to run at all, project or not.
	 *
	 * A project-less conversation still has a working directory — a scratch folder — which is
	 * enough for a shell but not enough for a file tree or a git panel: there is nothing in it and
	 * it is not a repository. Two questions, because two different sets of panels turn on them.
	 */
	cwd: boolean;
	session: boolean;
}

export interface PanelDefinition {
	kind: PanelKind;
	label: string;
	icon: typeof GitCompare;
	shortcut: string;
	/** Why it cannot be opened right now, given the current state. */
	unavailable?(state: PanelAvailability): string | undefined;
	/**
	 * A panel this one belongs beside, and which side of it.
	 *
	 * Two panels are a *pair* when neither is much use alone: a file tree with nothing open is a
	 * list, and an open file without the tree is one file with no way to reach the next. The dock
	 * has no other notion of related panes — everything else is independent, and arranging it is
	 * the user's business.
	 *
	 * Declaring it buys two things. Opening this panel puts it beside its partner rather than
	 * wherever new panels go, so a tree and a file land as a tree *and* a file. And making either
	 * one full screen brings the other, because "show me this properly" means the pair when the
	 * pair is what you are working in.
	 *
	 * Only honoured while the two are actually adjacent. Drag them apart and they are two ordinary
	 * panes again — a full screen that quietly swallowed half the window because of a relationship
	 * declared in a file nobody has read would be worse than not having the feature at all.
	 */
	companion?: {
		kind: PanelKind;
		side: DropSide;
		/**
		 * How much of the pair this panel takes when it opens beside its partner.
		 *
		 * Halves are the wrong default for a browser: a file tree needs enough width for a name and
		 * an editor needs the rest. Absent, the two split evenly like any other new pane.
		 */
		share?: number;
	};
	render: ComponentType;
	/**
	 * Drawn in the pane header in place of the title.
	 *
	 * For a panel whose header is a control rather than a label — the terminal's tab strip is the
	 * one. Everything else gets the title, which is what a header is for; this exists because a
	 * strip of tabs *is* the title once there is more than one of something in a pane.
	 */
	header?: ComponentType;
	/**
	 * Drawn in the header's controls, left of full screen and close.
	 *
	 * For what you do to whatever the panel is showing, as opposed to what you do to the pane. The
	 * file panel puts its wrap/format/open-in marks here; they used to be a labelled toolbar across
	 * the top of the file, which cost a line of the file on every file for four controls that never
	 * change. The conversation's own panel menu arrives by a different route — it belongs to the
	 * window rather than to a panel.
	 */
	actions?: ComponentType;
}

const registered: PanelDefinition[][] = [];

export function registerPanels(panels: PanelDefinition[]): () => void {
	registered.push(panels);
	return () => {
		const at = registered.indexOf(panels);
		if (at >= 0) registered.splice(at, 1);
	};
}

/**
 * Every panel, in registration order, later registrations replacing earlier ones by kind.
 *
 * Same rule as the tool registry: a plugin that wants its own Git panel registers under `review`
 * and displaces the built-in, rather than having to prevent it from loading.
 */
export function allPanels(): PanelDefinition[] {
	const byKind = new Map<PanelKind, PanelDefinition>();
	for (const set of registered) for (const panel of set) byKind.set(panel.kind, panel);
	return [...byKind.values()];
}
