/**
 * What is installed, and whether it is on.
 *
 * That is the whole page: a row per plugin — its mark, its name and version, one line about it — a
 * switch, and a ⋯ for the rest. 更新 appears on the row when the registry has a newer version and
 * automatic updating has not got to it yet. Everything else about a plugin (its skills, its licence,
 * its repository, things to try) is its page in the market, which 查看详情 opens.
 */

import { useI18n } from "../../i18n/index.ts";
import type { Plugin } from "@lyra/core";
import { ArrowUp, FolderOpen, MoreHorizontal, Store, TriangleAlert, Trash2 } from "lucide-react";
import { useState } from "react";

import { Confirm } from "../../ui/overlay/Confirm.tsx";
import { MenuBody, MenuItem, MenuSeparator, Popover, usePopover } from "../../ui/overlay/Popover.tsx";
import { ActionSpinner } from "../../ui/motion/loaders.tsx";
import { useApp } from "../../store/index.ts";
import { SkeletonList, useSlowLoad } from "../../ui/primitives/Skeleton.tsx";
import { settingsAfterToggle, useLocalScan, type MarketMark } from "../plugins/index.ts";
import { Card, ListRow, Toggle } from "./controls.tsx";
import { PluginIcon } from "./PluginIcon.tsx";
import { ProjectOverrideNotice } from "./ProjectOverrideNotice.tsx";
import { bridge } from "../../services/index.ts";

