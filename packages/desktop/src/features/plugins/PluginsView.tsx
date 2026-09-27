/**
 * 插件市场: what you could add to Lyra, and what you already have.
 *
 * This is the browsing half of a subject that has two halves. It answers "what is out there" — a
 * shelf of marks and one-line descriptions, laid out to be skimmed, with one action on each. The
 * other half is 设置 › 插件, which answers "what have I got, and is it on": a list with switches.
 * The bundle's own page (`PluginDetail`) is where the two meet.
 *
 * What changed, and why, since the page was three tabs of three different layouts:
 *
 *   - One grid for all three kinds, filtered by a tab in the header (全部 · 插件 · MCP · 技能)
 *     rather than three pages that each explained themselves in a paragraph.
 *   - Shelves by category, most installed first, with a row of category chips to jump to one. The
 *     公开 / 个人 split is gone: "from a registry" and "only on this machine" is a fact about a
 *     bundle, and the few that only exist here get a shelf of their own at the end.
 *   - No strip of installed icons above the grid: every card already says whether it is installed,
 *     and the strip was the same information a second time.
 *   - Updates are one line with one button, and they happen on their own unless that is switched
 *     off (`autoUpdatePlugins`); see `plugin-updates.ts` in the main process.
 *   - The catalogue re-reads itself while open and when the window comes back into focus.
 *
 * Its header lives in the window's own 44px strip, level with the sidebar's controls, the same way
 * the pull request view does — see `PullRequestList` for why `no-drag` sits on the controls and
 * never on the row.
 */

import { ArrowUp, CircleAlert, Info, MoreHorizontal, Plus, RefreshCw, Settings2, Store, X } from "lucide-react";
import { useMemo, useState } from "react";

import { formatList, useI18n } from "../../i18n/index.ts";
import { useApp } from "../../store/index.ts";
import { ActionSpinner } from "../../ui/motion/loaders.tsx";
import { MenuBody, MenuItem, MenuSeparator, Popover, usePopover } from "../../ui/overlay/Popover.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { SkeletonGrid, useSlowLoad } from "../../ui/primitives/Skeleton.tsx";
import { SearchField } from "../../ui/inputs/SearchField.tsx";
import { Button } from "../../ui/primitives/Button.tsx";
import { GitHubMark } from "../../ui/primitives/GitHubMark.tsx";
import { TabStrip } from "../../ui/primitives/TabStrip.tsx";
import { newMcpServer } from "../settings/index.ts";
import { CatalogCard } from "./CatalogCard.tsx";
import { missingOf, useEnvironment } from "./McpKeys.tsx";
import { PluginDetail } from "./PluginDetail.tsx";
import { RegistrySources } from "./RegistrySources.tsx";
import { byPopularity, matches, shelves, UNFILED, useCatalog, type CatalogItem } from "./useCatalog.ts";
import type { InstallReports } from "./useInstall.ts";
import { bridge } from "../../services/index.ts";

/** The market's own repository: where its catalogue and platform are, and where to ask for an entry. */
const MARKET_REPO = "https://github.com/kittors/Lyra-Registry";

/** Which kinds the grid shows. `all` is the market's front door; the other three narrow it. */
type Kind = "all" | "plugin" | "mcp" | "skill";

type Notice = { tone: "error" | "note"; text: string };

