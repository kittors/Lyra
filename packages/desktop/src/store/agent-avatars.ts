/**
 * 一个智能体的名字，对应哪一张脸。
 *
 * 设置页、提及菜单、对话里的派发行、输入框上方那条、子智能体面板——五个地方画同一批人，必须
 * 是同一张脸，所以都从这里问。
 *
 * 名单从哪儿来由调用方决定：设置页有它自己读到的那份定义，提及菜单有它自己的，其余的用当前
 * 会话的能力清单。它们是同一个目录读出来的同一批人，`assignAvatars` 只看名单里有谁、不看顺序，
 * 于是算出来的也是同一批脸。
 */

import { useMemo } from "react";
import { BUILTIN_AGENTS, RENAMED_AGENTS } from "@lyra/core/agents-builtin";
import { assignAvatars, hashedAvatar, parseAvatar, type Avatar } from "../lib/agent-avatar.ts";
import { useApp } from "./index.ts";

const BUILTIN = new Map(BUILTIN_AGENTS.map((agent) => [agent.name, agent.avatar]));
const BUILTIN_TAKEN = BUILTIN_AGENTS.flatMap((agent) => {
	const face = parseAvatar(agent.avatar);
	return face ? [face] : [];
});

/**
 * 内置的那张脸，按名字——包括改过名的旧名。
 *
 * 不只看定义里带没带：用户在 `~/.lyra/agents/general.md` 里手写一份覆盖内置的，文件里多半没有
 * `avatar` 这一行，可它仍然是 `general`，不该因为改了几句指令就换了一张脸。
 */
export function builtinAvatar(name: string): string | undefined {
	return BUILTIN.get(RENAMED_AGENTS[name] ?? name);
}

export type AvatarOf = (name: string) => Avatar;

/** 名单里的按名单排座；名单外的（历史会话里一个已经删掉的智能体）按名字另算一张。 */
export function avatarResolver(list: readonly { name: string; avatar?: string }[]): AvatarOf {
	const roster = assignAvatars(list, builtinAvatar);
	return (name) =>
		roster.get(name) ?? roster.get(RENAMED_AGENTS[name] ?? name) ?? parseAvatar(builtinAvatar(name)) ?? hashedAvatar(name, BUILTIN_TAKEN);
}

/** 给了名单就按它；没给就用当前会话的能力清单，会话还没有能力清单时用内置的那七个。 */
export function useAgentAvatars(list?: readonly { name: string; avatar?: string }[] | null): AvatarOf {
	const known = useApp((s) => s.capabilities?.agents);
	const source = list ?? known ?? BUILTIN_AGENTS;
	return useMemo(() => avatarResolver(source), [source]);
}
