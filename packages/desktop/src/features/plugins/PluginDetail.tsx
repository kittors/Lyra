/**
 * One bundle, at length — any of the three kinds — and everything that can be done to it.
 *
 * The grid answers "which one"; this answers "what is in it, do I want it, and is it working". It is
 * the one place in the market where a bundle is *managed*: switched on, given its keys, updated,
 * tried, uninstalled. The card deliberately does none of that (see `CatalogCard`), and 设置 › 插件
 * does the same things as rows in a list for somebody going through what they have.
 *
 * Top to bottom, in the order somebody needs it:
 *
 *   1. what it is — mark, name, a line, who made it, how many use it, and a row of tags (its shelf,
 *      licence, the agents it installs into) ending in its repository and website;
 *   2. the action — 安装, or once installed its switch, 更新 when there is one, and a ⋯ for the rest;
 *   3. its keys, for an MCP server that still has a placeholder — before anything else, because
 *      until they are filled nothing below can work;
 *   4. things to try, and then the bundle at length: its README — the same document the market's
 *      web page shows — with its skills and its servers as tabs beside it.
 *
 * An MCP bundle's switch is here now, one for the whole bundle. It used to send you to 设置 › MCP,
 * on the grounds that its servers each have their own switch there — true, and still true, but a
 * bundle with one server (which is nearly all of them) was two pages away from being turned on.
 */

