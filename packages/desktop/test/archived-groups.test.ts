import assert from "node:assert/strict";
import { test } from "node:test";

import { groupIsOpen, toggleOpened } from "../src/features/settings/archived-groups.ts";

test("归档分组默认收起，点过的才开", () => {
	const closed = new Set<string>();
	assert.equal(groupIsOpen("/a", closed, false), false);
	const opened = toggleOpened(closed, "/a");
	assert.equal(groupIsOpen("/a", opened, false), true);
	assert.equal(groupIsOpen("/b", opened, false), false);
	assert.equal(groupIsOpen("/a", toggleOpened(opened, "/a"), false), false);
});

test("搜索时匹配到的分组一律展开，不改人手动开过的集合", () => {
	const opened = new Set<string>();
	assert.equal(groupIsOpen("/a", opened, true), true);
	assert.equal(opened.size, 0, "搜索展开不该写进 opened，清掉关键字后还该是收起的");
	assert.equal(groupIsOpen("/a", opened, false), false);
});
