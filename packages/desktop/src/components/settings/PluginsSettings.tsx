/**
 * What is installed, and whether it is on.
 *
 * That is the whole page. Every plugin used to arrive here as a card with three badges, two
 * counts, a 详情 disclosure and a 打开目录 link — nine pieces of information for a question with
 * two possible answers, repeated down the page until nothing on it could be found at a glance.
 *
 * Everything that was taken off is still reachable, one click further away and somewhere it makes
 * more sense: the version, the licence, the skills it carries and the servers it declares are the
 * bundle's own page, which exists and says all of it at length. 管理 goes there. The directory is
 * behind the ⋯, where you look for it when you already know you want it.
 */

import type { Plugin } from "@lyra/core";
import { FolderOpen, MoreHorizontal, Settings2, TriangleAlert, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Confirm } from "../Confirm.tsx";
import { MenuBody, MenuItem, MenuSeparator, Popover, usePopover } from "../Popover.tsx";
import { useApp } from "../../store.ts";
import { SkeletonList, useSlowLoad } from "../Skeleton.tsx";
import { settingsAfterToggle } from "../plugins/toggle.ts";
import { Card, ListRow, Toggle } from "./controls.tsx";
import { PluginIcon } from "./PluginIcon.tsx";
import { bridge } from "../../services/index.ts";

export function PluginsSettings({ filter = "" }: { filter?: string }) {
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);
	const workspace = useApp((s) => s.workspace);
	const setView = useApp((s) => s.setView);
	const setPluginFocus = useApp((s) => s.setPluginFocus);
	const extensionsNonce = useApp((s) => s.extensionsNonce);
	const bumpExtensions = useApp((s) => s.bumpExtensions);
	const [scan, setScan] = useState<Awaited<ReturnType<typeof bridge.plugins.list>> | null>(null);
	/*
	 * Declared here, above the early return, because hooks cannot be conditional.
	 *
	 * A local scan is usually instantaneous, so the placeholder is for the case where it is not —
	 * a workspace with a lot of skill directories, or a cold filesystem cache.
	 */
	const slow = useSlowLoad(scan === null);

	const refresh = async () => setScan(await bridge.plugins.list(workspace?.path ?? ""));

	useEffect(() => {
		void refresh();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [workspace?.path, settings?.disabledPlugins.length, extensionsNonce]);

	if (!settings) return null;
	const needle = filter.trim().toLowerCase();
	const plugins = (scan?.plugins ?? []).filter(
		(p) =>
			!needle ||
			`${p.id} ${p.manifest.name ?? ""} ${p.manifest.interface?.shortDescription ?? ""}`
				.toLowerCase()
				.includes(needle),
	);
	const diagnostics = scan?.pluginDiagnostics ?? [];

	/* `*` means "none of them" and is still shown to the user below; the rule for clearing it lives
	   in `settingsAfterToggle`, because the catalogue card switches plugins too. */
	const allOff = settings.disabledPlugins.includes("*");

	const toggle = (plugin: Plugin, enabled: boolean) => {
		void saveSettings(settingsAfterToggle(settings, plugin, enabled, scan?.plugins ?? []));
	};

	/** The bundle's own page, in the catalogue — which is a different view, not a panel in here. */
	const manage = (plugin: Plugin) => {
		setPluginFocus(plugin.id);
		setView("plugins");
	};

	return (
		<div>
			{diagnostics.length > 0 && (
				<Card className="mb-6 border-accent/35 bg-accent/6">
					<div className="px-4 py-3">
						<div className="mb-2 flex items-center gap-1.5 text-label text-accent">
							<TriangleAlert size={13} strokeWidth={1.9} />
							{diagnostics.length} 个插件问题
						</div>
						{diagnostics.map((diagnostic) => (
							<div key={diagnostic.path} className="py-0.5 text-detail text-accent/85">
								<span className="font-mono">{diagnostic.path}</span> — {diagnostic.message}
							</div>
						))}
					</div>
				</Card>
			)}

			{/*
			 * Said out loud, because otherwise the page is a list of plugins that are all off for no
			 * visible reason — indistinguishable from having switched each one off.
			 */}
			{allOff && plugins.length > 0 && (
				<p className="mb-3 rounded-[10px] border border-line-soft px-3 py-2 text-detail leading-relaxed text-ink-muted">
					设置里写着 <code className="font-mono">disabledPlugins: ["*"]</code>，所以下面所有插件都不生效。
					把任意一个拨回「开」会解除这条总开关，其余插件保持当前状态。
				</p>
			)}

			{/*
			 * No 已安装（N） heading.
			 *
			 * The tab above already says 插件 and carries the count, so the heading repeated both
			 * words directly under the thing that had just said them — and it did it on all three
			 * tabs, which made the tabs look like they had not changed anything.
			 */}
			{slow ? (
				<SkeletonList count={5} label="正在读取已安装的插件" />
			) : plugins.length === 0 ? (
				<div className="py-10 text-center">
					<p className="text-label leading-relaxed text-ink-muted">
						{needle ? "没有匹配的插件。" : "还没有插件。去插件市场装一个，或把插件目录放进 ~/.lyra/plugins。"}
					</p>
				</div>
			) : (
				plugins.map((plugin) => (
					<PluginRow
						key={plugin.id}
						plugin={plugin}
						onToggle={(enabled) => toggle(plugin, enabled)}
						onManage={() => manage(plugin)}
						onRemoved={() => {
							void refresh();
							bumpExtensions();
						}}
					/>
				))
			)}
		</div>
	);
}

