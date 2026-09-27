/**
 * One message in the side chat.
 *
 * Deliberately lighter than the main transcript: no timestamps, no usage line. This is a scratchpad
 * you ask questions in, and the ceremony that belongs on a permanent record would be noise on one
 * that is thrown away at quit.
 *
 * Editing a question is the exception, and it earns its place for the same reason it does in the
 * main conversation: a question that came out wrong, re-asked underneath the old one, leaves the
 * model reading both — which is precisely how a side chat loses the thread it was opened to follow.
 */

import { translate } from "../../i18n/translate.ts";
import type { AssistantMessage, Message, UserContent, UserMessage } from "@lyra/core";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { MessageActions } from "../conversation/index.ts";
import { MessageEditor } from "../conversation/index.ts";
import { useSide, sideChatOf } from "../dock/index.ts";
import { useSideSessionId } from "./scope.ts";
import { Markdown, SpokenBubble, spokenText } from "../conversation/index.ts";
import { ThinkingBlock } from "../conversation/index.ts";
import { segments, ToolRun } from "../conversation/index.ts";
import { isAttachmentBody } from "../../lib/attachment-placeholders.ts";

export function MessageRow({ message, index, live }: {
	message: Message;
	index: number;
	/** 这是正在答的那一条：它末尾那一段工具调用正在跑，那一行要亮着。 */
	live?: boolean;
}) {
	if (message.role === "toolResult") return null;

	if (message.role === "user") {
		// The main-transcript snapshots injected before each question are context for the model,
		// not something the user wrote — showing them would bury the actual conversation.
		if (message.synthetic) return null;
		return <UserRow index={index} message={message} />;
	}

	return <AssistantRow message={message} live={live} />;
}

/**
 * A question, and the means to ask it differently.
 *
 * The edit affordance appears on hover, on the row rather than on the bubble, so it does not shift
 * anything when it arrives. `group-has-[:focus-visible]` and not `focus-within`: a mouse click
 * leaves focus behind and the button would stay out after the pointer had gone — see
 * `e2e/hover-controls-probe.ts`.
 */
function UserRow({ index, message }: { index: number; message: UserMessage }) {
	const sessionId = useSideSessionId();
	const editAndResend = useSide((s) => s.editAndResend);
	const running = useSide((s) => sideChatOf(s, sessionId).running);
	/*
	 * 人打的那句话优先，拼起来的 `content` 只是退路——见 `spokenText`。`content` 里带着展开给模型的
	 * 附件正文，把它们拼起来画，等于把写给模型的记号摆到人眼前。
	 */
	const text = spokenText(message);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(text);

	function submit() {
		const trimmed = draft.trim();
		setEditing(false);
		if (!trimmed) return;
		/*
		 * 带的东西原样跟过去：改的是措辞，不是文件。
		 *
		 * 从前只带了图片——编辑框改的是 `displayText`，不含附件正文，于是重问一遍，【报告.md】 还在
		 * 句子里，文件本身已经没了，模型对着一份看不见的文件作答；气泡也退回原文。和主会话同一个做法
		 * （`UserMessage` 的 `submit`）：图片、正文、新措辞，再加上给人看的那一份。
		 */
		const images = message.content.filter((block): block is Extract<UserContent, { type: "image" }> => block.type === "image");
		const bodies = message.content.filter((block): block is Extract<UserContent, { type: "text" }> => block.type === "text" && isAttachmentBody(block.text));
		void editAndResend(sessionId, index, [...images, ...bodies, { type: "text", text: trimmed }], { displayText: trimmed, attachments: message.attachments ?? [] });
	}

	if (editing) {
		return (
			<div className="ly-enter mb-4">
				<MessageEditor
					value={draft}
					onChange={setDraft}
					onSubmit={submit}
					onCancel={() => {
						setDraft(text);
						setEditing(false);
					}}
					confirmLabel={translate("sideMessage.reask")}
					// The panel is a couple of hundred pixels wide; 320 would swallow it.
					maxHeight={220}
				/>
			</div>
		);
	}

	return (
		<div className="group/msg ly-enter flex flex-col items-end">
			{/* 和子智能体面板同一个气泡——见 `SpokenBubble`。 */}
			<SpokenBubble message={message} renderText={(plain) => <Markdown text={plain} />} />

			{/*
			 * The same row the main transcript puts under a sent message — the same component, not a
			 * lookalike. It carries the time, the copy button and, as its child, whatever this side
			 * offers beyond copying. Here that is editing, exactly as it is there.
			 */}
			<MessageActions timestamp={message.timestamp} text={text} className="pr-1">
				<button
					type="button"
					data-ly-tip={translate(running ? "sideMessage.busy" : "sideMessage.editAndReask")}
					aria-label={translate("sideMessage.editAndReask")}
					disabled={running}
					onClick={() => {
						setDraft(text);
						setEditing(true);
					}}
					className="flex h-6 w-6 items-center justify-center rounded-md text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent"
				>
					<Pencil size={12.5} strokeWidth={1.8} />
				</button>
			</MessageActions>
		</div>
	);
}

