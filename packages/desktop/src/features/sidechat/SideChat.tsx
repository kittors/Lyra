/**
 * The conversation beside the conversation.
 *
 * A scratchpad that can see what the main session is doing but does not write into it. Anything
 * that needs doing gets dispatched to that session's queue instead, which is what `TaskStrip`
 * below the messages reports on.
 *
 * Only the arrangement lives here: a message is `sidechat/MessageRow`, the dispatched work is
 * `sidechat/TaskStrip`, and the field is `sidechat/SideComposer`.
 */

import { MessageCirclePlus } from "lucide-react";
import type { Message } from "@lyra/core";
import { useEffect, useState } from "react";
import { useSide } from "../dock/index.ts";
import { BackToLatest } from "../conversation/index.ts";
import { PanelEmpty } from "../../ui/layout/PanelEmpty.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { useFollowBottom } from "../../ui/scroll/useFollowBottom.ts";
import { tailSignature } from "../../ui/scroll/signature.ts";
import { ThinkingLine } from "../conversation/index.ts";
import { moodFor, phraseFor } from "../../lib/thinking-words.ts";
import { lastIsSettled, MessageRow, rowKey } from "./MessageRow.tsx";
import { SideComposer } from "./SideComposer.tsx";
import { TaskStrip } from "./TaskStrip.tsx";

export function SideChat() {
	const messages = useSide((s) => s.messages);
	const running = useSide((s) => s.running);
	const sessionId = useSide((s) => s.sessionId);
	const ask = useSide((s) => s.ask);
	const abort = useSide((s) => s.abort);
	const reset = useSide((s) => s.reset);

	/*
	 * The same rule the main transcript follows, from the same place.
	 *
	 * This panel used to keep its own: a lone `pinned` ref, a 60px slack where the conversation had
	 * 80, no reaction to the panel being resized, and no way back down once you had scrolled up. The
	 * ref was the worst of it — it never reset, so scrolling up here and then switching the main
	 * conversation left the incoming session's side chat parked at an offset that belonged to the
	 * one before it.
	 */
	const follow = useFollowBottom({
		surfaceId: sessionId,
		namespace: "sidechat",
		count: messages.length,
		tail: tailSignature(messages, running ? "run" : ""),
	});

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			{!sessionId ? (
				// It reads the conversation it is attached to; without one there is nothing to be
				// beside.
				<PanelEmpty icon={MessageCirclePlus} title="侧边聊天">
					先在左边开始一个对话。侧边聊天读的是那个对话，没有它就无从谈起。
				</PanelEmpty>
			) : messages.length === 0 ? (
				<PanelEmpty icon={MessageCirclePlus} title="侧边聊天">
					它看得见主会话聊了什么，但说的话不会写进主会话；需要动手的事，它会交给主会话排队执行。这里的对话会保留，随时回来接着聊。
				</PanelEmpty>
			) : (
				<div className="relative flex min-h-0 flex-1 flex-col">
				<Scroller
					className="flex-1"
					scrollRef={follow.scrollRef}
					contentClassName="px-3"
					onScroll={follow.onScroll}
					onResize={follow.onResize}
				>
					{/*
					 * Capped and centred, exactly as the main transcript is.
					 *
					 * At panel width this changes nothing. Full screen it is the difference between
					 * a conversation and a wall of text a metre wide — prose stops being readable
					 * somewhere around 90 characters, and the panel is over twice that when it
					 * takes the whole column.
					 */}
					<div className="mx-auto w-full max-w-[var(--ly-content)] py-3">
						{messages.map((message, index) => (
							<MessageRow key={rowKey(message, index)} message={message} index={index} />
						))}
						{/*
						 * The same line the main transcript shows while it waits, minus the meter.
						 *
						 * Both conversations are waiting on a model and should say so the same way; a
						 * spinner and the words 「思考中…」 next to the main transcript's orb and phrase
						 * made the panel read as a different application. Elapsed time and tokens are
						 * the main session's to report — this one has nothing to count.
						 */}
						{running && lastIsSettled(messages) && <SideThinking messages={messages} />}
						{/* The end of it, so that having seen the newest reply is a fact rather than a
						    guess made from how far down you are. See `useFollowBottom`. */}
						<div ref={follow.tailRef} aria-hidden className="h-px w-full shrink-0" />
					</div>
				</Scroller>
				{/*
				 * The way back, which this panel never had.
				 *
				 * It streams like the main transcript does, so scrolling up to read something while a
				 * reply is arriving leaves you with no route back to it but dragging — and "back" keeps
				 * moving while the reply is still being written.
				 */}
				<BackToLatest show={follow.away} unread={follow.unread} onClick={follow.returnToBottom} />
				</div>
			)}

			<TaskStrip />

			<SideComposer
				running={running}
				disabled={!sessionId}
				onSend={(content) => void ask(content)}
				onStop={() => void abort()}
				onReset={messages.length > 0 ? () => void reset() : undefined}
			/>
		</div>
	);
}

/**
 * The side chat's own "working" line.
 *
 * Its own component so the phrase can advance on a timer without re-rendering the whole panel on
 * every tick — the transcript above it can be long, and a list that repaints four times a second
 * while the model thinks is the kind of thing that makes a window feel heavy.
 *
 * The mood is read off what is actually on screen, the same way `RunningIndicator` reads it: a
 * `text` block still arriving means composing, anything else means thinking.
 */
function SideThinking({ messages }: { messages: Message[] }) {
	const [tick, setTick] = useState(0);
	useEffect(() => {
		const id = setInterval(() => setTick((t) => t + 1), 2600);
		return () => clearInterval(id);
	}, []);

	const last = messages[messages.length - 1];
	const writing =
		last?.role === "assistant" && last.content.some((block) => block.type === "text" && block.text.length > 0);
	const mood = moodFor(undefined, undefined, false, writing);
	return <ThinkingLine mood={mood} phrase={phraseFor(mood, tick, 0)} />;
}
