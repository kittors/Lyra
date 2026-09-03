/**
 * One message, rendered.
 *
 * A user's turn is a bubble; the agent's is a column of blocks — thinking, text, previews — with
 * its timestamp and actions appearing only once the reply has actually ended. A runtime message
 * (the nudge that continues a stalled turn) renders as nothing at all: it was never something a
 * person said, and showing it where a person's messages go is a lie about who is talking.
 */

import { memo, useState } from "react";
import type { AssistantMessage, Message } from "@lyra/core";
import { Markdown } from "./Markdown.tsx";
import { MessageActions } from "./MessageActions.tsx";
import { ThinkingBlock } from "./ThinkingBlock.tsx";
import { UserMessage } from "./UserMessage.tsx";
import { useApp } from "../../store/index.ts";
import { ChevronDown, RotateCcw, TriangleAlert } from "lucide-react";
import { Text } from "../../ui/primitives/Text.tsx";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
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


export function messageKey(message: Message, index: number): string {
  if (message.role === "toolResult") return `tr-${message.toolCallId}`;
  return `${message.role}-${message.timestamp}-${index}`;
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
  continued,
  turnStats,
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
  /** The runtime told it to keep going, so this is a pause rather than a finish. */
  continued?: boolean;
  /** Accumulated statistics for the turn this message concludes. */
  turnStats?: TurnStats;
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
    if (message.synthetic || isNudge(message)) return null;
    return <UserMessage message={message} index={index} />;
  }

  // Tool results are rendered inside their tool card, not as standalone rows.
  if (message.role === "toolResult") return null;

  return (
    <AssistantRow message={message} index={index} upTo={upTo} from={from} continued={continued} turnStats={turnStats} />
  );
});

function AssistantRow({
  message,
  index,
  upTo,
  from = 0,
  continued,
  turnStats,
}: {
  message: AssistantMessage;
  index: number;
  upTo: number;
  from?: number;
  continued?: boolean;
  turnStats?: TurnStats;
}) {
  const running = useApp((s) => s.running);
  const retryFrom = useApp((s) => s.retryFrom);
  /*
   * Whether a failure states itself in full or waits to be asked. See the error block below and
   * 外观 → 出错时显示. Undefined counts as compact, which is what a fresh install gets.
   */
  const compactErrors = useApp((s) => s.settings?.appearance?.errorDetail !== "full");
  const [errorOpen, setErrorOpen] = useState(false);
  const confirm = useConfirmer();

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
            // Ticking while it is the block being written: only the newest block of a reply that is
            // still arriving can be, whatever the message as a whole is doing.
            return (
              <ThinkingBlock
                key={at}
                text={block.thinking}
                redacted={block.redacted === true}
                live={message.stopReason === "pending" && at === message.content.length - 1}
              />
            );
          }
          if (block.type === "text") {
            return block.text ? (
              <div key={at} className="mb-2.5">
                <Markdown text={block.text} />
              </div>
            ) : null;
          }
          return <LiveToolCard key={block.id} block={block} stopReason={message.stopReason} />;
        }

        const calls = segment.blocks.map((block) => ({ block, stopReason: message.stopReason }));
        return <ToolRunGroup key={`group-${position}`} calls={calls} />;
      })}

      {message.stopReason === "error" && message.errorMessage && (
        /*
         * Stated, not staged.
         *
         * The first version of this put a bordered button under the message, which made a
         * dropped socket look like the most important thing on the screen. A failure is worth
         * one line — what went wrong, and the word that undoes it — set at the same weight as
         * the timestamp under every other reply.
         *
         * Compact goes further, and is the default: the wording of the common failure is a stack
         * of provider JSON that nobody reads, and a long session where the connection wobbled a
         * few times reads as a wall of red for something that fixed itself. So it says how many
         * words it is withholding and opens on a click. Set by 外观 → 出错时显示.
         */
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {compactErrors && !errorOpen ? (
            <button
              type="button"
              onClick={() => setErrorOpen(true)}
              className="flex items-center gap-1 rounded text-caption text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:text-ink"
            >
              <TriangleAlert size={10.5} strokeWidth={1.9} className="text-danger" />
              这一轮出错了
              <ChevronDown size={10} strokeWidth={2} />
            </button>
          ) : (
            <Text
              size="caption"
              tone="danger"
              className="break-words whitespace-pre-wrap"
            >
              {message.errorMessage}
            </Text>
          )}
          <button
            type="button"
            disabled={running}
            /*
             * Asked first: this discards the turn rather than resuming it.
             *
             * The word sits at the end of a failure message, where it reads as "undo the error" —
             * and what it actually does is throw away everything the turn had done and pay for the
             * whole thing again. The row underneath offers 继续, which is what most people mean
             * here; see `ResumeRow`.
             */
            onClick={() =>
              confirm.ask({
                title: "重新生成这次回答？",
                detail: (
                  <>
                    这会丢掉本轮已经做过的工作——读过的文件、跑过的命令——并从你最后一条消息重新开始，
                    重新消耗一次 token。
                    <br />
                    想保留这些、从中断处接着做，请用下面那行的「继续」。
                  </>
                ),
                confirmLabel: "重新生成",
                onConfirm: () => void retryFrom(index),
              })
            }
            className="flex items-center gap-1 rounded text-caption text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:text-ink disabled:opacity-40"
          >
            <RotateCcw size={10.5} strokeWidth={1.9} />
            重试
          </button>
          {confirm.element}
        </div>
      )}

      {/*
       * Only where the reply actually ends.
       *
       * One answer is often several assistant messages: the model says what it is about to do,
       * calls a tool, reads the result, says the next thing. Those middle messages end with
       * `toolUse` — they are the sentence before the work, not the end of the answer — and each
       * one was getting its own timestamp and copy button, so a single reply came back stamped
       * four times. The row belongs to the message that finished the turn.
       */}
      {settled(message.stopReason) && !continued && text.trim() && (
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
