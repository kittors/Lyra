/**
 * The catalogue: what you could have, and what you already do.
 *
 * This is the browsing half of a subject that has two halves. It answers "what is out there and
 * what did I install" — a page of marks and one-line descriptions, laid out to be skimmed. The
 * other half is 设置, which answers "what is this one doing": switches, versions, parameters,
 * where its directory is. The sidebar used to go straight there, which meant the first question
 * had nowhere to be asked. The gear in the header is the way from here to there, and it points
 * at whichever settings tab matches the tab you are on.
 *
 * Three tabs, because there are three things and they are not interchangeable: a plugin is a
 * bundle of skills, an MCP server is a program that gets started, and a skill is a page of
 * instructions. They used to share one tab called 插件, which is how seven MCP servers came to be
 * listed, installed and described as plugins — and then failed to appear on the MCP settings page,
 * because that page reads the settings file and these had been written somewhere else.
 *
 * Its header lives in the window's own 44px strip, level with the sidebar's controls, the same
 * way the pull request view does — see `PullRequestList` for why `no-drag` sits on the controls
 * and never on the row.
 */

import type { BundleKind, Skill } from "@lyra/core";
import { Blocks, Cable, ChevronDown, RefreshCw, Settings as SettingsIcon, Sparkles, Store } from "lucide-react";
import { Spinner } from "../../ui/motion/loaders.tsx";
import { useMemo, useState } from "react";

import { useI18n } from "../../i18n/index.ts";
import { useApp } from "../../store/index.ts";
import { MenuBody, MenuItem, Popover, usePopover } from "../../ui/overlay/Popover.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { SkeletonGrid, useSlowLoad } from "../../ui/primitives/Skeleton.tsx";
import { SearchField } from "../../ui/inputs/SearchField.tsx";
import { PluginIcon, SkillMark } from "../settings/index.ts";
import { CatalogCard } from "./CatalogCard.tsx";
import { PluginDetail } from "./PluginDetail.tsx";
import { RegistrySources } from "./RegistrySources.tsx";
import { settingsAfterToggle } from "./toggle.ts";
import { groupByCategory, isEnabled, isInstalled, UNFILED, useCatalog, type CatalogItem } from "./useCatalog.ts";
import { RollingText } from "../../ui/motion/RollingText.tsx";
import { bridge } from "../../services/index.ts";

/**
 * Which of the three the page is showing.
 *
 * `plugins` and `mcp` are the two things a registry offers, and they are separated because they
 * are not the same thing — a plugin is a bundle of skills, an MCP server is a program that gets
 * started and speaks a protocol. One tab called 插件 holding both is what let seven MCP servers
 * be advertised as plugins, installed as plugins, and then not appear on the MCP settings page.
 */
type Tab = "plugins" | "mcp" | "skills";
/**
 * Which half of the catalogue is on show.
 *
 * `public` is everything a registry offers, installed or not. `personal` is what only exists on
 * this machine — a directory somebody dropped in, or an example that was installed to be read.
 * The split is the one distinction the page can draw honestly: everything else it knows about a
 * bundle came out of the same two sources.
 */
type Scope = "public" | "personal";

