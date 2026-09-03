/**
 * The signed-in accounts, shared by the two screens that care about them.
 *
 * The settings page changes them and the pull request pane draws them, and those are not near each
 * other in the tree — so this is a store rather than a hook's private state. Adding an account in
 * settings has to make a tab appear in the pane without a reload, and signing one out has to take
 * its rows away wherever they are.
 *
 * Module-scoped, and deliberately not in the app's main store: everything here is a copy of what
 * the main process owns, refreshed by asking rather than by being told, and mixing that in with
 * state the renderer is authoritative for is how the two get confused.
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { ForgeAccount, ForgeKind } from "../../../electron/ipc-types.ts";
import { bridge } from "../../services/index.ts";

let accounts: ForgeAccount[] = [];
let loaded = false;
let inFlight: Promise<ForgeAccount[]> | null = null;
const listeners = new Set<() => void>();

function publish(next: ForgeAccount[]): ForgeAccount[] {
	/*
	 * The same array comes back when nothing changed.
	 *
	 * `useSyncExternalStore` compares snapshots by identity and re-renders on any difference, so a
	 * fresh array every 45 seconds would re-render the tab strip — and everything keyed off it —
	 * for an answer that never varies.
	 */
	const same =
		next.length === accounts.length &&
		next.every((account, index) => {
			const old = accounts[index];
			return (
				old &&
				old.id === account.id &&
				old.label === account.label &&
				old.enabled === account.enabled &&
				old.login === account.login &&
				old.avatarUrl === account.avatarUrl &&
				(old.lastError ?? "") === (account.lastError ?? "")
			);
		});
	if (same) return accounts;

	accounts = next;
	for (const listener of listeners) listener();
	return accounts;
}

/** Re-read the list from the main process. Concurrent callers share one round trip. */
export function reloadAccounts(): Promise<ForgeAccount[]> {
	inFlight ??= bridge.forge
		.accounts()
		.then((next) => {
			loaded = true;
			return publish(Array.isArray(next) ? next : []);
		})
		.catch(() => accounts)
		.finally(() => {
			inFlight = null;
		});
	return inFlight;
}

function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/**
 * The accounts, and whether the answer has arrived yet.
 *
 * `ready` matters for exactly one decision and it is an important one: an empty list before the
 * first answer and an empty list after it look the same, and only the second one means "you have
 * not added an account" — which is a screen with a button on it, not a blank pane.
 */
export function useForgeAccounts(): { accounts: ForgeAccount[]; ready: boolean } {
	const list = useSyncExternalStore(subscribe, () => accounts);
	useEffect(() => {
		if (!loaded) void reloadAccounts();
	}, []);
	return { accounts: list, ready: loaded };
}

/** The four ways an account changes, each of them re-reading the list afterwards. */
export function useAccountActions() {
	return {
		signIn: useCallback(async (input: { kind: ForgeKind; baseUrl: string; token: string; label?: string }) => {
			const result = await bridge.forge.signIn(input);
			if (result.account) await reloadAccounts();
			return result;
		}, []),
		signOut: useCallback(async (id: string) => {
			await bridge.forge.signOut(id);
			await reloadAccounts();
		}, []),
		setEnabled: useCallback(async (id: string, enabled: boolean) => {
			await bridge.forge.setEnabled(id, enabled);
			await reloadAccounts();
		}, []),
		rename: useCallback(async (id: string, label: string) => {
			await bridge.forge.rename(id, label);
			await reloadAccounts();
		}, []),
	};
}
