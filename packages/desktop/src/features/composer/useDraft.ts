/**
 * 一个输入框里还没发出去的字和附件，按「在对谁说」存起来。
 *
 * 主输入框一直这样存：`useApp.drafts`，按会话 id，换个会话再回来，打了一半的话还在。侧边聊天和
 * 子智能体那两个框把草稿放在组件自己的 state 里——面板一关、换个会话，那半句话就没了。子智能体那个
 * 更糟：面板不按子智能体重挂（有意的，见 `SubAgentPanel` 里 `Transcript` 那段），于是给 A 写到一半
 * 切到 B，那半句话跟着过去了，回车一按，说给了另一个人。
 *
 * 同一个仓库、同一套规则，只是键不同：`side:<会话>`、`subagent:<会话>:<子智能体>`。
 *
 * 手上这份字记着它是谁的（`owner`），存的时候存到它自己名下，而不是存到「此刻的键」名下。从前是
 * 按键存：换人的那一次提交里，state 里还是 A 的字、键却已经是 B，于是 A 的草稿被写到了 B 名下——
 * 下一帧会写回 B 自己的，可要是这两帧之间面板被关掉，B 的草稿就永远是 A 的那半句话了（用户自己
 * 派的审查子智能体报出来的）。
 */

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

import { useApp } from "../../store/index.ts";
import type { DraftAttachment } from "./attachments/read.ts";

export interface Draft<T> {
	text: string;
	setText: Dispatch<SetStateAction<string>>;
	attachments: T[];
	setAttachments: Dispatch<SetStateAction<T[]>>;
	/** 发出去了：框清空，存着的那份也扔掉。 */
	clear: () => void;
}

interface Held<T> {
	/** 这份字是谁的。 */
	owner: string | null;
	text: string;
	attachments: T[];
}

function stored<T>(key: string | null): Held<T> {
	const saved = key ? useApp.getState().drafts[key] : undefined;
	return { owner: key, text: saved?.text ?? "", attachments: (saved?.attachments as T[] | undefined) ?? [] };
}

export function useDraft<T extends DraftAttachment>(key: string | null): Draft<T> {
	const [held, setHeld] = useState<Held<T>>(() => stored<T>(key));
	/*
	 * 换人的那一帧，state 里还是上一个的字：画的时候直接取新的这一个名下存着的，框里不闪一下别人的话。
	 * 下面那个 effect 随后把它正式换进 state。
	 */
	const shown = held.owner === key ? held : stored<T>(key);
	const live = useRef(held);
	live.current = held;

	/* 换了说话对象：手上这份存回它自己名下，再把新的这一个名下的取出来。 */
	useEffect(() => {
		const before = live.current;
		if (before.owner === key) return;
		if (before.owner) useApp.getState().setDraft(before.owner, { text: before.text, attachments: before.attachments });
		setHeld(stored<T>(key));
	}, [key]);

	/* 打一个字存一次——存到这份字的主人名下。还没换过来的那一帧不存：那是上一个人的字。 */
	useEffect(() => {
		if (held.owner && held.owner === key) useApp.getState().setDraft(held.owner, { text: held.text, attachments: held.attachments });
	}, [key, held]);

	const setText = useCallback<Dispatch<SetStateAction<string>>>(
		(next) => setHeld((was) => ({ ...was, text: typeof next === "function" ? next(was.text) : next })),
		[],
	);
	const setAttachments = useCallback<Dispatch<SetStateAction<T[]>>>(
		(next) => setHeld((was) => ({ ...was, attachments: typeof next === "function" ? next(was.attachments) : next })),
		[],
	);

	const clear = () => {
		setHeld((was) => ({ ...was, text: "", attachments: [] }));
		if (live.current.owner) useApp.getState().setDraft(live.current.owner, null);
	};

	return { text: shown.text, setText, attachments: shown.attachments, setAttachments, clear };
}
