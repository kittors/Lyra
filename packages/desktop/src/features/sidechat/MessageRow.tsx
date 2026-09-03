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

import type { AssistantMessage, Message, UserContent } from "@lyra/core";
import { openFromEvent } from "../image/viewer-store.ts";
import { Pencil } from "lucide-react";
import { useState } from "react";
import { MessageActions } from "../conversation/MessageActions.tsx";
import { MessageEditor } from "../conversation/message/MessageEditor.tsx";
import { useSide } from "../dock/sideStore.ts";
import { Markdown } from "../conversation/Markdown.tsx";
import { ThinkingBlock } from "../conversation/ThinkingBlock.tsx";
import { ToolCard } from "../conversation/ToolCard.tsx";

export function MessageRow({ message, index }: { message: Message; index: number }) {
	if (message.role === "toolResult") return null;

	if (message.role === "user") {
		// The main-transcript snapshots injected before each question are context for the model,
		// not something the user wrote — showing them would bury the actual conversation.
		if (message.synthetic) return null;
		const text = message.content
			.filter((block): block is Extract<UserContent, { type: "text" }> => block.type === "text")
			.map((block) => block.text)
			.join("\n");
		const images = message.content.filter(
			(block): block is Extract<UserContent, { type: "image" }> => block.type === "image",
		);
		return <UserRow index={index} text={text} images={images} timestamp={message.timestamp} />;
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
	images,
	timestamp,
}: {
	index: number;
	text: string;
	images: Extract<UserContent, { type: "image" }>[];
	timestamp: number;
}) {
	const editAndResend = useSide((s) => s.editAndResend);
	const running = useSide((s) => s.running);
	const [editing, setEditing] = useState(false);
	const [draft, setDraft] = useState(text);

	function submit() {
		const trimmed = draft.trim();
		setEditing(false);
		if (!trimmed) return;
		// The images came with the question and stay with it; the edit is to the wording.
		void editAndResend(index, [...images, { type: "text", text: trimmed }]);
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
					confirmLabel="重新提问"
					// The panel is a couple of hundred pixels wide; 320 would swallow it.
					maxHeight={220}
				/>
			</div>
		);
	}

	return (
		<div className="group/msg ly-enter mb-2.5 flex flex-col items-end">
			<div className="max-w-[88%] rounded-[13px] rounded-br-[5px] bg-card px-3 py-2 text-label leading-relaxed text-ink">
				{text && <div className="whitespace-pre-wrap">{text}</div>}
				{images.length > 0 && (
					<div className={`flex flex-wrap gap-1.5 ${text ? "mt-2" : ""}`}>
						{images.map((block, i) => (
							<button
								key={i}
								type="button"
								aria-label="预览图片"
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
									alt="附图"
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
					data-ly-tip={running ? "回答进行中，无法编辑" : "编辑并重新提问"}
					aria-label="编辑并重新提问"
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
	const toolRuns = useSide((s) => s.toolRuns);
	/** What it actually said, for the copy button. Tool calls and thinking are not the answer. */
	const spoken = message.content
		.filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
		.map((block) => block.text)
		.join("\n");

	return (
		<div className="group/msg ly-enter mb-4">
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
						<div key={index} className="mb-2.5">
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
						status={run?.status ?? (message.stopReason === "pending" ? "running" : "error")}
						result={run?.result}
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