export function PluginsSettings({ filter = "", markOf }: { filter?: string; markOf?: (id?: string, name?: string) => MarketMark | undefined }) {
	const { t } = useI18n();
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);
	const setView = useApp((s) => s.setView);
	const setPluginFocus = useApp((s) => s.setPluginFocus);
	const bumpExtensions = useApp((s) => s.bumpExtensions);
	const updates = useApp((s) => s.pluginUpdates);
	const { scan } = useLocalScan();
	/*
	 * A local scan is usually instantaneous, so the placeholder is for the case where it is not — a
	 * workspace with a lot of skill directories, or a cold filesystem cache.
	 */
	const slow = useSlowLoad(scan === null);

	if (!settings) return null;
	const needle = filter.trim().toLowerCase();
	const plugins = (scan?.plugins ?? []).filter(
		(p) => !needle || `${p.id} ${p.manifest.name ?? ""} ${p.manifest.interface?.shortDescription ?? ""}`.toLowerCase().includes(needle),
	);
	/*
	 * Two lists, because they answer different questions. A problem is a plugin that did not load;
	 * a warning is one that did, with a skill that may not behave as written — a short description,
	 * an `allowed-tools` entry Lyra cannot honour. Counted together, a short description read as a
	 * broken plugin.
	 *
	 * Warnings are counted by skill, because one file can carry several and the header says how many
	 * skills. Problems stay one per line: that header counts problems, and each is its own to fix.
	 */
	const diagnostics = (scan?.pluginDiagnostics ?? []).filter((diagnostic) => diagnostic.severity !== "warning");
	const warnings = (scan?.pluginDiagnostics ?? []).filter((diagnostic) => diagnostic.severity === "warning");
	const warned = new Set(warnings.map((warning) => warning.path)).size;
	const behind = new Set((updates?.outdated ?? []).map((entry) => entry.id));

	/* `*` means "none of them" and is still shown to the user below; the rule for clearing it lives
	   in `settingsAfterToggle`, because the market switches plugins too. */
	const allOff = settings.disabledPlugins.includes("*");

	const toggle = (plugin: Plugin, enabled: boolean) => {
		void saveSettings(settingsAfterToggle(settings, plugin, enabled, scan?.plugins ?? []));
	};

	/** The bundle's own page, in the market — a different view, not a panel in here. */
	const details = (plugin: Plugin) => {
		setPluginFocus(plugin.id);
		setView("plugins");
	};

	return (
		<div>
			<ProjectOverrideNotice keys={["disabledPlugins"]} />
			{diagnostics.length > 0 && (
				<Card className="mb-6 border-accent/35 bg-accent/6">
					<div className="px-4 py-3">
						<div className="mb-2 flex items-center gap-1.5 text-label text-accent">
							<TriangleAlert size={13} strokeWidth={1.9} />
							{t("pluginsSettings.problems", { n: diagnostics.length })}
						</div>
						{/* By position: a path repeats when one file has two diagnostics, and these rows hold no state. */}
						{diagnostics.map((diagnostic, index) => (
							<div key={index} className="py-0.5 text-detail text-accent/85">
								<span className="font-mono">{diagnostic.path}</span> — {diagnostic.message}
							</div>
						))}
					</div>
				</Card>
			)}

			{warnings.length > 0 && (
				<details className="mb-5 rounded-[10px] bg-card/50 px-4 py-2.5 text-detail text-ink-faint">
					<summary className="flex cursor-pointer items-center gap-1.5 text-ink-muted">
						<TriangleAlert size={12} strokeWidth={1.9} />
						{t("pluginsSettings.warnings", { n: warned })}
					</summary>
					<div className="pt-2">
						{warnings.map((warning, index) => (
							<div key={index} className="py-0.5">
								<span className="font-mono">{warning.path}</span> — {warning.message}
							</div>
						))}
					</div>
				</details>
			)}

			{/*
			 * Said out loud, because otherwise the page is a list of plugins that are all off for no
			 * visible reason — indistinguishable from having switched each one off.
			 */}
			{allOff && plugins.length > 0 && (
				<p className="mb-3 rounded-[10px] bg-card/60 px-3 py-2 text-detail leading-relaxed text-ink-muted">
					{t("plugins.settingsSays")} <code className="font-mono">disabledPlugins: ["*"]</code>
					{t("plugins.allOffDetail")}
				</p>
			)}

			{slow ? (
				<SkeletonList count={5} label={t("plugins.reading")} />
			) : scan === null ? null : plugins.length === 0 ? (
				<div className="py-12 text-center">
					<p className="text-label leading-relaxed text-ink-muted">{needle ? t("plugins.noMatch") : t("plugins.empty")}</p>
					{!needle && (
						<button
							type="button"
							onClick={() => {
								setPluginFocus(null);
								setView("plugins");
							}}
							className="mx-auto mt-3 flex h-[32px] items-center gap-1.5 rounded-lg bg-card-hover px-3 text-label text-ink transition-colors duration-[var(--ly-t-quick)] hover:bg-line-soft"
						>
							<Store size={14} strokeWidth={1.8} aria-hidden />
							{t("pluginsSettings.browse")}
						</button>
					)}
				</div>
			) : (
				/* The same inset the rules and MCP lists sit at, so a switch is in one place on every tab. */
				<div className="px-2">
				{plugins.map((plugin) => (
					<PluginRow
						key={plugin.id}
						plugin={plugin}
						outdated={behind.has(plugin.id)}
						updating={updates?.updating.includes(plugin.id) ?? false}
						mark={markOf?.(plugin.id, plugin.manifest.interface?.displayName ?? plugin.manifest.name)}
						onToggle={(enabled) => toggle(plugin, enabled)}
						onDetails={() => details(plugin)}
						onChanged={bumpExtensions}
					/>
				))}
				</div>
			)}
		</div>
	);
}

