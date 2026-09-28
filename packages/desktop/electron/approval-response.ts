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
	if (!session.resolveApproval(requestId, decision)) throw new Error("Invalid or expired approval response");
	// An escalation is granted for its one call whatever the answer said, and the gate keeps nothing
	// of it; written to the settings it would only be listed as a grant that does not exist.
	if (decision === "always" && pending && pending.request.escalation === undefined) await remember(pending.request.subject);
}
