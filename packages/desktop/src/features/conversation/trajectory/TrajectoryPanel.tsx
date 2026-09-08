import { History, Coins, Terminal, Zap } from "lucide-react";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { freshTokens } from "@lyra/core/tokens";
import { countBySource, entryKey, filterTrajectory, type Entry, type Source, type TrajectoryFilter } from "@lyra/core/trajectory-view";
import { PanelEmpty } from "../../../ui/layout/PanelEmpty.tsx";
import { SearchField } from "../../../ui/inputs/SearchField.tsx";
import { formatTokens } from "../../../lib/format-tokens.ts";
import { TraceActions } from "./TraceActions.tsx";
import { useApp } from "../../../store/index.ts";
import { useOpenFile } from "../../../store/openFile.ts";
import { useDock, companionOf } from "../../dock/index.ts";
import { SourceFilter } from "./SourceFilter.tsx";
import { useTrajectory } from "./useTrajectory.ts";
import { TraceList } from "./TraceList.tsx";
import { TraceInspector } from "./TraceInspector.tsx";
import { TraceTimeline, type TimeRange } from "./TraceTimeline.tsx";
import { consumeTraceFocus, useTraceFocus } from "./navigation.ts";
import { available, bridge } from "../../../services/index.ts";
import { useI18n } from "../../../i18n/index.ts";

export function TrajectoryPanel() {
	const { t } = useI18n();
	const meta = useApp(state => state.meta);
	return meta ? <SessionTrajectory key={meta.id} /> : <PanelEmpty icon={History} title={t("trajectory.title")}>{t("trajectory.openConversation")}</PanelEmpty>;
}

