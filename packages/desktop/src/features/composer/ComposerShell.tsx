import { motionReduced } from "../../ui/motion/reduced.ts";
import { Textarea } from "../../ui/inputs/NativeField.tsx";
import { useFieldFade } from "../../ui/inputs/useFieldFade.ts";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { CommandText } from "./CommandText.tsx";
import type { ComposerDecorations } from "./CommandText.tsx";
import { pickedFrom, type PickedFile } from "./attachments/picked.ts";
import { OverlayScrollbar } from "../../ui/scroll/OverlayScrollbar.tsx";
import { FIT_LEVELS, FIT_PROBE, settle, tight } from "./fit.ts";
import { ROLL_VALUE } from "../../ui/motion/RollingText.tsx";
import { useI18n } from "../../i18n/index.ts";

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
  /**
   * 一行小字，贴在框内的最上沿。
   *
   * 和 `attachments` 分开，是因为它们说的不是一回事：附件是这条消息的一部分，会跟着发出去；这里
   * 放的是关于输入框此刻状态的旁白（翻到第几条历史了），发出去的东西里没有它。挤进同一个槽，
   * 「这条消息带了什么」就再也读不准了。
   */
  hint,
  left,
  right,
  onFiles,
  onKeyDown,
  onContextMenu,
  fieldRef,
	decoration,
	onSelect,
	onFocus,
	onBlur,
	commandMenu,
	onAttachmentClick,
}: {
	onAttachmentClick?: (index: number, rect?: DOMRect) => void;
	decoration?: ComposerDecorations;
	onSelect?: () => void;
	onFocus?: () => void;
	onBlur?: () => void;
	commandMenu?: { id: string; active: number; open: boolean };
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  disabled?: boolean;
  autoFocus?: boolean;
  attachments?: React.ReactNode;
  hint?: React.ReactNode;
  left?: React.ReactNode;
  right?: React.ReactNode;
  /**
   * Supplied only where attachments are accepted; enables paste and drop.
   *
   * Files *with their paths*, read here rather than by the caller — `pathForDrop` has to run while
   * the `DataTransfer` is still alive, and this is the last place that is true. A caller receiving
   * a bare `FileList` could no longer find out where any of it came from.
   */
  onFiles?: (files: PickedFile[]) => void;
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
   * 右键点在字上。
   *
   * 给附件标记用：被点到的是这个 textarea，而标记画在铺于其上的镜像层里，那一层整层不接事件。谁在
   * 那个坐标下面，只能由调用方按字符偏移去问。
   */
  onContextMenu?: (event: React.MouseEvent<HTMLTextAreaElement>) => void;
  /**
   * The field itself, for a caller that has to put the caret in it.
   *
   * Text can arrive here from outside — a suggestion card, a review being opened — and landing it
   * without the focus leaves the user looking at a sentence they now have to click on before they
   * can change a word of it. Optional: only the caller that needs it passes one.
   */
  fieldRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
	const { t } = useI18n();
  const own = useRef<HTMLTextAreaElement>(null);
  const field = fieldRef ?? own;
	const mirror = useRef<HTMLDivElement>(null);
	/*
	 * 两头化开的那两个长度，写在 `.ly-scroll-host` 上。
	 *
	 * 写在外壳而不是 textarea 上，是因为这里的字有**两层**：底下的 textarea，和铺在它上面画命令、
	 * 引用、附件标记的镜像层。两层必须虚化得一模一样，否则打着 `/` 或带着附件的时候，滚到顶上会
	 * 看见一层淡了另一层还在。变量是可继承的，写一处，两层各自读同一个数。
	 */
	const scroller = useRef<HTMLDivElement>(null);
	useFieldFade(field, scroller);
	const [composing, setComposing] = useState(false);
	/*
	 * 正在组字的那几个字母在哪儿。
	 *
	 * 组字期间 textarea 的字仍然是透明的，画字的还是镜像层——所以镜像层得知道这一段是「还没上屏
	 * 的」，给它画上输入法那条下划线。起点在 `compositionstart` 那一刻定下：那时光标就在组字要开
	 * 始的地方（选中一段再打字的话，选区起点就是它）。往后每次 update 只有长度在变。
	 */
	const [composed, setComposed] = useState<{ start: number; end: number } | null>(null);
	/*
	 * 有东西要画才铺镜像层。
	 *
	 * 三样都要问：命令、引用、附件标记。漏掉任何一样的后果都一样——那一段在屏幕上是纯黑的普通文字，
	 * 而装饰数据算得好好的。附件标记就是这么漏过一次的。
	 *
	 * 组字**不**在撤下它的理由之列。一度是的——组字时整层摘掉，textarea 的字跟着变回不透明，于是
	 * 打中文的全过程里每一枚 `【图片 1】` 都塌回成一串方括号加文件名，一个字上屏才变回来。而中文
	 * 是每个字都要过一次组字的：那等于「打字时标记一直是坏的」，只有停下手才好。
	 *
	 * 不撤是成立的，因为组字中的字母**已经在受控的 `value` 里**（Chromium 组字期间照常发 `input`，
	 * 量过：打到 `zhe` 时 value 就是 `…】zhe`，选区也同步）。镜像层照着 value 画，画出来和底下严
	 * 丝合缝，人看见的仍然是自己正在打的那几个字母。
	 */
	const highlighted =
		decoration && (Boolean(decoration.command) || Boolean(decoration.mentions?.length) || Boolean(decoration.attachments?.length))
			? { ...decoration, ...(composed ? { composing: composed } : {}) }
			: undefined;
	const syncMirror = () => {
		if (mirror.current && field.current) mirror.current.style.transform = `translateY(${-field.current.scrollTop}px)`;
	};
	useLayoutEffect(syncMirror);

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
    /*
     * One level in from the handle, where the overflow actually is.
     *
     * The probe is a `RollingText`, and it is the box *inside* it that elides — see the
     * `.truncate .ly-roll-value` rule in styles.css. That box is width-bound by the wrapper, so the
     * wrapper's own `scrollWidth` never exceeds its `clientWidth`: measuring it would report a row
     * that fits at every width, and the toolbar would stop adapting entirely.
     *
     * Falling back to the handle so a probe that is not a rolling label still measures something.
     */
    const handle = row?.querySelector(`.${FIT_PROBE}`) ?? null;
    const probe = handle?.querySelector(`.${ROLL_VALUE}`) ?? handle;
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
   *
   * 下限不在这里定：`min-height` 读设置里的行数，见 `misc.css` 的 `.ly-composer-text`。这里只
   * 需要认得它——`height: auto` 之后量到的 `clientHeight` 就是那条线，上限再低也不能低过它，
   * 否则一个还没打字的框自己就在滚。
   */
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    const resize = () => {
			const previous = el.getBoundingClientRect().height;
			const transition = el.style.transition;
			el.style.transition = "none";
      el.style.height = "auto";
      const floor = el.clientHeight;
      const ceiling = Math.max(floor, Math.min(300, window.innerHeight * 0.34));
      el.style.maxHeight = `${ceiling}px`;
			const target = Math.min(el.scrollHeight, ceiling);
      el.style.overflowY = el.scrollHeight > ceiling ? "auto" : "hidden";
			// Latch a numeric starting size; auto-to-pixels cannot interpolate on supported hosts.
			if (previous > 0 && !motionReduced()) {
				el.style.height = `${previous}px`;
				void el.offsetHeight;
			}
			el.style.transition = transition;
			el.style.height = `${target}px`;
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
              // 同步读，就在这儿：事件返回之后 `DataTransfer` 就空了，路径也就无从问起。
              onFiles(pickedFrom(e.dataTransfer.files));
            }
          : undefined
      }
    >
      {hint}
      {attachments}

      {/*
       * The field scrolls once it hits its ceiling, so it needs the app's thumb like every
       * other scroller. Native bars are hidden globally, which left a long draft scrolling
       * with nothing to say so — and no way to see how much of it was above the fold.
       */}
      <div ref={scroller} className="ly-scroll-host relative">
				{highlighted && <CommandText value={value} decoration={highlighted} mirror={mirror} />}
        <Textarea
          ref={field}
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
					onSelect={onSelect}
					onFocus={onFocus}
					onBlur={onBlur}
					onScroll={syncMirror}
					onCompositionStart={(e) => {
						/*
						 * 属性当场写一次，不等这一轮渲染。
						 *
						 * 读它的是别处那条光标夹取（`Composer` 里挂在 `selectionchange` 上的那个）：组字期
						 * 间谁去动一下选区，输入法当场就散了。而组字的第一次选区变化和 `compositionstart`
						 * 是同一帧的事，等 React 把 state 渲染出来已经晚了一步。下面那行 `data-composing`
						 * 才是真正管着它的人，这里只是把它提前到这一刻。
						 */
						e.currentTarget.dataset.composing = "";
						setComposing(true);
						const at = e.currentTarget.selectionStart;
						setComposed({ start: at, end: at });
					}}
					onCompositionUpdate={(e) =>
						setComposed((was) => {
							const start = was?.start ?? e.currentTarget.selectionStart - e.data.length;
							return { start, end: start + e.data.length };
						})
					}
					onCompositionEnd={(e) => {
						delete e.currentTarget.dataset.composing;
						setComposing(false);
						setComposed(null);
					}}
					data-highlighted={Boolean(highlighted)}
					data-composing={composing ? "" : undefined}
					role={commandMenu ? "combobox" : undefined}
					aria-label={t("composer.message")}
					aria-autocomplete={commandMenu ? "list" : undefined}
					aria-expanded={commandMenu?.open}
					aria-controls={commandMenu?.open ? commandMenu.id : undefined}
					aria-activedescendant={commandMenu?.open ? `${commandMenu.id}-${commandMenu.active}` : undefined}
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
                  onFiles(pickedFrom(e.clipboardData.files));
                }
              : undefined
          }
          onContextMenu={onContextMenu}
          onMouseMove={(e) => {
            if (composing || e.buttons !== 0) return;
            const target = e.currentTarget;
            const mirrorEl = target.closest(".ly-composer")?.querySelector("[data-command-mirror]");
            const tokens = [...(mirrorEl?.querySelectorAll(".ly-attachment-token") ?? [])];
            let hitIdx = -1;
            for (let i = 0; i < tokens.length; i++) {
              const token = tokens[i];
              const hit = [...token.getClientRects()].some(
                (rect) =>
                  e.clientX >= rect.left &&
                  e.clientX <= rect.right &&
                  e.clientY >= rect.top &&
                  e.clientY <= rect.bottom,
              );
              if (hit) {
                hitIdx = i;
                break;
              }
            }
            tokens.forEach((token, idx) => {
              token.toggleAttribute("data-hovered", idx === hitIdx);
            });
            if (hitIdx >= 0) {
              target.style.cursor = "pointer";
            } else {
              target.style.cursor = "";
            }
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.cursor = "";
            const mirrorEl = e.currentTarget.closest(".ly-composer")?.querySelector("[data-command-mirror]");
            mirrorEl?.querySelectorAll(".ly-attachment-token[data-hovered]").forEach((token) => {
              token.removeAttribute("data-hovered");
            });
          }}
          onClick={(e) => {
            if (composing) return;
            const mirrorEl = e.currentTarget.closest(".ly-composer")?.querySelector("[data-command-mirror]");
            const tokens = [...(mirrorEl?.querySelectorAll(".ly-attachment-token") ?? [])];
            let hitRect: DOMRect | undefined;
            const at = tokens.findIndex((token) =>
              [...token.getClientRects()].some((rect) => {
                const match =
                  e.clientX >= rect.left &&
                  e.clientX <= rect.right &&
                  e.clientY >= rect.top &&
                  e.clientY <= rect.bottom;
                if (match) hitRect = rect;
                return match;
              }),
            );
            if (at >= 0 && onAttachmentClick) {
              e.preventDefault();
              onAttachmentClick(at, hitRect);
            }
          }}
          onKeyDown={(e) => {
						if (composing || e.nativeEvent.isComposing || e.keyCode === 229) return;
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
          className="ly-composer-text ly-field-fade relative block max-h-[min(300px,34vh)] w-full resize-none bg-transparent placeholder:text-ink-faint"
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
      <div ref={bar} data-ly-fit={fit} className="ly-composer-bar flex items-center justify-between gap-1">
        <div className="flex shrink-0 items-center gap-1">{left}</div>
        <div className="flex min-w-0 shrink items-center gap-1">{right}</div>
      </div>
    </div>
  );
}

