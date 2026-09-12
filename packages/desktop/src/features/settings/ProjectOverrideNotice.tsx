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

import { useI18n } from "../../i18n/index.ts";
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

const useProjectLayer = create<LayerState>((set) => ({
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
	const { t } = useI18n();
	const hits = view.overrides.filter((one) => keys.some((key) => one.key === key || one.key.startsWith(`${key}.`)));
	const refused = view.refused.filter((key) => keys.includes(key));
	if (hits.length === 0 && refused.length === 0) return null;
	return (
		<Card className="mb-6 border-accent/35 bg-accent/6">
			<div className="px-4 py-3" data-project-override>
				<div className="mb-1.5 flex items-center gap-1.5 text-label text-accent">
					<TriangleAlert size={13} strokeWidth={1.9} />
					{t("override.title")}
				</div>
				{hits.map((one) => (
					<div key={one.key} className="py-0.5 text-detail" data-project-override-key={one.key}>
						<span className="font-mono text-ink">{one.key}</span>
						<span className="text-ink-muted">
							{" "}
							{t("override.globalHere")} <span className="font-mono">{brief(one.global)}</span>{" "}
							{t("override.inThisProject")}
							<span className="text-accent">{t("override.hasNoEffect")}</span>
							{t("override.setTo", { mode: t(one.kind === "array" ? "override.replaced" : "override.overrode") })}{" "}
							<span className="font-mono">{brief(one.project)}</span>
						</span>
					</div>
				))}
				{refused.map((key) => (
					<div key={key} className="py-0.5 text-detail text-ink-muted" data-project-refused-key={key}>
						<span className="font-mono text-ink">{key}</span> {t("override.notAllowed")}
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
	const { t } = useI18n();
	return (
		<Card className="mb-6">
			<div className="px-4 py-3" data-project-layer>
				<div className="mb-1 text-label text-ink">{t("override.projectConfig")}</div>
				<p className="mb-2 font-mono text-caption text-ink-faint">{view.path}</p>
				{view.error && <p className="mb-2 text-detail text-danger">{view.error}</p>}
				{view.overrides.length === 0 && view.refused.length === 0 && !view.error && (
					<p className="text-detail text-ink-muted">{t("override.nothingOverridden")}</p>
				)}
				{view.overrides.map((one) => (
					<div key={one.key} className="py-0.5 text-detail" data-project-layer-key={one.key}>
						<span className="font-mono text-ink">{one.key}</span>
						<div className="ml-3 text-ink-muted">
							{t("override.projectValue")} <span className="font-mono">{brief(one.project)}</span>
						</div>
						<div className="ml-3 text-ink-muted">
							{t("override.globalValue")} <span className="font-mono">{brief(one.global)}</span>{" "}
							<span className="text-accent">
								{t("override.overriddenNote", { mode: t(one.kind === "array" ? "override.replaced" : "override.overrode") })}
							</span>
						</div>
					</div>
				))}
				{view.refused.map((key) => (
					<div key={key} className="py-0.5 text-detail text-ink-muted" data-project-layer-refused={key}>
						<span className="font-mono text-ink">{key}</span> {t("override.repoBanned")}
					</div>
				))}
			</div>
		</Card>
	);
}
