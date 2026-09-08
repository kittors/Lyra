/**
 * 会话正忙的时候说出口的那些话，排在这里等下一轮。
 *
 * 从前它们是直接插进正在跑的那一轮的——`Session.prompt` 忙时的默认投递就叫 steer——说出口就已经
 * 在模型手里：改不了、撤不回，也排不了第二条。可中途想说的常常不止一句，而且多半是「这件做完再做
 * 那件」，插进去反倒打断了正在做的那件。
 *
 * 所以它们先落在这里。队列是输入框的东西，不是会话的东西：里面既有已经展开好、随时能发出去的内容，
 * 也有原样收着的那份草稿——「编辑」要把草稿整份放回输入框，附件和引用一起，而不是把展开后的提示词
 * 倒回去给人看。
 *
 * 出队由事件推着走：这一轮干净收尾了（`agent_end` 的 reason 是 done）才轮到下一条。中断、报错、
 * 卡死都不发——按下停止之后接着把排着的三条灌进去，而屏幕上刚刚说完「已停止」，是最不该发生的事。
 * 那几条仍旧留在条上，等人自己决定还发不发。
 */

import type { UserContent } from "@lyra/core";
import type { AppState } from "./index.ts";

type Get = () => AppState;
type Set = (partial: Partial<AppState> | ((state: AppState) => Partial<AppState>)) => void;

/** 附件在草稿里的样子。和 `drafts` 里的同一种东西，因为「编辑」要把它原样放回去。 */
interface QueuedAttachment {
	id: string;
	name: string;
	mimeType: string;
	kind?: string;
	data?: string;
	text?: string;
	isText?: boolean;
}

/** 一次提交在输入框里本来的样子。 */
interface QueuedDraft {
	text: string;
	attachments: QueuedAttachment[];
	sessionRefs: { id: string; title: string }[];
}

export interface QueuedMessage {
	id: string;
	/** 展开好的、真正发出去的东西——命令已经变成它代表的提示词，图片已经是 content 块。 */
	content: UserContent[];
	displayText?: string;
	skillRef?: { name: string; path?: string; pluginId?: string };
	sessionRefs?: { id: string; title: string }[];
	/** 原样收着的草稿，「编辑」拿它回填输入框。 */
	draft: QueuedDraft;
	/** 条上那一行字。展开前的原文，因为那才是人写下的话。 */
	preview: string;
	/** 第一张图，条上那个缩略图。 */
	thumbnail?: { mimeType: string; data: string };
	queuedAt: number;
}

export interface QueueSlice {
	/** 每个会话各自排着的，按发出去的先后。空了就把这个会话的键删掉，不留空数组。 */
	queued: Record<string, QueuedMessage[]>;
	/** 排到队尾，返回它的 id。 */
	enqueue(sessionId: string, entry: Omit<QueuedMessage, "id" | "queuedAt">): string;
	/** 拿走一条并把它交还给调用者——删掉是丢弃，编辑是把它放回输入框，两件事同一个动作。 */
	dropQueued(sessionId: string, id: string): QueuedMessage | null;
	/** 换个位置。`placement` 说的是落在目标的前面还是后面。 */
	moveQueued(sessionId: string, id: string, targetId: string, placement: "before" | "after"): boolean;
	/** 发队首。这一轮干净收尾之后由事件调它。 */
	flushQueue(sessionId: string): Promise<void>;
	/**
	 * 现在就把这一条交出去，不打断正在跑的那一轮。
	 *
	 * 也就是原来忙时的默认行为——插进这一轮。空闲时它和普通发送是同一件事，因为空闲时两种投递本来
	 * 就没有区别（见 `Session.prompt`）。
	 */
	steerQueued(sessionId: string, id: string): Promise<void>;
}

