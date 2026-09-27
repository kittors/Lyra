/**
 * `@` 菜单里的智能体用它们自己的脸，而且是设置页上那一张。
 *
 * 菜单拿到的名单是它自己问来的（`commands.list`），设置页用的是定义列表——两份名单是同一批人，
 * 脸必须一样，不然在设置页认好的那个，到了输入框里又得重新认一遍。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement as h } from "react";
import { BUILTIN_AGENTS } from "@lyra/core/agents-builtin";
import { MentionMenu } from "../../src/features/composer/MentionMenu.tsx";
import { rankMentions } from "../../src/features/composer/mention-catalog.ts";
import { assignAvatars, formatAvatar } from "../../src/lib/agent-avatar.ts";
import { builtinAvatar } from "../../src/store/agent-avatars.ts";
import { mount } from "../helpers/mount.ts";

test("agents in the @ menu wear the faces the settings page gives them", async () => {
	const agents = [
		...BUILTIN_AGENTS.map((agent) => ({ id: agent.name, name: agent.name, description: agent.description, avatar: agent.avatar })),
		{ id: "boss", name: "boss", description: "编排者" },
		{ id: "docs-writer", name: "docs-writer", description: "整理文档", avatar: "ghost-plum" },
	];
	const items = rankMentions("", { agents, allowAction: false });
	const view = await mount(h(MentionMenu, { id: "m", items, agents, term: "", active: 0, keyboardSelection: false, onPick: () => {}, onHover: () => {} }));
	try {
		const expected = assignAvatars(agents, builtinAvatar);
		const drawn = view.all<HTMLElement>('[data-mention-kind="subagent"]').map((row) => [row.dataset.mentionTitle, row.querySelector<HTMLElement>(".ly-avatar")?.dataset.avatar]);
		assert.equal(drawn.length, agents.length);
		for (const [name, face] of drawn) assert.equal(face, formatAvatar(expected.get(name as string)!), `${name}`);
		assert.equal(new Set(drawn.map(([, face]) => face)).size, drawn.length, "no two alike");
		// 别的条目还是线性图标。
		assert.equal(view.all('[data-mention-kind="action"] .ly-avatar').length, 0);
	} finally {
		await view.unmount();
	}
});
