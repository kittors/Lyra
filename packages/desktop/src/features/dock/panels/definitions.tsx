/**
 * Which panels exist right now, and whether each can be opened.
 *
 * The registry says what is registered; this says what is *available* — a file browser needs a
 * project, a trajectory needs a conversation. Deciding it once, here, is what lets the tab strip
 * and the chooser and the add menu all disable the same things for the same stated reason.
 */

import { allPanels, type PanelDefinition } from "./registry.ts";
import type { PanelKind } from "../sideStore.ts";
import { useApp } from "../../../store/index.ts";
import "./builtin.tsx";

/** A panel with its availability already decided, which is all a view needs. */
export type ResolvedPanel = Omit<PanelDefinition, "unavailable"> & { unavailable?: string };

export function usePanelDefinitions(): ResolvedPanel[] {
	const workspace = useApp((s) => s.workspace);
	const scratchCwd = useApp((s) => s.scratchCwd);
	const activeSessionId = useApp((s) => s.activeSessionId);
	const state = {
		workspace: Boolean(workspace),
		cwd: Boolean(workspace ?? scratchCwd),
		session: Boolean(activeSessionId),
	};
	return allPanels().map((panel) => ({ ...panel, unavailable: panel.unavailable?.(state) }));
}

/**
 * Where a panel belongs, if it belongs beside another one.
 *
 * Read from the registry rather than restated at the call site, so a panel's idea of where it goes
 * lives with the panel — and so a plugin's does too.
 */
export function companionOf(kind: PanelKind) {
	return allPanels().find((panel) => panel.kind === kind)?.companion;
}

/** What a tab shows. A kind with no registered panel renders nothing rather than crashing. */
export function renderPanel(kind: PanelKind) {
	const panel = allPanels().find((p) => p.kind === kind);
	if (!panel) return null;
	const Body = panel.render;
	return <Body />;
}

/** A panel's own header content, for the few that draw a control where the title goes. */
export function renderPanelHeader(kind: PanelKind) {
	const Header = allPanels().find((p) => p.kind === kind)?.header;
	return Header ? <Header /> : null;
}

/** A panel's own controls, for the header's button row. */
export function renderPanelActions(kind: PanelKind) {
	const Actions = allPanels().find((p) => p.kind === kind)?.actions;
	return Actions ? <Actions /> : null;
}
