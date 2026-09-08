/**
 * One message, rendered.
 *
 * A user's turn is a bubble; the agent's is a column of blocks — thinking, text, previews — with
 * its timestamp and actions appearing only once the reply has actually ended. A runtime message
 * (the nudge that continues a stalled turn) renders as nothing at all: it was never something a
 * person said, and showing it where a person's messages go is a lie about who is talking.
 */

import { memo } from "react";
import type { AssistantMessage, Message } from "@lyra/core";
import { TurnDeliveryCard } from "./TurnDelivery.tsx";
import { Markdown } from "./Markdown.tsx";
import { MessageActions } from "./MessageActions.tsx";
import { ThinkingBlock } from "./ThinkingBlock.tsx";
import { RuleCard } from "./RuleCard.tsx";
import { conversationTime } from "./question-navigation.ts";
import { UserMessage } from "./UserMessage.tsx";
import { useApp } from "../../store/index.ts";
import { isNudge, type TurnStats } from "./grouping.ts";
import { LiveToolCard, segments, ToolRun as ToolRunGroup } from "./runs.tsx";

/**
 * Whether this message is where the reply stopped, rather than a pause inside it.
 *
 * `pending` is still arriving; `toolUse` is a handover to a tool with more to come after it.
 * Everything else — a plain stop, a length cap, an error, an abort — is an ending.
 */
function settled(stopReason: AssistantMessage["stopReason"]): boolean {
  return stopReason !== "pending" && stopReason !== "toolUse";
}


/**
 * A row only changes when its own message does.
 *
 * The transcript re-renders on every streamed token; the four hundred rows above the one being
 * written have not changed and must not be rebuilt. Message objects are replaced rather than
 * mutated, so the default comparison is exactly the right question to ask.
 */
export const MessageRow = memo(function MessageRow({
  message,
  index,
  upTo,
  from,
  lead,
  newest,
  continued,
  turnStats,
  viewKey,
  showTime,
}: {
  message: Message;
  index: number;
  /**
   * How many content blocks belong to this row.
   *
   * Calls the model made after its last sentence are not part of the reply — they are the start
   * of the run below, which the next message's calls join. Drawing them here instead would put a
   * group inside this row and a second one under it with nothing between them, and every batch
   * after the first would land in the second.
   */
  upTo: number;
  /**
   * Where this row starts, for the one reply whose reasoning is drawn above the work.
   *
   * See `Run.from` in `grouping.ts`. Absent everywhere else, which is every other row.
   */
  from?: number;
  /**
   * This row is only the reasoning that opens the reply, not the reply.
   *
   * The same message gets two rows when it thinks and then speaks, and everything that belongs to
   * the reply as a whole — the failure, the delivery card, the timestamp and copy button — belongs
   * to the second one. Without this they were drawn under both, so a turn came back stamped twice.
   */
  lead?: boolean;
  /** The newest reply in the transcript: the only one whose reasoning can still be arriving. */
  newest?: boolean;
  /** The runtime told it to keep going, so this is a pause rather than a finish. */
  continued?: boolean;
  /** Accumulated statistics for the turn this message concludes. */
  turnStats?: TurnStats;
  viewKey?: string;
  showTime?: boolean;
}) {
  if (message.role === "user") {
    /*
     * The runtime talking to the model, not the user talking.
     *
     * Recognised by what it says, not only by its flag. The flag was added later, so every nudge
     * already written to a log lacks it — and those are exactly the ones sitting in people's
     * transcripts wearing their own bubble, timestamp and edit button, looking like something
     * they typed and never did. Reading the text catches both.
     *
     * Most runtime messages say nothing a reader needs and stay hidden; a nudge is why another
     * turn started, so it gets a line of its own — a note about the conversation rather than a
     * message in it.
     */
    /*
     * Invisible, including the fact that it happened.
     *
     * A line saying "自动继续" was there to explain why another turn began — but the work either
     * side of it is one continuous stretch, and a rule drawn through the middle of it interrupts
     * something that never stopped. The plan already shows what remains, and the transcript reads
     * better without a note about the machinery that kept it going.
     *
     * `grouping.ts` passes over these before a row is ever made, so nothing should reach here;
     * this is the latch rather than the rule. Getting it wrong puts words in someone's mouth,
     * which is the one failure worth checking for twice.
     */
    /*
     * One synthetic message is worth showing: a rule correction.
     *
     * The rest of them are machinery — the nudge that continues a stalled turn, the resume note —
     * and drawing a line through work that never stopped reads worse than silence. A rule is not
     * machinery: it changed what the model said, and without a mark here that change looks like
     * the model having thought better of it on its own.
     */
    if (message.ruleMatch) return <RuleCard match={message.ruleMatch} />;
    if (message.synthetic || isNudge(message)) return null;
    return <>{showTime && <div className="ly-conversation-time my-6 text-center text-caption text-ink-faint"><time dateTime={new Date(message.timestamp).toISOString()}>{conversationTime(message.timestamp)}</time></div>}<UserMessage message={message} index={index} /></>;
  }

  // Tool results are rendered inside their tool card, not as standalone rows.
  if (message.role === "toolResult") return null;

  return (
    <AssistantRow message={message} upTo={upTo} from={from} lead={lead} newest={newest} continued={continued} turnStats={turnStats} viewKey={viewKey} />
  );
});