import type { McpServerConfig } from "@lyra/core";
import { ArrowUp, ArrowUpRight, Cable, ChevronRight, Download, ExternalLink, FolderOpen, Globe, MoreHorizontal, Settings2, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { formatList, useI18n } from "../../i18n/index.ts";
import { useApp } from "../../store/index.ts";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import { MenuBody, MenuItem, MenuSeparator, Popover, usePopover } from "../../ui/overlay/Popover.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { Button } from "../../ui/primitives/Button.tsx";
import { GitHubMark } from "../../ui/primitives/GitHubMark.tsx";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { SkeletonBar } from "../../ui/primitives/Skeleton.tsx";
import { TabStrip, type TabStripItem } from "../../ui/primitives/TabStrip.tsx";
import { TimeAgo } from "../../ui/primitives/TimeAgo.tsx";
import { CLIENT_LABEL } from "@lyra/registry-shared";
import { PluginIcon, safeColour, Toggle } from "../settings/index.ts";
import { isEnabled, isInstalled, UNFILED, type CatalogItem } from "./catalog.ts";
import { compactCount } from "./format.ts";
import { McpKeys, missingOf, useEnvironment } from "./McpKeys.tsx";
import { settingsAfterToggle } from "./toggle.ts";
import { useInstall, type InstallReports } from "./useInstall.ts";
import type { Plugin } from "@lyra/core";
import type { Skill } from "@lyra/core";
import type { AgentCapabilities } from "../../../electron/ipc-types.ts";
import { bridge } from "../../services/index.ts";
import { Markdown } from "../conversation/index.ts";
import { Readme } from "./Readme.tsx";
import { useReadme, type ReadmeResult } from "./useReadme.ts";

export function PluginDetail({
	item,
	installedPlugins,
	localSkills,
	onBack,
	onTry,
	reports,
}: {
	item: CatalogItem;
	/** Every plugin on disk — switching one on through the `*` wildcard has to name the rest. */
	installedPlugins: Plugin[];
	/** The loose skills, for listing what a collection put down. */
	localSkills: Skill[];
	onBack: () => void;
	/** Starts a conversation with this prompt already in the composer. */
	onTry: (prompt: string) => void;
	reports: InstallReports;
}) {
	const { t } = useI18n();
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);
	const openExtensions = useApp((s) => s.openExtensions);
	const activeSessionId = useApp((s) => s.activeSessionId);
	const confirm = useConfirmer();
	const more = usePopover();
	const act = useInstall(item, reports);
	const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);

	const plugin = item.installed;
	const bundle = item.bundle;
	const manifest = plugin?.manifest ?? bundle?.manifest;
	const ui = manifest?.interface;
	const prompts = ui?.defaultPrompt ?? [];
	const installed = isInstalled(item);
	const enabled = isEnabled(item);
	const isMcp = item.kind === "mcp";
	const dir = plugin?.dir ?? bundle?.dir ?? item.collectedIn;
	const brandColour = safeColour(item.brandColor);
	/** A bundle inside the project's own directory is removed by deleting it there. */
	const workspaceOwned = (plugin?.source ?? bundle?.source) === "workspace";
	const present = useEnvironment(item.servers.flatMap((server) => Object.keys(server.env ?? {})).concat(item.needs.map((need) => need.name)));
	const missing = [...new Set(item.servers.flatMap((server) => missingOf(server, present)))];

	// What the running session says about these servers: connected, how many tools, or why not.
	useEffect(() => {
		if (!isMcp || !installed || !activeSessionId) return;
		let alive = true;
		void bridge.sessions
			.capabilities(activeSessionId)
			.then((answer) => alive && setCapabilities(answer))
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, [isMcp, installed, activeSessionId, settings?.mcpServers]);

	/** One switch for the whole thing: a plugin's flag, or every server an MCP bundle brought. */
	const setEnabled = (next: boolean) => {
		if (!settings) return;
		if (plugin) {
			void saveSettings(settingsAfterToggle(settings, plugin, next, installedPlugins));
			return;
		}
		if (bundle) {
			const ids = new Set(item.servers.map((server) => server.id));
			void saveSettings({
				...settings,
				mcpServers: settings.mcpServers.map((server) => (ids.has(server.id) ? ({ ...server, enabled: next } as McpServerConfig) : server)),
			});
		}
	};

	const website = ui?.websiteURL ?? manifest?.homepage ?? item.entry?.homepage;
	const developer = ui?.developerName ?? item.author;
	const version = item.version;
	const license = manifest?.license ?? item.entry?.license;
	const skills = plugin?.skills ?? collectionSkills(item, localSkills);
	const switchable = installed && (plugin !== null || (bundle !== null && item.servers.length > 0));
	const readme = useReadme(item);
	// What stands in for a README when there is none: the long description, or the full line.
	const fallback = ui?.longDescription || (item.description && item.description !== item.tagline ? item.description : "");
	const tabs: TabStripItem<DetailTab>[] = [
		{ id: "overview", label: t("pluginDetail.overview") },
		...(skills.length > 0 ? [{ id: "skills" as const, label: t("common.skills"), count: skills.length }] : []),
		...(isMcp && item.servers.length > 0 ? [{ id: "servers" as const, label: t("market.mcpServers"), count: item.servers.length }] : []),
	];
	const [tab, setTab] = useState<DetailTab>("overview");
	const current = tabs.some((entry) => entry.id === tab) ? tab : "overview";

	return (
		<div className="-mt-11 flex min-h-0 flex-1 flex-col" data-plugin-detail={item.id}>
			<header className="relative z-50 flex h-11 shrink-0 items-center gap-1 px-3">
				<nav className="no-drag flex min-w-0 items-center gap-1 text-label">
					<button
						type="button"
						onClick={onBack}
						className="rounded-lg px-2 py-1 text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:text-ink"
					>
						{t("market.title")}
					</button>
					<ChevronRight size={13} strokeWidth={1.8} className="shrink-0 text-ink-faint" />
					<span className="max-w-[320px] truncate px-1 text-ink">{item.name}</span>
				</nav>
				<div className="flex-1" />
			</header>

			<Scroller className="flex-1" contentClassName="px-6 pb-16">
				<div className="mx-auto w-full max-w-[760px]">
					{/* 1. What it is. */}
					<div className="flex items-start gap-4 pt-5">
						<PluginIcon
							name={item.name}
							id={item.id}
							logo={item.logo}
							brandColor={item.brandColor}
							category={item.category}
							kind={item.kind}
							size={60}
						/>
						<div className="min-w-0 flex-1 pt-0.5">
							<div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
								<h1 className="text-heading leading-tight font-semibold tracking-tight text-ink">{item.name}</h1>
								<span className="rounded-md bg-card-hover px-1.5 text-caption leading-[20px] text-ink-muted">
									{isMcp ? "MCP" : item.kind === "skill" ? t("common.skills") : t("common.plugins")}
								</span>
							</div>
							<p className="pt-1 text-label leading-relaxed text-ink-muted">{item.tagline || item.description || t("market.noTagline")}</p>
							<Facts item={item} developer={developer} version={version} />
							<Tags item={item} license={license} website={website} />
						</div>
					</div>

					{/* 2. The action. */}
					<div className="flex flex-wrap items-center gap-2 pt-5">
						{!installed ? (
							item.entry && (
								<Button
									variant="primary"
									loading={act.busy === "install"}
									icon={<Download size={14} strokeWidth={2} aria-hidden />}
									onClick={() => void act.install()}
								>
									{act.busy === "install" ? t("market.installing") : t("common.install")}
								</Button>
							)
						) : (
							<>
								{switchable && (
									<label className="flex h-[32px] items-center gap-2.5 rounded-lg bg-card-hover/70 pr-2 pl-3 text-label text-ink">
										{enabled ? t("market.enabled") : t("market.disabled")}
										<Toggle checked={enabled} onChange={setEnabled} ariaLabel={t("market.enableNamed", { name: item.name })} />
									</label>
								)}
								{item.collected > 0 && (
									<span className="flex h-[32px] items-center rounded-lg bg-card-hover/70 px-3 text-label text-ink-muted">
										{t("market.skillsInstalled", { n: item.collected })}
									</span>
								)}
								{item.outdated && item.entry && (
									<Button
										variant="subtle"
										loading={act.busy === "update"}
										icon={<ArrowUp size={14} strokeWidth={2.2} aria-hidden />}
										onClick={() => void act.update()}
										className="bg-accent/12 text-accent hover:bg-accent/20 hover:text-accent"
									>
										{item.entry.version ? t("catalogCard.updateTo", { version: `v${item.entry.version}` }) : t("catalogCard.updateToLatest")}
									</Button>
								)}
								<Button
									variant="subtle"
									label={t("common.more")}
									icon={<MoreHorizontal size={16} strokeWidth={1.9} aria-hidden />}
									onClick={more.toggle}
								/>
							</>
						)}
					</div>
					{!installed && item.needs.some((need) => !need.optional) && (
						<p className="pt-3 text-detail leading-relaxed text-ink-muted">
							{t("market.needsKeysBefore", { names: formatList(item.needs.filter((need) => !need.optional).map((need) => need.name)) })}
						</p>
					)}

					{/* 3. Keys, before anything that depends on them. */}
					{installed && isMcp && item.needs.length > 0 && (
						<section className="mt-7 rounded-xl bg-card/60 px-5 py-4" data-detail-keys="">
							<div className="flex items-center gap-2 pb-3">
								<h2 className="text-body font-medium text-ink">{t("mcpKeys.title")}</h2>
								{missing.length > 0 ? (
									<span className="text-detail text-accent">{t("mcpKeys.missing", { n: missing.length })}</span>
								) : (
									<span className="text-detail text-ok">{t("mcpKeys.ready")}</span>
								)}
							</div>
							<McpKeys servers={item.servers} notes={item.needs} />
							{missing.length === 0 && !enabled && <p className="pt-3 text-detail text-ink-muted">{t("mcpKeys.nowEnable")}</p>}
						</section>
					)}

					{/*
					 * 4a. Things to try, on the bundle's own colour — only for something installed and on,
					 * since each is a button that starts a conversation that relies on it.
					 */}
					{prompts.length > 0 && enabled && missing.length === 0 && (
						<section
							style={{
								background: brandColour
									? `linear-gradient(135deg, color-mix(in srgb, ${brandColour} 18%, transparent), color-mix(in srgb, ${brandColour} 6%, transparent))`
									: undefined,
							}}
							className={`mt-7 flex flex-col gap-2 rounded-xl p-4 ${brandColour ? "" : "bg-card-hover/50"}`}
						>
							<h2 className="pb-1 text-detail font-medium text-ink-muted">{t("market.tryAsking")}</h2>
							{prompts.slice(0, 4).map((prompt) => (
								<button
									key={prompt}
									type="button"
									onClick={() => onTry(prompt)}
									className="group/prompt flex items-center gap-2.5 rounded-lg bg-shell/85 px-3.5 py-2.5 text-left text-label text-ink shadow-sm transition-colors duration-[var(--ly-t-quick)] hover:bg-shell"
								>
									<span className="min-w-0 flex-1">{prompt}</span>
									<ArrowUpRight size={14} strokeWidth={2} className="shrink-0 text-ink-faint transition-colors duration-[var(--ly-t-quick)] group-hover/prompt:text-ink" />
								</button>
							))}
						</section>
					)}

					{/*
					 * 4. What it is at length, and what is inside — one at a time.
					 *
					 * The introduction is the bundle's README, the same document the market's web page shows
					 * under its name (see `useReadme`); its skills and its servers are the other two tabs.
					 * They used to be stacked one after another with a table of facts at the end — version,
					 * licence, category, source, repository, website, folder — most of which the line under
					 * the name already said, and the rest of which fit in the row of tags beside it.
					 */}
					{tabs.length > 1 && (
						<div className="pt-8">
							<TabStrip label={item.name} value={current} onChange={setTab} items={tabs} />
						</div>
					)}
					<div key={current} className={`ly-swap-in ${tabs.length > 1 ? "pt-5" : "pt-8"}`} data-detail-tab={current}>
						{current === "overview" && <Overview readme={readme} fallback={fallback} />}
						{current === "skills" &&
							skills.map((skill) => (
								<div key={skill.path} className="flex items-start gap-3 py-2.5">
									<Sparkles size={14} strokeWidth={1.8} className="mt-0.5 shrink-0 text-violet" />
									<div className="min-w-0 flex-1">
										<div className="text-label text-ink">{skill.name}</div>
										<p className="mt-0.5 line-clamp-2 text-detail leading-relaxed text-ink-muted">{skill.description}</p>
									</div>
								</div>
							))}
						{current === "servers" &&
							item.servers.map((server) => (
								<ServerRow
									key={server.id}
									server={server}
									missing={missingOf(server, present)}
									status={capabilities?.mcp.find((status) => status.id === server.id)}
								/>
							))}
					</div>

					{/*
					 * Said once, at the bottom, for anything not yet on disk. Installing puts somebody
					 * else's files on this machine; the index is a list, not a review.
					 */}
					{!installed && item.entry && (
						<p className="pt-8 text-caption leading-relaxed text-ink-faint">
							{isMcp ? t("pluginDetail.installMcpWarning") : t("pluginDetail.installPluginWarning")}
						</p>
					)}
				</div>
			</Scroller>

			{more.open && (
				<Popover anchor={more.anchor} onClose={more.close} placement="bottom" align="start" width="compact" role="menu" label={item.name}>
					<MenuBody>
						{prompts[0] && enabled && (
							<MenuItem
								icon={<ArrowUpRight size={13} strokeWidth={1.8} />}
								onClick={() => {
									more.close();
									onTry(prompts[0]!);
								}}
							>
								{t("catalogCard.tryNow")}
							</MenuItem>
						)}
						<MenuItem
							icon={<Settings2 size={13} strokeWidth={1.8} />}
							onClick={() => {
								more.close();
								openExtensions(isMcp ? "mcp" : item.kind === "skill" ? "skills" : "plugins", item.name);
							}}
						>
							{t("market.manageInSettings")}
						</MenuItem>
						{dir && (
							<MenuItem
								icon={<FolderOpen size={13} strokeWidth={1.8} />}
								onClick={() => {
									more.close();
									void bridge.system.openPath(dir);
								}}
							>
								{t("common.openFolder")}
							</MenuItem>
						)}
						{website && (
							<MenuItem
								icon={<ExternalLink size={13} strokeWidth={1.8} />}
								onClick={() => {
									more.close();
									void bridge.system.openExternal(website);
								}}
							>
								{t("pluginDetail.homepage")}
							</MenuItem>
						)}
						<MenuSeparator />
						<MenuItem
							danger
							icon={<Trash2 size={13} strokeWidth={1.8} />}
							disabled={act.busy !== null || workspaceOwned}
							title={workspaceOwned ? t("pluginDetail.projectScoped") : undefined}
							onClick={() => {
								more.close();
								confirm.ask({
									title: t("plugins.uninstallConfirm", { name: item.name }),
									detail: isMcp
										? t("pluginDetail.uninstallMcpDetail", { n: item.servers.length })
										: item.collected > 0
											? t("catalogCard.uninstallSkillsDetail", { n: item.collected })
											: t("plugins.uninstallDetail"),
									confirmLabel: t("mcp.uninstall"),
									onConfirm: () =>
										void act.uninstall().then(() => {
											// A bundle from a registry stays on the page as "not installed"; one that only
											// ever existed here has nothing left to show.
											if (!item.entry) onBack();
										}),
								});
							}}
						>
							{t("mcp.uninstall")}
						</MenuItem>
					</MenuBody>
				</Popover>
			)}
			{confirm.element}
		</div>
	);
}

