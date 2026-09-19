import { useContext } from "react";
import { SessionScope, useScopedMeta } from "../../app/session-scope.tsx";
import { useApp } from "../../store/index.ts";
import { useTerminals } from "../../store/terminals.ts";
import { bridge } from "../../services/index.ts";

/** The strip and its xterm must select the same shell without changing another tile's focus. */
export function useTerminalScope() {
	const session = useContext(SessionScope);
	const scope = bridge.bootWindow?.panelScope === "window" ? undefined : session === null ? "@draft" : session;
	const meta = useScopedMeta();
	const workspace = useApp((state) => state.workspace?.path ?? "");
	const active = useTerminals((state) => scope === undefined ? state.active : state.activeByScope[scope] ?? "");
	return { scope, active, cwd: meta?.cwd ?? workspace };
}