function SessionTrajectory() {
	const { t } = useI18n();
	const meta = useApp(state => state.meta);
	const { all, loading, refreshing, error, refresh } = useTrajectory();
	const controls = useRef<HTMLDivElement>(null);
	const [following, setFollowing] = useState(true);
	const [sources, setSources] = useState<Source[]>([]);
	const [query, setQuery] = useState("");
	const deferredQuery = useDeferredValue(query);
	const [status, setStatus] = useState<TrajectoryFilter["status"]>();
	const [time, setTime] = useState<TimeRange | null>(null);
	const [selected, setSelected] = useState<string | null>(null);
	const [target, setTarget] = useState<string | null>(null);
	const [collapsed, setCollapsed] = useState(new Set<number>());
	const focus = useTraceFocus();
	const sessionId = meta?.id;
	const counts = useMemo(() => countBySource(all), [all]);
	const entries = useMemo(() => filterTrajectory(all, { sources, query: deferredQuery, status }), [all, sources, deferredQuery, status]);
	const matches = useMemo(() => new Set(entries.map(entryKey)), [entries]);
	const focused = useMemo(() => time ? new Set(filterTrajectory(entries, { time }).map(entryKey)) : null, [entries, time]);
	const byId = useMemo(() => new Map(all.map(entry => [entryKey(entry), entry])), [all]);
	const picked = selected ? byId.get(selected) : undefined;
	const totals = useMemo(() => {
		const requests = new Set(all.filter(entry => entry.source === "request").flatMap(entry => entry.linkedSeqs ?? []));
		return all.reduce((total, entry) => {
			// Fresh tokens, as everywhere else — see `freshTokens`. Cost is unaffected: it already
			// prices each bucket at its own rate.
			if (entry.usage && (entry.source === "request" || !requests.has(entry.seq))) { total.tokens += freshTokens(entry.usage); total.cost += entry.usage.cost.total; }
			if (entry.source === "tool-call") total.tools++;
			return total;
		}, { tokens: 0, cost: 0, tools: 0 });
	}, [all]);
	const navigate = useCallback((entry: Entry) => {
		setCollapsed(previous => { const next = new Set(previous); if (entry.turn !== undefined) next.delete(entry.turn); return next; });
		setSelected(entryKey(entry)); setTarget(entryKey(entry));
	}, []);
	const select = useCallback((entry: Entry) => { setTarget(null); setSelected(entryKey(entry)); }, []);
	const collapse = useCallback((turn: number) => setCollapsed(previous => { const next = new Set(previous); if (next.has(turn)) next.delete(turn); else next.add(turn); return next; }), []);
	useEffect(() => {
		if (!sessionId || focus.sessionId !== sessionId || !focus.correlationId) return;
		const entry = all.find(entry => entry.correlationId === focus.correlationId && entry.source === "tool-call");
		if (entry) { setSources([]); setQuery(""); setStatus(undefined); setTime(null); setCollapsed(new Set()); setSelected(entryKey(entry)); setTarget(entryKey(entry)); consumeTraceFocus(focus.nonce); }
	}, [focus.nonce, focus.sessionId, focus.correlationId, sessionId, all]);
	const exportFile = async (format: "md" | "json" | "output", entry?: Entry) => {
		if (!meta) return;
		try {
			const path = await bridge.sessions.exportTrajectory(meta.projectId, meta.id, format, entry ? { id: entryKey(entry) } : undefined);
			await useOpenFile.getState().open({ path, name: path.split(/[\\/]/).pop() || path, isDirectory: false, size: 0 });
			useDock.getState().open("file", companionOf("file"));
			setSelected(null);
		} catch (error) { useApp.getState().notify(String(error), "error"); }
	};
	const fork = async () => {
		if (!meta || !picked) return;
		try { const result = await bridge.sessions.fork(meta.projectId, meta.id, picked.seq); if (result) await useApp.getState().openSession(result.meta); else throw new Error(t("trajectory.forkFailed")); }
		catch (error) { useApp.getState().notify(String(error), "error"); }
	};
	const selectedIndex = entries.findIndex(entry => entryKey(entry) === selected);
	const closeDetails = () => {
		setSelected(null); setTarget(null);
		requestAnimationFrame(() => {
			const row = [...(controls.current?.parentElement?.querySelectorAll<HTMLButtonElement>("[data-trace-entry]") ?? [])].find(element => element.dataset.traceEntry === selected);
			(row ?? controls.current?.querySelector("input"))?.focus({ preventScroll: true });
		});
	};
	return <div className="ly-trajectory flex min-h-0 min-w-0 flex-1 flex-col" data-trajectory onKeyDown={event => { if (event.key === "Escape" && selected && !event.defaultPrevented) { event.stopPropagation(); closeDetails(); } }}>
		<div ref={controls} className="flex shrink-0 items-center gap-1 px-2 pt-1.5 pb-1" role="toolbar" aria-label={t("trajectory.toolbar")}>
			<SearchField value={query} onChange={setQuery} placeholder={t("trajectory.search")} className="min-w-0 flex-1" />
			<SourceFilter selected={sources} counts={counts} status={status} onStatus={setStatus} onToggle={source => setSources(current => current.includes(source) ? current.filter(value => value !== source) : [...current, source])} onClear={() => setSources([])} />
			<TraceActions refreshing={refreshing} collapsed={collapsed.size > 0} onRefresh={refresh} onExport={available("sessions", "exportTrajectory") ? format => void exportFile(format) : undefined} onCollapse={() => setCollapsed(collapsed.size ? new Set() : new Set(all.flatMap(entry => entry.turn === undefined ? [] : [entry.turn])))} />
		</div>
		<TraceTimeline entries={all} range={time} selected={selected} onRange={setTime} onSelect={navigate} matches={matches} paused={!following || Boolean(picked)} />
		<div className="flex shrink-0 items-center gap-2 whitespace-nowrap px-3 text-caption text-ink-faint tabular-nums" data-trace-count aria-live="polite">
			<span data-ly-tip={t("trajectory.countOf", { shown: entries.length, total: all.length })}>{focused ? t("trajectory.focused", { n: focused.size }) : `${entries.length}/${all.length}`}</span>
			<span className="ml-auto flex items-center gap-1" data-ly-tip={t("trajectory.toolCalls", { n: totals.tools })}><Terminal size={11} />{formatTokens(totals.tools)}</span>
			<span className="flex items-center gap-1" data-ly-tip={`${totals.tokens.toLocaleString()} tokens`}><Zap size={11} />{formatTokens(totals.tokens)}</span>
			{totals.cost > 0 && <span className="flex items-center gap-1" data-ly-tip={t("trajectory.estimatedCost", { cost: totals.cost.toFixed(4) })}><Coins size={11} />${totals.cost.toFixed(2)}</span>}
		</div>
		{error && <p role="alert" className="px-3 py-1 text-caption text-danger">读取失败：{error}</p>}
		{loading ? <p role="status" className="px-3 py-2 text-caption text-ink-faint">{t("trajectory.loading")}</p> : !entries.length && <p className="px-3 py-2 text-caption text-ink-faint">{all.length ? t("trajectory.noMatch") : t("trajectory.empty")}</p>}
		{picked && !matches.has(entryKey(picked)) && <div className="px-3 py-1 text-caption text-ink-muted">{t("trajectory.filteredOut")} <button type="button" className="text-info" onClick={() => { setSources([]); setQuery(""); setStatus(undefined); navigate(picked); }}>{t("trajectory.locateAndClear")}</button></div>}
		<div className="ly-trace-body" data-has-detail={Boolean(picked)}>
			<div className="ly-trace-ledger">
				<TraceList entries={entries} selected={selected} onSelect={select} resetKey={JSON.stringify([sources, deferredQuery, status])} collapsed={collapsed} onCollapse={collapse} target={target} focused={focused} paused={Boolean(picked || time)} onFollowing={setFollowing} />
			</div>
			{picked && <TraceInspector anchor={controls.current} entry={picked} all={all} query={deferredQuery} onSelect={navigate} onClose={closeDetails} onExport={() => void exportFile("json", picked)} onOutput={() => void exportFile("output", picked)} onFork={() => void fork()} previous={selectedIndex > 0 ? () => navigate(entries[selectedIndex - 1]) : undefined} next={selectedIndex >= 0 && selectedIndex < entries.length - 1 ? () => navigate(entries[selectedIndex + 1]) : undefined} />}
		</div>
	</div>;
}
