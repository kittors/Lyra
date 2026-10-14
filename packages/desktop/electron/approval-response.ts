import type { AgentSession } from "@lyra/core";

/** Keep permission persistence tied to the pending request owned by the runtime. */
export async function resolveSessionApproval(
	session: Pick<AgentSession, "resolveApproval" | "listPendingApprovals">,
	requestId: string,
	decision: unknown,
	remember: (subject: string) => Promise<void>,
): Promise<void> {
	// Resolution consumes the request synchronously, so retain its trusted subject first.
	const pending = session.listPendingApprovals().find((entry) => entry.id === requestId);
	/*
	 * A credential card is filled through `credentials:submit` and nowhere else. Answered "once" here
	 * it would close as filled with nothing filled — the broker would refuse it, but the card would
	 * already be gone. Refusing it is the one answer this channel carries for one.
	 */
	if (pending?.request.kind === "credential" && decision !== "reject") throw new Error("A credential card is filled through credentials.submit");
	if (!session.resolveApproval(requestId, decision)) throw new Error("Invalid or expired approval response");
	// An escalation is granted for its one call whatever the answer said, and the gate keeps nothing
	// of it; written to the settings it would only be listed as a grant that does not exist.
	if (decision === "always" && pending && pending.request.escalation === undefined) await remember(pending.request.subject);
}
