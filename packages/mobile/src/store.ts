/**
 * Which desktop this phone is paired with. That is the whole of it.
 *
 * This store used to hold sessions, messages, tool runs, approvals and a live socket — everything
 * the phone's own conversation screen needed to draw. That screen is gone: the phone now shows the
 * desktop's own interface in a WebView, and that interface keeps its own state exactly as it does
 * on a desktop. Modelling any of it a second time here would be two answers to the same question.
 *
 * What is left is the address, and it is persisted because being asked to scan a code every launch
 * is not a security measure, it is an annoyance. `SecureStore` is the keychain: the token in here
 * opens a paired desktop, so it does not belong in ordinary preferences.
 */

import * as SecureStore from "expo-secure-store";
import { create } from "zustand";

import { verifyToken, type Connection } from "./connection.ts";

const CONNECTION_KEY = "lyra.connection";

interface MobileState {
	/**
	 * Whether the stored connection has been read back yet.
	 *
	 * There is a moment at launch with no answer, and deciding during it would flash the pairing
	 * screen at somebody who is already paired.
	 */
	hydrated: boolean;
	connection: Connection | null;
	/** Why the last pairing attempt failed, for the screen that asked. */
	error: string | null;

	hydrate(): Promise<void>;
	pair(connection: Connection): Promise<boolean>;
	unpair(): Promise<void>;
}

export const useMobile = create<MobileState>((set) => ({
	hydrated: false,
	connection: null,
	error: null,

	async hydrate() {
		const raw = await SecureStore.getItemAsync(CONNECTION_KEY).catch(() => null);
		if (!raw) {
			set({ hydrated: true });
			return;
		}
		try {
			set({ connection: JSON.parse(raw) as Connection, hydrated: true });
		} catch {
			// Unreadable is the same as absent: pair again rather than launch into a broken state.
			set({ hydrated: true });
		}
	},

	async pair(connection) {
		/*
		 * A relayed connection is verified before it gets here, and cannot be verified the same way.
		 *
		 * `verifyToken` asks the sync server a question over HTTP; a relay answers no HTTP this app
		 * knows. What stands in for it is the room: both ends derive it from the token, so meeting in
		 * one already proves the token matches — see `pingRelay`, which waits for the desktop to
		 * actually be in there rather than settling for an empty room.
		 */
		if (!connection.relay && !(await verifyToken(connection))) {
			set({ error: "地址或令牌不正确，请检查桌面端的「移动端同步」页面。" });
			return false;
		}

		// Keychain writes can fail (locked device, web preview); pairing should still work for this
		// session rather than dropping the user back to the pairing screen.
		await SecureStore.setItemAsync(CONNECTION_KEY, JSON.stringify(connection)).catch(() => undefined);
		set({ connection, error: null });
		return true;
	},

	async unpair() {
		await SecureStore.deleteItemAsync(CONNECTION_KEY).catch(() => undefined);
		set({ connection: null, error: null });
	},
}));

export { pingDesktop, pingRelay, originOf, type Connection } from "./connection.ts";