function AssistantRow({ message, live }: { message: AssistantMessage; live?: boolean }) {
	const sessionId = useSideSessionId();
	const toolRuns = useSide((s) => sideChatOf(s, sessionId).toolRuns);
	/** What it actually said, for the copy button. Tool calls and thinking are not the answer. */
	const spoken = message.content
		.filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
		.map((block) => block.text)
		.join("\n");

	return (
		<div className="group/msg ly-enter flex flex-col gap-2.5">
			{/*
			 * 连着的几次工具调用收成一行，和主会话一样。
			 *
			 * 这里从前每次调用一张卡片：问一句「这个函数在哪儿用到了」，面板里竖着排出六张「读取文件」，
			 * 答案被挤到屏幕外。主会话早就把它们收成「读取文件 6 个」一行、点开才看每一张——同一件事在
			 * 两个对话里两种长相。
			 */}
			{segments(message.content).map((segment, position, all) => {
				if (segment.kind === "tools") {
					return (
						<ToolRun
							key={`tools-${position}`}
							calls={segment.blocks.map((block) => ({ block, stopReason: message.stopReason }))}
							runs={toolRuns}
							live={Boolean(live) && position === all.length - 1}
						/>
					);
				}
				const { block, index } = segment;
				if (block.type === "thinking") {
					return (
						<ThinkingBlock
							key={index}
							text={block.thinking}
							redacted={block.redacted === true}
							live={message.stopReason === "pending" && index === message.content.length - 1}
						/>
					);
				}
				if (block.type === "text") {
					return block.text ? (
						// The same rhythm as the main transcript — see `rows.tsx`.
						<div key={index}>
							<Markdown text={block.text} />
						</div>
					) : null;
				}
				return null;
			})}

			{message.stopReason === "error" && message.errorMessage && (
				<div className="mt-2 rounded-[9px] border border-danger/35 bg-danger/8 px-3 py-2 text-detail text-danger">
					{message.errorMessage}
				</div>
			)}

			{/*
			 * The same row the main transcript puts under a finished reply: when it was said, and a
			 * way to take it with you. No duration and no token count — those belong to the main
			 * session's turn. Only once the reply has finished: a row of controls under a message that
			 * is still arriving offers to copy half a sentence.
			 */}
			{message.stopReason !== "pending" && spoken.trim() && (
				<MessageActions timestamp={message.timestamp} text={spoken} />
			)}
		</div>
	);
}

/** Stable across re-renders while a message is still streaming into place. */
export function rowKey(message: Message, index: number): string {
	if (message.role === "toolResult") return `tr-${message.toolCallId}`;
	return `${message.role}-${message.timestamp}-${index}`;
}

/**
 * Whether the reply has stopped producing anything, so "思考中…" is the truth rather than a
 * spinner sitting under text that is already being written.
 */
export function lastIsSettled(messages: Message[]): boolean {
	const last = messages[messages.length - 1];
	if (!last || last.role !== "assistant") return true;
	return !last.content.some((c) => (c.type === "text" && c.text) || c.type === "toolCall");
}
