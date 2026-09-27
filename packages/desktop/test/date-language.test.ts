/**
 * Dates written by plain functions, in the language the window is set to.
 *
 * Each of these formatted with a hard-coded "zh-CN", so every other interface language read Chinese
 * dates: 「9月26日」 over a message, 「2026/09/26 14:28」 behind a commit's age, 「2026/9/26」 beside a
 * past conversation in the `@` menu. The components that call them are covered, language switch
 * included, in `test/ui/date-language.test.ts`.
 *
 * Every Chinese expectation here is what the code printed before the fix, character for character.
 */

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { SessionMeta } from "@lyra/core";

import { rankMentions } from "../src/features/composer/mention-catalog.ts";
import { conversationTime } from "../src/features/conversation/question-navigation.ts";
import { setActiveLocale } from "../src/i18n/translate.ts";
import { exactTime } from "../src/lib/relative-time.ts";

const AFTERNOON = new Date(2026, 8, 26, 14, 28).getTime();
const MORNING = new Date(2025, 11, 3, 9, 5).getTime();
const DAY = 86_400_000;

// The locale is module state; leaving it on English would change every test after this one.
afterEach(() => setActiveLocale("zh-CN"));

test("the time over a message reads the way English does", () => {
	setActiveLocale("en");
	assert.equal(conversationTime(AFTERNOON, AFTERNOON), "Today 2:28 PM");
	assert.equal(conversationTime(AFTERNOON, AFTERNOON + DAY), "Yesterday 2:28 PM");
	assert.equal(conversationTime(AFTERNOON, AFTERNOON + 2 * DAY), "September 26 2:28 PM");
	assert.equal(conversationTime(MORNING, AFTERNOON), "December 3, 2025 9:05 AM");
	// What a component passes when it holds the language from `useI18n()`.
	assert.equal(conversationTime(MORNING, AFTERNOON, "en"), "December 3, 2025 9:05 AM");
});

test("the time over a message keeps its Chinese look, unpadded hour included", () => {
	assert.equal(conversationTime(AFTERNOON, AFTERNOON), "今天 14:28");
	assert.equal(conversationTime(AFTERNOON, AFTERNOON + DAY), "昨天 14:28");
	assert.equal(conversationTime(AFTERNOON, AFTERNOON + 2 * DAY), "9月26日 14:28");
	// 9:05 and 0:05, never 09:05: this label always wrote the hour without a leading zero.
	assert.equal(conversationTime(MORNING, AFTERNOON), "2025年12月3日 9:05");
	assert.equal(conversationTime(new Date(2026, 8, 20, 0, 5).getTime(), AFTERNOON), "9月20日 0:05");
});

test("the exact time behind an age follows the window's language", () => {
	const afternoon = new Date(AFTERNOON).toISOString();
	const morning = new Date(MORNING).toISOString();
	setActiveLocale("en");
	assert.equal(exactTime(afternoon), "09/26/2026, 2:28 PM");
	assert.equal(exactTime(morning), "12/03/2025, 9:05 AM");
	setActiveLocale("zh-CN");
	assert.equal(exactTime(afternoon), "2026/09/26 14:28");
	assert.equal(exactTime(morning), "2025/12/03 09:05");
	assert.equal(exactTime(afternoon, "en"), "09/26/2026, 2:28 PM");
	assert.equal(exactTime("not a date", "en"), "");
});

test("a past conversation in the @ menu is dated in the window's language", () => {
	const session = { id: "s-1", title: "Refactor", projectName: "lyra", updatedAt: AFTERNOON } as SessionMeta;
	const dated = () => rankMentions("", { sessions: [session] }).find((item) => item.kind === "session")?.description;
	setActiveLocale("en");
	assert.equal(dated(), "lyra · 9/26/2026");
	setActiveLocale("fr");
	assert.equal(dated(), "lyra · 26/09/2026");
	setActiveLocale("zh-CN");
	assert.equal(dated(), "lyra · 2026/9/26");
});
