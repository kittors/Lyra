/**
 * Answering the card that offers to turn a correction into a rule.
 *
 * Three calls, and the interesting one is the preview: the file is rendered in the main process
 * rather than in the window, so what the card shows is produced by the same function that writes
 * the file. A second renderer in the UI would drift, and the direction it would drift is the one
 * that matters — somebody approving text that is not what lands on disk.
 *
 * Both answers go through the session, which is where the offer budget lives. A window that
 * dismissed a card without telling the session would leave it free to ask again immediately.
 */

import { ipcMain } from "electron";
import { renderRuleFile, type CorrectionSuggestion, type RuleDestination } from "@lyra/core";
import { sessions } from "../session-hub.ts";

export function registerRulesIpc(): void {
	/** The markdown a suggestion becomes — what the card shows, and what gets saved. */
	ipcMain.handle("rules:preview", async (_event, suggestion: CorrectionSuggestion) => renderRuleFile(suggestion));

	ipcMain.handle(
		"rules:keep",
		async (_event, sessionId: string, scope: RuleDestination, name: string, content: string) => {
			const session = sessions.get(sessionId);
			/*
			 * A closed session means there is nowhere to save it *to*: the destination depends on the
			 * session's own cwd. Refusing loudly is better than guessing a project directory.
			 */
			if (!session) throw new Error("这个会话已经关掉了，规则没有保存。");
			return session.keepSuggestedRule(scope, name, content);
		},
	);

	ipcMain.handle("rules:decline", async (_event, sessionId: string) => {
		sessions.get(sessionId)?.declineSuggestedRule();
	});
}
