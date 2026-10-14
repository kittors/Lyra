import type { CredentialBroker, UserContent } from "@lyra/core";
import { credentialBroker } from "./credential-broker.ts";

/** `PromptOrigin` from `prompt-input.ts`, which this cannot import: that file leads back to `session-hub.ts`. */
type Origin = "local" | "remote";
/** The broker's two steps, passed in by the tests; the app's own broker otherwise. */
type Screener = Pick<CredentialBroker, "screenPrompt" | "letIn">;

/**
 * A message on its way into a conversation, with every credential value in it replaced by its mark.
 *
 * Before anything is written or sent: a password pasted into the composer by mistake reaches neither
 * the session log nor the model, only `[credential:name]`. Covers what the model reads (`content`)
 * and what the bubble shows (`displayText`) alike — the bubble is persisted too.
 */
export async function screenMessage(
	sessionId: string | null,
	content: UserContent[],
	displayText: string | undefined,
	broker: Screener = credentialBroker,
): Promise<{ content: UserContent[]; displayText?: string; named: string[] }> {
	const texts = content.flatMap((block) => (block.type === "text" ? [block.text] : []));
	if (displayText !== undefined) texts.push(displayText);
	const screened = await broker.screenPrompt(sessionId, texts);
	let at = 0;
	return {
		content: content.map((block) => (block.type === "text" ? { ...block, text: screened.texts[at++] ?? block.text } : block)),
		...(displayText === undefined ? {} : { displayText: screened.texts[at] ?? displayText }),
		named: screened.named,
	};
}

/**
 * Saved credentials the message named, handed to the conversation without a card — when it was typed
 * at this computer.
 *
 * A phone never hands one over: its credential cards can only be declined (`approval-response.ts`),
 * and a mark typed there would be a way round that. Its message is still screened.
 */
export async function handOver(sessionId: string, named: readonly string[], origin: Origin, broker: Screener = credentialBroker): Promise<void> {
	if (origin === "local") await broker.letIn(sessionId, named);
}

/** A steer into a running sub-agent: the same screening, for words that go straight to a model. */
export async function screenSteer(
	sessionId: string,
	said: string | UserContent[],
	display: { displayText?: string } | undefined,
	origin: Origin,
	broker: Screener = credentialBroker,
): Promise<{ said: string | UserContent[]; displayText?: string }> {
	const content: UserContent[] = typeof said === "string" ? [{ type: "text", text: said }] : said;
	const screened = await screenMessage(sessionId, content, display?.displayText, broker);
	await handOver(sessionId, screened.named, origin, broker);
	const first = screened.content[0];
	return {
		said: typeof said === "string" && first?.type === "text" ? first.text : screened.content,
		...(screened.displayText === undefined ? {} : { displayText: screened.displayText }),
	};
}