export function PluginsView() {
	const { t } = useI18n();
	const setView = useApp((s) => s.setView);
	const setSettingsSection = useApp((s) => s.setSettingsSection);
	const setComposerDraft = useApp((s) => s.setComposerDraft);
	const newSession = useApp((s) => s.newSession);

	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);

	const catalog = useCatalog();
	const [tab, setTab] = useState<Tab>("plugins");
	const [query, setQuery] = useState("");
	const [scope, setScope] = useState<Scope | null>(null);
	const [sourcesOpen, setSourcesOpen] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	/**
	 * Which bundle is open, by key rather than by value.
	 *
	 * Holding the object would freeze it at the moment it was clicked: install something from its
	 * own page and the page would go on describing the version that had no directory yet. The key
	 * is looked up against the live catalogue on every render, so a refresh flows through.
	 *
	 * In the store rather than here because 设置 › 插件 opens this page too, from a window this
	 * component is not on screen for.
	 */
	const openKey = useApp((s) => s.pluginFocus);
	const setOpenKey = useApp((s) => s.setPluginFocus);
	const add = usePopover();

	// The settings page has a tab per kind now, so the gear points at the matching one rather
	// than always at 插件 — which, from the MCP tab, was the wrong half of the answer.
	const openSettings = (section: "plugins" | "mcp" = "plugins") => {
		setView("settings");
		setSettingsSection(section);
	};

	/**
	 * Leave for a new conversation with one of a bundle's own example prompts already typed.
	 *
	 * Shared by the cards and the detail page, because 立即试用 has to mean the same thing in both
	 * — the card reached it through a menu and the page through a bubble, and they were two
	 * copies of the same three calls in the same order.
	 */
	const startWith = (prompt: string) => {
		void newSession();
		setComposerDraft(prompt);
		setView("chat");
	};

	/**
	 * Switch a plugin on or off from its card, without going to 设置 first.
	 *
	 * The rule is `settingsAfterToggle`, shared with the settings list — the wildcard case is not
	 * obvious and two copies of it would be right in one place only.
	 *
	 * Only a plugin has one switch: an MCP bundle has one per server it brought, which is a
	 * different control on a different page, and a collection has none at all. `CatalogCard` draws
	 * nothing when this returns without acting.
	 */
	const toggle = (item: CatalogItem, enabled: boolean) => {
		const plugin = item.installed;
		if (!plugin || !settings) return;
		void saveSettings(
			settingsAfterToggle(
				settings,
				plugin,
				enabled,
				catalog.items.flatMap((entry) => (entry.installed ? [entry.installed] : [])),
			),
		);
	};

	// Whichever kind this tab is about. Everything below — the counts, the two scopes, the
	// installed strip — is scoped to it, so the page never mixes the two.
	/*
	 * One tab, one kind — including the skills tab, which used to be lumped in with plugins.
	 *
	 * That was fine while the only skills in existence were the ones a plugin brought with it: there
	 * was nothing of kind `skill` to show. Now the registry offers collections directly, and a
	 * collection filed under 插件 is the same mistake this page already made once with MCP servers.
	 */
	const ofKind = catalog.items.filter((item) => item.kind === (tab === "skills" ? "skill" : tab === "mcp" ? "mcp" : "plugin"));
	const published = ofKind.filter((item) => item.entry !== null);
	const personal = ofKind.filter((item) => item.entry === null);
	/*
	 * Undecided until the user decides, then fixed.
	 *
	 * Landing on 公开 with no registries configured shows an empty page as the first thing this
	 * view ever does, which reads as broken rather than as unconfigured. Landing on whichever side
	 * has something in it costs nothing and is right in both directions — a fresh install has only
	 * personal bundles, a configured one has both.
	 */
	/*
	 * While the registries are still answering, 公开 is empty because it has not been filled yet —
	 * which is not the same fact as being empty, and choosing between the two sides on it lands you
	 * on 个人 and then moves you to 公开 a moment later. Waiting means the default is decided once,
	 * against the finished answer, and the empty side shows a placeholder instead of a verdict.
	 */
	const current: Scope = scope ?? (published.length > 0 || catalog.loading ? "public" : "personal");
	const shown = current === "public" ? published : personal;

	const needle = query.trim().toLowerCase();
	const filtered = useMemo(
		() =>
			needle
				? shown.filter((item) => `${item.name} ${item.id} ${item.description}`.toLowerCase().includes(needle))
				: shown,
		[shown, needle],
	);
	const groups = useMemo(() => groupByCategory(filtered), [filtered]);

	const installed = ofKind.filter(isInstalled);
	/** Long enough to be worth a placeholder; a fetch that beats the threshold shows nothing. */
	const slow = useSlowLoad(catalog.loading);
	const slowLocal = useSlowLoad(catalog.localLoading);
	/*
	 * The collections the skills tab can offer, searched by the same box as everything else.
	 *
	 * Not grouped by category: three or four collections do not need shelves, and a heading over a
	 * single card says less than the card does.
	 */
	const collections = tab === "skills" ? filtered : [];

	/* Whichever sources failed, shown on every tab — a tab that hides it reads as "nothing here". */
	const sourceErrors =
		catalog.errors.length > 0 ? (
			<div className="mt-3 rounded-[10px] border border-accent/35 bg-accent/6 px-3 py-2">
				{catalog.errors.map((error) => (
					<p key={error.url} className="py-0.5 text-detail leading-relaxed text-accent">
						<span className="font-mono">{error.url}</span> — {error.message}
					</p>
				))}
			</div>
		) : null;

	/*
	 * Looked up rather than remembered — see `openKey`. Falls back to the grid if the key stops
	 * resolving, which is what uninstalling from the detail page does to it.
	 */
	const open = openKey ? (catalog.items.find((entry) => entry.key === openKey) ?? null) : null;
	if (open) {
		return (
			<PluginDetail
				item={open}
				onBack={() => setOpenKey(null)}
				onChanged={() => {
					setFailure(null);
					catalog.refresh();
				}}
				onError={setFailure}
				onTry={startWith}
			/>
		);
	}

	return (
		<div className="-mt-11 flex min-h-0 flex-1 flex-col">
			<header
				className="relative z-50 flex h-11 shrink-0 items-center gap-1 px-3"
			>
				<div className="no-drag flex items-center gap-1">
					{(
						[
							{ id: "plugins" as const, label: t("common.plugins"), icon: Blocks },
							{ id: "mcp" as const, label: t("market.mcp"), icon: Cable },
							{ id: "skills" as const, label: t("common.skills"), icon: Sparkles },
						] satisfies { id: Tab; label: string; icon: typeof Blocks }[]
					).map((entry) => (
						<button
							key={entry.id}
							type="button"
							onClick={() => {
								setTab(entry.id);
								// The two scopes are counted per kind, so a choice made under one tab
								// says nothing about the next: start it undecided again.
								setScope(null);
							}}
							className={`h-[26px] rounded-lg px-2.5 text-label transition-colors duration-[var(--ly-t-quick)] ${
								tab === entry.id ? "bg-card-hover text-ink" : "text-ink-muted hover:text-ink"
							}`}
						>
							{entry.label}
						</button>
					))}
				</div>

				{/* Everything between the tabs and the actions is the window's to drag. */}
				<div className="flex-1" />

				<div className="no-drag flex items-center gap-1">
					<HeaderButton label={t("market.reload")} onClick={catalog.refresh}>
						{catalog.loading ? <Spinner size={13.5} /> : <RefreshCw size={13.5} strokeWidth={1.8} />}
					</HeaderButton>
					<HeaderButton
						label={tab === "mcp" ? t("market.mcpSettings") : t("market.pluginSettings")}
						onClick={() => openSettings(tab === "mcp" ? "mcp" : "plugins")}
					>
						<SettingsIcon size={13.5} strokeWidth={1.8} />
					</HeaderButton>
					<button
						type="button"
						onClick={add.toggle}
						aria-haspopup="menu"
						aria-expanded={add.open}
						className="ml-1 flex h-[26px] items-center gap-1.5 rounded-lg bg-ink px-2.5 text-detail font-medium text-shell transition-opacity duration-[var(--ly-t-quick)] hover:opacity-90"
					>
						{t("mcp.add")}
						<ChevronDown size={12} strokeWidth={2} />
					</button>
				</div>
			</header>

			{add.open && (
				<Popover anchor={add.anchor} onClose={add.close} placement="bottom" align="end" width="default">
					<MenuBody>
						<MenuItem
							icon={<Store size={14} strokeWidth={1.8} />}
							onClick={() => {
								add.close();
								setSourcesOpen(true);
							}}
						>
							{t("market.addRegistry")}
						</MenuItem>
						<MenuItem
							icon={<Cable size={14} strokeWidth={1.8} />}
							onClick={() => {
								add.close();
								setView("settings");
								setSettingsSection("mcp");
							}}
						>
							{t("market.addMcpServer")}
						</MenuItem>
						</MenuBody>
				</Popover>
			)}

			<Scroller className="flex-1" contentClassName="px-6 pb-16">
				{/* `@container`, so the grid answers to this column's width rather than the window's —
				    the sidebar and the panel both take from it. */}
				<div className="@container mx-auto w-full max-w-[860px]">
					<h1 className="pt-6 text-display leading-tight font-semibold tracking-tight text-ink">
						<RollingText>{tab === "plugins" ? t("common.plugins") : tab === "mcp" ? t("market.mcp") : t("common.skills")}</RollingText>
					</h1>
					{/*
					 * Each one says what it is, because they are three different things.
					 *
					 * The plugin line used to read "一个插件是一组技能和 MCP 服务", which is what the
					 * whole page was built on and is not true: a plugin is skills. A server that runs
					 * a command on this machine is not a kind of skill bundle, and saying so is what
					 * made 安装 mean two different things under one word.
					 */}
					<p className="pt-2 pb-6 text-label leading-relaxed text-ink-muted">
						{tab === "plugins"
							? t("market.pluginsIntro")
							: tab === "mcp"
								? t("market.mcpIntro")
								: t("market.skillsIntro")}
					</p>

					<SearchField
						size="comfortable"
						value={query}
						onChange={setQuery}
						placeholder={tab === "plugins" ? t("market.searchPlugins") : tab === "mcp" ? t("market.searchMcp") : t("market.searchSkills")}
						className="w-full"
					/>

					{failure && (
						<p className="mt-4 rounded-[10px] border border-danger/35 bg-danger/6 px-3 py-2 text-detail leading-relaxed text-danger">
							{failure}
						</p>
					)}

					{tab !== "skills" ? (
						<>
							{installed.length > 0 && (
								<section className="pt-8">
									<div className="flex items-center gap-2 pb-3">
										<h2 className="text-body font-medium text-ink">{t("common.installed")}</h2>
										<span className="text-detail text-ink-faint tabular-nums">{installed.length}</span>
										<div className="flex-1" />
										<HeaderButton
											label={tab === "mcp" ? t("market.manageMcp") : t("market.managePlugins")}
											onClick={() => openSettings(tab === "mcp" ? "mcp" : "plugins")}
										>
											<SettingsIcon size={13} strokeWidth={1.8} />
										</HeaderButton>
									</div>
									<div className="flex flex-wrap gap-2">
										{installed.map((item) => (
											<button
												key={item.key}
												type="button"
												data-ly-tip={isEnabled(item) ? item.name : t("market.notEnabled", { name: item.name })}
												aria-label={item.name}
												onClick={() => setOpenKey(item.key)}
												className={`flex h-[52px] w-[52px] items-center justify-center rounded-xl transition-[background-color,opacity] duration-[var(--ly-t-quick)] hover:bg-card-hover/60 ${
													isEnabled(item) ? "" : "opacity-40"
												}`}
											>
												<PluginIcon
													name={item.name}
													logo={item.logo}
													brandColor={item.brandColor}
													kind={item.kind}
													size={34}
												/>
											</button>
										))}
									</div>
								</section>
							)}

							<div className="flex items-center gap-1 pt-8 pb-1">
								<ScopeTab active={current === "public"} count={published.length} onClick={() => setScope("public")}>
									{t("common.public")}
								</ScopeTab>
								<ScopeTab active={current === "personal"} count={personal.length} onClick={() => setScope("personal")}>
									{t("common.personal")}
								</ScopeTab>
							</div>

							{/*
							 * Shown whichever side is open, which it was not.
							 *
							 * It was gated on the 公开 tab, and the tab that opens by default is whichever
							 * one has anything in it — so a registry that failed to load left 公开 empty,
							 * dropped you on 个人, and hid the reason on the tab you were not looking at.
							 * The page then read as "there is nothing here", which is a different problem
							 * with a different fix.
							 */}
							{sourceErrors}

							{catalog.loading && groups.length === 0 ? (
								/* Shaped like the grid it precedes, so nothing moves when the answer lands. */
								slow ? <SkeletonGrid count={6} label={t("market.readingPlugins")} /> : null
							) : groups.length === 0 ? (
								<Empty
									kind={tab === "mcp" ? "mcp" : "plugin"}
									scope={current}
									searching={needle.length > 0}
									sources={catalog.sources.length}
									onAddSource={() => setSourcesOpen(true)}
								/>
							) : (
								groups.map((group) => (
									<section key={group.category} className="pt-6">
										{/*
										 * A single unnamed group needs no heading — the page title already said
										 * what these are, and 其他 over the only section on screen names nothing.
										 */}
										{!(group.category === UNFILED && groups.length === 1) && (
											<h2 className="pb-1 text-body font-medium text-ink">
												{group.category === UNFILED ? t("common.other") : group.category}
											</h2>
										)}
										<div className="grid grid-cols-1 gap-x-4 @2xl:grid-cols-2">
											{group.items.map((item) => (
												<div key={item.key} data-item={item.key}>
													<CatalogCard
														item={item}
														onOpen={() => setOpenKey(item.key)}
											onToggle={(enabled) => toggle(item, enabled)}
														onChanged={() => {
															setFailure(null);
															catalog.refresh();
														}}
														onError={setFailure}
														onTry={startWith}
													/>
												</div>
											))}
										</div>
									</section>
								))
							)}
						</>
					) : (
						/*
						 * Two things, in the order you need them.
						 *
						 * This tab used to be the second list alone, which made the skill market unreachable:
						 * the sources were configured, the collections were fetched, and nothing on screen
						 * ever drew them. A market you cannot see is not a market.
						 *
						 * Collections come first because they are what the page can act on, and the skills
						 * below are partly the result of having acted. There are no 公开 / 个人 scopes here:
						 * a personal skill is a directory, not a collection, and it is already in the list
						 * underneath rather than being a second kind of card.
						 */
						<>
							{sourceErrors}

							{slow && collections.length === 0 && (
								<section className="pt-6">
									<h2 className="pb-1 text-body font-medium text-ink">{t("market.skillPacks")}</h2>
									<SkeletonGrid count={4} label={t("market.readingSkills")} />
								</section>
							)}

							{collections.length > 0 && (
								<section className="pt-6">
									<h2 className="pb-1 text-body font-medium text-ink">{t("market.skillPacks")}</h2>
									<div className="grid grid-cols-1 gap-x-4 @2xl:grid-cols-2">
										{collections.map((item) => (
											<div key={item.key} data-item={item.key}>
												<CatalogCard
													item={item}
													onOpen={() => setOpenKey(item.key)}
											onToggle={(enabled) => toggle(item, enabled)}
													onChanged={() => {
														setFailure(null);
														catalog.refresh();
													}}
													onError={setFailure}
													onTry={startWith}
												/>
											</div>
										))}
									</div>
								</section>
							)}

							<section className="pt-8">
								<div className="flex items-baseline gap-2 pb-1">
									<h2 className="text-body font-medium text-ink">{t("market.localSkills")}</h2>
									<span className="text-detail text-ink-faint tabular-nums">{catalog.localLoading ? "" : catalog.skills.length}</span>
								</div>
								{catalog.localLoading ? (slowLocal ? <SkeletonGrid count={4} label={t("market.readingLocal")} /> : null) : <SkillList skills={catalog.skills} needle={needle} />}
							</section>
						</>
					)}

					{catalog.diagnostics.length > 0 && (
						<div className="mt-8 rounded-[10px] border border-accent/35 bg-accent/6 px-3 py-2">
							<p className="pb-1 text-detail font-medium text-accent">
								{t("market.unreadable", { n: catalog.diagnostics.length })}
							</p>
							{catalog.diagnostics.map((diagnostic) => (
								<p key={diagnostic.path} className="py-0.5 text-detail leading-relaxed text-accent/85">
									<span className="font-mono">{diagnostic.path}</span> — {diagnostic.message}
								</p>
							))}
						</div>
					)}
				</div>
			</Scroller>

			{sourcesOpen && (
				<RegistrySources
					sources={catalog.sources}
					errors={catalog.errors}
					onClose={() => {
						setSourcesOpen(false);
						catalog.refresh();
					}}
				/>
			)}
		</div>
	);
}