/** The line under the name: who, which version, how many, how recently. */
function Facts({ item, developer, version }: { item: CatalogItem; developer?: string; version?: string }) {
	const { t } = useI18n();
	const parts: React.ReactNode[] = [];
	if (developer) parts.push(<span key="by">{developer}</span>);
	if (version) parts.push(<span key="v" className="tabular-nums">v{version}</span>);
	if ((item.downloads ?? 0) > 0) parts.push(<span key="d" className="tabular-nums">{t("market.downloadsShort", { n: compactCount(item.downloads ?? 0) })}</span>);
	if (item.updatedAt) {
		parts.push(
			<span key="u">
				{t("market.updatedAgo")}
				<TimeAgo iso={item.updatedAt} />
			</span>,
		);
	}
	if (parts.length === 0) return null;
	return (
		<div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pt-2 text-detail text-ink-faint">
			{parts.map((part, index) => (
				<span key={index} className="flex items-center gap-1.5">
					{index > 0 && <span aria-hidden className="text-ink-faint/50">·</span>}
					{part}
				</span>
			))}
		</div>
	);
}

type DetailTab = "overview" | "skills" | "servers";

/**
 * What the facts table used to spell out in rows, as a line of tags: the shelf it is on, its licence,
 * the agents it installs into — and, at the end, its repository and website as marks to press.
 *
 * Version, author, installs and age are in the line above; the folder and the homepage are in the ⋯.
 * The registry it came from is gone: with one market configured it said the same word on every page.
 */
