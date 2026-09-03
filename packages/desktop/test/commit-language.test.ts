/**
 * The Git panel's commit-language catalog and the prompt it feeds the model.
 *
 * The wand used to invent a message from file names. These tests pin that the prompt actually
 * describes the patch, that every language the menu offers has a matching instruction, and that
 * a junk stored id falls back rather than going out as an unknown language.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { COMMIT_LANGUAGE_PROSE, buildCommitPrompt, cleanCommitMessage } from "../electron/git-commit-message.ts";
import {
	COMMIT_LANGUAGES,
	DEFAULT_COMMIT_LANGUAGE,
	resolveCommitLanguage,
} from "../src/features/git/commit-language.ts";

test("every language the menu offers has a prompt instruction", () => {
	for (const language of COMMIT_LANGUAGES) {
		assert.ok(COMMIT_LANGUAGE_PROSE[language.id], language.id);
	}
});

test("an unknown stored id falls back to Chinese", () => {
	assert.equal(resolveCommitLanguage("nope"), DEFAULT_COMMIT_LANGUAGE);
	assert.equal(resolveCommitLanguage(undefined), "zh");
	assert.equal(resolveCommitLanguage("en"), "en");
});

test("the prompt names the language and carries the patch", () => {
	const { system, user } = buildCommitPrompt("diff --git a/foo.ts b/foo.ts\n+export const x = 1\n", "en", "staged");
	assert.match(system, /English/);
	assert.match(system, /Conventional Commits/);
	assert.match(user, /foo\.ts/);
	assert.match(user, /staged/);
});

test("unstaged work is labelled as such, so the model does not pretend it is the index", () => {
	const { user } = buildCommitPrompt("diff --git a/a.ts b/a.ts", "zh", "unstaged");
	assert.match(user, /unstaged/i);
});

test("fenced or quoted model output is stripped to the commit message", () => {
	assert.equal(cleanCommitMessage("```\nfeat: add login\n```"), "feat: add login");
	assert.equal(cleanCommitMessage('"feat: add login"'), "feat: add login");
	assert.equal(cleanCommitMessage("feat: add login"), "feat: add login");
});