function HeaderButton({
	label,
	onClick,
	children,
}: {
	label: string;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			data-ly-tip={label}
			aria-label={label}
			onClick={onClick}
			className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink"
		>
			{children}
		</button>
	);
}

function ScopeTab({
	active,
	count,
	onClick,
	children,
}: {
	active: boolean;
	count: number;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			aria-pressed={active}
			onClick={onClick}
			className={`flex h-[28px] items-center gap-1.5 rounded-lg px-2.5 text-label transition-colors duration-[var(--ly-t-quick)] ${
				active ? "bg-card-hover text-ink" : "text-ink-muted hover:text-ink"
			}`}
		>
			{children}
			<span className="text-detail text-ink-faint tabular-nums">{count}</span>
		</button>
	);
}

/**
 * Why there is nothing here, which is four different situations wearing the same blank page.
 *
 * Told apart because the useful next step differs every time: wait, clear the search, add a
 * registry, or accept that a configured registry is genuinely empty. A single "没有插件" would be
 * accurate in all four and actionable in none.
 */
function Empty({
	kind,
	scope,
	searching,
	sources,
	onAddSource,
}: {
	kind: BundleKind;
	scope: Scope;
	searching: boolean;
	sources: number;
	onAddSource: () => void;
}) {
	const { t } = useI18n();
	const mcp = kind === "mcp";
	if (searching) {
		return <p className="py-16 text-center text-label text-ink-faint">{mcp ? t("mcp.noMatch") : t("plugins.noMatch")}</p>;
	}
	if (scope === "personal") {
		return (
			<p className="py-16 text-center text-label leading-relaxed text-ink-faint">
				{mcp ? t("market.noLocalMcp") : t("market.noLocalPlugins")}
			</p>
		);
	}
	return (
		<div className="py-16 text-center">
			<p className="text-label leading-relaxed text-ink-faint">
				{sources === 0 ? t("market.noRegistry") : mcp ? t("market.emptyMcp") : t("market.emptyPlugins")}
			</p>
			<button
				type="button"
				onClick={onAddSource}
				className="mt-4 h-8 rounded-lg bg-ink px-3.5 text-label font-medium text-shell transition-opacity duration-[var(--ly-t-quick)] hover:opacity-90"
			>
				<RollingText>{sources === 0 ? t("market.addRegistry") : t("market.manageRegistry")}</RollingText>
			</button>
		</div>
	);
}

