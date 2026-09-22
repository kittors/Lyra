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
import type { AssistantMessage, Message, MessageAttachment, UserContent } from "@lyra/core";
import { openFromEvent } from "../image/index.ts";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { MessageActions } from "../conversation/index.ts";
import { MessageEditor } from "../conversation/index.ts";
import { useSide, sideChatOf } from "../dock/index.ts";
import { useSideSessionId } from "./scope.ts";
import { BubbleText, Markdown } from "../conversation/index.ts";
import { ThinkingBlock } from "../conversation/index.ts";
import { ToolCard } from "../conversation/index.ts";
import { toolCardFallback } from "../conversation/index.ts";

export function MessageRow({ message, index }: { message: Message; index: number }) {
	if (message.role === "toolResult") return null;

	if (message.role === "user") {
		// The main-transcript snapshots injected before each question are context for the model,
		// not something the user wrote — showing them would bury the actual conversation.
		if (message.synthetic) return null;
		/*
		 * 人打的那句话优先，拼起来的 `content` 只是退路。
		 *
		 * `content` 里带着展开给模型的附件正文——`### Attached file: image.png` 和围栏起来的内容。
		 * 把它们拼起来画，等于把写给模型的记号摆到人眼前，而同一条消息在主会话里画的是一枚胶囊。
		 * `displayText` 是这条消息发出时一并存下的那份「人打的字」，升级之前发的老消息没有它，
		 * 那时仍然退回原来的拼法——少一枚胶囊，总好过整条消息不见。
		 */
		const spoken = message.content
			.filter((block): block is Extract<UserContent, { type: "text" }> => block.type === "text")
			.map((block) => block.text)
			.join("\n");
		const text = message.displayText ?? spoken;
		const images = message.content.filter(
			(block): block is Extract<UserContent, { type: "image" }> => block.type === "image",
		);
		return (
			<UserRow
				index={index}
				text={text}
				attachments={message.attachments ?? []}
				images={images}
				timestamp={message.timestamp}
			/>
		);
	}

	return <AssistantRow message={message} />;
}

/**
 * A question, and the means to ask it differently.
 *
 * The edit affordance appears on hover, on the row rather than on the bubble, so it does not shift
 * anything when it arrives. `group-has-[:focus-visible]` and not `focus-within`: a mouse click
 * leaves focus behind and the button would stay out after the pointer had gone — see
 * `e2e/hover-controls-probe.ts`.
 */
