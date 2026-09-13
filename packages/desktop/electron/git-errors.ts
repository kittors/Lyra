/**
 * Turning what git said into what a person needs to do about it.
 *
 * Everything here is about the handful of failures that actually happen when a button in the panel
 * talks to a remote. Git's own wording is accurate and addressed to someone at a terminal: it
 * answers with three lines of `hint:` and a suggested command, which is the right answer to a
 * different question than "why did that button not work".
 *
 * Unmatched output is passed through unchanged, and that is deliberate. A sentence in English that
 * nobody translated is worth more than a confident Chinese sentence about the wrong cause — the
 * first one can be searched for, the second one sends you looking in the wrong place.
 */

/**
 * The failures worth naming, in the order they are tried.
 *
 * Ordered rather than keyed because two of them overlap: a push rejected for being behind says both
 * `[rejected]` and `non-fast-forward`, and a fetch against a host that is down can mention both the
 * URL and the resolver. First match wins, so the more specific cause is listed first.
 */
const KNOWN: { match: (text: string) => boolean; say: string }[] = [
	{
		// `pull --ff-only` against a branch that has moved on both sides.
		match: (t) => t.includes("Diverging branches can't be fast-forwarded") || t.includes("Not possible to fast-forward"),
		say: "远端已分叉，无法快进。先手动合并或变基。",
	},
	{
		match: (t) => t.includes("no tracking information"),
		say: "当前分支没有上游。",
	},
	{
		// Ordinary "someone else pushed first".
		match: (t) => t.includes("non-fast-forward") || (t.includes("[rejected]") && t.includes("fetch first")),
		say: "远端有新的提交，先拉取再推送。",
	},
	{
		// Not "wrong password" — there was nowhere to ask for one. See `runRemote`.
		// `unable to get password from user` is what current GCM prints when
		// `credential.interactive=false` and nothing is stored.
		match: (t) =>
			t.includes("could not read Username") ||
			t.includes("terminal prompts disabled") ||
			t.includes("unable to get password from user"),
		say: "远端需要登录，这里无法输入。请先在终端里配置一次凭据。",
	},
	{
		match: (t) => t.includes("Authentication failed") || t.includes("Permission denied"),
		say: "远端拒绝了凭据。",
	},
	{
		match: (t) => t.includes("Could not resolve host") || t.includes("unable to access") || t.includes("Connection refused"),
		say: "连不上远端。",
	},
	{
		match: (t) => t.includes("does not appear to be a git repository") || t.includes("Repository not found"),
		say: "远端仓库不存在，或没有访问权限。",
	},
];

/**
 * What to show in the red bar, given what git printed.
 *
 * The fallback is the first three lines rather than all of it: git's advice blocks run to a dozen
 * lines and the panel's bar would become the panel.
 */
export function explainGitFailure(stderr: string): string {
	const text = stderr.trim();
	if (!text) return "操作失败";
	for (const entry of KNOWN) {
		if (entry.match(text)) return entry.say;
	}
	return text.split("\n").slice(0, 3).join("\n");
}
