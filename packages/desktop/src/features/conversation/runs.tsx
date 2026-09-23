/**
 * Drawing the rows that `grouping.ts` decided on.
 *
 * The grouping itself is plain data and lives next door; what is left here is a card that
 * subscribes to its own tool run and a group that reads the totals across one.
 */

import { memo } from "react";
import type { AssistantContent, AssistantMessage } from "@lyra/core";
import { PreviewCard, type PreviewInfo } from "../files/index.ts";
import { ToolCard } from "./ToolCard.tsx";
import { describeRun } from "./ToolGroup.tsx";
import { ToolGroup } from "./ToolGroup.tsx";
import { useApp, type ToolRun as ToolRunState } from "../../store/index.ts";
import { useScopedRunning } from "../../app/session-scope.tsx";
import { toolCardFallback } from "./tool-status.ts";
import { sameRun, type Call } from "./grouping.ts";
import { baseName } from "../../lib/paths.ts";

/**
 * How much of a long transcript is mounted at once, and how much each "show more" adds — **in turns**.
 *
 * Counted in turns rather than in rows, and that unit is the whole point. The window used to step by
 * 60 `Run`s while the transcript draws in `TurnBlock`s (`grouping.ts`), and a turn can hold hundreds
 * of runs: one session had 400 tool calls between two things the user typed. Paging by row into a
 * turn like that loads 60 rows straight into an already-collapsed block, so the only thing that
 * changes on screen is the number in 「调用工具 N 个」 — four clicks in a row, and the transcript does
 * not move. Now one click always brings whole turns, so it always brings something you can see.
 *
 * Twenty rather than sixty because a turn is worth several rows: its question, its answer, and the
 * one folded line standing in for everything in between. Collapsed turns cost nothing to keep
 * mounted (`TurnProcess` renders nothing while closed), so this number is about how much a person
 * wants to take in at once, not about what the browser can hold.
 */
export const WINDOW_TURNS = 20;

export type Segment =
  | { kind: "block"; block: AssistantContent; index: number }
  | { kind: "tools"; blocks: Extract<AssistantContent, { type: "toolCall" }>[] };

/**
 * Split a reply into runs of tool calls and everything else.
 *
 * Text between two calls is a break in the run — the model stopping to explain is exactly the
 * boundary a reader uses, so folding across it would join two things it deliberately separated.
 */
export function segments(content: AssistantContent[]): Segment[] {
  const out: Segment[] = [];
  for (const [index, block] of content.entries()) {
    if (block.type === "toolCall") {
      const last = out[out.length - 1];
      if (last?.kind === "tools") last.blocks.push(block);
      else out.push({ kind: "tools", blocks: [block] });
    } else {
      out.push({ kind: "block", block, index });
    }
  }
  return out;
}

/**
 * One card, subscribed to its own record and nothing else.
 *
 * Tool output streams: a long install or a test run emits `tool_update` many times a second, and
 * each one replaces the whole `toolRuns` map. Anything reading that map re-renders — so with the
 * map read at the top of the transcript, every chunk of output repainted every message in the
 * conversation. In a session with hundreds of messages that is what made scrolling stutter.
 *
 * Reading one entry means Object.is sees no change for the other cards and they stay put.
 */
export function LiveToolCard({
  block,
  stopReason,
  runs,
}: {
  block: Extract<AssistantContent, { type: "toolCall" }>;
  stopReason: AssistantMessage["stopReason"];
  /**
   * Where to read this call's record, for a transcript that is not the main session's.
   *
   * A sub-agent's tool events never reach the app store — `runSubAgent` emits only the messages it
   * produced — so a card left to look itself up there finds nothing, calls itself an error and
   * shows the raw tool name. The sub-agent panel rebuilds the same records from its own transcript
   * and passes them in.
   */
  runs?: Record<string, ToolRunState>;
}) {
  const stored = useApp((s) => s.toolRuns[block.id]);
  const run = runs ? runs[block.id] : stored;
  /*
   * 这一轮还在不在跑，决定没有记录的卡片怎么说话——见 `tool-status.ts`。
   *
   * 子智能体那份转录（传了 `runs`）不看它：那是一段已经结束的记录，而这里读到的 `running` 是
   * 主会话此刻的状态，拿它去判子智能体的旧卡片，会让它们跟着主会话一起转圈。
   */
  const turnRunning = useScopedRunning();
  /*
   * A preview replaces its own tool card.
   *
   * The card would say "预览已生成" above the thing itself, which is a caption nobody needs —
   * the page is right there, and it is the result.
   */
  const preview = (run?.result?.details as { preview?: PreviewInfo } | undefined)?.preview;
  if (preview) return <PreviewCard preview={preview} />;
  return (
    <ToolCard
      stateKey={runs ? undefined : `tool-${block.id}`}
      toolName={block.name}
      args={block.arguments}
      summary={run?.summary ?? block.name}
      // 没有记录时说什么，以及为什么不能只看这条消息定没定稿：见 `tool-status.ts`。
      status={run?.status ?? toolCardFallback(stopReason, runs ? false : turnRunning)}
      result={run?.result}
      startedAt={run?.startedAt}
    />
  );
}