/**
 * Every skill on this machine, whoever brought it.
 *
 * Flat rather than grouped by plugin: a skill is reached by name when the agent decides it is
 * relevant, and which bundle it arrived in is a fact about installation, not about use. The
 * source is on the row for the one moment it matters — working out which directory to edit.
 */
function SkillList({ skills, needle }: { skills: Skill[]; needle: string }) {
	const { t } = useI18n();
	const filtered = needle
		? skills.filter((skill) => `${skill.name} ${skill.description}`.toLowerCase().includes(needle))
		: skills;

	if (filtered.length === 0) {
		return (
			<p className="py-16 text-center text-label text-ink-faint">
				<RollingText>{needle ? t("common.noMatchingSkills") : t("skills.empty")}</RollingText>
			</p>
		);
	}

	return (
		<div className="grid grid-cols-1 gap-x-4 pt-8 @2xl:grid-cols-2">
			{filtered.map((skill) => (
				<button
					key={`${skill.source}:${skill.name}`}
					type="button"
					data-ly-tip={t("common.openFolder")}
					onClick={() => void bridge.system.openPath(skill.dir)}
					className="flex items-start gap-3 rounded-xl p-3 text-left transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover/60"
				>
					<SkillMark size={36} />
					<div className="min-w-0 flex-1 pt-0.5">
						<div className="flex items-center gap-2">
							<span className="truncate text-label font-medium text-ink">{skill.name}</span>
							{skill.pluginId && <span className="shrink-0 text-caption text-ink-faint">{skill.pluginId}</span>}
						</div>
						<p className="mt-0.5 line-clamp-2 text-detail leading-relaxed text-ink-muted">{skill.description}</p>
					</div>
				</button>
			))}
		</div>
	);
}
