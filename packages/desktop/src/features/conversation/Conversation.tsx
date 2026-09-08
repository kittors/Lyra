import { translate } from "../../i18n/translate.ts";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ApprovalOverlay } from "./ApprovalOverlay.tsx";
import { BackToLatest } from "./BackToLatest.tsx";
import { Composer } from "../composer/index.ts";
import { ResumeRow } from "./ResumeRow.tsx";
import { HiccupRow } from "./HiccupTrace.tsx";
import { RuleSuggestion } from "./RuleSuggestion.tsx";
import { RunningIndicator } from "./RunningIndicator.tsx";
import { TaskList } from "../task/index.ts";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { useAnswering } from "./useAnswering.ts";
import { isNudge, runs, runKey } from "./grouping.ts";
import { ToolRun as ToolRunGroup, WINDOW_STEP } from "./runs.tsx";
import { CommandRunRow } from "./CommandRunRow.tsx";
import { QuestionNav } from "./QuestionNav.tsx";
import { questionsIn, timeSeparators } from "./question-navigation.ts";
import { MessageRow } from "./rows.tsx";
import { useTranscriptWindow } from "./view-state.ts";
import { useFollowBottom } from "../../ui/scroll/useFollowBottom.ts";
import { tailSignature } from "../../ui/scroll/signature.ts";
import { useLayout } from "../../app/layout.tsx";
import { useApp } from "../../store/index.ts";

/**
 * Nothing about the window's shape belongs to the transcript.
 *
 * The transcript takes no props: everything it draws comes from the store, and the store tells it
 * directly when that changes. But it is mounted inside the dock, and the dock is re-rendered by
 * every drag — a pane's boundary, a pane being carried, the sidebar's edge — so a fresh element
 * was handed down forty-five times a second and React rebuilt several hundred rows behind it, each
 * one re-parsing its markdown. Dragging the sidebar across a long session cost 470KB of re-parsed
 * prose per gesture. A memo boundary here is one comparison of two empty objects, and it is where
 * the layout stops being the transcript's business.
 */
/**
 * The width below which the question rail stops getting a column of its own.
 *
 * Indenting the text 48px to clear the rail costs a tenth of a 520px column and nothing worth
 * noticing above it — and the right side is padded 16px whatever happens, so the whole difference
 * lands as the transcript sitting visibly right of centre. Below this the rail goes against the
 * edge and both sides get 28px.
 */
const NARROW_COLUMN = 520;

