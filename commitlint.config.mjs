/**
 * What a commit message has to be, checked by the commit-msg hook.
 *
 * CONTRIBUTING already asks for conventional commits with a Chinese subject and a body that says
 * why. Nothing enforced it, so the log holds both `fix(desktop): …` and bare sentences, and the
 * release notes cannot be generated from something half the entries do not follow.
 *
 * The rules below are deliberately narrow: they check the shape, not the prose. A message can still
 * be useless while passing this — that is what review is for.
 */

export default {
	extends: ["@commitlint/config-conventional"],
	rules: {
		/*
		 * Subjects are Chinese, and every casing rule in the default set is about English.
		 * `sentence-case` on 「修复截图后 Dock 图标消失」 is a question with no answer.
		 */
		"subject-case": [0],
		"type-enum": [2, "always", ["feat", "fix", "perf", "refactor", "docs", "test", "chore", "ci", "build", "revert"]],
		/*
		 * A warning rather than an error. The scope is filing information: getting it wrong makes a
		 * changelog entry land in a slightly odd place, and blocking a commit over that teaches
		 * people to reach for `--no-verify`, which is the thing this hook exists to avoid.
		 */
		"scope-enum": [
			1,
			"always",
			["core", "desktop", "electron", "ui", "mobile", "relay", "cli", "registry", "sync", "release", "deps"],
		],
		"header-max-length": [2, "always", 100],
		// Bodies carry pasted output, paths and stack traces. Wrapping those would corrupt them.
		"body-max-line-length": [0],
	},
};
