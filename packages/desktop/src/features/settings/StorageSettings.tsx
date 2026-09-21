/**
 * 会话记录占了多少地方，以及怎么删掉一段。
 *
 * 这一页最重要的事不是那个按钮，是它下面那句话：**用量页上的每个数字都是从会话记录里现算的，
 * 所以让那些数字消失只有一个办法，就是删掉产生它们的对话。**「清除统计数据」听起来像在清一份
 * 缓存，而它清的是聊天记录——这个误会只要发生一次，代价就是半年的对话。
 *
 * 独立成一页，而不是挂在使用统计底下。那一页是拿来读的，一个不可撤销的删除动作跟在读数后面，
 * 等于让每一次查账都从「不要点错」开始；而这一页问的是另一个问题——这台机器上存着什么、还要
 * 留多久——它和索引库、移动端同步是同一类事，所以落在「数据与统计」那一组里。
 *
 * 排版走 `Row`，不是自己拼一行 flex。数字会变（「78 条 · 330 MB」换成「77 条 · 330 MB」），而
 * 一个 `flex-wrap` 的行在内容变宽一点点时会整组换行——同一块卡片，选完日期之后长得完全是另一
 * 个样子。`Row` 是明确的两列：说明在左，控件在右，右边那列 `shrink-0`，什么都不会跳。
 */

import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { bridge } from "../../services/index.ts";
import { useI18n } from "../../i18n/index.ts";
import { DateRangeField, rangeLabel } from "../../ui/inputs/DateRangeField.tsx";
import { inRange, type DayRange } from "../../ui/inputs/day-range.ts";
import { ActionSpinner } from "../../ui/motion/loaders.tsx";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import type { StorageUse } from "../../../electron/session-cleanup.ts";
import { Card, Row, SectionTitle } from "./controls.tsx";
import { formatBytes } from "./usage-format.ts";

/** 清完之后要说的那句话。 */
interface Done {
	removed: number;
	freed: number;
	skipped: number;
}

