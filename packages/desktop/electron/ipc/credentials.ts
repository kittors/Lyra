/**
 * Filling a credential card, and the vault page where the person keeps credentials by hand.
 *
 * Values travel in, through `submit`, `add` and `update`, and no channel hands one back — the rule
 * the forge tokens keep (`forge:accounts` in `ipc/git.ts`), for the reason written there: a value
 * that can be asked for over IPC ends up in a devtools panel. The one way out is `copy`, and it goes
 * from here to the system clipboard, not to the renderer. The phone is given none of these
 * (`METHODS.credentials` are `remote: false`): a relay sees the frames it carries in the clear
 * (ADR-0002), and what is typed into a card must not cross one.
 */

import { clipboard, ipcMain } from "electron";
import { credentialBroker } from "../credential-broker.ts";
import { addInputOf, patchOf, resultOf, submissionOf } from "../credential-input.ts";
import { sessions } from "../session-hub.ts";

/** How long a copied secret stays on the clipboard. What password managers do, and long enough to paste. */
const CLIPBOARD_CLEAR_MS = 30_000;

/** Wiped after a while, unless something else has been copied since: that is the person's now. */
function copySecret(text: string): void {
	clipboard.writeText(text);
	setTimeout(() => {
		if (clipboard.readText() === text) clipboard.clear();
	}, CLIPBOARD_CLEAR_MS).unref();
}

export function registerCredentialsIpc(): void {
	ipcMain.handle("credentials:submit", async (_event, sessionId: string, requestId: string, input: unknown) => {
		const session = sessions.get(sessionId);
		// A sub-agent's card waits in its parent's gate, so the parent session finds it too.
		const pending = session?.listPendingApprovals().find((entry) => entry.id === requestId);
		const key = pending?.request.kind === "credential" ? pending.request.credential?.key : undefined;
		if (!session || !key) return { ok: false, problem: "expired" };
		const result = await credentialBroker.submit(key, submissionOf(input));
		// The card closes as filled only once the broker holds the value.
		if (result.ok) session.resolveApproval(requestId, "once");
		return result;
	});

	ipcMain.handle("credentials:list", () => credentialBroker.saved());

	ipcMain.handle("credentials:add", async (_event, input: unknown) => resultOf(await credentialBroker.addSaved(addInputOf(input))));

	ipcMain.handle("credentials:update", async (_event, name: string, input: unknown) =>
		resultOf(await credentialBroker.updateSaved(String(name), patchOf(input))));

	ipcMain.handle("credentials:remove", (_event, name: string) => credentialBroker.removeSaved(String(name)));

	ipcMain.handle("credentials:copy", async (_event, name: string) => {
		const copyable = await credentialBroker.copyable(String(name));
		if (!copyable) return { copied: false };
		if (copyable.secret) copySecret(copyable.text);
		else clipboard.writeText(copyable.text);
		return { copied: true, clearsAfter: copyable.secret ? CLIPBOARD_CLEAR_MS : null };
	});
}
