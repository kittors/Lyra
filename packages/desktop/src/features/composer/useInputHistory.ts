/**
 * 方向键往回翻自己说过的话。
 *
 * 和 shell 里那套是同一个动作，所以照着它的规矩来：↑ 往更早翻，↓ 往回走，翻过最近的一条就回到
 * 原来那句没打完的草稿。草稿必须回得来——否则「想看看上次怎么说的」这个念头，代价是丢掉手里正在
 * 写的半句话，那样没有人敢按第二次。
 *
 * 方向键在这个输入框里已经有三个主人：@ 的名单、/ 的命令单、还有排队消息的挪动。所以这里排在最
 * 后一个，而且只在**光标已经贴着边**的时候才接管——文本有好几行时，↑ 的本分是把光标挪到上一行，
 * 抢过来就成了「多行输入里没法用方向键」。判据是光标到头（往上）或到尾（往下），不是「输入框是
 * 不是空的」：空框只是这件事最常见的一种情形，不是它的全部。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, RefObject } from "react";

import type { Message } from "@lyra/core";
/*
 * 走前门，不伸进 `conversation/grouping.ts`——`pnpm arch` 的 features-through-the-front-door 拦这个。
 *
 * 「哪几条是人自己打的」本来就是转录的语义，判断留在那个域里，这边只消费结果。
 */
import { spokenByPerson } from "../conversation/index.ts";

export interface InputHistory {
	/** 排在 @ 和 / 之后的最后一手。吃掉了这个键就回 true。 */
	keyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
	/** 输入框的内容变了。一动手就不再是「在翻历史」了。 */
	change: (next: string) => void;
	/** 正翻到第几条，给上面那行小字用；不在历史里时是 null。 */
	position: { current: number; total: number } | null;
}

export function useInputHistory({
	messages,
	value,
	onPick,
	field,
	resetKey,
}: {
	messages: readonly Message[];
	value: string;
	onPick: (text: string) => void;
	field: RefObject<HTMLTextAreaElement | null>;
	/** 换了对话就从头开始：上一个对话翻到哪儿了，跟这一个没关系。 */
	resetKey: string;
}): InputHistory {
	const entries = useMemo(() => spokenByPerson(messages), [messages]);
	/** -1 是「在草稿上」，0 是最近说过的那一句。 */
	const [index, setIndex] = useState(-1);
	const draft = useRef("");

	useEffect(() => {
		setIndex(-1);
		draft.current = "";
	}, [resetKey]);

	const apply = useCallback(
		(next: number) => {
			setIndex(next);
			onPick(next === -1 ? draft.current : (entries[next] ?? ""));
			/*
			 * 光标落到最后。
			 *
			 * 翻出来的那句话，十有八九是要接着改两个字再发的，落在开头等于还得自己按一次 End。
			 * 排到下一帧，因为这会儿 React 还没把新的值写进 textarea，现在设的位置会被覆盖掉。
			 */
			requestAnimationFrame(() => {
				const el = field.current;
				if (el) el.setSelectionRange(el.value.length, el.value.length);
			});
		},
		[entries, field, onPick],
	);

	const keyDown = useCallback(
		(event: KeyboardEvent<HTMLTextAreaElement>) => {
			if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false;
			// 带修饰键的方向键是另外的意思（选中、跳段、系统快捷键），一个都不碰。
			if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
			if (entries.length === 0) return false;

			const el = field.current;
			if (!el) return false;
			// 手上正选着一段字，方向键是用来收放选区的。
			if (el.selectionStart !== el.selectionEnd) return false;

			const up = event.key === "ArrowUp";
			// 光标还没贴到那一头，方向键归光标。
			if (up ? value.slice(0, el.selectionStart).includes("\n") : value.slice(el.selectionEnd).includes("\n")) return false;

			if (up) {
				if (index + 1 >= entries.length) return false; // 已经是最早的一条，让键透过去
				if (index === -1) draft.current = value; // 头一次往回翻，先把手里这句收好
				apply(index + 1);
			} else {
				if (index === -1) return false; // 本来就在草稿上，没有「更新」的可翻
				apply(index - 1);
			}
			event.preventDefault();
			return true;
		},
		[apply, entries.length, field, index, value],
	);

	const change = useCallback(
		(next: string) => {
			/*
			 * 改了一个字，就不再是「正在翻历史」。
			 *
			 * 比对的是内容而不是「有没有敲过键」，因为 `apply` 自己也会走一遍 `onChange`——那一次的
			 * 值正好等于翻出来的那条，据此分得开「是我翻的」和「是人改的」，不用另外记一个标志位。
			 */
			if (index !== -1 && next !== entries[index]) setIndex(-1);
		},
		[entries, index],
	);

	return {
		keyDown,
		change,
		position: index >= 0 ? { current: index + 1, total: entries.length } : null,
	};
}