export function queueSlice(set: Set, get: Get): QueueSlice {
	/*
	 * 一个会话同时只送一条。
	 *
	 * 「这一轮结束了」和「人自己按了转向」可以撞在同一帧上，而两边都是先取走再发送——没有这道闸，
	 * 取走的是两条，发出去的也是两条，队列的先后就没了。
	 */
	const sending = new Set<string>();

	/** 写回一个会话的队列；空了就连键一起去掉。 */
	const write = (sessionId: string, list: QueuedMessage[]) =>
		set((state) => {
			const queued = { ...state.queued };
			if (list.length > 0) queued[sessionId] = list;
			else delete queued[sessionId];
			return { queued };
		});

	/** 取走一条，连同它原来站的位置——送不出去的时候要放回原处，而不是队尾。 */
	const take = (sessionId: string, id: string): { entry: QueuedMessage; at: number } | null => {
		const list = get().queued[sessionId] ?? [];
		const at = list.findIndex((entry) => entry.id === id);
		if (at < 0) return null;
		const entry = list[at]!;
		write(sessionId, list.toSpliced(at, 1));
		return { entry, at };
	};

	const putBack = (sessionId: string, entry: QueuedMessage, at: number) => {
		const list = get().queued[sessionId] ?? [];
		write(sessionId, list.toSpliced(Math.min(at, list.length), 0, entry));
	};

	/**
	 * 取走、发出去，发不出去就放回原处。
	 *
	 * 先取走再发，是因为条上那一行要在按下去的那一刻就走人——发送要跨一次 IPC，等它回来再收行，
	 * 中间那段时间人会以为没点着。代价是失败要能还原，所以位置也一起记着。
	 */
	const dispatch = async (sessionId: string, id: string, deliver?: "steer"): Promise<void> => {
		if (sending.has(sessionId)) return;
		const taken = take(sessionId, id);
		if (!taken) return;
		sending.add(sessionId);
		try {
			const accepted = await get().send(taken.entry.content, {
				sessionId,
				...(deliver ? { deliver } : {}),
				...(taken.entry.displayText !== undefined ? { displayText: taken.entry.displayText } : {}),
				...(taken.entry.skillRef ? { skillRef: taken.entry.skillRef } : {}),
				...(taken.entry.sessionRefs?.length ? { sessionRefs: taken.entry.sessionRefs } : {}),
			});
			if (!accepted) putBack(sessionId, taken.entry, taken.at);
		} catch (cause) {
			putBack(sessionId, taken.entry, taken.at);
			get().notify(`排队的消息没能发出去：${cause instanceof Error ? cause.message : String(cause)}`, "error");
		} finally {
			sending.delete(sessionId);
		}
	};

	return {
		queued: {},

		enqueue(sessionId, entry) {
			const id = crypto.randomUUID();
			const list = get().queued[sessionId] ?? [];
			write(sessionId, [...list, { ...entry, id, queuedAt: Date.now() }]);
			return id;
		},

		dropQueued(sessionId, id) {
			return take(sessionId, id)?.entry ?? null;
		},

		moveQueued(sessionId, id, targetId, placement) {
			if (id === targetId) return false;
			const list = get().queued[sessionId] ?? [];
			const from = list.findIndex((entry) => entry.id === id);
			const target = list.findIndex((entry) => entry.id === targetId);
			if (from < 0 || target < 0) return false;
			const without = list.toSpliced(from, 1);
			/*
			 * 目标的位置在拿走之后重新找一遍。
			 *
			 * 从上往下拖的时候，被拖的那一条本来就排在目标前面，拿走它之后目标整个上移一位——按原来
			 * 的下标插，落点会差一格，看起来就是「拖过去了又弹回来一点」。
			 */
			const at = without.findIndex((entry) => entry.id === targetId);
			const to = placement === "before" ? at : at + 1;
			if (to === from) return false;
			write(sessionId, without.toSpliced(to, 0, list[from]!));
			return true;
		},

		async flushQueue(sessionId) {
			const first = get().queued[sessionId]?.[0];
			if (!first) return;
			/*
			 * 真的停下来了才发。
			 *
			 * `agent_end` 之后紧接着又开一轮是常事——「继续」、重试、上一条排队的刚被送出去。这时候
			 * 再送一条进去，它会作为插话落进那一轮，而排队的意思恰恰是不插话。
			 */
			if (get().activity[sessionId] === "running") return;
			await dispatch(sessionId, first.id);
		},

		async steerQueued(sessionId, id) {
			await dispatch(sessionId, id, "steer");
		},
	};
}
