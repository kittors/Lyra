/**
 * 标注工具条：选工具、选颜色、选粗细，以及那几个一次性动作。
 *
 * 从 `Annotator.tsx` 拆出来的，那个文件到这一步是 2088 行。拆得动是因为它本来就是三块——那份
 * 文件头写着「Split into a hook, a canvas and a toolbar」，只是三块住在一起。工具条这一块和另
 * 外两块之间只有四个符号来往，其中三个（`BACKDROPS`、`WEIGHT_LEVELS`，以及这里的一堆度量与
 * 图标表）本来就只有它自己用，跟着搬过来了；剩下 `COLOURS` 两边都用，留在原处导出。
 *
 * 工具条不能住在画布的父节点里，这条约束没有变：舞台为了缩放带着 transform，而 `position:
 * fixed` 在一个被 transform 过的祖先里是相对那个祖先固定的。一个跟着图片一起放大、一起滑走的
 * 工具条，在 400% 下没法用。
 */

import type { MessageKey } from "../../i18n/messages/index.ts";
import { translate } from "../../i18n/translate.ts";
import {
	ArrowUpRight,
	Delete,
	Circle,
	Download,
	Grid2x2,
	ListOrdered,
	Minus,
	Pencil,
	Pin,
	Redo2,
	Square,
	Trash2,
	Type,
	Undo2,
	X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { Tool } from "./annotate.ts";
import { COLOURS, type Annotator } from "./Annotator.tsx";

/** What can sit behind a caption. Transparent first, because most captions want nothing. */
const BACKDROPS: [string | undefined, MessageKey][] = [
	[undefined, "annotate.transparent"],
	["#ffffffe6", "annotate.white"],
	["#111827e6", "annotate.black"],
	["#fde68ae6", "annotate.paleYellow"],
];

/** Multipliers for mark and text weight, used in Annotator and ScreenshotOverlay. */
const WEIGHT_LEVELS: [number, MessageKey, number][] = [
	[0.6, "annotate.thin", 4],
	[1, "annotate.medium", 6],
	[1.8, "annotate.thick", 9],
];

const TOOLS: [Tool, typeof Pencil, MessageKey][] = [
	["pen", Pencil, "annotate.pen"],
	["arrow", ArrowUpRight, "annotate.arrow"],
	["line", Minus, "annotate.line"],
	["rect", Square, "annotate.rectangle"],
	["ellipse", Circle, "annotate.ellipse"],
	["step", ListOrdered, "annotate.step"],
	["text", Type, "annotate.text"],
	["mosaic", Grid2x2, "annotate.mosaic"],
];

/**
 * What the size control is sizing, per tool.
 *
 * One control has always driven all three; only its name was ever about lines.
 */
const SIZE_LABEL: Partial<Record<Tool, MessageKey>> = {
	text: "annotate.fontSize",
	mosaic: "annotate.mosaicSize",
	step: "annotate.stepSize",
};

const COLOUR_NAMES: Record<string, MessageKey> = {
	"#ef4444": "annotate.red",
	"#3b82f6": "annotate.blue",
	"#22c55e": "annotate.green",
	"#eab308": "annotate.yellow",
	"#111827": "annotate.black",
};

/**
 * How big the bar is, as one table rather than a size prop threaded through six components.
 *
 * `compact` is the bar as it was: 24pt buttons with 14pt icons, which is right inside the image
 * viewer, where the picture is the thing being looked at and the bar is a strip along the bottom of
 * a window that already has its own chrome.
 *
 * `large` is for the capture overlay, and the reason it exists is that the same 24pt button behaves
 * differently there. The bar is floating over a frozen desktop with no window around it, at a
 * position that changes with every selection, and it is aimed at *while the hand is still moving*
 * from the drag that made the region. Every capture tool on this platform sizes that row at around
 * 32-36pt for exactly that reason — the report this answers is 「截图控件尺寸实在是太小了」, next to
 * a screenshot of WeChat's, which is 36.
 *
 * The numbers are kept together because they are not independent: `TOOL_STEP` and `TOOL_INSET` are
 * how far along the row a tool's centre sits, and the properties bubble is anchored with them. A
 * button that grew without them would leave the bubble pointing at the wrong tool.
 */
interface ToolbarMetrics {
	/** The bar itself: gap between controls, padding, corner. */
	bar: string;
	/** A tool button. */
	button: string;
	/** Icon size in points, for every control on the row. */
	icon: number;
	/** The divider between groups. */
	divider: string;
	/** The two buttons that end the job. */
	action: string;
	confirm: string;
	/** Distance between two tool-button centres, and where the first one's centre is. */
	step: number;
	inset: number;
	/** The properties bubble: its box, its weight buttons, and how big a colour swatch is. */
	bubble: string;
	weight: string;
	swatch: string;
	bubbleDivider: string;
}

const METRICS: Record<"compact" | "large", ToolbarMetrics> = {
	compact: {
		bar: "gap-0.5 rounded-xl px-1.5 py-1",
		button: "h-6 w-6 rounded-md",
		icon: 14,
		divider: "mx-1.5 h-4",
		action: "h-6 px-2",
		confirm: "h-6 px-2.5 text-detail",
		step: 26,
		inset: 18,
		bubble: "gap-1 rounded-lg px-2 py-1",
		weight: "h-5 px-1.5 text-caption",
		swatch: "h-[14px] w-[14px]",
		bubbleDivider: "mx-0.5 h-3.5",
	},
	large: {
		bar: "gap-1 rounded-2xl px-2 py-1.5",
		button: "h-9 w-9 rounded-lg",
		icon: 18,
		divider: "mx-1.5 h-5",
		action: "h-9 px-2.5",
		confirm: "h-9 px-3.5 text-label",
		// 36pt button + 4pt gap, and 8pt of padding before the first button's own half-width.
		step: 40,
		inset: 26,
		bubble: "gap-1.5 rounded-xl px-2.5 py-1.5",
		weight: "h-7 px-2.5 text-detail",
		swatch: "h-[18px] w-[18px]",
		bubbleDivider: "mx-1 h-4",
	},
};

/**
 * 在按钮上按住多久，算「我要挪这条工具栏」而不是「我要按这个按钮」。
 *
 * 320ms：比一次利落的点击长得多（那是 80–150ms），又短到按下去等一等就有反应，不至于让人以为
 * 按住不管用。跟系统里长按呼出菜单的那个数是一个量级。
 */
const HOLD_TO_DRAG_MS = 320;
/** 按住期间手抖几个像素还算没动。超过就是在往别的按钮上蹭，那一下仍然是点击。 */
const HOLD_SLOP = 4;

/**
 * The bar when the caller does not place it: floating at the bottom of the window.
 *
 * Floating rather than in a column under the image, which is where it began: that made the picture
 * give up height to make room, so entering edit mode visibly shrank it. Floating means the picture
 * is exactly the same size in both modes, and the bar stays legible through its own background
 * rather than by pushing anything out of the way.
 *
 * Which is why exactly one class here may set `position`, and a test holds it to that. A list cannot hold two —
 * which one wins is decided by the order Tailwind emits them, not the order they are written, and
 * `relative` is emitted after `fixed`. A stray `relative` sat in this list and did exactly that: the
 * bar the comment below calls floating was in fact in flow, and the image viewer's stage is a flex
 * row, so it became a second item beside the picture, 406px wide. The picture was pushed
 * (1280 − 1100 − 406) / 2 = 113px off the left edge of the window and the bar landed at x=1424,
 * outside it, clipped away by the overlay's `overflow-hidden`. Pressing 标注 moved the image and
 * took the toolbar with it — with nothing left to annotate with.
 *
 * Named rather than inline because that is what makes it testable; `ScreenshotOverlay` passes its
 * own list and is unaffected either way.
 */
export const FLOATING_BAR =
	"pointer-events-auto fixed bottom-6 left-1/2 z-[120] flex items-center border border-white/12 bg-[#1c1c1e]/92 shadow-[0_8px_32px_rgba(0,0,0,0.45)] backdrop-blur-xl transition-[opacity,transform] duration-[var(--ly-t-base)] ease-out";

export function AnnotateToolbar({
	annotator,
	onCancel,
	onSave,
	onPin,
	onDownload,
	onGrab,
	grabbing = false,
	size = "compact",
	canReplace,
	saveLabel,
	cancelLabel,
	requireDirty = true,
	className,
	style,
	propertiesSide = "above",
}: {
	annotator: Annotator;
	onCancel: () => void;
	onSave: () => void;
	/**
	 * Leave the picture on the desktop, above everything, instead of delivering it.
	 *
	 * Present only where it means something — the capture overlay — because pinning a region of a
	 * picture that is already open in a window is a copy of a thing you are looking at.
	 */
	onPin?: () => void;
	/** Write the picture to the download directory. Same reasoning as `onPin`. */
	onDownload?: () => void;
	/**
	 * 这一条要挪窝了：从哪儿按下的，按下时它在哪儿。
	 *
	 * 挪到哪儿是调用方的事——它飘在一张截好的屏幕上，得留在屏幕里——所以这里只说「开始了」，外加
	 * 两个位置。带上 `origin` 而不是让调用方自己去 DOM 里量：这一条的位置只有它自己最清楚，而且
	 * 按住按钮触发的那一次是从定时器里发出的，那会儿 React 的合成事件早就没有 `currentTarget` 了。
	 *
	 * 不传就是不能挪：看图器里这一条钉在窗口底边，没有别处可去。
	 */
	onGrab?: (grab: { from: { x: number; y: number }; origin: { x: number; y: number } }) => void;
	/** 正在挪，好让整条和它上面每个控件都显示同一个光标。 */
	grabbing?: boolean;
	/**
	 * How big the controls are. `large` is the capture overlay; see `METRICS`.
	 *
	 * Defaulted rather than required so the image viewer, which is the other caller and wants the
	 * bar it already had, does not have to say so.
	 */
	size?: "compact" | "large";
	/**
	 * Which way the tool's own settings bubble opens, in terms of this bar.
	 *
	 * `above` puts it over the bar, `below` under it. The caller decides because only the caller
	 * knows where the bar was placed relative to what is being annotated: the bubble has to open
	 * away from that, or it covers it. Defaults to `above`, which is right for the file editor,
	 * where the bar is pinned to the bottom of the stage.
	 */
	propertiesSide?: "above" | "below";
	/** Whether saving can replace the original, or only produce a copy. */
	canReplace: boolean;
	/** Overrides what the save button says. Left off, it says what `canReplace` implies. */
	saveLabel?: string;
	cancelLabel?: string;
	/**
	 * Whether saving requires a mark to have been made.
	 *
	 * True for a picture that already exists — saving an untouched copy of it produces a second
	 * identical file, which is why the button is dead until there is something to save. False for
	 * the screenshot overlay, where the button is how the capture itself is confirmed and an
	 * unannotated region is the commonest thing anyone wants.
	 */
	requireDirty?: boolean;
	className?: string;
	style?: React.CSSProperties;
}) {
	const metrics = METRICS[size];
	const [shown, setShown] = useState(false);
	useEffect(() => {
		// One frame late, so the transition has a start state to move away from.
		const id = requestAnimationFrame(() => setShown(true));
		return () => cancelAnimationFrame(id);
	}, []);

	const bar = useRef<HTMLDivElement | null>(null);
	/** 按住计时中的那一次，连同它按在哪儿——手挪出去就作废。 */
	const holding = useRef<{ from: { x: number; y: number }; timer: ReturnType<typeof setTimeout> } | null>(null);
	/** 这一次按下已经变成了挪窝，那么随之而来的那个 click 不作数。 */
	const dragged = useRef(false);

	const endHold = useCallback(() => {
		if (holding.current) clearTimeout(holding.current.timer);
		holding.current = null;
	}, []);
	useEffect(() => endHold, [endHold]);

	const beginDrag = useCallback(
		(from: { x: number; y: number }) => {
			const box = bar.current?.getBoundingClientRect();
			if (!box || !onGrab) return;
			dragged.current = true;
			onGrab({ from, origin: { x: box.left, y: box.top } });
		},
		[onGrab],
	);

	// Undo, redo and delete from the keyboard, which is where anyone drawing reaches first.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			// Never while typing a caption: there, ⌘Z belongs to the field and backspace is a
			// backspace. A shortcut that deletes the mark you are in the middle of writing is worse
			// than no shortcut.
			if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;

			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
				event.preventDefault();
				if (event.shiftKey) annotator.redo();
				else annotator.undo();
				return;
			}

			if ((event.key === "Backspace" || event.key === "Delete") && annotator.selected !== null) {
				// Backspace is the browser's "go back" on some setups; taking it is the point.
				event.preventDefault();
				annotator.removeSelected();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [annotator]);

	return (
		<div
			/*
			 * The caller says where the bar is; `metrics` says how big it is.
			 *
			 * Appended rather than left to the caller, because those two decisions belong to different
			 * people and used to be one string. The overlay's own class list carried `gap-0.5 px-1.5
			 * py-1` copied from the default — so a size change here would have had no effect there at
			 * all, and the two would have drifted the first time either was touched. What a caller
			 * passes now is position, background and shadow; spacing is not its business.
			 */
			/*
			 * And every control on it, while it is being dragged.
			 *
			 * The bar follows the pointer, so the pointer spends the whole drag *on the bar* — over
			 * buttons, each of which has a cursor of its own. Without the descendant rule the closed
			 * hand appears for one frame on the grip and is replaced by an arrow for the rest of the
			 * gesture, which reads as the drag having been dropped.
			 */
			ref={bar}
			/*
			 * 整条都能拿起来，光标一直这么说着。
			 *
			 * 之前是行首一个竖点手柄，只有那 8pt 宽的一小条能拖。它有两处不对：得先看见它、再瞄准
			 * 它，而这条工具栏本身就是浮在别人屏幕上的临时东西，没有窗口标题栏那样的位置约定；而且
			 * 它在一排按钮的最前面，本身就是这排按钮里的一个「洞」。
			 *
			 * 现在按钮之外的地方按下就能拖，光标从进来那一刻就说得清楚。按钮上按住不放也能拖——
			 * 见 `HOLD_TO_DRAG_MS`——因为这条几乎全是按钮，只留缝隙可拖等于还是要瞄准。
			 */
			className={`${className ?? FLOATING_BAR} ${metrics.bar} ${grabbing ? "cursor-grabbing [&_*]:cursor-grabbing" : onGrab ? "cursor-grab" : ""}`}
			style={{
				opacity: shown ? 1 : 0,
				transform: className ? undefined : `translateX(-50%) translateY(${shown ? 0 : 10}px)`,
				...style,
			}}
			/*
			 * The bar never takes focus away from what is being typed.
			 *
			 * A caption is committed when its field loses focus, and pressing a button here was
			 * enough to do that — so reaching for a bigger size ended the caption instead of
			 * resizing it, and the next press started a new one somewhere else. Preventing the
			 * default on `mousedown` is what stops the focus moving; the click still fires, so every
			 * control works exactly as before, only now the field is still there afterwards and the
			 * new size is applied to it live.
			 */
			onMouseDown={(event) => event.preventDefault()}
			onPointerDown={(event) => {
				if (!onGrab || event.button !== 0) return;
				const target = event.target as HTMLElement;
				// 气泡飘在这一条外面，只是 DOM 上挂在里面。调粗细不该把整条带走。
				if (target.closest?.("[data-toolbar-bubble]")) return;
				const from = { x: event.clientX, y: event.clientY };
				if (!target.closest?.("button, input, textarea, select, a")) {
					// 空白处：按下就是要挪它，没有第二种解释。
					event.preventDefault();
					beginDrag(from);
					return;
				}
				/*
				 * 按在按钮上：先当成要按它，按住不放才改主意。
				 *
				 * 反过来（按下即拖、松开算点击）也能实现，代价是每一次点击都先动一下——按钮在手指
				 * 底下抖，这条工具栏上的每一个操作都会变得不确定。
				 */
				endHold();
				holding.current = {
					from,
					timer: setTimeout(() => {
						holding.current = null;
						beginDrag(from);
					}, HOLD_TO_DRAG_MS),
				};
			}}
			onPointerMove={(event) => {
				const held = holding.current;
				if (!held) return;
				// 手挪开了就不是「按住」，是在往某个按钮上蹭——那一下仍然该是点击。
				if (Math.abs(event.clientX - held.from.x) > HOLD_SLOP || Math.abs(event.clientY - held.from.y) > HOLD_SLOP) endHold();
			}}
			onPointerUp={endHold}
			onPointerCancel={endHold}
			onPointerLeave={endHold}
			/*
			 * 挪完之后那一下 click 要吞掉。
			 *
			 * 按住一个按钮把整条拖走，松手时浏览器照样会在这条上派发一次 click——那正是刚才被按住
			 * 的那个按钮。不吞掉的话，「把工具栏从要标注的地方挪开」会顺手切一次工具，或者更糟，
			 * 按到「完成」把整个截图交出去。
			 */
			onClickCapture={(event) => {
				if (!dragged.current) return;
				dragged.current = false;
				event.preventDefault();
				event.stopPropagation();
			}}
		>
			{/*
			 * The properties of the tool in hand, above the row rather than inside it.
			 *
			 * Every property of every tool laid out in one line is what made this bar as wide as a
			 * laptop screen — and most of it was inert at any moment, because a colour does nothing
			 * for a mosaic and a backdrop does nothing for an arrow. Lifted into a bubble that points
			 * at the tool it belongs to, the row is just the tools, and what is on screen is only
			 * what the current tool actually has.
			 */}
			<ToolProperties annotator={annotator} index={TOOLS.findIndex(([id]) => id === annotator.tool)} side={propertiesSide} metrics={metrics} />

			{/*
			 * 行首曾经有一个竖点手柄，现在没有了。
			 *
			 * 它占着一排按钮的头一格，本身却不是按钮——一排控件里的一个洞，第一次看到的人得先弄明白
			 * 那是什么。而它换来的能力，现在整条都有：按钮之外按下就能拖，按钮上按住不放也能拖。
			 * 少一格，这一条还窄了 20pt，在一块框得很小的区域旁边，那 20pt 是看得出来的。
			 */}
			{TOOLS.map(([id, Icon, label], at) => (
				<ToolButton key={id} metrics={metrics} toolIndex={at} label={translate(label)} active={annotator.tool === id} onClick={() => annotator.setTool(id)}>
					<Icon size={metrics.icon} strokeWidth={1.9} />
				</ToolButton>
			))}

			<Divider metrics={metrics} />

			<ToolButton metrics={metrics} label={translate("annotate.undo")} disabled={!annotator.canUndo} onClick={annotator.undo}>
				<Undo2 size={metrics.icon} strokeWidth={1.9} />
			</ToolButton>
			<ToolButton metrics={metrics} label={translate("annotate.redo")} disabled={!annotator.canRedo} onClick={annotator.redo}>
				<Redo2 size={metrics.icon} strokeWidth={1.9} />
			</ToolButton>
			{/*
			 * Deleting the selected mark, where the selected mark is not.
			 *
			 * Present only while something is selected, next to the other things that act on the
			 * drawing as a whole. It appears rather than greying out, so the row does not carry a dead
			 * control most of the time.
			 */}
			{annotator.selected !== null && (
				<span className="flex animate-[ly-tool-in_var(--ly-t-base)_ease-out]">
					<ToolButton metrics={metrics} label={translate("annotate.deleteSelected")} onClick={annotator.removeSelected}>
						<Delete size={metrics.icon} strokeWidth={1.9} />
					</ToolButton>
				</span>
			)}
			<ToolButton metrics={metrics} label={translate("annotate.clear")} disabled={!annotator.dirty} onClick={annotator.clear}>
				<Trash2 size={metrics.icon} strokeWidth={1.9} />
			</ToolButton>

			{/*
			 * The two ways out that are not "give it to Lyra", in their own group.
			 *
			 * Both end the capture and neither delivers it to the app, which is what makes them a
			 * group of their own between the drawing tools and the confirm button: 置顶 leaves the
			 * picture on the desktop to look at, 下载 leaves it in a folder to keep. They only appear
			 * where they mean something — the image viewer's copy of this bar has neither.
			 */}
			{(onPin || onDownload) && <Divider metrics={metrics} />}
			{onPin && (
				<ToolButton metrics={metrics} label={translate("annotate.pinToDesktop")} onClick={onPin}>
					<Pin size={metrics.icon} strokeWidth={1.9} />
				</ToolButton>
			)}
			{onDownload && (
				<ToolButton metrics={metrics} label={translate("annotate.download")} onClick={onDownload}>
					<Download size={metrics.icon} strokeWidth={1.9} />
				</ToolButton>
			)}

			<Divider metrics={metrics} />

			<button
				type="button"
				data-ly-tip={cancelLabel ?? translate("annotate.exit")}
				data-ly-tip-side="top"
				aria-label={cancelLabel ?? translate("annotate.exit")}
				onClick={onCancel}
				className={`flex cursor-pointer items-center rounded-md text-white/65 transition-colors duration-[var(--ly-t-quick)] hover:text-white ${metrics.action}`}
			>
				<X size={metrics.icon - 1} strokeWidth={2} />
			</button>
			<button
				type="button"
				data-ly-tip={saveLabel ?? translate(canReplace ? "annotate.saveOver" : "annotate.saveCopyTip")}
				data-ly-tip-side="top"
				disabled={requireDirty && !annotator.dirty}
				onClick={onSave}
				// `whitespace-nowrap` because the label is four characters and the button is sized by
				// its padding: without it "保存副本" wrapped to two lines and took the whole bar's
				// height with it.
				className={`flex cursor-pointer items-center whitespace-nowrap rounded-md bg-white font-medium text-[#1c1c1e] transition-opacity duration-[var(--ly-t-quick)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35 ${metrics.confirm}`}
			>
				{saveLabel ?? translate(canReplace ? "common.save" : "annotate.saveCopy")}
			</button>
		</div>
	);
}