function AssistantRow({
  message,
  upTo,
  from = 0,
  lead,
  newest,
  continued,
  turnStats,
  viewKey,
}: {
  message: AssistantMessage;
  upTo: number;
  from?: number;
  lead?: boolean;
  newest?: boolean;
  continued?: boolean;
  turnStats?: TurnStats;
  viewKey?: string;
}) {
  const running = useApp((s) => s.running);

  const own = message.content.slice(from, upTo);

  const text = own
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("\n\n");

  // `group/msg` is what reveals the row below, and it names the whole reply as the target.
  return (
    <div className="group/msg ly-enter mb-2.5">
      {/*
       * Grouped before rendering, not after.
       *
       * A run of finished tool calls collapses into one line; anything else — text, thinking, a
       * preview, or a call still going — stays exactly where it is. Whether a card can be folded
       * away is a fact about the call, so it has to be decided here rather than by looking at
       * rendered output that no longer knows what it came from.
       */}
      {segments(own).map((segment, position) => {
        if (segment.kind === "block") {
          const { block, index } = segment;
          // `segments` numbers what it was handed; `from` puts that back on the message's own scale.
          const at = from + index;
          if (block.type === "thinking") {
            /*
             * Typing itself out while it is the reasoning still being written.
             *
             * Not `stopReason === "pending"`, which is the reply's state and answers a different
             * question. A provider that batches hands over the reasoning and the call after it in
             * one breath, so the reply has already settled by the first render — and that is the
             * case the typing exists for, not the one it should skip. What matters is that this is
             * the newest reasoning in a transcript that is still moving; `grouping.ts` says which.
             */
            return (
              <ThinkingBlock
                key={at}
                stateKey={viewKey ? `${viewKey}:thinking:${at}` : undefined}
                text={block.thinking}
                redacted={block.redacted === true}
                live={newest === true && at === upTo - 1 && (running || message.stopReason === "pending")}
              />
            );
          }
          if (block.type === "text") {
            return block.text ? (
              <div key={at} className="mb-2.5 last:mb-0">
                <Markdown text={block.text} />
              </div>
            ) : null;
          }
          return <LiveToolCard key={block.id} block={block} stopReason={message.stopReason} />;
        }

        const calls = segment.blocks.map((block) => ({ block, stopReason: message.stopReason }));
        return <ToolRunGroup key={`group-${position}`} calls={calls} />;
      })}

      {/*
       * 失败不在这里说了——它和「正在重连」是同一件事的两个阶段，一起搬到了 `HiccupTrace`。
       *
       * 这里从前是一个红三角、一句「这一轮出错了」、一个展开箭头，外加一个「重试」；底下 `ResumeRow`
       * 再来一行「上次请求失败 · 继续 · 重试」。两行、四个可点的东西、一个红标，说的是一件多半几秒
       * 钟后自己就好了的事——而真自己好了的那些，一点痕迹都不留。轻重反了。
       *
       * 那个「重试」也一并撤了。它做的是丢掉整轮重新生成，在一轮已经花掉几十万 token 之后按错就是
       * 再花一次，而它当时正并排站在「继续」旁边、长得像同一类东西。重新生成仍在——在消息自己的
       * 操作里，见 `MessageActions`——只是不再摆在一句失败旁边勾着人点。
       */}

      {/*
       * Only where the reply actually ends.
       *
       * One answer is often several assistant messages: the model says what it is about to do,
       * calls a tool, reads the result, says the next thing. Those middle messages end with
       * `toolUse` — they are the sentence before the work, not the end of the answer — and each
       * one was getting its own timestamp and copy button, so a single reply came back stamped
       * four times. The row belongs to the message that finished the turn.
       */}
      {!lead && settled(message.stopReason) && !continued && <TurnDeliveryCard timestamp={message.timestamp} />}
      {!lead && settled(message.stopReason) && !continued && text.trim() && (
        <MessageActions
          timestamp={message.timestamp}
          text={text}
          durationMs={turnStats?.durationMs ?? message.durationMs}
          sseDurationMs={turnStats?.sseDurationMs ?? message.sseDurationMs}
          tokens={turnStats?.outputTokens ?? message.usage?.output}
        />
      )}
    </div>
  );
}