function UserRow({
	index,
	text,
	attachments,
	images,
	timestamp,
}: {
	index: number;
	text: string;
	/** 名字和门类，用来认出句子里的 `【图片 1】`——正文不在里面，它已经在 `content` 里了。 */
	attachments: MessageAttachment[];
	images: Extract<UserContent, { type: "image" }>[];
	timestamp: number;
}) {
	const sessionId = useSideSessionId();
	const editAndResend = useSide((s) => s.editAndResend);
	const running = useSide((s) => sideChatOf(s, sessionId).running);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(text);

	function submit() {
		const trimmed = draft.trim();
		setEditing(false);
		if (!trimmed) return;
		// The images came with the question and stay with it; the edit is to the wording.
		void editAndResend(sessionId, index, [...images, { type: "text", text: trimmed }]);
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
			<div className="ly-user-bubble max-w-[88%] rounded-2xl bg-card px-4 py-2.5 text-ink">
				{/*
				 * 和主会话气泡同一个组件：没有附件标记时整段走 markdown，有标记时保持行内。
				 *
				 * 这一句从前是 `whitespace-pre-wrap` 的纯文本，于是 `# 需求1` 画出来就是一行井号；
				 * 而附件那一段更明显——写给模型的 `### Attached file: …` 原样摆在人眼前。
				 */}
				{text && (
					<BubbleText
						text={text}
						files={attachments}
						className="text-body leading-relaxed"
						renderText={(plain) => <Markdown text={plain} />}
						/*
						 * 这里的胶囊只认名字，不带动作。
						 *
						 * 主会话那边点一枚能开文件、能预览、能右键——靠的是消息里存下的路径和像素。
						 * 侧边聊天的附件也存了名字和路径，但这个面板两百来像素宽，没有能承接
						 * 「打开」的地方（文件面板属于主窗口）。所以先只认出它、画成一枚标签，
						 * 不给一条点了没反应的路。
						 */
						renderFile={(file, at) => (
							<span key={at} className="ly-attachment-token" data-kind={file.kind}>
								{file.label ?? file.name}
							</span>
						)}
					/>
				)}
				{images.length > 0 && (
					<div className={`flex flex-wrap gap-1.5 ${text ? "mt-2" : ""}`}>
						{images.map((block, i) => (
							<button
								key={i}
								type="button"
								aria-label={translate("sideMessage.previewImage")}
								onClick={(event) =>
									openFromEvent(
										event,
										images.map((img) => ({ src: `data:${img.mimeType};base64,${img.data}` })),
										i,
									)
								}
								className="block overflow-hidden rounded-md border border-line bg-card shadow-xs transition-opacity duration-[var(--ly-t-quick)] hover:opacity-85"
							>
								<img
									src={`data:${block.mimeType};base64,${block.data}`}
									alt={translate("sideMessage.attachedImage")}
									className="h-14 w-20 object-cover"
								/>
							</button>
						))}
					</div>
				)}
			</div>

			{/*
			 * The same row the main transcript puts under a sent message — the same component, not a
			 * lookalike. It carries the time, the copy button and, as its child, whatever this side
			 * offers beyond copying. Here that is editing, exactly as it is there.
			 *
			 * The panel had none of it: no timestamp, no copy, and an edit button invented on the
			 * spot in a different size and position. Two conversations, two vocabularies for the same
			 * three actions.
			 */}
			<MessageActions timestamp={timestamp} text={text} className="pr-1">
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

function AssistantRow({ message }: { message: AssistantMessage }) {
	const sessionId = useSideSessionId();
	const toolRuns = useSide((s) => sideChatOf(s, sessionId).toolRuns);
	// 没有运行记录的卡片说什么，取决于这一轮跑完没有——见 `conversation/tool-status.ts`。
	const turnRunning = useSide((s) => sideChatOf(s, sessionId).running);
	/** What it actually said, for the copy button. Tool calls and thinking are not the answer. */
	const spoken = message.content
		.filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
		.map((block) => block.text)
		.join("\n");

	return (
		<div className="group/msg ly-enter flex flex-col gap-2.5">
			{message.content.map((block, index) => {
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
						// The same rhythm as the main transcript — see `rows.tsx`. Two conversations
						// showing the same kind of answer at two different spacings is the drift this
						// panel keeps accumulating.
						<div key={index}>
							<Markdown text={block.text} />
						</div>
					) : null;
				}
				const run = toolRuns[block.id];
				return (
					<ToolCard
						key={block.id}
						toolName={block.name}
						args={block.arguments}
						summary={run?.summary ?? block.name}
						status={run?.status ?? toolCardFallback(message.stopReason, turnRunning)}
						result={run?.result}
						startedAt={run?.startedAt}
					/>
				);
			})}

			{message.stopReason === "error" && message.errorMessage && (
				<div className="mt-2 rounded-[9px] border border-danger/35 bg-danger/8 px-3 py-2 text-detail text-danger">
					{message.errorMessage}
				</div>
			)}

			{/*
			 * The same row the main transcript puts under a finished reply: when it was said, and a
			 * way to take it with you.
			 *
			 * No duration and no token count — those belong to the main session's turn, and this
			 * panel has no turn of its own to report. `MessageActions` leaves them out when they are
			 * not given, which is why it can be the same component rather than a similar one.
			 *
			 * Only once the reply has finished. A row of controls under a message that is still
			 * arriving offers to copy half a sentence.
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