function Tags({ item, license, website }: { item: CatalogItem; license?: string; website?: string }) {
	const { t } = useI18n();
	const repository = item.entry?.repository ? repoUrl(item.entry.repository) : undefined;
	// A homepage that is the repository says nothing the repository mark does not.
	const site = website && website.replace(/\/+$/, "") !== repository?.replace(/\/+$/, "") ? website : undefined;
	const tags = [item.category !== UNFILED ? item.category : undefined, license].filter((tag): tag is string => Boolean(tag));
	const clients = (item.clients ?? []).map((client) => CLIENT_LABEL[client] ?? client);
	if (tags.length === 0 && clients.length === 0 && !repository && !site) return null;
	return (
		<div className="flex flex-wrap items-center gap-1.5 pt-3" data-detail-tags="">
			{tags.map((tag) => (
				<span key={tag} className="rounded-full bg-card-hover px-2.5 text-caption leading-[22px] text-ink-muted">
					{tag}
				</span>
			))}
			{clients.map((client) => (
				<span key={client} className="rounded-full bg-card/70 px-2.5 text-caption leading-[22px] text-ink-faint">
					{client}
				</span>
			))}
			{repository && (
				<IconButton label={t("common.repository")} size="sm" icon={<GitHubMark size={13} />} onClick={() => void bridge.system.openExternal(repository)} />
			)}
			{site && <IconButton label={t("pluginDetail.website")} size="sm" icon={<Globe size={13} strokeWidth={1.9} />} onClick={() => void bridge.system.openExternal(site)} />}
		</div>
	);
}