/**
 * One run of tool work: always a line, never a row of cards.
 *
 * The threshold that used to decide between the two forms is gone. It was the source of the
 * unevenness — the same kind of work looked like two different things depending on how many
 * calls happened to fall together, and the boundary moved as the model chose to batch or not.
 */
const ToolRunGroup = function ToolRun({
  calls,
  live,
  runs,
}: {
  calls: Call[];
  /** Whether this is the run being worked on right now — decided in `grouping.ts`, not here. */
  live?: boolean;
  /** Records for a transcript outside the main session — see `LiveToolCard`. */
  runs?: Record<string, ToolRunState>;
}) {
  /*
   * Primitives, not the map.
   *
   * A selector returning an object builds a new one every time and so always looks changed; a
   * number is compared by value, so this re-renders when what it shows changes and not when some
   * other card emits a line of output.
   */
  /*
   * The glide asks one question: is this the run that is happening now.
   *
   * It used to also light up whenever a call in the group counted as live, and that turned out to
   * mean something else entirely: a call with no recorded result counts as live while its message
   * is still `pending`, so several groups qualified at once and the conversation shimmered in
   * places nothing was happening. Answering it with "the last run in the transcript" was the next
   * attempt, and it was wrong in the other direction — the last run stays the last run after you
   * ask something else, so a finished stretch of work glided through the whole of the next reply.
   *
   * The question is about the turn, so it is answered where the turn's shape is known. See
   * `liveWork` in `grouping.ts`.
   */

  /*
   * One sentence, growing — never a different sentence while it works.
   *
   * A running group used to say what the live call was doing, or "执行 N 个操作" when several
   * were going at once, and go back to describing itself when they finished. Now that a run
   * keeps taking on the calls of the replies that follow it, that line is the *same* line all
   * turn: it would read "读取文件 3 个", then "执行 npm install", then "执行 6 个操作", then
   * "读取文件 3 个、执行命令 2 个" — one row rewriting itself in two different languages while
   * you try to read it. Built from the calls alone, it only ever gains a clause. That the run is
   * still going is said by the highlight gliding along it, which is the one thing a count of
   * events nobody witnessed was standing in for.
   */
  const summary = describeRun(calls.map(({ block }) => ({ toolName: block.name, subject: subjectOf(block) })));
  // Totals across the run, so a fold does not hide how much changed.
  const added = useApp((s) => calls.reduce((n, { block }) => n + diffOf((runs ?? s.toolRuns)[block.id], "added"), 0));
  const removed = useApp((s) => calls.reduce((n, { block }) => n + diffOf((runs ?? s.toolRuns)[block.id], "removed"), 0));

  const cards = calls.map(({ block, stopReason }) => (
    <LiveToolCard key={block.id} block={block} stopReason={stopReason} runs={runs} />
  ));

  return (
    <ToolGroup stateKey={runs ? undefined : `tools-${calls[0].block.id}`} summary={summary} added={added} removed={removed} running={Boolean(live)}>
      {cards}
    </ToolGroup>
  );
}
/**
 * A settled group of tool calls never changes again — but whether it is the *current* one does.
 *
 * Compared by what the group is made of rather than by the array it arrives in: the array is
 * rebuilt on every render of the transcript, but the calls in it are the same objects with the
 * same ids, and a group whose calls are unchanged has nothing new to draw.
 *
 * `live` has to be in here too, and leaving it out is the whole of a bug that survived two
 * attempts at fixing it. It is the one prop that changes *without the calls changing*: a group
 * stops being the current one the moment another begins, and stops being live the moment the turn
 * ends — and in both cases its own calls are exactly as they were. Compared on calls alone, React
 * was told nothing had changed and skipped the render, so the highlight stayed on every group that
 * had ever been the current one, and stayed lit after the turn was over.
 *
 * It also explains why this twice looked fixed when it was not: switching conversations remounts
 * these, and a fresh mount never consults a memo comparison. The failure only shows in the one
 * situation the comparison exists for — a transcript being added to in place.
 *
 * The comparison itself is `sameRun`, in `grouping.ts`, so that the tests can check the one that
 * actually runs instead of a copy of it. See the note there.
 */
export const ToolRun = memo(ToolRunGroup, sameRun);


/** The file a call is about, when it is about one — the part worth naming in a summary. */
function subjectOf(block: Extract<AssistantContent, { type: "toolCall" }>): string | undefined {
  const path = (block.arguments as { path?: unknown } | undefined)?.path;
  // Either separator: a Windows path split on "/" alone came back whole, drive letter and all.
  return typeof path === "string" ? baseName(path) : undefined;
}

function diffOf(run: ToolRunState | undefined, key: "added" | "removed"): number {
  const value = (run?.result?.details as Record<string, unknown> | undefined)?.[key];
  return typeof value === "number" ? value : 0;
}
