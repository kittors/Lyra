/**
 * A rule reminder in the transcript is a card, not the `<system-reminder>` the model was sent (16 §验收).
 *
 * The message the core writes carries the XML for the model and `ruleMatch` for the pane. This
 * mounts the row that decides which one a person sees.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";

import type { Message } from "@lyra/core";
import { RuleCard } from "../../src/features/conversation/RuleCard.tsx";
import { click, mount } from "../helpers/mount.ts";

const XML = '<system-reminder reason="rule" rule="no-any" source="text">\n你刚才正要输出的内容触发了这条规则。\n\n触发的内容："x: any"\n\n不要用 any。\n</system-reminder>';

const MATCH: NonNullable<Extract<Message, { role: "user" }>["ruleMatch"]> = {
	rules: [{ name: "no-any", excerpt: "x: any", source: "text", content: "不要用 any。" }] as never,
	interrupted: true,
};

test("the card names the rule and what tripped it, and shows no XML", async () => {
	const view = await mount(h(RuleCard, { match: MATCH }));
	const text = view.text();
	assert.match(text, /no-any/);
	assert.ok(!text.includes("<system-reminder"), `no raw XML: ${text}`);
	assert.ok(!text.includes("</"), "no closing tags either");
	await click(view.find("button"));
	assert.match(view.text(), /x: any|不要用 any/, "unfolded: the excerpt or the rule text");
	assert.ok(!view.text().includes(XML), "still not the XML");
	await view.unmount();
});
