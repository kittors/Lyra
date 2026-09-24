import { translate } from "../../i18n/translate.ts";
import { FileDiff, Files, FileText, Undo2 } from "lucide-react";
import { Caret } from "../../ui/primitives/Caret.tsx";
import { useEffect, useRef, useState } from "react";
import type { DeliveryFile, TurnDelivery } from "../../../electron/turn-delivery.ts";
import { bridge, onPhone } from "../../services/index.ts";
import { relativeTo } from "../../lib/paths.ts";
import { useApp } from "../../store/index.ts";
import { useOpenFile } from "../../store/openFile.ts";
import { Button } from "../../ui/primitives/Button.tsx";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { Popover } from "../../ui/overlay/Popover.tsx";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import { companionOf, openScopedPanel, usePaneDock } from "../dock/index.ts";
import { useScopedMessages, useScopedRunning, useScopedSessionId } from "../../app/session-scope.tsx";
import { DiffView } from "../git/index.ts";
import { latestDeliveryTimestamp } from "./delivery-state.ts";
import { peekDelivery, rememberDelivery } from "./delivery-cache.ts";
import { useDeliveryReview } from "./delivery-review.ts";
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
 *
 * Long, then — but a full second was past where a wait still reads as a wait. A row is 36px, so
 * crossing one takes well under a tenth of a second even slowly; everything above that is spent
 * on a pointer that has already stopped. And a pointer that has stopped and got nothing back for
 * a second reads as a row with nothing to show, so the hand moves — which starts the count over.
 * Waiting longer is how you stop it opening at all.
 */
const HOVER_OPEN_MS = 700;
/**
 * And how long it has to mean leaving.
 *
 * The gap between a row and the preview above it is real, and crossing it is how you get to the
 * diff to scroll it. Closing on the frame the pointer left the card would make that crossing
 * impossible.
 */
const HOVER_CLOSE_MS = 160;