/** `mx-1.5` rather than `mx-1`: the swatch next to a divider carries a ring that needs the room. */
const Divider = ({ metrics }: { metrics: ToolbarMetrics }) => (
	<span className={`w-px shrink-0 bg-white/15 ${metrics.divider}`} />
);

/**
 * The properties of the tool currently in hand, in a bubble that points at it.
 *
 * Two things are gained by lifting these out of the row. The row stops being a catalogue of every
 * property of every tool — which is what made it wide enough to run off the side of the screen —
 * and each tool gets to show only what it actually has: a mosaic samples the picture underneath it
 * and has no colour, an arrow has no backdrop. A control that cannot affect the thing in your hand
 * is worse than a missing one, because it reads as a promise the tool does not keep.
 *
 * Anchored to the tool's own button rather than centred, so which tool is being configured is
 * answered by where the bubble is, and clamped so it cannot hang off either end of the bar.
 */
function ToolProperties({
	annotator,
	index,
	side,
	metrics,
}: {
	annotator: Annotator;
	index: number;
	side: "above" | "below";
	metrics: ToolbarMetrics;
}) {
	const isText = annotator.tool === "text";
	// The mosaic is the one tool with no colour of its own — it takes the picture's.
	const hasColour = annotator.tool !== "mosaic";

	/*
	 * Where the tool this belongs to actually is, measured rather than calculated.
	 *
	 * It used to be `index * 26 + 18` — the button's width plus its gap, plus the bar's padding —
	 * and that arithmetic is a copy of the layout kept in a second place. It was already one size
	 * behind: a bar with a drag handle in front of the tools shifts every button along by the width
	 * of the handle, so the tail pointed at the tool before the one in hand, on the overlay's bar
	 * and nowhere else. Every future control added to the head of the row would do the same.
	 *
	 * The formula is kept as the value for the first frame, because `useLayoutEffect` runs after
	 * this render and a bubble that appeared at 0 and jumped would be worse than one that is a few
	 * points out for one frame.
	 */
	const box = useRef<HTMLDivElement | null>(null);
	const [anchor, setAnchor] = useState(Math.max(0, index) * metrics.step + metrics.inset);
	useLayoutEffect(() => {
		const bar = box.current?.offsetParent as HTMLElement | null;
		const button = bar?.querySelector<HTMLElement>(`[data-tool-index="${index}"]`);
		if (!button) return;
		setAnchor(button.offsetLeft + button.offsetWidth / 2);
	}, [index, metrics, annotator.selected]);

	return (
		<div
			/*
			 * Opens away from the region, not always upwards.
			 *
			 * The toolbar itself sits below the selection whenever there is room, so a bubble pinned
			 * to `bottom-full` opened into the gap between the two — over the bottom of the very
			 * region being annotated. Which side is "away" is only known where the toolbar was
			 * placed, so it is passed in: `below` means the toolbar is below the selection and the
			 * bubble goes further down, `above` means it is above and the bubble goes further up.
			 */
			ref={box}
			/*
			 * 标出来，好让工具栏的按住拖拽把这一片排除在外。
			 *
			 * 气泡在 DOM 上是工具栏的孩子、在屏幕上却飘在它外面。工具栏空白处按下就能拖，气泡里的
			 * 空白（按钮之间那几个像素）如果也算数，调粗细时手一沉整条工具栏就跟着走了。
			 */
			data-toolbar-bubble
			className={`absolute left-0 flex cursor-default animate-[ly-tool-in_var(--ly-t-base)_ease-out] items-center border border-white/12 bg-[#1c1c1e]/95 shadow-[0_6px_20px_rgba(0,0,0,0.4)] backdrop-blur-xl ${metrics.bubble} ${
				side === "below" ? "top-full mt-2" : "bottom-full mb-2"
			}`}
			style={{ left: anchor, transform: "translateX(-50%)" }}
		>
			{WEIGHT_LEVELS.map(([value, label]) => (
				<button
					key={label}
					type="button"
					onClick={() => annotator.setWeight(value)}
					aria-label={translate("annotate.sizeIs", {
						what: translate(SIZE_LABEL[annotator.tool] ?? "annotate.weight"),
						label: translate(label),
					})}
					aria-pressed={annotator.weight === value}
					className={`flex cursor-pointer items-center rounded transition-colors ${metrics.weight} ${
						annotator.weight === value ? "bg-white/20 text-white" : "text-white/55 hover:bg-white/10 hover:text-white"
					}`}
				>
					{translate(label)}
				</button>
			))}

			{hasColour && <span className={`w-px shrink-0 bg-white/15 ${metrics.bubbleDivider}`} />}

			{hasColour &&
				COLOURS.map((value) => (
					<button
						key={value}
						type="button"
						aria-label={COLOUR_NAMES[value] ? translate(COLOUR_NAMES[value]) : value}
						aria-pressed={annotator.colour === value}
						onClick={() => annotator.setColour(value)}
						style={{ background: value }}
						className={`shrink-0 cursor-pointer rounded-full transition-transform duration-[var(--ly-t-quick)] ${metrics.swatch} ${
							annotator.colour === value
								? "scale-110 ring-2 ring-white/85 ring-offset-2 ring-offset-[#1c1c1e]"
								: "opacity-80 hover:scale-110 hover:opacity-100"
						}`}
					/>
				))}

			{/* A caption can sit on a plate; nothing else can, so nothing else offers it. */}
			{isText && <span className={`w-px shrink-0 bg-white/15 ${metrics.bubbleDivider}`} />}
			{isText &&
				BACKDROPS.map(([value, label]) => (
					<button
						key={label}
						type="button"
						aria-label={translate("annotate.textBackground", { label: translate(label) })}
						aria-pressed={annotator.backdrop === value}
						onClick={() => annotator.setBackdrop(value)}
						style={value ? { background: value } : undefined}
						className={`shrink-0 cursor-pointer rounded-[4px] transition-transform duration-[var(--ly-t-quick)] ${metrics.swatch} ${
							value ? "" : "ly-checker-xs"
						} ${
							annotator.backdrop === value
								? "scale-110 ring-2 ring-white/85 ring-offset-2 ring-offset-[#1c1c1e]"
								: "opacity-80 hover:scale-110 hover:opacity-100"
						}`}
					/>
				))}

			{/* The tail, which is what makes it a bubble belonging to a button rather than a second row. */}
			{/*
			 * The little point, on whichever side the toolbar actually is.
			 *
			 * It exists to say which button this bubble belongs to, and it was pinned to the bottom
			 * and pointing down no matter where the bubble opened. The bubble flips: when the
			 * toolbar sits below the region, the bubble opens *below the toolbar*, and a point on
			 * its underside was aiming at empty screen — at the dock, in the report — while the
			 * button it belongs to was above it.
			 *
			 * Rotating a square by 45° and keeping two of its borders is what makes the tip; which
			 * two decides which way it faces.
			 */}
			<span
				className={`absolute left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-white/12 bg-[#1c1c1e]/95 ${
					side === "below" ? "-top-1 border-t border-l" : "-bottom-1 border-r border-b"
				}`}
			/>
		</div>
	);
}

function ToolButton({
	label,
	active,
	disabled,
	onClick,
	metrics,
	toolIndex,
	children,
}: {
	label: string;
	active?: boolean;
	disabled?: boolean;
	onClick: () => void;
	metrics: ToolbarMetrics;
	/** Which drawing tool this is, so the properties bubble can find it and point at it. */
	toolIndex?: number;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			data-ly-tip={label}
			data-tool-index={toolIndex}
			// Above: the bar sits at the bottom of the window, so a bubble below it would be off screen
			// and get flipped anyway. Saying so directly avoids the flip.
			data-ly-tip-side="top"
			aria-label={label}
			aria-pressed={active}
			disabled={disabled}
			onClick={onClick}
			className={`flex cursor-pointer items-center justify-center transition-colors duration-[var(--ly-t-quick)] disabled:cursor-not-allowed disabled:opacity-30 ${metrics.button} ${
				active ? "bg-white text-[#1c1c1e]" : "text-white/65 hover:bg-white/12 hover:text-white"
			}`}
		>
			{children}
		</button>
	);
}
