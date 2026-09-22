/**
 * 这个侧边聊天面板是「谁的」。
 *
 * 分屏之后一个窗口里可以有不止一个侧边聊天面板，每个属于自己那一屏的会话。从前面板一律读
 * `useSide` 里「当前那一份」，于是点一下另一屏，所有侧边聊天面板一起换成那一屏的对话——两屏
 * 画着同一段内容，而其中一屏的标题写着另一个会话的名字。
 *
 * 答案从 `SessionScope` 来，和主对话、终端、浏览器面板用的是同一个来源（`app/session-scope.tsx`
 * 开头那段说明了它的三种取值）。`undefined` 是「不在任何一屏里」——窗口 dock 上的面板、面板
 * 窗口——那时回落到当前会话，正是从前的行为。
 *
 * 这里只回答「是谁」，取数留在各个组件里（`useSide((s) => sideChatOf(s, sessionId).…)`）。
 * 把取数也搬进来会让这个文件 import `dock` 的大门，而那扇门后面接着 `DockView → 面板注册表
 * → 回到 sidechat`——一个新的环，`pnpm arch` 当场红。`features/terminal/scope.ts` 是同一个
 * 位置上的同一种东西。
 */

import { useContext } from "react";
import { SessionScope } from "../../app/session-scope.tsx";
import { useApp } from "../../store/index.ts";

export function useSideSessionId(): string | null {
	const scoped = useContext(SessionScope);
	const active = useApp((s) => s.activeSessionId);
	return scoped === undefined ? active : scoped;
}
