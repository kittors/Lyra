import { useEffect, useRef, useState } from "react";
import { bridge } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";
import { kinds, popOutPanel, usePaneDock } from "../dock/index.ts";
import { closePane } from "./actions.ts";
import { subtreeMinPx } from "./geometry.ts";
import { useSplit } from "./store.ts";
import { sessionIds, type SplitNode } from "./tree.ts";

/** An existing split has the same minimum as a new one, including after a native resize. */
export function useOverflowScreens(tree: SplitNode, size: { width: number; height: number } | null): void {
	const busy = useRef(false);
	const attempt = useRef("");
	const [completed, setCompleted] = useState(0);
	const signature = JSON.stringify([tree, size]);
	useEffect(() => {
		if (!size || !bridge.windows || busy.current || attempt.current === signature) return;
		const ids = sessionIds(tree);
		if (ids.length < 2 || (subtreeMinPx(tree, "row") <= size.width + 1 && subtreeMinPx(tree, "col") <= size.height + 1)) return;
		const sessionId = [...ids].reverse().find(id=>id !== useSplit.getState().focused);
		if (!sessionId) return;
		let cancelled = false;
		queueMicrotask(() => {
			if (cancelled) return;
			attempt.current = signature;
			busy.current = true;
			void (async () => {
				try {
					// A detached conversation is a transcript. Its live tools need their own owners first.
					for (const kind of kinds(usePaneDock.getState().tree(sessionId))) {
						if (kind !== "conversation" && !await popOutPanel({ dock: "pane", scope: sessionId, kind, sessionId })) return;
					}
					const result = await bridge.windows?.open({ sessionId });
					if (result?.ok && useSplit.getState().tree === tree) {
						busy.current = false;
						closePane(sessionId);
					}
				} catch (error) {
					useApp.getState().notify(String(error), "error");
				} finally {
					busy.current = false;
					setCompleted(value => value + 1);
				}
			})();
		});
		return () => { cancelled = true; };
	}, [signature, tree, size, completed]);
}
