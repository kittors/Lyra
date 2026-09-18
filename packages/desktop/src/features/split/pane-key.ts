/** DOM id for a pane. The blank conversation has no session id, so it still needs a stable key. */
export const paneKey = (sessionId: string | null): string => sessionId ?? "@draft";