export function TurnDeliveryCard({ timestamp }: { timestamp: number }) {
	// This transcript's conversation, not whichever one has the focus: every screen shows its own.
	const sessionId = useScopedSessionId();
	const messages = useScopedMessages();
	const running = useScopedRunning();
	const latest = latestDeliveryTimestamp(messages, running);
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
	const [data, setData] = useState<TurnDelivery | null>(() => peekDelivery(sessionId, timestamp) ?? null);
	const [expanded, setExpanded] = useState(false);
	const [undoing, setUndoing] = useState(false);
	/** The row being previewed, and the file it stands for — the preview hangs off that row. */
	const [hover, setHover] = useState<{ anchor: HTMLElement; file: DeliveryFile } | null>(null);
	const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
	const live = useRef(true);
	const undoLock = useRef(false);
	const confirm = useConfirmer();
	useEffect(() => {
		live.current = true;
		void bridge.delivery.get(sessionId, timestamp).then((value) => {
			rememberDelivery(sessionId, timestamp, value);
			if (live.current) setData(value);
		}).catch((error: unknown) => { if (live.current) useApp.getState().notify(String(error), "error"); });
		return () => { live.current = false; clearTimeout(hoverTimer.current); };
	}, [sessionId, timestamp]);
	// Opening, switching and closing are the same decision made three ways, so they share one timer:
	// whichever happened last is the one that gets to land.
	type Hovered = { anchor: HTMLElement; file: DeliveryFile } | null;
	const schedule = (next: Hovered, delay: number) => { clearTimeout(hoverTimer.current); hoverTimer.current = setTimeout(() => setHover(next), delay); };
	const keepHover = () => clearTimeout(hoverTimer.current);
	const closeHover = () => schedule(null, HOVER_CLOSE_MS);
	/**
	 * 还在卡片里，但已经不在任何文件行上——那也算离开。
	 *
	 * 委托给整张卡片而不是逐行挂 `onMouseLeave`，理由和下面 `onMouseLeave` 那条一样：行与行
	 * 之间、行与浮层之间的每一次跨越，逐行问都会答「离开了」。这里问的是另一件事——指针此刻
	 * 压着的那个元素，到底还属不属于某一行。
	 */
	const offRows = (event: { target: EventTarget | null }) => {
		if (event.target instanceof Element && event.target.closest("[data-delivery-file]")) return;
		closeHover();
	};
	/** Gone now, and no pending intent left to bring it back a moment later. */
	const hideHover = () => { clearTimeout(hoverTimer.current); setHover(null); };
	const undo = async (path?: string) => {
		if (undoLock.current) return;
		undoLock.current = true; setUndoing(true);
		try {
			await bridge.delivery.undo(sessionId, timestamp, path);
			const value = await bridge.delivery.get(sessionId, timestamp);
			rememberDelivery(sessionId, timestamp, value);
			if (live.current) setData(value);
			useApp.getState().notify(t("delivery.reverted"), "info");
			if (!value.files.length) {
				useDeliveryReview.getState().close();
				usePaneDock.getState().close(sessionId, "delivery");
			} else {
				useDeliveryReview.getState().setData(value);
				useDeliveryReview.getState().touch();
			}
		} catch (error) { useApp.getState().notify(String(error), "error"); }
		finally { undoLock.current = false; if (live.current) setUndoing(false); }
	};
	const askUndo = (file?: DeliveryFile) => {
		hideHover();
		confirm.ask({ title: file ? t("delivery.revertFileConfirm") : t("delivery.revertAllConfirm"), detail: t("delivery.revertDetail"), confirmLabel: t("delivery.revertChanges"), onConfirm: () => undo(file?.path) });
	};
	// No slot while we wait: a 0→height reveal reads as the card unfolding from the top.
	if (!data?.files.length) return confirm.element;
	const files = data.files;
	const added = files.reduce((sum, file) => sum + file.added, 0);
	const removed = files.reduce((sum, file) => sum + file.removed, 0);
	/*
	 * The turn's own write-up, in the file pane.
	 *
	 * `collectDelivery` writes it for every engineering turn and the delivery channel grants read
	 * access to it — so the only thing standing between it and a reader is a way in. Rebuilding
	 * this card around file rows dropped that way in, and the report went on being written to
	 * `scratch/` where nothing opened it. The diffs answer "what changed"; this answers "what was
	 * asked, what was run and how it ended", which is the half no row can show.
	 */
	const report = data.reportPath;
	const openInFilePane = (path: string) => {
		hideHover();
		void useOpenFile.getState().open({ path, name: path.split(/[\\/]/).pop() || path })
			.catch((error: unknown) => useApp.getState().notify(String(error), "error"));
		openScopedPanel("file", companionOf("file"));
	};
	const openTurn = (path?: string) => {
		hideHover();
		useDeliveryReview.getState().open({ sessionId, timestamp, path: path ?? null }, data);
		openScopedPanel("delivery");
	};
	const remaining = files.length - PREVIEW_FILES;
	const relative = (path: string) => workspace ? relativeTo(workspace, path) : path;
	const row = (file: DeliveryFile) => <button key={file.path} type="button" data-delivery-file={file.path}
		className="flex h-9 w-full items-center gap-3 rounded-md px-3 text-left text-label transition-colors hover:bg-card-hover focus-visible:bg-card-hover"
		// No `onMouseLeave` here: leaving a row for the row below it, or for the card's own header,
		// is not leaving the preview. The card answers that, once, below.
		onMouseEnter={(event) => schedule({ anchor: event.currentTarget, file }, HOVER_OPEN_MS)}
		// Press already chose the row. Kill any pending open so a timer cannot land between
		// pointerdown and click and paint one frame of preview.
		onPointerDown={() => hideHover()}
		// Keyboard focus is the one that already means this row. A mouse click also focuses
		// the button, but that focus arrives before `click` runs hideHover — opening here
		// paints the preview and tears it down in the next event, which is the flash.
		onFocus={(event) => {
			if (!event.currentTarget.matches(":focus-visible")) return;
			keepHover();
			setHover({ anchor: event.currentTarget, file });
		}} onBlur={closeHover}
		onClick={() => openTurn(file.path)}>
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
		 *
		 * 只是卡片也不等于那一行。从文件行往上抬到「已编辑 N 个文件」那一排、抬到「报告」「撤销」
		 * 「审核」上、或者落在行与卡片边框之间那几 px 内衬上——都已经出了它所预览的那一行，而一个
		 * 都没出卡片。于是这条 `onMouseLeave` 一次也不响，预览就一直挂着，指着一个指针早就离开的
		 * 行：屏幕上是一块从卡片底下长出来、不对应任何东西的面板，而它自己正压在那排按钮身上。
		 *
		 * 所以边界之外交给 `onMouseLeave`，边界之内改成问「现在压着的还是某一行吗」：`mouseover`
		 * 会冒泡，卡片里每一次跨元素都经过这里。行与行、行与浮层之间那点空档由 `HOVER_CLOSE_MS`
		 * 接住——跨过去只要几毫秒，远短于它；而往浮层去的那一路本来就是这么走的，浮层 portal 到
		 * `<body>`，出卡片的那一刻这条延迟关闭早就在跑了，进去之后 `keepHover` 再把它取消。
		 *
		 * 键盘一起：焦点落到卡片头上的按钮时，预览同样要让开——它开在那些按钮上面。
		 */}
		<div className="mt-3" onMouseLeave={closeHover} onMouseOver={offRows} onFocus={offRows}>
			<section data-turn-delivery aria-label={t("delivery.fileChanges")} className="rounded-xl border border-line bg-card/30 text-label">
				<div className="flex min-h-16 flex-wrap items-center gap-3 px-3 py-3">
					<span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card-hover text-ink-muted"><FileDiff size={21} strokeWidth={1.7} /></span>
					{/* 一行写不下就省略，不折行：折了这张卡就长高一截，而那一行字本来就是标题不是正文。 */}
					<div className="min-w-0 flex-1"><p className="truncate font-medium text-ink">{translate("delivery.editedN", { n: files.length })}</p><Counts added={added} removed={removed} /></div>
					<div className="ml-auto flex shrink-0 items-center gap-1">
						{/*
						 * 三颗都带字，都不画框，都是同一颗 `Button`。
						 *
						 * 「报告」原本是颗 `IconButton`：22px、`rounded-md`、静止时连底色都没有，而它旁边
						 * 的「审核」是 26px、`rounded-lg`、描着一圈线。同一行上并排站着两种高度、两种圆角、
						 * 两种轮廓，做的却是同一类事——`Button` 开头骂的就是这个：基线对不上的一排控件，读起
						 * 来像两条工具栏推在了一起。矮的那颗还没有范围线，于是它根本不像个能按的东西，像张
						 * 卡片顺手放的一个装饰图标。
						 *
						 * 不画框而不是都画上：`subtle` 就是为成排的动作留的，三颗描边挤在卡片右上角，等于在
						 * 这张卡片的头上又画了一排小格子。字补回来是因为那个文档图标认不出来——猜不到它打开
						 * 的是这一轮的实现与验证记录，而这一行没有别的东西会提。tooltip 留那句更长的说明。
						 */}
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
						 * Undoing one file at a time is on the hover preview, where the same
						 * condition is per file and does carry its reason.
						 */}
						{report && <Button size="sm" variant="subtle" icon={<FileText size={14} />} label={t("delivery.openReport")} onClick={() => openInFilePane(report)}>{t("common.report")}</Button>}
						{files.every((file) => file.canUndo) &&
							<Button size="sm" variant="subtle" icon={<Undo2 size={14} />} loading={undoing} label={t("delivery.revertThis")} onClick={() => askUndo()}>{t("common.revert")}</Button>}
						<Button size="sm" variant="subtle" icon={<Files size={14} />} label={t("delivery.reviewAll")} onClick={() => openTurn()}>{t("common.review")}</Button>
					</div>
				</div>
				<div className="px-1 pb-1">
					{files.slice(0, PREVIEW_FILES).map(row)}
					{remaining > 0 && <>
						<div id={"delivery-" + timestamp + "-more"} className="ly-reveal" data-open={expanded} aria-hidden={!expanded} inert={!expanded}><div>{files.slice(PREVIEW_FILES).map(row)}</div></div>
						{/* 展开的是一串文件，还有几个是这行唯一的信息——留字，箭头跟着开合转身。 */}
					<button type="button" aria-expanded={expanded} aria-controls={"delivery-" + timestamp + "-more"} onClick={() => { hideHover(); setExpanded(!expanded); }} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-md text-detail text-ink-muted hover:bg-card-hover hover:text-ink">
			{expanded ? t("delivery.collapse") : t("delivery.showMore", { n: remaining })}
			<Caret open={expanded} size={14} />
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
			/*
			 * 这一颗仍是 `IconButton`，和卡片头上那三颗不一样——不是漏改的。
			 *
			 * 它要在自己灰掉的时候说出为什么，而这正是 `explainDisabled` 干的事，`Button` 没有：
			 * 禁用的按钮收不到指针事件，`data-ly-tip` 那条 tooltip 永远打不开，剩一个灰块。
			 * 「这个文件后来被别的东西写过，撤不了了」恰恰是悬在它上面的人想知道的那句话。
			 *
			 * 另一半理由是这一行本来就不是一排动作：文件名、增删数，然后一颗操作，而浮层只有文件
			 * 行那么宽。给它补上字，先被挤掉的是文件名。
			 */
			header={<div className="flex min-w-0 items-center gap-3 px-3 py-2 text-label"><FileName path={relative(hover.file.path)} /><Counts added={hover.file.added} removed={hover.file.removed} /><IconButton size="sm" icon={<Undo2 size={14} />} label={hover.file.canUndo ? t("delivery.revertOne") : t("delivery.cannotRevert")} explainDisabled disabled={!hover.file.canUndo || undoing} onClick={() => askUndo(hover.file)} /></div>}>
			<DiffView path={hover.file.path} hunks={hover.file.hunks} maxLines={Infinity} />
		</Popover>}
		{confirm.element}
	</>;
}
