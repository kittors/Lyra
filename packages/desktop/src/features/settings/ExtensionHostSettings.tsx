/**
 * What the extensions are doing — the page the plan calls observability (10 §7.3, 16 §8).
 *
 * An extension runs in a worker and answers events; nothing on the conversation surface says
 * whether it answered, how long it took, or that it has been switched off for timing out three
 * times. This page does: every extension, every event it asked for, the count and the p95 for
 * each, the last error, and the breaker state. Polled while open, because the numbers move with
 * the turn.
 *
 * The list is separate from the fetching so a test can mount it with numbers of its own.
 */

import type { ExtensionDiagnostic, ExtensionStats } from "@lyra/core";
import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../../store/index.ts";
import { bridge } from "../../services/index.ts";
import { Badge, Card, EmptyHint } from "./controls.tsx";

const POLL_MS = 2000;

export function ExtensionHostSettings({ filter = "" }: { filter?: string }) {
	const sessionId = useApp((s) => s.activeSessionId);
	const workspace = useApp((s) => s.workspace);
	const [data, setData] = useState<Awaited<ReturnType<typeof bridge.extensions.stats>> | null>(null);

	useEffect(() => {
		let gone = false;
		const tick = () => {
			void bridge.extensions
				.stats(sessionId, workspace?.path ?? "")
				.then((next) => {
					if (!gone) setData(next);
				})
				.catch(() => {});
		};
		tick();
		const timer = window.setInterval(tick, POLL_MS);
		return () => {
			gone = true;
			window.clearInterval(timer);
		};
	}, [sessionId, workspace?.path]);

	if (data === null) return null;
	const needle = filter.trim().toLowerCase();
	const shown = data.extensions.filter((one) => !needle || `${one.name} ${one.description ?? ""}`.toLowerCase().includes(needle));
	return <ExtensionStatsList live={data.live} extensions={shown} diagnostics={data.diagnostics} />;
}

export function ExtensionStatsList({
	live,
	extensions,
	diagnostics,
}: {
	/** Whether these numbers come from a running session, or the page is reading manifests off disk. */
	live: boolean;
	extensions: ExtensionStats[];
	diagnostics: ExtensionDiagnostic[];
}) {
	if (extensions.length === 0 && diagnostics.length === 0) {
		return (
			<EmptyHint>
				还没有扩展。
				<br />
				在 <span className="font-mono">.lyra/extensions/{"<名字>"}/</span> 放一个 <span className="font-mono">extension.json</span>{" "}
				和它指向的入口文件，下一个会话就会加载。
			</EmptyHint>
		);
	}
	return (
		<div data-extension-stats={live ? "live" : "idle"}>
			{!live && (
				<p className="mb-3 text-detail text-ink-muted">现在没有打开的会话，下面只是磁盘上的清单；数字要等一个会话跑起来。</p>
			)}
			{extensions.map((one) => (
				<Card key={one.dir} className="mb-3">
					<div className="px-4 py-3" data-extension={one.name}>
						<div className="flex flex-wrap items-center gap-2">
							<span className="text-label text-ink">{one.name}</span>
							{one.version && <span className="text-caption text-ink-faint">v{one.version}</span>}
							<StateBadge state={one.state} />
							<Badge tone="muted">{one.intercepts ? "可拦截" : "只观察"}</Badge>
							<span className="min-w-2 flex-1" />
							{one.failures > 0 && (
								<span className="text-caption text-ink-faint" data-extension-failures>
									已失败 {one.failures} 次
								</span>
							)}
						</div>
						{one.description && <p className="mt-0.5 text-detail text-ink-muted">{one.description}</p>}
						<p className="mt-0.5 font-mono text-caption text-ink-faint" data-ly-tip={one.dir}>
							{one.dir}
						</p>
						{one.perEvent.length === 0 ? (
							<p className="mt-2 text-detail text-ink-faint">没有订阅任何事件——它什么都收不到。</p>
						) : (
							<table className="mt-2 w-full text-detail tabular-nums" data-extension-events>
								<thead>
									<tr className="text-caption text-ink-faint">
										<th className="py-0.5 text-left font-normal">事件</th>
										<th className="py-0.5 text-right font-normal">调用</th>
										<th className="py-0.5 text-right font-normal">错误</th>
										<th className="py-0.5 text-right font-normal">超时</th>
										<th className="py-0.5 text-right font-normal">p95</th>
									</tr>
								</thead>
								<tbody>
									{one.perEvent.map((row) => (
										<tr key={row.event} data-extension-event={row.event} className="text-ink-muted">
											<td className="py-0.5 font-mono">{row.event}</td>
											<td className="py-0.5 text-right">{row.calls}</td>
											<td className={`py-0.5 text-right ${row.errors > 0 ? "text-danger" : ""}`}>{row.errors}</td>
											<td className={`py-0.5 text-right ${row.timeouts > 0 ? "text-danger" : ""}`}>{row.timeouts}</td>
											<td className="py-0.5 text-right" data-extension-p95>
												{row.p95Ms === null ? "—" : `${formatMs(row.p95Ms)}`}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
						{one.lastError && (
							<p className="mt-2 text-detail text-danger" data-extension-last-error>
								最近一次出错：<span className="font-mono">{one.lastError.event}</span> — {one.lastError.message}
							</p>
						)}
					</div>
				</Card>
			))}
			{diagnostics.length > 0 && (
				<Card className="mb-3 border-accent/35 bg-accent/6">
					<div className="px-4 py-3">
						<div className="mb-2 flex items-center gap-1.5 text-label text-accent">
							<TriangleAlert size={13} strokeWidth={1.9} />
							宿主记下的 {diagnostics.length} 条
						</div>
						{diagnostics.map((diagnostic, i) => (
							// Diagnostics are an append-only log; position is identity.
							<div key={`${i}-${diagnostic.message}`} className="py-0.5 text-detail text-accent/85" data-extension-diagnostic>
								<span className="font-mono">{diagnostic.extension}</span> — {diagnostic.message}
							</div>
						))}
					</div>
				</Card>
			)}
		</div>
	);
}

function StateBadge({ state }: { state: ExtensionStats["state"] }) {
	if (state === "running") return <Badge tone="ok">运行中</Badge>;
	if (state === "tripped") return <Badge tone="danger">已熔断</Badge>;
	if (state === "exited") return <Badge tone="danger">已退出</Badge>;
	return <Badge tone="muted">未加载</Badge>;
}

/** `0.4 ms`, `12 ms`, `1.8 s` — one shape per scale, which is how a column stays readable. */
export function formatMs(ms: number): string {
	if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`;
	if (ms >= 10) return `${Math.round(ms)} ms`;
	return `${ms.toFixed(1)} ms`;
}
