import { useI18n } from "../../i18n/index.ts";
import { Copy, ExternalLink, Globe, Server, Square, X, CircleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { SessionServices as Services } from "../../../shared/session-services.ts";
import { bridge, onPhone } from "../../services/index.ts";
import { useApp } from "../../store/index.ts";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { ScrollText } from "../../ui/scroll/ScrollText.tsx";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import { commandBrowser } from "../browser/index.ts";

const cache = new Map<string, Services>();
export function SessionServices() {
	const { t } = useI18n();
	const sessionId = useApp((state) => state.activeSessionId);
	const [snapshot, setSnapshot] = useState<{ id: string; value: Services } | null>(null);
	const [busy, setBusy] = useState<string | null>(null);
	const root = useRef<HTMLDivElement>(null);
	const confirm = useConfirmer();
	useEffect(() => {
		if (!sessionId || onPhone()) return;
		let live = true, timer: ReturnType<typeof setTimeout>;
		const refresh = async () => {
			try {
				if (!document.hidden && root.current?.getBoundingClientRect().width) {
					const value = await bridge.services.list(sessionId);
					if (live) { cache.set(sessionId, value); setSnapshot({ id: sessionId, value }); }
				}
			} catch (error) {
				if (live) setSnapshot({ id: sessionId, value: { jobs: cache.get(sessionId)?.jobs ?? [], discoveryError: String(error) } });
			} finally { if (live) timer = setTimeout(() => void refresh(), 2000); }
		};
		void refresh();
		return () => { live = false; clearTimeout(timer); };
	}, [sessionId]);
	const value = sessionId ? snapshot?.id === sessionId ? snapshot.value : cache.get(sessionId) : undefined;
	const jobs = value?.jobs.filter((job) => job.finishedAt === undefined) ?? [];
	const stop = async (id: string, force: boolean) => {
		if (!sessionId) return;
		setBusy(id);
		try {
			if (!await bridge.services.stop(sessionId, id, force)) throw new Error(t("services.exited"));
			const value = await bridge.services.list(sessionId); cache.set(sessionId, value); setSnapshot({ id: sessionId, value });
		} catch (error) { useApp.getState().notify(String(error), "error"); }
		finally { setBusy(null); }
	};
	return <div ref={root} data-session-services>
		{jobs.length > 0 && <div className="flex items-center gap-1.5 px-1.5 pt-3 pb-1 text-caption text-ink-faint"><Server size={12} />{t("services.title")}<span className="ml-auto tabular-nums">{jobs.length}</span>{value?.discoveryError && <span data-ly-tip={t("services.portFailed", { reason: value.discoveryError })}><CircleAlert size={12} /></span>}</div>}
		{jobs.map((job) => <div key={job.id} data-service-id={job.id} className="group/service rounded-lg px-1.5 py-1.5">
			<div className="flex items-center gap-1.5">
				<span className={`h-1.5 w-1.5 shrink-0 rounded-full ${job.status === "failed" ? "bg-danger" : "bg-ok/70"}`} />
				<ScrollText text={job.command} className="min-w-0 flex-1 text-detail text-ink-muted" />
				<span className="text-caption text-ink-faint tabular-nums" data-ly-tip={t("services.pid", { pid: job.pid ?? t("common.unknown") })}>{job.status === "stopping" ? t("services.stopping") : job.pid}</span>
				<div className="flex shrink-0 opacity-0 transition-opacity group-hover/service:opacity-100 group-focus-within/service:opacity-100">
					<IconButton size="sm" label={t("services.stop")} disabled={busy === job.id || job.status === "stopping"} icon={<Square size={12} />} onClick={() => void stop(job.id, false)} />
					<IconButton size="sm" label={t("services.kill")} disabled={busy === job.id} tone="danger" icon={<X size={13} />} onClick={() => confirm.ask({ title: t("services.killConfirm"), detail: job.command, confirmLabel: t("services.killLabel"), onConfirm: () => void stop(job.id, true) })} />
				</div>
			</div>
			{job.endpoints.map((endpoint) => <div key={`${endpoint.pid}:${endpoint.address}:${endpoint.port}`} className="flex items-center gap-1.5 pl-3 text-caption text-ink-faint">
				<ScrollText text={`${endpoint.address}:${endpoint.port}`} className="min-w-0 flex-1 font-mono" />
				{endpoint.url && <><IconButton size="sm" label={t("services.openBuiltin")} icon={<Globe size={12} />} onClick={() => void commandBrowser({ type: "open", url: endpoint.url!, sessionId, newTab: true })} /><IconButton size="sm" label={t("services.openSystem")} icon={<ExternalLink size={12} />} onClick={() => void bridge.system.openExternal(endpoint.url!)} /></>}
				<IconButton size="sm" label={t("services.copyUrl")} icon={<Copy size={12} />} onClick={() => void bridge.clipboard.write(endpoint.url ?? `${endpoint.address}:${endpoint.port}`)} />
			</div>)}
			{job.error && <p className="pl-3 text-caption text-danger">{job.error}</p>}
		</div>)}
		{confirm.element}
	</div>;
}
