import { useContext } from "react";
import { SessionScope, useScopedMeta, useScopedWorkspace } from "../../app/session-scope.tsx";
import { useTerminals } from "../../store/terminals.ts";
import { bridge } from "../../services/index.ts";

/** The strip and its xterm must select the same shell without changing another tile's focus. */
export function useTerminalScope() {
	const session = useContext(SessionScope);
	const scope = bridge.bootWindow?.panelScope === "window" ? undefined : session === null ? "@draft" : session;
	const meta = useScopedMeta();
	// A blank screen's shell starts in its own project, not in the one beside it that has focus.
	const workspace = useScopedWorkspace().workspace?.path ?? "";
	const active = useTerminals((state) => scope === undefined ? state.active : state.activeByScope[scope] ?? "");
	return { scope, active, cwd: meta?.cwd ?? workspace };
}
