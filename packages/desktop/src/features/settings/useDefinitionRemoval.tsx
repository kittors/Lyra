import type { MessageKey } from "../../i18n/messages/index.ts";
import { translate } from "../../i18n/translate.ts";
import { useRef, useState } from "react";
import { bridge } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";

/** Keys, so the word matches the window rather than the moment this file loaded. */
const LABELS = { command: "removal.command", skill: "removal.skill", rule: "removal.rule" } as const satisfies Record<string, MessageKey>;

export function useDefinitionRemoval(kind: keyof typeof LABELS, cwd: string, reload: () => void) {
	const confirm = useConfirmer();
	const inflight = useRef(new Set<string>());
	const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
	async function remove(path: string) {
		if (inflight.current.has(path)) return;
		inflight.current.add(path);
		setPending(new Set(inflight.current));
		try {
			await bridge.capabilities.trash(kind, cwd, path);
			useApp.getState().bumpExtensions();
			reload();
		} catch (cause) {
			useApp.getState().notify(translate("removal.failed", { reason: cause instanceof Error ? cause.message : String(cause) }), "error");
		} finally {
			inflight.current.delete(path);
			setPending(new Set(inflight.current));
		}
	}
	return {
		pending,
		element: confirm.element,
		ask(name: string, path: string) {
			confirm.ask({
				title: translate("removal.confirm", { kind: translate(LABELS[kind]), name }),
				detail: <><span>{kind === "skill" ? translate("removal.skillDetail") : translate("removal.fileDetail")}</span><span className="mt-2 block break-all font-mono">{path}</span></>,
				confirmLabel: translate("removal.toTrash"),
				onConfirm: () => void remove(path),
			});
		},
	};
}