export const Conversation = memo(function Conversation() {
  const messages = useApp((s) => s.messages);
  const running = useApp((s) => s.running);
  const compactions = useApp((s) => s.compactions);
	const commandRuns = useApp((s) => s.commandRuns);
	/*
	 * 这一轮里连接抖过没有，以及最后怎么了。
	 *
	 * 和压缩标记、命令边界一起交给 `runs`，因为它们是同一种东西：转录里按位置插进去的一条记录。
	 * 从前它是转录末尾单独的一丛，一律挂在运行指示器底下——那让一句「重连 2 次后恢复」站在了「此刻」
	 * 的位置上，而它说的是四十分钟前的事。见 `HiccupTrace`。
	 */
	const hiccups = useApp((s) => s.hiccups);
	const compacting = commandRuns.some((command) => command.status === "running");
  /*
   * How many tool calls there are, and how many have stopped running.
   *
   * Both halves matter and only the first used to be here. A call settling changes the card —
   * output replaces the spinner, a duration appears, an error opens — without touching a message
   * and without changing how many calls exist, so a signature built from the count alone was
   * identical either side of the one moment a tool card changes size the most.
   *
   * Still a count rather than the map: a streamed chunk moves neither number, which is what keeps
   * the layout effect off the per-token path. Growth inside a running card is left to the resize
   * observer, which is what it is for.
   *
   * Returned as a string so the selector compares by value; an object would be a new identity on
   * every store change and re-render the transcript for each one.
   */
  const toolProgress = useApp((s) => {
    let total = 0;
    let settled = 0;
    for (const run of Object.values(s.toolRuns)) {
      total += 1;
      if (run.status !== "running") settled += 1;
    }
    return `${total}/${settled}`;
  });
  const activeSessionId = useApp((s) => s.activeSessionId);
  const loadingSession = useApp((s) => s.loadingSession);
  const allRuns = useMemo(() => runs(messages, compactions, commandRuns, hiccups), [messages, compactions, commandRuns, hiccups]);
  const separators = useMemo(() => timeSeparators(messages), [messages]);
  const questions = useMemo(() => questionsIn(messages), [messages]);
  const range = useTranscriptWindow(activeSessionId, WINDOW_STEP, allRuns.length);
  const [jump, setJump] = useState<{ sessionId: string | null; index: number } | null>(null);
  const { compact } = useLayout();
  /*
   * The floating card needs its own width plus a readable column left over beside it.
   * 320 for the card, 32 for the gap it keeps from the edge, and 420 of text — below that the
   * reply is a ribbon and the card should go and sit above the composer instead.
   */
  const column = useRef<HTMLDivElement>(null);
  const [roomToFloat, setRoomToFloat] = useState(false);
  /*
   * Too narrow to spend 48px on the question rail and leave the column looking centred.
   *
   * Asked of this column, not of the window. A 1400px window with the sidebar and a file panel
   * open leaves the transcript 460px wide, and 48 against 16 is just as lopsided there as it is on
   * a 380px window — the window is simply not what the reader is looking at. Below this the rail
   * moves to the very edge and the padding goes symmetric; see `QuestionNav`.
   */
  const [narrowColumn, setNarrowColumn] = useState(false);
  useEffect(() => {
    const element = column.current;
    if (!element) return;
    let frame = 0;
    const read = () => {
      setRoomToFloat(element.clientWidth >= 320 + 32 + 420);
      setNarrowColumn(element.clientWidth < NARROW_COLUMN);
    };
    const measure = () => {
      if (document.documentElement.hasAttribute("data-resizing")) {
        // Debounce / coalesce measurement during resizing drags so we don't trigger layout thrashing
        if (!frame) {
          frame = requestAnimationFrame(() => {
            frame = 0;
            read();
          });
        }
        return;
      }
      read();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  /**
   * The final answer is arriving right now.
   *
   * This is the moment the running indicator stops being informative and starts being noise — and
   * it lasts exactly as long as words are actually landing. Asked of the tail of the transcript and
   * of the clock, because the two ways it comes apart from "this reply has some text in it" are
   * both ordinary: a call appended after a sentence, and a stream that goes quiet. Both left the
   * line folded for the rest of a turn that was still running. See `conversation/answering.ts`.
   */
  const answering = useAnswering(messages);

  /*
   * Following the bottom, and everything that decides whether to.
   *
   * All of it used to be here: a `pinnedToBottom` ref recomputed from `scrollTop` on every event, a
   * hand-rolled glide, a `missed` flag set from the fact that the messages array had been
   * reassigned. Three surfaces had their own copy of it and none of them agreed. See
   * `scroll/follow.ts` for the rule and `docs/2026-09-02-scroll-follow-design.md` for the four
   * reported bugs that came out of deriving the reader's intention from pixels the program also
   * writes.
   */
  const follow = useFollowBottom({
    surfaceId: activeSessionId,
    namespace: "transcript",
    ready: !loadingSession,
    count: messages.length + commandRuns.length,
    /*
     * What "something arrived" means here.
     *
     * `toolProgress` is folded in because a card appearing *or completing* changes the page without
     * touching a message — see its selector above for why both numbers are needed.
     */
    tail: tailSignature(messages, toolProgress),
  });
  const scrollRef = follow.scrollRef;

  /*
   * Sending puts you back at the bottom, wherever you had scrolled to.
   *
   * Reading back through a conversation and then asking something is ordinary, and the reply to
   * it arrives at the end — so staying where you were means watching a screen on which nothing
   * appears to happen. Your own message is the one thing you can be certain you want to see.
   */
  const pending = useApp((s) => s.pendingUserMessage);
  const { returnToBottom } = follow;
  useLayoutEffect(() => {
    if (!pending && !compacting) return;
    range.latest();
    returnToBottom();
    // The pending object identifies one submission; changing the window is not a new submission.
    // oxlint-disable-next-line exhaustive-deps
  }, [pending, compacting, returnToBottom]);


  /*
   * Recomputed when the transcript changes, not on every render.
   *
   * A streaming reply re-renders this component on every token; without the memo each one walked
   * the whole message list again and handed every row a freshly built object, so React rebuilt
   * three hundred rows to show one more word arriving.
   */
  const hidden = range.start;
  const visibleRuns = allRuns.slice(range.start, range.end);
  const { scrollTo, detach } = follow;
  useLayoutEffect(() => {
    if (!jump || jump.sessionId !== activeSessionId) return;
    const el = scrollRef.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>(`[data-question-index="${jump.index}"]`);
    if (!target) return;
    scrollTo(el.scrollTop + target.getBoundingClientRect().top - el.getBoundingClientRect().top - 40, true);
    setJump(null);
  }, [jump, activeSessionId, range.start, range.end, scrollRef, scrollTo]);

  return (
    <div ref={column} className="flex min-h-0 flex-1 flex-col">
      {/*
       * The transcript and the button that scrolls it, in a box of their own.
       *
       * This used to be the same box as the composer, and `bottom` measured from the bottom of
       * *that* — so the button sat inside the field you type in rather than above the last
       * message. What it offers is about the transcript, so the transcript is what it is
       * positioned against.
       */}
      <div className="@container relative flex min-h-0 flex-1 flex-col">
      {/*
       * Over the transcript when there is room beside it, in the column when there is not.
       *
       * The plan is a companion to the conversation rather than part of it: it is one thing that
       * keeps changing, not another entry in a log, so it holds a fixed corner instead of
       * scrolling away with the messages that happened to be on screen when it was written. Below
       * the breakpoint there is no corner to spare — the transcript needs its full width — so it
       * moves to the one place that is always visible, just above where you type.
       */}
      {/*
       * Floating only when it can float clear of the words.
       *
       * The window being wide is not the same as this column being wide: open the side panel and
       * the transcript can be 600px inside a 1400px window, at which point a 320px card in the
       * corner is sitting on top of the reply rather than beside it. Measured here, against the
       * column it would cover.
       */}
      {roomToFloat && (
        <div className="pointer-events-none absolute top-3 right-4 z-20 w-[320px]">
          <TaskList placement="floating" />
        </div>
      )}

      <Scroller
        className="flex-1"
        scrollRef={scrollRef}
        /*
         * The rail's room comes out of the column, so in a narrow column it comes out even.
         *
         * `pl-12 pr-4` clears the question rail on the left and leaves the right alone, which reads
         * as centred in a wide column and as visibly off-centre in a narrow one: 48 against 16 is a
         * twelfth of a 380px pane, and the whole transcript sits to the right of its own box. Below
         * `NARROW_COLUMN` the rail moves to the very edge and 28px each side clears it evenly.
         */
        contentClassName={questions.length > 1 ? (narrowColumn ? "px-7" : "pl-12 pr-4 @min-[600px]:pr-8") : compact ? "px-4" : "px-8"}
        onScroll={follow.onScroll}
        onResize={follow.onResize}
        onUserScroll={follow.onUserScroll}
      >
        {/* Historical rows must never replay entrance motion when revisited. */}
        <div
          /* `--ly-bottom-inset` keeps 「回到最新」 off the newest message; see `styles/scroll.css`. */
          className="ly-transcript ly-no-enter mx-auto w-full max-w-[var(--ly-content)] pt-5 pb-[var(--ly-bottom-inset)]"
          aria-busy={loadingSession}
        >
          {/*
           * Runs of tool calls are gathered across messages, not just inside one.
           *
           * A model that calls a tool, reads the result and calls the next one produces a fresh
           * assistant message every time. Grouping within a message therefore caught parallel
           * batches and missed sequential ones — which is the common case, and the one that
           * fills the transcript with a column of near-identical cards. A message carrying text
           * ends the run, because that is the model saying something worth reading.
           */}
          {/*
           * Only the tail is mounted until you ask for the rest.
           *
           * A day-long session runs to thousands of messages, each with its own cards and
           * expanders. Mounting all of them costs memory that never comes back and makes every
           * repaint walk the whole tree, which is what turns scrolling to treacle. The recent
           * end is what anyone is reading; the rest is one click away and stays unmounted until
           * then.
           */}
          {loadingSession && <div role="status" className="text-label text-ink-faint">{translate("conversation.loading")}</div>}
          {hidden > 0 && (
            <button
              type="button"
              onClick={range.earlier}
              className="mb-4 flex h-7 w-full items-center justify-center rounded-md text-detail text-ink-faint transition-colors hover:bg-card-hover hover:text-ink-muted"
            >
              {translate("conversation.showEarlier", { n: Math.min(hidden, WINDOW_STEP), total: hidden })}
            </button>
          )}

          {visibleRuns.map((run) =>
            /*
						 * Automatic compaction belongs on the running indicator. An explicitly submitted
						 * command keeps its own result, so the user can verify the action they requested.
             */
            run.kind === "compaction" ? null : run.kind === "command" ? <CommandRunRow key={`${activeSessionId}:${runKey(run)}`} command={run.command} /> : run.kind === "hiccup" ? (
              <HiccupRow key={`${activeSessionId}:${runKey(run)}`} hiccup={run.hiccup} />
            ) : run.kind === "message" ? (
              <MessageRow
                key={`${activeSessionId}:${runKey(run)}`}
                viewKey={runKey(run)}
                showTime={separators.has(run.index)}
                message={run.message}
                index={run.index}
                upTo={run.upTo}
                from={run.from}
                lead={run.lead}
                newest={run.newest}
                /* A turn the runtime carried straight on from did not end where it stopped. */
                continued={isNudge(messages[run.index + 1])}
                /* Computed with the grouping, so its identity changes only when the transcript
                 * does — see `Run` in `grouping.ts` for what recomputing it here used to cost. */
                turnStats={run.turnStats}
              />
            ) : (
              /* Keyed on the first call, not the position: inserting anything above must not
               * make React tear this run down and build it again. */
              <ToolRunGroup
                key={`${activeSessionId}:${runKey(run)}`}
                calls={run.calls}
                /*
                 * The run being worked on keeps its highlight moving — and only that one, so the
                 * transcript never claims two things are happening at once.
                 *
                 * Which run that is comes from `grouping.ts`, because it is a question about the
                 * shape of the turn rather than about the position of a row. Asking it here, as
                 * "the last run on screen", is what left a finished run gliding through the whole
                 * of the next reply: a new question does not move the last run, so the highlight
                 * simply stayed where the previous turn had left it.
                 *
                 * `running` is still asked separately: the newest work in a turn that has ended is
                 * still the newest work, and nothing should glide once the turn is over.
                 */
                live={running && Boolean(run.live)}
              />
            ),
          )}

          {/*
           * Present for the whole turn — until the answer starts, at which point it has been
           * overtaken by what it was standing in for.
           *
           * It stays put through the parts of a turn: it used to appear only when the last message
           * had settled, so it came and went with every tool call, and its 46px came and went with
           * it, shifting the transcript up and down all through a turn.
           *
           * But once prose is streaming in above it, "Nearly there…" is describing something the
           * reader can already see the end of. Sitting under a finished answer saying almost-done
           * reads as the app having lost track of itself.
           *
           * Folded rather than removed, so the height goes continuously — which is the whole
           * reason it was made to stay put in the first place.
           */}
          {range.end < allRuns.length && <button type="button" onClick={range.later} className="my-3 flex h-7 w-full items-center justify-center rounded-md text-detail text-ink-faint transition-colors hover:bg-card-hover hover:text-ink-muted">{translate("conversation.showLaterN", { n: Math.min(WINDOW_STEP, allRuns.length - range.end) })}</button>}
          {range.end === allRuns.length && <>
          <div className="ly-reveal" data-open={running && !answering && !compacting} aria-hidden={!running || answering || compacting}>
            <div>
              <div>{running && !compacting && <RunningIndicator />}</div>
            </div>
          </div>
          {/* Where the running indicator would have been, saying why it is not there. */}
          <ResumeRow />
          {/*
           * 「要把这次纠正变成一条规则吗？」——在转录末尾，而且只在一轮结束之后。
           *
           * 位置就是这个功能的一半。它问的是刚刚那次交流，所以贴着刚刚那次交流的末尾；而中途
           * 弹出来的选择，人会为了让它消失而随手点掉。
           */}
          <RuleSuggestion />
          {/*
           * The end of the transcript, as an element.
           *
           * Marking the newest message read is the one question that cannot be answered by
           * arithmetic: someone who scrolls up two screens, reads the paragraphs that arrived and
           * stops there has caught up, and no distance-from-bottom test tells that apart from
           * someone who has not. This entering the viewport is the fact itself. Zero height, so it
           * changes nothing about the layout it reports on.
           */}
          <div ref={follow.tailRef} aria-hidden className="h-px w-full shrink-0" />
          </>}
        </div>
      </Scroller>

      {/*
       * Over the transcript's last few pixels, not in the flow.
       *
       * A button that took a row of its own would push the transcript up by its own height the
       * moment it appeared, and a control offering to move you should not itself move the thing
       * it is about.
       */}
      {questions.length > 1 && <QuestionNav key={activeSessionId} questions={questions} viewport={scrollRef} edge={narrowColumn} onSelect={(index) => {
        const at = allRuns.findIndex((run) => run.kind === "message" && run.index === index);
        if (at < 0) return;
        detach();
        range.reveal(at);
        setJump({ sessionId: activeSessionId, index });
      }} />}
      <BackToLatest
        show={follow.away || range.end < allRuns.length}
        unread={follow.unread}
        onClick={() => { range.latest(); follow.returnToBottom(); }}
      />
      </div>

      {/*
       * Approvals sit directly above the composer.
       *
       * They used to be pinned to the bottom of the whole pane, which put them over the field
       * you type in — the one control you might want while deciding, and the place your eye is
       * already resting. Anchored to the composer instead, they push nothing around and cover
       * nothing: the decision sits between the transcript that prompted it and the box you
       * would answer in.
       */}
      <div className="relative shrink-0">
        <ApprovalOverlay />
        {!roomToFloat && (
          <div className={`${compact ? "px-4" : "px-8"} pb-1.5`}>
            <div className="mx-auto w-full max-w-[var(--ly-content)]">
              <TaskList placement="inline" />
            </div>
          </div>
        )}
        <Composer />
      </div>
    </div>
  );
});

/**
 * Stand-in for a transcript that is still being read off disk.
 *
 * Opening a stored session replays its whole log and starts its MCP servers. The selection in
 * the sidebar lands immediately; without something here the main column would show the empty
 * state in the meantime, which reads as "this session has no messages".
 */
export function ConversationSkeleton() {
  const { compact } = useLayout();
  // Uneven widths so it reads as prose rather than as a loading bar.
  const rows = [72, 94, 61, 88, 47];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={`ly-defer-in min-h-0 flex-1 overflow-hidden ${compact ? "px-4" : "px-8"}`}
        aria-busy
      >
        <div className="mx-auto w-full max-w-[var(--ly-content)] py-5">
          <div className="ly-pulse flex flex-col gap-3">
            <div className="ml-auto h-[38px] w-[45%] rounded-[16px] rounded-br-[6px] bg-card" />
            {rows.map((width, index) => (
              <div
                key={index}
                className="h-[13px] rounded bg-card"
                style={{ width: `${width}%` }}
              />
            ))}
            <div className="mt-2 h-[38px] w-full rounded-[11px] bg-card" />
          </div>
        </div>
      </div>

      <Composer />
    </div>
  );
}
