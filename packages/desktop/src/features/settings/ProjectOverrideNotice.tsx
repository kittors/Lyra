/**
 * "This page cannot change that here" — the project layer, said out loud (14 §3).
 *
 * Arrays replace rather than merge, which is the right choice (append semantics cannot express
 * removing an entry) and the one people trip over: a project listing one disabled rule replaces
 * the global list entirely, and the toggle on this page goes on toggling a value nothing reads.
 * omp can only warn about this in its docs. A page can show it beside the control it affects.
 *
 * Two shapes: a notice for the keys one page owns, and a card that lists everything the project
 * file changes, for the general page. Both read the same answer; the data is fetched once per
 * workspace and kept in a small store so five pages do not make five calls.
 */

import type { ProjectLayerView } from "../../../electron/ipc-types.ts";
import { TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { create } from "zustand";
import { useApp } from "../../store/index.ts";
import { bridge } from "../../services/index.ts";
import { Card } from "./controls.tsx";

interface LayerState {
	cwd: string | null;
	view: ProjectLayerView | null;
	load(cwd: string): Promise<void>;
}

export const useProjectLayer = create<LayerState>((set) => ({
	cwd: null,
	view: null,
	async load(cwd) {
		const view = await bridge.settings.layers(cwd).catch(() => null);
		set({ cwd, view });
	},
}));

/** Keep the store current for the open workspace, and re-read after any settings save. */
function useLayerSync(): ProjectLayerView | null {
	const workspace = useApp((s) => s.workspace);
	const settings = useApp((s) => s.settings);
	const view = useProjectLayer((s) => s.view);
	useEffect(() => {
		if (workspace?.path) void useProjectLayer.getState().load(workspace.path);
	}, [workspace?.path, settings]);
	return workspace?.path ? view : null;
}

/** A value as it would be written, cut short: the page is saying *which*, not reproducing the file. */
export function brief(value: unknown, max = 96): string {
	const text = JSON.stringify(value) ?? String(value);
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function ProjectOverrideNotice({ keys }: { keys: string[] }) {
	const view = useLayerSync();
	if (!view) return null;
	return <OverrideNotice view={view} keys={keys} />;
}

/** The notice, given its data — what a test mounts. */
export function OverrideNotice({ view, keys }: { view: ProjectLayerView; keys: string[] }) {
	const hits = view.overrides.filter((one) => keys.some((key) => one.key === key || one.key.startsWith(`${key}.`)));
	const refused = view.refused.filter((key) => keys.includes(key));
	if (hits.length === 0 && refused.length === 0) return null;
	return (
		<Card className="mb-6 border-accent/35 bg-accent/6">
			<div className="px-4 py-3" data-project-override>
				<div className="mb-1.5 flex items-center gap-1.5 text-label text-accent">
					<TriangleAlert size={13} strokeWidth={1.9} />
					这个项目的配置文件改写了这一页的设置
				</div>
				{hits.map((one) => (
					<div key={one.key} className="py-0.5 text-detail" data-project-override-key={one.key}>
						<span className="font-mono text-ink">{one.key}</span>
						<span className="text-ink-muted">
							{" "}
							在这里改的全局值 <span className="font-mono">{brief(one.global)}</span> 在这个项目里
							<span className="text-accent">不生效</span>——被项目值{one.kind === "array" ? "整体替换" : "覆盖"}为{" "}
							<span className="font-mono">{brief(one.project)}</span>
						</span>
					</div>
				))}
				{refused.map((key) => (
					<div key={key} className="py-0.5 text-detail text-ink-muted" data-project-refused-key={key}>
						<span className="font-mono text-ink">{key}</span> 出现在项目文件里，但这个键不允许放在仓库里，已被忽略
					</div>
				))}
				<p className="mt-1 font-mono text-caption text-ink-faint" data-project-override-path>
					{view.path}
				</p>
			</div>
		</Card>
	);
}

/** Everything the project file changes, for the general page. */
export function ProjectLayerCard() {
	const view = useLayerSync();
	if (!view || !view.exists) return null;
	return <LayerCard view={view} />;
}

export function LayerCard({ view }: { view: ProjectLayerView }) {
	return (
		<Card className="mb-6">
			<div className="px-4 py-3" data-project-layer>
				<div className="mb-1 text-label text-ink">这个项目的配置</div>
				<p className="mb-2 font-mono text-caption text-ink-faint">{view.path}</p>
				{view.error && <p className="mb-2 text-detail text-danger">{view.error}</p>}
				{view.overrides.length === 0 && view.refused.length === 0 && !view.error && (
					<p className="text-detail text-ink-muted">它没有改写任何全局值——里面的键要么全局没设过，要么两边一样。</p>
				)}
				{view.overrides.map((one) => (
					<div key={one.key} className="py-0.5 text-detail" data-project-layer-key={one.key}>
						<span className="font-mono text-ink">{one.key}</span>
						<div className="ml-3 text-ink-muted">
							项目值 <span className="font-mono">{brief(one.project)}</span>
						</div>
						<div className="ml-3 text-ink-muted">
							全局值 <span className="font-mono">{brief(one.global)}</span>{" "}
							<span className="text-accent">⚠ 被项目值{one.kind === "array" ? "整体替换" : "覆盖"}，不生效</span>
						</div>
					</div>
				))}
				{view.refused.map((key) => (
					<div key={key} className="py-0.5 text-detail text-ink-muted" data-project-layer-refused={key}>
						<span className="font-mono text-ink">{key}</span> 不允许放在仓库文件里，已被忽略
					</div>
				))}
			</div>
		</Card>
	);
}
