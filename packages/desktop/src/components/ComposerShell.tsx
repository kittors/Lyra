import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { OverlayScrollbar } from "./OverlayScrollbar.tsx";
import { FIT_LEVELS, FIT_PROBE, settle, tight } from "./composer/fit.ts";

/**
 * The surface you type into, wherever you are typing.
 *
 * One component rather than two sets of matching class strings. The main composer and the side
 * chat's had drifted — different radius, different padding, different button heights, so the
 * two sat at different heights beside each other and read as parts of different applications.
 * Anything that is the same about them is now the same by construction, and what differs is
 * only what genuinely differs: which controls sit along the bottom.
 *
 * `left` and `right` are those controls. Left is context — what this will run against; right is
 * action — what happens when you commit.
 */
export function ComposerShell({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  autoFocus,
  /** Rendered above the field, for image thumbnails. */
  attachments,
  left,
  right,
  onFiles,
  onKeyDown,
  fieldRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  disabled?: boolean;
  autoFocus?: boolean;
  attachments?: React.ReactNode;
  left?: React.ReactNode;
  right?: React.ReactNode;
  /** Supplied only where attachments are accepted; enables paste and drop. */
  onFiles?: (files: FileList | null) => void;
  /**
   * First refusal on every keystroke, for whatever is floating above the field.
   *
   * The slash-command list needs the arrow keys and Enter while it is open, and it is owned by
   * the composer rather than by this component — so it has to be able to take them before the
   * field's own handling runs. Calling `preventDefault` is how it says it did: this checks for
   * that rather than for a return value, because that is already what stops the browser from
   * acting on a key and there is no sense in having two ways to say the same thing.
   */
  onKeyDown?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  /**
   * The field itself, for a caller that has to put the caret in it.
   *
   * Text can arrive here from outside — a suggestion card, a review being opened — and landing it
   * without the focus leaves the user looking at a sentence they now have to click on before they
   * can change a word of it. Optional: only the caller that needs it passes one.
   */
  fieldRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const own = useRef<HTMLTextAreaElement>(null);
  const field = fieldRef ?? own;

  /*
   * How much of the toolbar has had to be given up for what is in it to fit.
   *
   * The walk is done against the live DOM in one synchronous pass rather than one level per render.
   * Rendering each step and re-measuring is the tidier-looking version and it does not work: the
   * thing that changes here is usually a width, and a width changing does not re-render anything.
   * The observer would set the level back to zero, React would see zero where zero already was, skip
   * the render, and the effect that does the measuring would never run again. The row simply stopped
   * adapting after its first layout.
   *
   * So `settle` puts the row into each level itself — the attribute is what the CSS keys off, and
   * reading `scrollWidth` straight after setting it forces the layout to be up to date — and hands
   * React only the answer. The attribute is left as it was found; the state below is what really
   * sets it.
   */
  const bar = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<number>(FIT_LEVELS.all);

  const remeasure = useCallback(() => {
    const row = bar.current;
    const probe = row?.querySelector(`.${FIT_PROBE}`) ?? null;
    if (!row || !probe) return;
    const was = row.getAttribute("data-ly-fit");
    const level = settle((at) => {
      row.setAttribute("data-ly-fit", String(at));
      return tight(probe);
    });
    if (was !== null) row.setAttribute("data-ly-fit", was);
    setFit(level);
  }, []);

  useEffect(() => {
    const row = bar.current;
    if (!row) return;
    const observer = new ResizeObserver(remeasure);
    observer.observe(row);
    return () => observer.disconnect();
  }, [remeasure]);

  /*
   * And after every render, because the row can also outgrow itself without changing size: picking
   * a longer model name is the ordinary way. No dependency array — `remeasure` only calls `setFit`
   * with the level it measured, so a render that changes nothing settles on the same answer and
   * stops.
   */
  useLayoutEffect(remeasure);

  /*
   * Grow with the text, but never past a third of the window.
   *
   * Measured against the window rather than a fixed ceiling because the same component now
   * runs inside a 368px panel and across a full-width column; a 300px field in a short window
   * would leave no transcript above it in either.
   */
  useEffect(() => {
    const el = field.current;
    if (!el) return;
    const resize = () => {
      el.style.height = "auto";
      const maxHeight = Math.min(300, window.innerHeight * 0.34);
      const nextHeight = Math.min(el.scrollHeight, maxHeight);
      el.style.height = `${nextHeight}px`;
      el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [value, field]);

  return (
    <div
      /*
       * No fill of its own. `bg-input` is a grey well; on the conversation page it almost
       * vanished into the shell, and in a dock panel it stacked into a slab. Border and the
       * `.ly-composer` shadow are what lift it; the surface underneath shows through.
       *
       * `@container` so the controls along the bottom can drop labels when *this* runs out
       * of room rather than when the window does. At 1100px wide with a sidebar and a panel
       * open, this field is 350px.
       */
      className="ly-composer @container rounded-[18px] border border-line-soft bg-transparent transition-[border-color,box-shadow] duration-[var(--ly-t-base)]"
      onDragOver={onFiles ? (e) => e.preventDefault() : undefined}
      onDrop={
        onFiles
          ? (e) => {
              e.preventDefault();
              onFiles(e.dataTransfer.files);
            }
          : undefined
      }
    >
      {attachments}

      {/*
       * The field scrolls once it hits its ceiling, so it needs the app's thumb like every
       * other scroller. Native bars are hidden globally, which left a long draft scrolling
       * with nothing to say so — and no way to see how much of it was above the fold.
       */}
      <div className="ly-scroll-host relative">
        <textarea
          ref={field}
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          onPaste={
            onFiles
              ? (e) => {
                  /*
                   * A pasted file is a file, and nothing else.
                   *
                   * macOS puts more than one thing on the pasteboard when a screenshot is copied:
                   * the image, and a `file://` URL pointing at where it was spooled. Taking the
                   * image and letting the paste run its course took both — the picture became an
                   * attachment and the path was typed into the message, so every pasted screenshot
                   * arrived with a line of
                   * `file:///Users/…/CoreSpotlight/PasteboardHistory/2026-08-17_19-40-12.png`
                   * under it. The same is true of anything copied out of Finder.
                   *
                   * Only when there is actually a file: a paste with no files is ordinary text and
                   * must go in as ordinary text.
                   */
                  if (e.clipboardData.files.length === 0) return;
                  e.preventDefault();
                  onFiles(e.clipboardData.files);
                }
              : undefined
          }
          onKeyDown={(e) => {
            onKeyDown?.(e);
            if (e.defaultPrevented) return;
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              onSubmit();
            }
          }}
          rows={1}
          placeholder={placeholder}
          className="block max-h-[min(300px,34vh)] w-full resize-none bg-transparent px-4 pt-3.5 pb-2.5 text-body leading-relaxed text-ink placeholder:text-ink-faint"
        />
        <OverlayScrollbar viewport={field} orientation="vertical" />
      </div>

      {/*
       * One side yields, and it is the side with something that can yield.
       *
       * Both used to shrink, which is a way of saying neither did: everything in `left` is
       * `shrink-0`, so flex squeezed the *box* down to 73px while its contents stayed 124px wide
       * and simply hung out of it — over the model chip, by 47px on a 424px field. That is the
       * overlap, and it is not what it looks like: nothing is being drawn on top of anything, the
       * left group is just narrower than what is inside it.
       *
       * `right` is where the give is, because the model's name is the one thing in this row that
       * can be shorter without being wrong. It shrinks, and when it has shrunk past being readable
       * the row starts dropping the parts that marked themselves droppable.
       *
       * `data-ly-fit` is how much of the row has been given up; the rules in `styles.css` hide the
       * parts that marked themselves droppable. Measured rather than guessed from a width — see
       * `composer/fit.ts`.
       */}
      <div ref={bar} data-ly-fit={fit} className="flex items-center justify-between gap-1 px-3 pt-0 pb-2.5">
        <div className="flex shrink-0 items-center gap-1">{left}</div>
        <div className="flex min-w-0 shrink items-center gap-1">{right}</div>
      </div>
    </div>
  );
}

/** The send / stop button, so both composers commit with the same target. */
export function ComposerSend({
  running,
  disabled,
  onSend,
  onStop,
  tip = "发送",
}: {
  running: boolean;
  disabled?: boolean;
  onSend: () => void;
  onStop: () => void;
  /** Tooltip and accessible name while idle. Stop is always 停止. */
  tip?: string;
}) {
  if (running) {
    return (
      <button
        type="button"
        data-ly-tip="停止"
        aria-label="停止"
        onClick={onStop}
        className="ly-pop flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full bg-ink text-shell transition-all duration-[var(--ly-t-quick)] hover:opacity-85"
      >
        <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden>
          <rect width="11" height="11" rx="1.5" fill="currentColor" />
        </svg>
      </button>
    );
  }
  return (
    <button
      type="button"
      data-ly-tip={tip}
      aria-label={tip}
      disabled={disabled}
      onClick={onSend}
      className="flex h-[27px] w-[27px] shrink-0 items-center justify-center rounded-full bg-elevated text-ink transition-all duration-[var(--ly-t-quick)] enabled:hover:bg-ink enabled:hover:text-shell enabled: disabled:opacity-45"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
    </button>
  );
}
