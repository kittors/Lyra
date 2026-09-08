/**
 * 排在输入框上方、等着轮到自己的那几条。
 *
 * 会话正忙的时候按下回车，话不再直接插进正在跑的那一轮，而是落在这里——一条一行，看得见、改得了、
 * 也排得出先后。队列本身在 `store/queue-slice.ts`，这里只管它长什么样、怎么被摆弄。
 *
 * 四件事各有各的出口，因为它们真的是四件不同的事：
 *
 *   插进这一轮   原来忙时的默认行为，现在退成一个按钮：这条现在就送出去，不打断正在跑的那一轮。
 *   删除         不想说了。
 *   编辑         这一条整份退回输入框——附件和引用一起——所以它先从条上消失，再落回输入框里。
 *   拖动         多条排着的时候，先后顺序是能改的，而改的过程要看得见：让位的那几条自己滑开。
 *
 * 离场都要走完动画再消失，包括不是人点走的那一次：这一轮结束时队首会被自动送出，行在同一瞬间没掉，
 * 而没掉的东西和送出去的东西在眼睛里不是一回事。所以走掉的那条会被留下来播完退场，见 `leaving`。
 */

import { CornerDownLeft, GripVertical, MessageSquarePlus, MoreHorizontal, PencilLine, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { QueuedMessage } from "../../store/queue-slice.ts";
import { DURATION } from "../../ui/motion/tokens.ts";
import { MenuBody, MenuItem, Popover, usePopover } from "../../ui/overlay/Popover.tsx";
import { companionOf, useDock, useSide } from "../dock/index.ts";
import { useApp } from "../../store/index.ts";
import { useI18n } from "../../i18n/index.ts";

/** 空列表用同一个，否则每次取值都是一个新数组，订阅它的组件每一帧都要重渲染一次。 */
const NONE: QueuedMessage[] = [];

/** 还在播退场的那一条，连同它走之前站的位置——补回原处，队伍才不会在它头上先塌一格。 */
interface Leaving {
	entry: QueuedMessage;
	at: number;
}

export function QueuedMessages({
	sessionId,
	running,
	onEdit,
}: {
	sessionId: string;
	/**
	 * 这一轮还在跑吗。
	 *
	 * 只影响条上怎么说：跑着的时候排队的是「等它结束」，而停下来之后队伍是不会自己走的——按下停止
	 * 说的就是现在别再花钱了。那时候它们等的是人，得说出来，否则看着就像卡住了。
	 */
	running: boolean;
	/** 编辑：整份草稿回到输入框，由输入框自己决定怎么接。 */
	onEdit: (entry: QueuedMessage) => void;
}) {
	const { t } = useI18n();
	const items = useApp((state) => state.queued[sessionId] ?? NONE);
	const [leaving, setLeaving] = useState<Leaving[]>([]);
	const previous = useRef(items);

	/*
	 * 谁走了，从两次列表的差里读出来。
	 *
	 * 删除和编辑是这里点出去的，自己知道；自动出队不是——它由 `agent_end` 推着走，这个组件没有别的
	 * 途径知道那一条已经被送出去了。比对上一次的列表对三种情形一视同仁，也就少了三条各自为政的路。
	 */
	useEffect(() => {
		const gone = previous.current
			.map((entry, at) => ({ entry, at }))
			.filter(({ entry }) => !items.some((each) => each.id === entry.id));
		previous.current = items;
		if (gone.length === 0) return;
		setLeaving((current) => [...current, ...gone]);
		const timer = setTimeout(
			() => setLeaving((current) => current.filter((each) => !gone.some((one) => one.entry.id === each.entry.id))),
			DURATION.base,
		);
		return () => clearTimeout(timer);
	}, [items]);

	const rows: { entry: QueuedMessage; leaving: boolean }[] = items.map((entry) => ({ entry, leaving: false }));
	for (const { entry, at } of leaving) rows.splice(Math.min(at, rows.length), 0, { entry, leaving: true });

	if (rows.length === 0) return null;
	return (
		<Rows
			sessionId={sessionId}
			rows={rows}
			onEdit={onEdit}
			label={t("composer.queueLabel")}
			status={running ? t("composer.queueWaiting") : t("composer.queueHeld")}
		/>
	);
}

/**
 * 拖动的状态，和它带来的位移。
 *
 * `delta` 是被拖的那条跟着指针走了多远，`to` 是松手会落到第几位。其余各行按这两个数字让位——
 * 让位是 transform，不是重排：重排一次就是一次布局，而布局是不能补间的。
 */
interface Drag {
	id: string;
	from: number;
	to: number;
	delta: number;
}

function Rows({
	sessionId,
	rows,
	onEdit,
	label,
	status,
}: {
	sessionId: string;
	rows: { entry: QueuedMessage; leaving: boolean }[];
	onEdit: (entry: QueuedMessage) => void;
	label: string;
	/** 这一条在等什么，写在它的悬停说明里。 */
	status: string;
}) {
	const moveQueued = useApp((state) => state.moveQueued);
	const list = useRef<HTMLDivElement>(null);
	const [drag, setDrag] = useState<Drag | null>(null);
	/** 一行到下一行的距离，拖动开始时量一次——行高固定，量一次就够，量在拖动中会读到让位后的位置。 */
	const step = useRef(0);
	const origin = useRef({ y: 0, index: 0 });

	const sortable = rows.filter((row) => !row.leaving).length > 1;

	const startDrag = (index: number, id: string, event: React.PointerEvent) => {
		// 触摸留给页面自己滚；只有主键起拖。
		if (!sortable || event.button !== 0 || event.pointerType === "touch") return;
		const elements = [...(list.current?.querySelectorAll("[data-queue-row]") ?? [])];
		const first = elements[0]?.getBoundingClientRect();
		const second = elements[1]?.getBoundingClientRect();
		step.current = first && second ? second.top - first.top : 0;
		if (!step.current) return;
		origin.current = { y: event.clientY, index };
		/*
		 * 抓住指针，这样手滑出这个小手柄之后拖动也不会断。
		 *
		 * 包起来是因为不是每个环境都给抓：拿不到就退回成普通的 pointermove——在手柄上拖仍旧是好的，
		 * 只是甩太远会松手。为这个让整条拖动不能用，不值得。
		 */
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {
			/* 拿不到就算了，见上。 */
		}
		setDrag({ id, from: index, to: index, delta: 0 });
	};

	const moveDrag = (event: React.PointerEvent) => {
		if (!drag) return;
		const span = rows.length - 1;
		const at = origin.current.index;
		/*
		 * 只在队伍自己的长度里走。
		 *
		 * 甩到卡片外面那一段没有任何落点可去，而卡片是裁掉溢出的——不夹的话，手往下一甩，被拖的那行
		 * 直接消失在边界外，看着像被拖没了。夹住之后它顶在最后一格，正是松手会落到的地方。
		 */
		const delta = Math.min(Math.max(event.clientY - origin.current.y, -at * step.current), (span - at) * step.current);
		const to = Math.min(Math.max(at + Math.round(delta / step.current), 0), span);
		if (delta !== drag.delta || to !== drag.to) setDrag({ ...drag, delta, to });
	};

	const endDrag = () => {
		if (!drag) return;
		const target = rows[drag.to]?.entry;
		if (target && drag.to !== drag.from) {
			moveQueued(sessionId, drag.id, target.id, drag.to > drag.from ? "after" : "before");
		}
		setDrag(null);
	};

	/** 让位：被拖的那条跟着手指，被越过的那几条各让一格。 */
	const offsetOf = (index: number): number => {
		if (!drag) return 0;
		if (index === drag.from) return drag.delta;
		if (drag.from < drag.to && index > drag.from && index <= drag.to) return -step.current;
		if (drag.from > drag.to && index >= drag.to && index < drag.from) return step.current;
		return 0;
	};

	/** 键盘也要能改顺序：拖动是鼠标的说法，↑↓ 是同一件事的另一种说法。 */
	const nudge = (index: number, id: string, by: -1 | 1) => {
		const target = rows[index + by]?.entry;
		if (!target) return;
		moveQueued(sessionId, id, target.id, by > 0 ? "after" : "before");
	};

	return (
		/*
		 * 一张卡片，几行内容——而不是几张卡片。
		 *
		 * 上一版每行都是独立的圆角块：一圈描边、一层底色、一道间隙，三条排在一起就画了三次分隔，
		 * 而它们本来就是一队，分开反倒要人自己看出它们是一伙的。边框只画外面这一圈，行与行之间什么
		 * 都不画——挨着就够了，指到哪一行哪一行才亮起来。
		 *
		 * `overflow-hidden` 是为了圆角：行的高亮要在角上被切住。它也顺手圈住了拖动——被拖的那行
		 * 位移在下面按队伍长度夹过，甩不出这张卡片。
		 */
		<div ref={list} role="list" aria-label={label} data-composer-queue className="mb-1.5 overflow-hidden rounded-[14px] border border-line-soft bg-card/40">
			{rows.map((row, index) => (
				<Row
					key={row.entry.id}
					sessionId={sessionId}
					entry={row.entry}
					leaving={row.leaving}
					index={index}
					sortable={sortable}
					dragging={drag?.id === row.entry.id}
					offset={offsetOf(index)}
					status={status}
					onEdit={onEdit}
					onDragStart={startDrag}
					onDragMove={moveDrag}
					onDragEnd={endDrag}
					onNudge={nudge}
				/>
			))}
		</div>
	);
}

function Row({
	sessionId,
	entry,
	leaving,
	index,
	sortable,
	dragging,
	offset,
	status,
	onEdit,
	onDragStart,
	onDragMove,
	onDragEnd,
	onNudge,
}: {
	sessionId: string;
	entry: QueuedMessage;
	leaving: boolean;
	index: number;
	sortable: boolean;
	dragging: boolean;
	offset: number;
	status: string;
	onEdit: (entry: QueuedMessage) => void;
	onDragStart: (index: number, id: string, event: React.PointerEvent) => void;
	onDragMove: (event: React.PointerEvent) => void;
	onDragEnd: () => void;
	onNudge: (index: number, id: string, by: -1 | 1) => void;
}) {
	const { t } = useI18n();
	const dropQueued = useApp((state) => state.dropQueued);
	const steerQueued = useApp((state) => state.steerQueued);
	const more = usePopover();

	const remove = () => dropQueued(sessionId, entry.id);
	const edit = () => {
		more.close();
		const taken = dropQueued(sessionId, entry.id);
		if (taken) onEdit(taken);
	};
	/*
	 * 拿到侧边聊天去问。
	 *
	 * 侧边聊天碰不到项目，它读得到这个对话在做什么但不写进去——所以「这句话我先问问，别占用正在跑
	 * 的这一轮」正是它的用途。同样从队列里取走：一句话只该被问一次。
	 */
	const aside = () => {
		more.close();
		const taken = dropQueued(sessionId, entry.id);
		if (!taken) return;
		useDock.getState().open("chat", companionOf("chat"));
		void useSide.getState().ask(taken.content);
	};

	return (
		<div
			data-queue-row
			role="listitem"
			className="ly-queue-row"
			data-leaving={leaving || undefined}
			data-dragging={dragging || undefined}
			style={{ transform: offset ? `translateY(${offset}px)` : undefined }}
		>
			{/* 折叠的那一层：`grid-template-rows` 收到 0fr 时，里面的东西要被它裁掉而不是溢出来。 */}
			<div>
				{/* 挨着的一行，没有自己的边和底——亮起来的只有指针停着的那一行。 */}
				<div className="group/queued flex h-8 items-center gap-2.5 px-2 text-label transition-colors hover:bg-card-hover">
					<button
						type="button"
						data-queue-grip
						disabled={!sortable}
						aria-label={t("composer.queueReorder")}
						data-ly-tip={sortable ? t("composer.queueReorder") : undefined}
						onPointerDown={(event) => onDragStart(index, entry.id, event)}
						onPointerMove={onDragMove}
						onPointerUp={onDragEnd}
						onPointerCancel={onDragEnd}
						onKeyDown={(event) => {
							if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
							event.preventDefault();
							onNudge(index, entry.id, event.key === "ArrowDown" ? 1 : -1);
						}}
						// 一个安静的记号，不是一颗按钮：它说的是「这一行能拖」，不是「按我」。
						className="flex h-6 w-4 shrink-0 cursor-grab items-center justify-center text-ink-faint transition-colors hover:text-ink-muted disabled:cursor-default"
					>
						<GripVertical size={13} strokeWidth={1.9} />
					</button>

					{entry.thumbnail && (
						<img
							src={`data:${entry.thumbnail.mimeType};base64,${entry.thumbnail.data}`}
							alt=""
							className="h-5 w-7 shrink-0 rounded-[3px] border border-line object-cover"
						/>
					)}

					{/* 整行的说明挂在文字上：一行放不下的那句话，读它要靠悬停。 */}
					<span className="min-w-0 flex-1 truncate text-ink-muted" data-ly-tip={`${entry.preview}\n\n${status}`}>
						{entry.preview}
					</span>

					{/*
					 * 三个记号一直在那儿，只是很淡。
					 *
					 * 藏到悬停再出现会更「干净」，代价是没人知道这一行还能做什么——排队条统共就这三件
					 * 事，而它们正是这个功能存在的理由。淡到不抢，指过去才亮，比藏起来诚实。
					 */}
					<div className="flex shrink-0 items-center gap-1 text-ink-faint">
						<button
							type="button"
							data-queue-steer
							data-ly-tip={t("composer.queueSteer")}
							aria-label={t("composer.queueSteer")}
							onClick={() => void steerQueued(sessionId, entry.id)}
							className="flex h-6 w-6 items-center justify-center transition-colors hover:text-ink"
						>
							<CornerDownLeft size={13.5} strokeWidth={1.9} />
						</button>
						<button
							type="button"
							data-queue-remove
							data-ly-tip={t("composer.queueRemove")}
							aria-label={t("composer.queueRemove")}
							onClick={remove}
							className="flex h-6 w-6 items-center justify-center transition-colors hover:text-danger"
						>
							<Trash2 size={13.5} strokeWidth={1.9} />
						</button>
						<button
							type="button"
							data-queue-more
							data-ly-tip={t("composer.queueMore")}
							aria-label={t("composer.queueMore")}
							aria-haspopup="menu"
							aria-expanded={more.open}
							onClick={more.toggle}
							className="flex h-6 w-6 items-center justify-center transition-colors hover:text-ink"
						>
							<MoreHorizontal size={14} strokeWidth={1.9} />
						</button>
					</div>
				</div>
			</div>

			{more.open && (
				<Popover anchor={more.anchor} onClose={more.close} placement="top" align="end" width="default" label={t("composer.queueMore")}>
					<MenuBody>
						<MenuItem icon={<PencilLine size={14} />} onClick={edit}>
							{t("composer.queueEdit")}
						</MenuItem>
						<MenuItem icon={<MessageSquarePlus size={14} />} onClick={aside}>
							{t("composer.queueSideChat")}
						</MenuItem>
					</MenuBody>
				</Popover>
			)}
		</div>
	);
}
