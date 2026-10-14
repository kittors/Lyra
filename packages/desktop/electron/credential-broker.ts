/**
 * The process's one credential broker — see `core/credentials/broker.ts`.
 *
 * A module of its own so the session hub and the IPC can both reach it without reaching each other.
 * One per process because what a conversation was given belongs to the conversation, not to the
 * window showing it: a session that is closed and reopened, or shown in a second window, keeps it.
 */
import { CredentialBroker } from "@lyra/core";

export const credentialBroker = new CredentialBroker();