export function PluginsView() {
	const { t } = useI18n();
	const setView = useApp((s) => s.setView);
	const setComposerDraft = useApp((s) => s.setComposerDraft);
	const newSession = useApp((s) => s.newSession);
	const openExtensions = useApp((s) => s.openExtensions);
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);
	const updates = useApp((s) => s.pluginUpdates);

	const catalog = useCatalog();
	const [kind, setKind] = useState<Kind>("all");
	const [category, setCategory] = useState<string | null>(null);
	const [query, setQuery] = useState("");
	const [sourcesOpen, setSourcesOpen] = useState(false);
	const [notice, setNotice] = useState<Notice | null>(null);
	const [updatingAll, setUpdatingAll] = useState(false);
	/**
	 * Which bundle is open, by key rather than by value — looked up against the live catalogue on
	 * every render, so installing something from its own page shows it installed. In the store
	 * because 设置 › 插件 opens a bundle's page too, from a view this component is not on screen for.
	 */
	const openKey = useApp((s) => s.pluginFocus);
	const setOpenKey = useApp((s) => s.setPluginFocus);
	const more = usePopover();

	const reports: InstallReports = {
		onChanged: () => catalog.refresh(),
		onError: (text) => setNotice({ tone: "error", text }),
		onNote: (text) => setNotice({ tone: "note", text }),
	};

	/** Leave for a new conversation with one of a bundle's own example prompts already typed. */
	const startWith = (prompt: string) => {
		void newSession();
		setComposerDraft(prompt);
		setView("chat");
	};

	/*
	 * What each installed MCP bundle still needs before it can start — computed once for the page,
	 * so the cards and the count agree. The login shell counts: a key already exported there is not
	 * missing.
	 */
	const present = useEnvironment(catalog.items.flatMap((item) => item.servers.flatMap((server) => Object.keys(server.env ?? {}))));
	const missing = useMemo(() => {
		const out = new Map<string, string[]>();
		for (const item of catalog.items) {
			if (item.servers.length === 0) continue;
			const names = [...new Set(item.servers.flatMap((server) => missingOf(server, present)))];
			if (names.length > 0) out.set(item.key, names);
		}
		return out;
	}, [catalog.items, present]);

	const ofKind = (which: Kind) => (which === "all" ? catalog.items : catalog.items.filter((item) => item.kind === which));
	const counts = { all: catalog.items.length, plugin: ofKind("plugin").length, mcp: ofKind("mcp").length, skill: ofKind("skill").length };
	const inKind = ofKind(kind);
	const published = inKind.filter((item) => item.entry !== null);
	const localOnly = inKind.filter((item) => item.entry === null);
	const categories = useMemo(() => shelves(published).map((shelf) => ({ name: shelf.category, count: shelf.items.length })), [published]);
	const searching = query.trim().length > 0;
	const narrowed = searching || category !== null;
	const flat = useMemo(
		() =>
			narrowed
				? inKind.filter((item) => (category === null || item.category === category) && matches(item, query)).sort(byPopularity)
				: [],
		[narrowed, inKind, category, query],
	);
	const outdated = catalog.items.filter((item) => item.outdated && item.entry);
	const slow = useSlowLoad(catalog.loading);
	// Bundles that did not load. A skill with a short description loaded fine and is not one of these.
	const problems = catalog.diagnostics.filter((diagnostic) => diagnostic.severity !== "warning");

	const updateAll = async () => {
		setUpdatingAll(true);
		try {
			const state = await bridge.plugins.updateAll(outdated.map((item) => item.id));
			if (state.failed.length > 0) {
				setNotice({ tone: "error", text: state.failed.map((failure) => t("install.failedWith", { name: failure.name, message: failure.message })).join("\n") });
			}
		} finally {
			setUpdatingAll(false);
			catalog.refresh();
		}
	};

	const open = openKey ? (catalog.items.find((entry) => entry.key === openKey || entry.id === openKey) ?? null) : null;
	if (open) {
		return (
			<PluginDetail
				item={open}
				installedPlugins={catalog.plugins}
				localSkills={catalog.skills}
				onBack={() => setOpenKey(null)}
				onTry={startWith}
				reports={reports}
			/>
		);
	}

	/*
	 * Each card's place in the order they arrive in, counted across shelves — the second shelf's
	 * first card follows the first shelf's last. Reset every render, so a re-render does not keep
	 * pushing the count up.
	 */
	let arrival = 0;
	const card = (item: CatalogItem) => (
		<CatalogCard
			key={item.key}
			index={arrival++}
			item={item}
			missing={missing.get(item.key) ?? []}
			showKind={kind === "all"}
			onOpen={() => setOpenKey(item.key)}
			reports={reports}
		/>
	);

	return (
		<div className="-mt-11 flex min-h-0 flex-1 flex-col" data-market="">
			<header className="relative z-50 flex h-11 shrink-0 items-center gap-1 px-3">
				{/* The whole strip is the window's to drag, bar the buttons at its end. */}
				<div className="flex-1" />

				<div className="no-drag flex items-center gap-0.5">
					<HeaderButton label={t("market.repo")} onClick={() => void bridge.system.openExternal(MARKET_REPO)}>
						<GitHubMark size={14} />
					</HeaderButton>
					<HeaderButton label={t("market.reload")} onClick={catalog.refresh}>
						{catalog.loading ? <ActionSpinner size={13.5} /> : <RefreshCw size={13.5} strokeWidth={1.8} />}
					</HeaderButton>
					<HeaderButton
						label={t("market.manage")}
						onClick={() => openExtensions(kind === "mcp" ? "mcp" : kind === "skill" ? "skills" : "plugins")}
					>
						<Settings2 size={14} strokeWidth={1.8} />
					</HeaderButton>
					<HeaderButton label={t("common.more")} onClick={more.toggle} expanded={more.open}>
						<MoreHorizontal size={15} strokeWidth={1.9} />
					</HeaderButton>
				</div>
			</header>

			{more.open && (
				<Popover anchor={more.anchor} onClose={more.close} placement="bottom" align="end" width="default" role="menu" label={t("common.more")}>
					<MenuBody>
						<MenuItem
							icon={<Store size={14} strokeWidth={1.8} />}
							onClick={() => {
								more.close();
								setSourcesOpen(true);
							}}
						>
							{t("market.sources")}
						</MenuItem>
						<MenuItem
							icon={<Plus size={14} strokeWidth={1.9} />}
							onClick={() => {
								more.close();
								if (settings) void saveSettings({ ...settings, mcpServers: [...settings.mcpServers, newMcpServer("stdio")] });
								openExtensions("mcp");
							}}
						>
							{t("market.addMcpServer")}
						</MenuItem>
						<MenuSeparator />
						<MenuItem
							icon={<ArrowUp size={14} strokeWidth={1.9} />}
							checked={settings?.autoUpdatePlugins !== false}
							onClick={() => {
								if (settings) void saveSettings({ ...settings, autoUpdatePlugins: settings.autoUpdatePlugins === false });
							}}
						>
							{t("market.autoUpdate")}
						</MenuItem>
					</MenuBody>
				</Popover>
			)}

			<Scroller className="flex-1" contentClassName="px-6 pb-16">
				{/* `@container`, so the grid answers to this column's width rather than the window's. */}
				<div className="@container mx-auto w-full max-w-[1040px]">
					<div className="pt-2 pb-5">
						<h1 className="text-display leading-tight font-semibold tracking-tight text-ink">{t("market.title")}</h1>
						<p className="pt-1.5 text-label text-ink-muted">{t("market.subtitle")}</p>
					</div>

					<SearchField
						size="comfortable"
						value={query}
						onChange={setQuery}
						placeholder={t("market.search")}
						className="w-full"
					/>

					{notice && <NoticeLine notice={notice} onDismiss={() => setNotice(null)} />}

					{outdated.length > 0 && (
						<div className="ly-swap-in mt-4 flex items-center gap-3 rounded-xl bg-accent/8 px-4 py-2.5" data-market-updates="">
							<ArrowUp size={14} strokeWidth={2.2} className="shrink-0 text-accent" />
							<p className="min-w-0 flex-1 text-label text-ink">
								{updates?.updating.length ? t("market.updatingN", { n: updates.updating.length }) : t("market.updatesN", { n: outdated.length })}
								<span className="pl-2 text-detail text-ink-muted">{formatList(outdated.map((item) => item.name).slice(0, 3))}{outdated.length > 3 ? "…" : ""}</span>
							</p>
							<Button variant="subtle" size="sm" loading={updatingAll} onClick={() => void updateAll()} className="bg-accent/12 text-accent hover:bg-accent/20 hover:text-accent">
								{t("market.updateAll")}
							</Button>
						</div>
					)}

					{catalog.errors.length > 0 && (
						<div className="mt-4 rounded-xl bg-danger/6 px-4 py-2.5">
							{catalog.errors.map((error) => (
								<p key={error.url} className="flex items-start gap-2 py-0.5 text-detail leading-relaxed text-danger">
									<CircleAlert size={13} strokeWidth={2} className="mt-0.5 shrink-0" />
									<span className="min-w-0">
										{t("market.sourceFailed")} <span className="font-mono">{error.url}</span> — {error.message}
									</span>
								</p>
							))}
						</div>
					)}

					{/*
					 * What to show, then what to narrow it to — kind first, because it changes which
					 * categories exist. The kind used to be a row of words in the window's title strip,
					 * above the page's own title, where it read as the window's tabs rather than this
					 * list's filter.
					 */}
					<div className="flex flex-col items-start gap-3 pt-5">
						<TabStrip
							label={t("market.title")}
							value={kind}
							onChange={(next) => {
								setKind(next);
								setCategory(null);
							}}
							items={[
								{ id: "all", label: t("market.all"), count: counts.all },
								{ id: "plugin", label: t("common.plugins"), count: counts.plugin },
								{ id: "mcp", label: "MCP", count: counts.mcp },
								{ id: "skill", label: t("common.skills"), count: counts.skill },
							]}
						/>
						{!searching && categories.length > 1 && (
							<div className="flex flex-wrap gap-1.5" role="group" aria-label={t("pluginDetail.category")}>
								<Chip active={category === null} onClick={() => setCategory(null)}>
									{t("market.allCategories")}
								</Chip>
								{categories.map((entry) => (
									<Chip key={entry.name} active={category === entry.name} onClick={() => setCategory(category === entry.name ? null : entry.name)}>
										{entry.name === UNFILED ? t("common.other") : entry.name}
										<span className="tabular-nums opacity-60">{entry.count}</span>
									</Chip>
								))}
							</div>
						)}
					</div>

					{/*
					 * Keyed on what is being shown, so choosing another kind or shelf replays the arrival —
					 * the content fades and its cards rise into place a beat apart — while typing into the
					 * search (the same view, narrower) only reflows. See `.ly-swap-in` / `.ly-rise-in`.
					 */}
					<div key={`${kind}|${category ?? ""}|${searching ? "search" : ""}`} className="ly-swap-in">
						{/*
						 * The skeleton until the market has answered once — not only until anything at all is
						 * known. Installed bundles are known first, from disk, and shown alone they landed on the
						 * 「本机添加 · 不在任何市场里」 shelf for the second before the market arrived, which is a
						 * wrong sentence about every one of them.
						 */}
						{catalog.loading && published.length === 0 ? (
							slow ? <div className="pt-8"><SkeletonGrid count={6} label={t("market.readingPlugins")} /></div> : null
						) : narrowed ? (
							flat.length === 0 ? (
								<Empty
									text={searching ? t("market.noMatch", { query: query.trim() }) : t("market.emptyCategory")}
									action={searching ? { label: t("market.clearSearch"), onClick: () => setQuery("") } : undefined}
								/>
							) : (
								<Shelf title={searching ? `“${query.trim()}”` : category === UNFILED ? t("common.other") : (category ?? "")} count={flat.length}>
									{flat.map(card)}
								</Shelf>
							)
						) : published.length === 0 && localOnly.length === 0 ? (
							<Empty
								text={catalog.sources.length === 0 ? t("market.noRegistry") : t("market.empty")}
								action={{ label: catalog.sources.length === 0 ? t("market.addRegistry") : t("market.manageRegistry"), onClick: () => setSourcesOpen(true) }}
							/>
						) : (
							<>
								{shelves(published).map((shelf) => (
									<Shelf key={shelf.category} id={shelf.category} title={shelf.category === UNFILED ? t("common.other") : shelf.category} count={shelf.items.length}>
										{shelf.items.map(card)}
									</Shelf>
								))}
								{localOnly.length > 0 && (
									<Shelf id="local" title={t("market.localOnly")} note={t("market.localOnlyNote")} count={localOnly.length}>
										{localOnly.sort(byPopularity).map(card)}
									</Shelf>
								)}
							</>
						)}
					</div>

					{kind === "skill" && catalog.skills.length > 0 && !narrowed && (
						<button
							type="button"
							onClick={() => openExtensions("skills")}
							className="mt-8 flex w-full items-center gap-2 rounded-xl bg-card/50 px-4 py-3 text-left text-label text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover/60 hover:text-ink"
						>
							{t("market.localSkillsCount", { n: catalog.skills.length })}
							<span className="ml-auto text-detail">{t("market.manageInSettings")} →</span>
						</button>
					)}

					{problems.length > 0 && (
						<button
							type="button"
							onClick={() => openExtensions("plugins")}
							className="mt-6 flex items-center gap-1.5 text-detail text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:text-ink"
						>
							<CircleAlert size={12} strokeWidth={2} />
							{t("market.unreadable", { n: problems.length })}
						</button>
					)}
				</div>
			</Scroller>

			{sourcesOpen && (
				<RegistrySources
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

/** A heading, how many are under it, and the grid. Every list on the page is one of these, so they all sit the same distance below whatever is above them. */
function Shelf({ id, title, note, count, children }: { id?: string; title: string; note?: string; count: number; children: React.ReactNode }) {
	return (
		<section className="pt-8" data-shelf={id}>
			<div className="flex items-baseline gap-2 pb-3">
				<h2 className="text-body font-medium text-ink">{title}</h2>
				<span className="text-detail text-ink-faint tabular-nums">{count}</span>
				{note && <span className="text-detail text-ink-faint">· {note}</span>}
			</div>
			<div className="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @5xl:grid-cols-3">{children}</div>
		</section>
	);
}

function HeaderButton({
	label,
	onClick,
	expanded,
	children,
}: {
	label: string;
	onClick: (event: React.MouseEvent<HTMLElement>) => void;
	expanded?: boolean;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			data-ly-tip={label}
			aria-label={label}
			aria-expanded={expanded}
			onClick={onClick}
			className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink aria-expanded:bg-card-hover aria-expanded:text-ink"
		>
			{children}
		</button>
	);
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
	return (
		<button
			type="button"
			aria-pressed={active}
			onClick={onClick}
			/*
			 * The chosen chip in the accent, not inverted to black: a solid black pill was the loudest
			 * thing on the page and said "this is a button to press" about the one that already is.
			 */
			className={`flex h-[28px] items-center gap-1.5 rounded-full px-3 text-detail whitespace-nowrap transition-[background-color,color,transform] duration-[var(--ly-t-quick)] active:scale-[0.96] ${
				active ? "bg-accent/12 font-medium text-accent" : "bg-card/70 text-ink-muted hover:bg-card-hover hover:text-ink"
			}`}
		>
			{children}
		</button>
	);
}

function Empty({ text, action }: { text: string; action?: { label: string; onClick: () => void } }) {
	return (
		<div className="py-16 text-center">
			<p className="text-label leading-relaxed text-ink-faint">{text}</p>
			{action && (
				<div className="mt-4 flex justify-center">
					<Button variant="subtle" onClick={action.onClick}>
						{action.label}
					</Button>
				</div>
			)}
		</div>
	);
}

/**
 * One line about the last thing that happened — a failure in red, anything else in the page's own
 * ink. It stays until dismissed or replaced: an install that failed while you were reading the card
 * below it should still be saying so when you look up.
 */
function NoticeLine({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
	const { t } = useI18n();
	const error = notice.tone === "error";
	return (
		<div
			role={error ? "alert" : "status"}
			className={`mt-4 flex items-start gap-2.5 rounded-xl px-4 py-2.5 text-detail leading-relaxed ${error ? "bg-danger/6 text-danger" : "bg-card/70 text-ink-muted"}`}
		>
			{error ? <CircleAlert size={13} strokeWidth={2} className="mt-0.5 shrink-0" /> : <Info size={13} strokeWidth={2} className="mt-0.5 shrink-0" />}
			<p className="min-w-0 flex-1 whitespace-pre-line">{notice.text}</p>
			<button type="button" aria-label={t("common.close")} data-ly-tip={t("common.close")} onClick={onDismiss} className="shrink-0 opacity-70 transition-opacity hover:opacity-100">
				<X size={13} strokeWidth={2} />
			</button>
		</div>
	);
}

