/**
 * Which panels exist right now, and whether each can be opened.
 *
 * The registry says what is registered; this says what is *available* — a file browser needs a
 * project, a trajectory needs a conversation. Deciding it once, here, is what lets the tab strip
 * and the chooser and the add menu all disable the same things for the same stated reason.
 */

import type { MessageKey } from "../../../i18n/messages/index.ts";
import { allPanels, panelsForHost, type PanelDefinition } from "./registry.ts";
import type { PanelKind } from "../sideStore.ts";
import { useScopedSessionId, useScopedWorkspace } from "../../../app/session-scope.tsx";
import { onPhone } from "../../../services/host.ts";
import "./builtin.tsx";

/** A panel with its availability already decided, which is all a view needs. */
export type ResolvedPanel = Omit<PanelDefinition, "unavailable"> & { unavailable?: MessageKey };

export function usePanelDefinitions(): ResolvedPanel[] {
	/*
	 * What this screen's conversation has, asked from its own title bar and dock.
	 *
	 * The live slot describes the focused screen only. Read from there, a conversation in no project
	 * with focus took the Git button away from the project's screen beside it and gave one to itself,
	 * and the blank screen offered the panels of the conversation next to it.
	 */
	const { workspace, scratchCwd } = useScopedWorkspace();
	const sessionId = useScopedSessionId();
	const state = {
		workspace: Boolean(workspace),
		cwd: Boolean(workspace ?? scratchCwd),
		session: Boolean(sessionId),
	};
	return panelsForHost(allPanels(), onPhone()).map((panel) => ({ ...panel, unavailable: panel.unavailable?.(state) }));
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