export function StorageSettings() {
	const { t } = useI18n();
	const [use, setUse] = useState<StorageUse | null>(null);
	const [range, setRange] = useState<DayRange>({ from: null, to: null });
	const [busy, setBusy] = useState(false);
	const [done, setDone] = useState<Done | null>(null);
	const confirm = useConfirmer();

	const load = useCallback(async () => {
		/*
		 * `try` 而不是 `.catch()`。
		 *
		 * 这个方法不存在的时候——旧版本的窗口、preload 没跑起来——`bridge.usage.storage()` 是**同步**
		 * 抛一个 TypeError，而 `.catch` 只接 promise 的拒绝，接不住它。那个异常会从这个 effect 里
		 * 冒出去，把整张设置页一起带走。
		 */
		try {
			setUse(await bridge.usage.storage());
		} catch {
			// 说不出自己要删掉什么的删除按钮，比没有这个按钮更糟——`use` 为 null 时它按不动。
			setUse(null);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	/**
	 * 选了这一段，会删掉什么——**在按下去之前就算出来**。
	 *
	 * 从前这里用的是总数，于是确认框问「删除全部 4 条会话？约释放 83 KB」，而实际落在所选范围里
	 * 的只有 1 条、25 KB。说多了已经够糟；同一个 bug 反过来（说 1 条删掉 4 条）就是灾难。
	 *
	 * 口径和主进程那一侧是同一个：按会话的最后活动日落不落在这一段里（`session-cleanup.ts` 的
	 * `withinRange`），而 `use.days` 就是按那个日期分的组。
	 */
	const target = useMemo(() => {
		const days = (use?.days ?? []).filter((each) => inRange(each.day, range));
		return {
			sessions: days.reduce((sum, each) => sum + each.sessions, 0),
			bytes: days.reduce((sum, each) => sum + each.bytes, 0),
		};
	}, [use, range]);

	/** 一条会话都没有——这一页只剩一句话，按钮没有东西可按。 */
	const empty = use !== null && use.sessions === 0;
	/** 选了一段，但那一段里一条会话都没有。 */
	const nothing = target.sessions === 0;

	const ask = () => {
		if (!use || empty || nothing) return;
		const all = !range.from && !range.to;
		confirm.ask({
			title: all ? t("cleanup.confirmAll", { n: target.sessions }) : t("cleanup.confirmSome", { n: target.sessions }),
			detail: t("cleanup.confirmDetail", { range: rangeLabel(range), size: formatBytes(target.bytes) }),
			confirmLabel: t("cleanup.clear"),
			onConfirm: () => void run(),
		});
	};

	const run = async () => {
		setBusy(true);
		setDone(null);
		try {
			setDone(await bridge.usage.clear(range));
			await load();
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="pt-8">
			<h1 className="text-display leading-tight font-semibold tracking-tight text-ink">{t("storage.title")}</h1>
			<p className="mt-2 max-w-[580px] pb-7 text-label leading-relaxed text-ink-muted">{t("storage.intro")}</p>

			<SectionTitle>{t("storage.records")}</SectionTitle>
			<Card data-usage-cleanup="true">
				<Row
					title={t("storage.sessionLogs")}
					detail={t("storage.sessionLogsDetail")}
					control={
						<span data-usage-total="true" className="text-label text-ink tabular-nums">
							{use === null ? "—" : t("storage.sizeAndCount", { size: formatBytes(use.bytes), n: use.sessions })}
						</span>
					}
				/>
				<Row
					title={t("cleanup.range")}
					/*
					 * 「这一段里有几条」说在左边，跟着说明文字走。
					 *
					 * 不说的话，唯一能知道会删掉什么的办法是点开那个不可逆动作的确认框——把确认框当成
					 * 信息来源用，等于鼓励人把它读成一道过场。放在左边而不是右边，是因为它每选一次就
					 * 换一个数，而右边那一列是控件的位置，不该跟着数字的位数横向挪动。
					 */
					detail={
						use === null
							? t("storage.rangeDetail")
							: empty
								? t("cleanup.empty")
								: nothing
									? t("cleanup.nothing")
									: t("cleanup.willRemove", { n: target.sessions, size: formatBytes(target.bytes) })
					}
					control={<DateRangeField value={range} onChange={setRange} earliest={use?.earliest ?? null} ariaLabel={t("cleanup.range")} />}
				/>
				<Row
					title={t("storage.clearTitle")}
					detail={
						<>
							{t("cleanup.warn")
								.split("**")
								.map((part, index) => (index % 2 === 1 ? <strong key={index} className="font-medium text-danger">{part}</strong> : part))}
							{done && (
								<span key={`${done.removed}:${done.freed}`} className="ml-1 text-ink-muted animate-[ly-fade-up_var(--ly-t-base)_ease-out] motion-reduce:animate-none">
									{done.removed > 0 ? t("cleanup.doneRemoved", { n: done.removed, size: formatBytes(done.freed) }) : t("cleanup.nothing")}
									{done.skipped > 0 && ` · ${t("cleanup.doneSkipped", { n: done.skipped })}`}
								</span>
							)}
						</>
					}
					control={
						<button
							type="button"
							onClick={ask}
							disabled={busy || use === null || empty || nothing}
							data-usage-clear="true"
							className="flex h-[26px] shrink-0 items-center gap-1.5 rounded-full px-2.5 text-detail text-danger transition-colors duration-[var(--ly-t-quick)] hover:bg-danger/10 disabled:pointer-events-none disabled:opacity-40"
						>
							{busy ? <ActionSpinner size={12} /> : <Trash2 size={12} strokeWidth={1.9} aria-hidden />}
							{busy ? t("cleanup.clearing") : t("cleanup.clear")}
						</button>
					}
				/>
			</Card>

			{confirm.element}
		</div>
	);
}
