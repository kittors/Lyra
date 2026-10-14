/**
 * The credentials a reference in a message can mean, as the main process lists them.
 *
 * Asked once per conversation and kept a few seconds: a reply that names three credentials draws three
 * chips, and they should cost one request, not three. Short, because what is saved changes — a card in
 * this conversation may just have been filled — and a chip that went on saying "not found" would be wrong.
 */

import type { CredentialMeta } from "@lyra/core";
import { useEffect, useState } from "react";
import { available, bridge } from "../../services/index.ts";

const FRESH_MS = 5_000;
const asked = new Map<string, { at: number; list: Promise<CredentialMeta[]> }>();

function known(sessionId: string | null): Promise<CredentialMeta[]> {
	const key = sessionId ?? "";
	const hit = asked.get(key);
	if (hit && Date.now() - hit.at < FRESH_MS) return hit.list;
	const list = bridge.credentials.list(sessionId ?? undefined).catch(() => [] as CredentialMeta[]);
	asked.set(key, { at: Date.now(), list });
	return list;
}

/** The credential `name` stands for here, `null` when nothing by that name is known, `undefined` until asked. */
export function useKnownCredential(name: string, sessionId: string | null): CredentialMeta | null | undefined {
	const [meta, setMeta] = useState<CredentialMeta | null | undefined>(undefined);
	useEffect(() => {
		// A phone cannot ask: the list is not offered to it (`credentials.*` are desktop only).
		if (!available("credentials", "list")) return setMeta(null);
		let live = true;
		void known(sessionId).then((list) => {
			if (live) setMeta(list.find((one) => one.name === name) ?? null);
		});
		return () => {
			live = false;
		};
	}, [name, sessionId]);
	return meta;
}