/** One stable button lets the icon and colours interpolate when the run changes state. */
export function ComposerSend({ running, disabled, onSend, onStop, continueReady = false, tip, active = true }: {
	running: boolean;
	continueReady?: boolean;
	disabled?: boolean;
	onSend: () => void;
	onStop: () => void;
	tip?: string;
	active?: boolean;
}) {
	const { t } = useI18n();
	const mode = running ? "stop" : continueReady ? "continue" : "send";
	const label = running ? t("composer.stop") : tip ?? t("composer.send");
	return <button type="button" data-composer-send={active ? mode : undefined} data-ly-tip={label} aria-label={label}
		disabled={!running && disabled} onClick={running ? onStop : onSend}
		className={`ly-composer-control ly-composer-icon relative flex shrink-0 items-center justify-center rounded-full transition-all duration-[var(--ly-t-quick)] ${running ? "bg-ink text-shell hover:opacity-85" : "bg-elevated text-ink enabled:hover:bg-ink enabled:hover:text-shell disabled:opacity-45"}`}>
		<span className="ly-send-icon" data-active={mode === "stop"}><svg width="11" height="11" viewBox="0 0 11 11" aria-hidden><rect width="11" height="11" rx="1.5" fill="currentColor" /></svg></span>
		<span className="ly-send-icon" data-active={mode === "continue"}><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M5 3.5 12.5 8 5 12.5Z" fill="currentColor" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" /></svg></span>
		<span className="ly-send-icon" data-active={mode === "send"}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 19V5M5 12l7-7 7 7" /></svg></span>
	</button>;
}