/** The introduction: the README when there is one, the long description when there is not. */
function Overview({ readme, fallback }: { readme: ReadmeResult; fallback: string }) {
	if (readme === undefined) {
		return (
			<div className="flex flex-col gap-3 pt-1" aria-busy="true">
				<SkeletonBar width="62%" height={14} />
				<SkeletonBar width="96%" />
				<SkeletonBar width="88%" />
				<SkeletonBar width="92%" />
				<SkeletonBar width="54%" />
			</div>
		);
	}
	if (readme) return <Readme markdown={readme.markdown} repo={readme.repo} dir={readme.dir} />;
	return fallback ? <Markdown text={fallback} className="text-label text-ink-muted" /> : null;
}

/**
 * One declared server: how it is started, and whether it is running.
 *
 * The command is shown as-is, in mono: it is what will run on this machine once the server is on,
 * and reading it is the only way to know whether that is `npx` fetching a package or a binary you
 * already have.
 */
function ServerRow({
	server,
	missing,
	status,
}: {
	server: McpServerConfig;
	missing: string[];
	status: AgentCapabilities["mcp"][number] | undefined;
}) {
	const { t } = useI18n();
	const how = server.transport === "stdio" ? `${server.command} ${(server.args ?? []).join(" ")}`.trim() : server.url;
	const state = !server.enabled
		? { tone: "text-ink-faint", label: t("market.serverOff") }
		: missing.length > 0
			? { tone: "text-accent", label: t("market.serverMissing", { names: formatList(missing) }) }
			: status?.state === "connected"
				? { tone: "text-ok", label: t("mcpSettings.toolCount", { n: status.toolCount }) }
				: status?.state === "failed"
					? { tone: "text-danger", label: t("mcp.failed") }
					: { tone: "text-ink-faint", label: t("market.serverOn") };
	return (
		<div className="flex items-start gap-3 py-2.5">
			<Cable size={14} strokeWidth={1.8} className="mt-0.5 shrink-0 text-info" />
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<span className="text-label text-ink">{server.name}</span>
					<span className="text-caption text-ink-faint">{server.transport}</span>
					<span className={`ml-auto text-caption ${state.tone}`}>{state.label}</span>
				</div>
				{how && <p className="mt-0.5 truncate font-mono text-detail text-ink-muted">{how}</p>}
				{status?.state === "failed" && status.error && !status.missing && (
					<p className="mt-1 line-clamp-2 text-detail text-danger/85">{status.error}</p>
				)}
			</div>
		</div>
	);
}

/** `git@github.com:owner/repo.git` is not something a browser can open. */
function repoUrl(repository: string): string {
	const ssh = /^git@([^:]+):(.+?)(?:\.git)?$/.exec(repository);
	return ssh ? `https://${ssh[1]}/${ssh[2]}` : repository.replace(/\.git$/, "");
}

/**
 * The skills a collection put among the loose ones: those the ledger names, or — for a collection
 * installed before the ledger named them — the ones carrying its prefix.
 */
function collectionSkills(item: CatalogItem, loose: Skill[]): Skill[] {
	if (item.collected === 0) return [];
	const named = item.origin?.skills;
	return loose.filter((skill) => {
		if (skill.pluginId) return false;
		const dirName = skill.dir.split(/[/\\]/).pop() ?? "";
		return named ? named.includes(dirName) : dirName.startsWith(`${item.id}-`);
	});
}
