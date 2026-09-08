import { translate } from "../../i18n/translate.ts";
import { ChevronDown, FileDiff, Files, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { DeliveryFile, TurnDelivery } from "../../../electron/turn-delivery.ts";
import { bridge, onPhone } from "../../services/index.ts";
import { relativeTo } from "../../lib/paths.ts";
import { useApp } from "../../store/index.ts";
import { Button } from "../../ui/primitives/Button.tsx";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { Popover } from "../../ui/overlay/Popover.tsx";
import { Overlay } from "../../ui/overlay/Overlay.tsx";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import { DiffView } from "../git/index.ts";
import { latestDeliveryTimestamp } from "./delivery-state.ts";
import { useI18n } from "../../i18n/index.ts";

const PREVIEW_FILES = 3;

/**
 * How long the pointer has to rest on a row before that row is what it meant.
 *
 * Two things depend on this being long, and both of them used to be broken by it being zero.
 *
 * The card's own 「撤销」 and 「审核」 sit directly above these rows, so going for them crosses them —
 * and the preview was up before the pointer had left. It opens above the row, over the buttons, so
 * the one action this turn offers became unreachable by trying to reach it.
 *
 * And the rows are flush against each other, with the preview 8px above the one it belongs to — so
 * that 8px is the row above. Nudging up from the last file lands there, and if switching were quick
 * the whole surface would jump a row and redraw, which from the outside is the preview vanishing.
 * Switching waits exactly as long as opening does: cross that row on the way into the preview and
 * the switch is cancelled before it ever happens.
 */
const HOVER_OPEN_MS = 1000;
/**
 * And how long it has to mean leaving.
 *
 * The gap between a row and the preview above it is real, and crossing it is how you get to the
 * diff to scroll it. Closing on the frame the pointer left the card would make that crossing
 * impossible.
 */
const HOVER_CLOSE_MS = 160;

export function TurnDeliveryCard({ timestamp }: { timestamp: number }) {
	const sessionId = useApp((state) => state.activeSessionId);
	const latest = useApp((state) => latestDeliveryTimestamp(state.messages, state.running));
	if (!sessionId || latest !== timestamp || onPhone()) return null;
	return <Delivery key={sessionId + ":" + timestamp} sessionId={sessionId} timestamp={timestamp} />;
}

function Counts({ added, removed }: { added: number; removed: number }) {
	return <span className="flex shrink-0 items-center gap-1.5 tabular-nums"><span className="text-ok">+{added}</span><span className="text-danger">−{removed}</span></span>;
}

function FileName({ path }: { path: string }) {
	const split = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1;
	return <span className="min-w-0 flex-1 truncate"><span className="text-ink-muted">{path.slice(0, split)}</span><span className="text-ink">{path.slice(split)}</span></span>;
}

function Delivery({ sessionId, timestamp }: { sessionId: string; timestamp: number }) {
	const { t } = useI18n();
	const workspace = useApp((state) => state.workspace?.path);
	const [data, setData] = useState<TurnDelivery | null>(null);
	const [expanded, setExpanded] = useState(false);
	const [review, setReview] = useState<string | true | null>(null);
	const [undoing, setUndoing] = useState(false);
	/** The row being previewed, and the file it stands for — the preview hangs off that row. */
	const [hover, setHover] = useState<{ anchor: HTMLElement; file: DeliveryFile } | null>(null);
	const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const live = useRef(true);
	const undoLock = useRef(false);
	const confirm = useConfirmer();
	useEffect(() => {
		live.current = true;
		void bridge.delivery.get(sessionId, timestamp).then((value) => { if (live.current) setData(value); }).catch((error: unknown) => { if (live.current) useApp.getState().notify(String(error), "error"); });
		return () => { live.current = false; clearTimeout(hoverTimer.current); };
	}, [sessionId, timestamp]);
	// Opening, switching and closing are the same decision made three ways, so they share one timer:
	// whichever happened last is the one that gets to land.
	type Hovered = { anchor: HTMLElement; file: DeliveryFile } | null;
	const schedule = (next: Hovered, delay: number) => { clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(() => setHover(next), delay); };
	const keepHover = () => clearTimeout(hoverTimer.current);
	const closeHover = () => schedule(null, HOVER_CLOSE_MS);
	/** Gone now, and no pending intent left to bring it back a moment later. */
	const hideHover = () => { clearTimeout(hoverTimer.current); setHover(null); };
	const undo = async (path?: string) => {
		if (undoLock.current) return;
		undoLock.current = true; setUndoing(true);
		try {
			await bridge.delivery.undo(sessionId, timestamp, path);
			const value = await bridge.delivery.get(sessionId, timestamp);
			if (live.current) setData(value);
			useApp.getState().notify(t("delivery.reverted"), "info");
		} catch (error) { useApp.getState().notify(String(error), "error"); }
		finally { undoLock.current = false; if (live.current) setUndoing(false); }
	};
	const askUndo = (file?: DeliveryFile) => {
		hideHover();
		confirm.ask({ title: file ? t("delivery.revertFileConfirm") : t("delivery.revertAllConfirm"), detail: t("delivery.revertDetail"), confirmLabel: t("delivery.revertChanges"), onConfirm: () => undo(file?.path) });
	};
	// Reports, warnings and commands cannot manufacture an empty file-change card.
	if (!data?.files.length) return null;
	const added = data.files.reduce((sum, file) => sum + file.added, 0);
	const removed = data.files.reduce((sum, file) => sum + file.removed, 0);
	const remaining = data.files.length - PREVIEW_FILES;
	const relative = (path: string) => workspace ? relativeTo(workspace, path) : path;
	const row = (file: DeliveryFile) => <button key={file.path} type="button" data-delivery-file={file.path}
		className="flex h-9 w-full items-center gap-3 rounded-md px-3 text-left text-label transition-colors hover:bg-card-hover focus-visible:bg-card-hover"
		// No `onMouseLeave` here: leaving a row for the row below it, or for the card's own header,
		// is not leaving the preview. The card answers that, once, below.
		onMouseEnter={(event) => schedule({ anchor: event.currentTarget, file }, HOVER_OPEN_MS)}
		// Focus is not a pointer passing through — it is already the answer, so it does not wait.
		onFocus={(event) => { keepHover(); setHover({ anchor: event.currentTarget, file }); }} onBlur={closeHover}
		onClick={() => { hideHover(); setReview(file.path); }}>
		<FileName path={relative(file.path)} /><Counts added={file.added} removed={file.removed} />
	</button>;
	return <>
		{/*
		 * Leaving is the card's business, not any one row's.
		 *
		 * Asked row by row, "the pointer left" was true every time it crossed from one file to the
		 * next and every time it went up to 「撤销」 — so the preview was always a moment from closing
		 * while the pointer was still inside the thing it belongs to. Asked once, of the card, it
		 * means what it says. The wrapper only exists to carry it: the handler belongs to the whole
		 * card, and a `section` is not something a pointer listener may hang on.
		 */}
		<div className="mt-3" onMouseLeave={closeHover}>
			<section data-turn-delivery aria-label={t("delivery.fileChanges")} className="rounded-xl border border-line bg-card/30 text-label">
				<div className="flex min-h-16 flex-wrap items-center gap-3 px-3 py-3">
					<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card-hover text-ink-muted"><FileDiff size={21} strokeWidth={1.7} /></span>
					<div className="min-w-0 flex-1"><p className="font-medium text-ink">{translate("delivery.editedN", { n: data.files.length })}</p><Counts added={added} removed={removed} /></div>
					<div className="ml-auto flex shrink-0 items-center gap-1">
						{/*
						 * Offered only when it can actually be done.
						 *
						 * It used to sit here greyed out, and a disabled button explains nothing: the
						 * browser sends it no pointer events, so its tooltip never opens — a dead grey
						 * block holding a place, saying neither what it would do nor why it will not.
						 * A file this turn touched can stop being undoable for reasons that have nothing
						 * to do with this card (something else wrote to it afterwards, or a command did),
						 * and none of that is a state this row can usefully show.
						 *
						 * Undoing one file at a time is still there, in 「审核」, where the same condition
						 * is per file and does carry its reason.
						 */}
						{data.files.every((file) => file.canUndo) &&
							<Button size="sm" variant="subtle" icon={<Undo2 size={14} />} loading={undoing} label={t("delivery.revertThis")} onClick={() => askUndo()}>{t("common.revert")}</Button>}
						<Button size="sm" icon={<Files size={14} />} label={t("delivery.reviewAll")} onClick={() => { hideHover(); setReview(true); }}>{t("common.review")}</Button>
					</div>
				</div>
				<div className="px-1 pb-1">
					{data.files.slice(0, PREVIEW_FILES).map(row)}
					{remaining > 0 && <>
						<div id={"delivery-" + timestamp + "-more"} className="ly-reveal" data-open={expanded} aria-hidden={!expanded} inert={!expanded}><div>{data.files.slice(PREVIEW_FILES).map(row)}</div></div>
						<button type="button" aria-expanded={expanded} aria-controls={"delivery-" + timestamp + "-more"} onClick={() => { hideHover(); setExpanded(!expanded); }} className="flex h-9 items-center gap-2 rounded-md px-3 text-ink-muted hover:bg-card-hover hover:text-ink">
							{expanded ? t("delivery.collapse") : t("delivery.showMore", { n: remaining })}<ChevronDown size={14} className="transition-transform duration-[var(--ly-t-quick)]" style={{ transform: expanded ? "rotate(180deg)" : undefined }} />
						</button>
					</>}
				</div>
			</section>
		</div>
		{/*
		 * Directly above the row it came out of, and as wide as it.
		 *
		 * The width was 720 — a number from nowhere, and on an ordinary window some 250px wider than
		 * the card underneath it. The preview hung off both sides of the thing that produced it and
		 * read as a surface from some other layout that happened to land there. The row has no width
		 * of its own to copy: it is as wide as the column, and the column follows the window.
		 *
		 * Measured off the anchor at open time, on the same terms as the position — a popover is
		 * placed by the layout it opened into, and width is part of that placement, not a separate
		 * thing to keep chasing afterwards.
		 *
		 * Off the row rather than off the card, so it stays attached to what it is previewing.
		 * Hung off the card it was steady, and pointlessly far: on a card with five files it opened
		 * a full card-height above the row it was showing, with the header and the other rows in
		 * between, and nothing about it said which file it belonged to. Staying still is what
		 * `HOVER_OPEN_MS` is for — time, not distance.
		 */}
		{hover && <Popover anchor={hover.anchor} onClose={hideHover} role="group" label={t("delivery.previewChanges")} placement="top" align="start" width={hover.anchor.offsetWidth} maxHeight={420}
			surface="panel" onMouseEnter={keepHover} onMouseLeave={closeHover}
			header={<div className="flex min-w-0 items-center gap-3 px-3 py-2 text-label"><FileName path={relative(hover.file.path)} /><Counts added={hover.file.added} removed={hover.file.removed} /></div>}>
			<DiffView path={hover.file.path} hunks={hover.file.hunks} maxLines={Infinity} />
		</Popover>}
		{/*
		 * A reading surface, not a form with diffs on it.
		 *
		 * Everything here used to scroll together inside 16px of padding: the dialog's title left
		 * the top of the window as soon as you moved, each file's name went with it — so halfway
		 * down a five-file review nothing on screen said which file you were reading — and the code,
		 * inset on all four sides, sat as a smaller rectangle inside the dialog with the dialog's own
		 * colour showing around it and the scrollbar riding 16px clear of the text it scrolls.
		 *
		 * So: the title is a fixed rail, each file's name holds at the top of the scroll until the
		 * next one pushes it off, and the code goes edge to edge with the bar over it. `top="line"`
		 * rather than a fade, because content here slides under something solid rather than
		 * dissolving into the window — and a fade would have softened the very names being held.
		 */}
		{review && <Overlay onClose={() => setReview(null)} width={850}>
			<div className="shrink-0 border-b border-line px-4 py-3"><h2 data-dialog-title className="text-body text-ink">{t("delivery.fileChanges")}</h2></div>
			<Scroller className="min-h-0 flex-auto" top="line" bottom="none">
				{data.files.filter((file) => review === true || review === file.path).map((file) => <div key={file.path} className="border-t border-line first:border-t-0">
					{/*
					 * Above the diff's own pinned columns and its sideways bar — see `DiffView`.
					 *
					 * 右边比左边多让 10px：代码那一列自带 `px-2.5` 的留白供滑块落脚，这一行没有，而它
					 * 右端正是「撤销」。滑块画在 z-40 上、自己吃点击，压上去就是按钮看得见、按不着。
					 */}
					<div className="sticky top-0 z-[3] flex items-center gap-3 border-b border-line-soft bg-float py-2 pr-[22px] pl-3 text-label"><FileName path={relative(file.path)} /><Counts added={file.added} removed={file.removed} /><IconButton size="sm" icon={<Undo2 size={14} />} label={file.canUndo ? t("delivery.revertOne") : t("delivery.cannotRevert")} explainDisabled disabled={!file.canUndo || undoing} onClick={() => askUndo(file)} /></div>
					<DiffView path={file.path} hunks={file.hunks} maxLines={Infinity} />
				</div>)}
			</Scroller>
		</Overlay>}
		{confirm.element}
	</>;
}