function PluginRow({
	plugin,
	mark,
	outdated,
	updating,
	onToggle,
	onDetails,
	onChanged,
}: {
	plugin: Plugin;
	/** The market's picture for it, when the bundle's own manifest names none. */
	mark?: MarketMark;
	outdated: boolean;
	updating: boolean;
	onToggle: (enabled: boolean) => void;
	onDetails: () => void;
	onChanged: () => void;
}) {
	const { t } = useI18n();
	const [busy, setBusy] = useState<"update" | "uninstall" | null>(null);
	const menu = usePopover();
	const [confirming, setConfirming] = useState(false);
	const ui = plugin.manifest.interface;
	// The market's name and line when it came from there: curated, and the same words the market card uses.
	const name = mark?.name ?? ui?.displayName ?? plugin.manifest.name ?? plugin.id;
	/** A bundle inside the project's own directory is removed by deleting it there. */
	const removable = plugin.source !== "workspace";

	const uninstall = async () => {
		setBusy("uninstall");
		await bridge.plugins.uninstall(plugin.id);
		setBusy(null);
		onChanged();
	};
	const update = async () => {
		setBusy("update");
		await bridge.plugins.updateAll([plugin.id]).catch(() => undefined);
		setBusy(null);
		onChanged();
	};

	return (
		<>
			<ListRow
				icon={<PluginIcon name={name} logo={ui?.logo ?? mark?.logo} brandColor={ui?.brandColor ?? mark?.brandColor} kind="plugin" size={30} />}
				title={
					<span className="flex min-w-0 items-center gap-2">
						<span className="truncate">{name}</span>
						{plugin.manifest.version && <span className="shrink-0 text-detail text-ink-faint tabular-nums">v{plugin.manifest.version}</span>}
						{plugin.source === "workspace" && <span className="shrink-0 text-caption text-ink-faint">{t("common.project")}</span>}
					</span>
				}
				detail={mark?.description ?? ui?.shortDescription ?? plugin.manifest.description ?? t("market.noTagline")}
				onOpen={onDetails}
				openLabel={t("plugins.openNamed", { name })}
				actions={
					<>
						{(outdated || updating) && (
							<button
								type="button"
								disabled={busy !== null || updating}
								onClick={() => void update()}
								aria-label={t("market.updateNamed", { name })}
								className="flex h-[24px] items-center gap-1 rounded-full bg-accent/12 px-2.5 text-caption font-medium text-accent transition-colors duration-[var(--ly-t-quick)] hover:bg-accent/20 disabled:opacity-60"
							>
								{busy === "update" || updating ? <ActionSpinner size={11} /> : <ArrowUp size={11} strokeWidth={2.2} aria-hidden />}
								{busy === "update" || updating ? t("market.updating") : t("common.update")}
							</button>
						)}
					</>
				}
				/*
				 * Switch, then ⋯ at the far end — the order the MCP cards and the rules list use, so the
				 * switches of all three tabs sit in the same place and the menu is always the last thing.
				 */
				control={
					<div className="flex items-center gap-2">
						<Toggle checked={plugin.enabled} onChange={onToggle} ariaLabel={t("market.enableNamed", { name })} />
						<button
							type="button"
							aria-label={t("plugins.moreFor", { name })}
							data-ly-tip={t("common.more")}
							aria-haspopup="menu"
							aria-expanded={menu.open}
							onClick={menu.toggle}
							className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-ink-faint opacity-0 transition-[color,background-color,opacity] duration-[var(--ly-t-quick)] group-hover/row:opacity-100 hover:bg-card-hover hover:text-ink focus-visible:opacity-100 aria-expanded:opacity-100"
						>
							{busy === "uninstall" ? <ActionSpinner size={13} /> : <MoreHorizontal size={15} strokeWidth={1.9} />}
						</button>
					</div>
				}
			/>

			{/* The question is a modal, so the menu is only ever a menu — see `Confirm`. */}
			{confirming && (
				<Confirm
					title={t("plugins.uninstallConfirm", { name })}
					detail={t("plugins.uninstallDetail")}
					confirmLabel={t("mcp.uninstall")}
					onCancel={() => setConfirming(false)}
					onConfirm={() => {
						setConfirming(false);
						void uninstall();
					}}
				/>
			)}

			{menu.open && (
				<Popover anchor={menu.anchor} onClose={menu.close} placement="bottom" align="end" width="compact" role="menu" label={name}>
					<MenuBody>
						<MenuItem
							icon={<Store size={13} strokeWidth={1.8} />}
							onClick={() => {
								menu.close();
								onDetails();
							}}
						>
							{t("pluginsSettings.details")}
						</MenuItem>
						<MenuItem
							icon={<FolderOpen size={13} strokeWidth={1.8} />}
							onClick={() => {
								menu.close();
								void bridge.system.openPath(plugin.dir);
							}}
						>
							{t("common.openFolder")}
						</MenuItem>
						<MenuSeparator />
						<MenuItem
							danger
							icon={<Trash2 size={13} strokeWidth={1.8} />}
							disabled={busy !== null || !removable}
							title={removable ? undefined : t("plugins.projectScoped")}
							onClick={() => {
								menu.close();
								setConfirming(true);
							}}
						>
							{t("mcp.uninstall")}
						</MenuItem>
					</MenuBody>
				</Popover>
			)}
		</>
	);
}
