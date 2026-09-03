/**
 * What a conversation is called before it is called anything.
 *
 * A session is stored the moment its first message is sent, which is a second or two before the
 * runtime has read that message and derived a title from it. In between, the log holds the
 * placeholder `core` writes — and `core` is platform-neutral and English, while both front ends
 * are not. Translating at the point of display rather than at the point of storage is what keeps
 * that so: the file stays neutral, and every screen showing it says the right thing, including
 * the conversations already on disk.
 *
 * Matched against the exact string on purpose. A title that merely *starts* with these words is
 * a real title — somebody's first message was about starting a new session — and rewriting it
 * would be replacing what they wrote.
 */

/** The placeholders `core` uses; see `SessionStore.create` and `setTitleFromPrompt`. */
const PLACEHOLDERS = new Set(["New session", "New Session", "Untitled"]);

/** The name to show, which is the stored one unless nothing has named it yet. */
export function sessionTitle(title: string | null | undefined): string {
	const stored = title?.trim() ?? "";
	if (!stored || PLACEHOLDERS.has(stored)) return "新对话";
	return stored;
}