function PluginRow({
	plugin,
	onToggle,
	onManage,
	onRemoved,
}: {
	plugin: Plugin;
	onToggle: (enabled: boolean) => void;
	onManage: () => void;
	onRemoved: () => void;
}) {
	const [busy, setBusy] = useState(false);
	const menu = usePopover();
	const [confirming, setConfirming] = useState(false);
	const ui = plugin.manifest.interface;
	const name = ui?.displayName ?? plugin.manifest.name ?? plugin.id;
	/** A bundle inside the project's own directory is removed by deleting it there. */
	const removable = plugin.source !== "workspace";

	const close = () => {
		menu.close();
		setConfirming(false);
	};

	const uninstall = async () => {
		setBusy(true);
		await bridge.plugins.uninstall(plugin.id);
		setBusy(false);
		onRemoved();
	};

	return (
		<>
			<ListRow
				icon={<PluginIcon name={name} logo={ui?.logo} brandColor={ui?.brandColor} kind="plugin" size={28} />}
				title={name}
				detail={ui?.shortDescription ?? plugin.manifest.description ?? "（无描述）"}
				onOpen={onManage}
				openLabel={`打开 ${name}`}
				actions={
					<button
						type="button"
						aria-label={`${name} 的更多操作`}
						aria-haspopup="menu"
						aria-expanded={menu.open}
						onClick={menu.toggle}
						className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-ink-faint opacity-0 transition-[color,background-color,opacity] duration-[var(--ly-t-quick)] group-hover/row:opacity-100 hover:bg-card-hover hover:text-ink focus-visible:opacity-100 aria-expanded:opacity-100"
					>
						<MoreHorizontal size={15} strokeWidth={1.9} />
					</button>
				}
				control={<Toggle checked={plugin.enabled} onChange={onToggle} />}
			/>

			{/* The question is a modal now, so the menu is only ever a menu — see `Confirm`. */}
			{confirming && (
				<Confirm
					title={`卸载 ${name}？`}
					detail="它的目录会被删除，随它安装的技能也一起消失。重新安装可以拿回来。"
					confirmLabel="卸载"
					onCancel={() => setConfirming(false)}
					onConfirm={() => {
						setConfirming(false);
						void uninstall();
					}}
				/>
			)}

			{menu.open && (
				<Popover
					anchor={menu.anchor}
					onClose={close}
					placement="bottom"
					align="end"
					width="compact"
					role="menu"
					label={name}
				>
						<MenuBody>
							<MenuItem
								icon={<Settings2 size={13} strokeWidth={1.8} />}
								onClick={() => {
									close();
									onManage();
								}}
							>
								管理
							</MenuItem>
							<MenuItem
								icon={<FolderOpen size={13} strokeWidth={1.8} />}
								onClick={() => {
									close();
									void bridge.system.openPath(plugin.dir);
								}}
							>
								打开目录
							</MenuItem>

							<MenuSeparator />

							<MenuItem
								danger
								icon={<Trash2 size={13} strokeWidth={1.8} />}
								disabled={busy || !removable}
								title={removable ? undefined : "项目里的插件，从项目目录里删"}
								onClick={() => {
									// The menu gives way to the question rather than sitting behind it.
									menu.close();
									setConfirming(true);
								}}
							>
								卸载
							</MenuItem>
						</MenuBody>
				</Popover>
			)}
		</>
	);
}
