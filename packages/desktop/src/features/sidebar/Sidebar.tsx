/**
 * The navigation pane: what you can go to, and what you have been in.
 *
 * Two lists rather than one. A project orders its conversations by what they belong to and 「聊天」
 * orders every conversation by when you last touched it, and no single list can be both — which is
 * why the most recent conversation used to be one of the hardest things in the pane to find. The
 * strip that switches between them is `sidebar/SidebarTabs`, the lists are `sidebar/ProjectList`
 * and `sidebar/ChatList`. The strip and the current heading are held at the top by `position:
 * sticky`; the only part of that JavaScript owns is where the fade below them starts, which is
 * `sidebar/useStickyFade` and `sidebar/sticky.ts`.
 *
 * Only the pane itself is here. Which conversations are listed and what a row does is
 * `sidebar/useSidebarLists`; the rules underneath it are `sidebar/grouping` and `sidebar/recency`.
 */

import { Archive, ListFilter, SquarePen } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLayout } from "../../app/layout.tsx";
import { useApp } from "../../store/index.ts";
import { usePopover } from "../../ui/overlay/Popover.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { ArchiveToggle } from "./ArchiveToggle.tsx";
import { ChatList, CHAT_PAGE } from "./ChatList.tsx";
import { DestinationNav } from "./DestinationNav.tsx";
import { ListMenu, type SortKey } from "./ListMenu.tsx";
import { NavItem } from "./NavItem.tsx";
import { SESSION_PAGE } from "./ProjectGroup.tsx";
import { ProjectList } from "./ProjectList.tsx";
import { SidebarFoot } from "./SidebarFoot.tsx";
import { SidebarHead } from "./SidebarHead.tsx";
import { SidebarTabs, StripButton, type SidebarTab } from "./SidebarTabs.tsx";
import { useSidebarLists } from "./useSidebarLists.ts";
import { useStickyFade } from "./useStickyFade.ts";

/** Where the folded-project list is remembered. */
const COLLAPSED_KEY = "ly-collapsed-projects";
/** And which half of the pane you were last in — the two are looked at on different days. */
const TAB_KEY = "ly-sidebar-tab";
/** And what "most recent" means, which is a preference rather than a place. */
const SORT_KEY = "ly-sidebar-sort";

export function Sidebar() {
	const workspace = useApp((s) => s.workspace);
	const activeSessionId = useApp((s) => s.activeSessionId);
	const scratchRoots = useApp((s) => s.scratchRoots);
	const newSession = useApp((s) => s.newSession);
	const adoptSidebarTab = useApp((s) => s.adoptSidebarTab);
	/**
	 * As a drawer this pane covers the thing it navigates to, so anything that changes what is
	 * behind it also has to get out of the way. Pushed, `dismissNav` does nothing and the
	 * sidebar stays where the user put it.
	 */
	const { compact, dismissNav } = useLayout();

	const [query, setQuery] = useState("");
	const [searching, setSearching] = useState(false);
	const [tab, setTab] = useState<SidebarTab>(() => (localStorage.getItem(TAB_KEY) === "chats" ? "chats" : "projects"));
	/**
	 * Whether the list is showing the archive instead.
	 *
	 * Not persisted, unlike the tab. Which of the two lists you prefer is a habit; being in the
	 * archive is an errand, and coming back to an app that opens on the things you filed away is
	 * being handed back a task you finished.
	 */
	const [archiveOpen, setArchiveOpen] = useState(false);
	/** How many rows each project is showing. Absent means the default five. */
	const [shown, setShown] = useState<Record<string, number>>({});
	/** The same, for the 「最近」 section — one number, because there is only ever one of it. */
	const [looseShown, setLooseShown] = useState(SESSION_PAGE);
	/** And for the flat 「聊天」 list, which is every conversation there is. */
	const [chatShown, setChatShown] = useState(CHAT_PAGE);
	/** Which timestamp orders both halves and the archive. Persisted: it is a preference, not a mode. */
	const [sort, setSort] = useState<SortKey>(() =>
		localStorage.getItem(SORT_KEY) === "createdAt" ? "createdAt" : "updatedAt",
	);
	const menu = usePopover();
	/**
	 * Which projects are folded shut.
	 *
	 * Kept here rather than in each group: a group is rebuilt whenever the session list changes,
	 * and state living inside one would unfold every time somebody sent a message. Persisted, so a
	 * sidebar somebody tidied stays tidy across launches.
	 */
	const [collapsed, setCollapsed] = useState<string[]>(() => {
		try {
			const stored = localStorage.getItem(COLLAPSED_KEY);
			return stored ? (JSON.parse(stored) as string[]) : [];
		} catch {
			return [];
		}
	});
	const toggleCollapsed = (path: string) =>
		setCollapsed((current) => (current.includes(path) ? current.filter((p) => p !== path) : [...current, path]));

	/*
	 * Written here rather than inside the updater above.
	 *
	 * An updater has to be a pure function of its argument, because React calls it more than once —
	 * twice per commit under StrictMode, and again whenever it replays a render it threw away.
	 * Writing to storage in there meant the last write was not necessarily the one matching the
	 * state that survived: folding a project left the fold on screen and `[]` on disk, so it came
	 * back open on the next launch. The effect runs once per committed value, which is the only
	 * moment a persisted copy is meaningful.
	 */
	useEffect(() => {
		try {
			localStorage.setItem(COLLAPSED_KEY, JSON.stringify(collapsed));
			localStorage.setItem(TAB_KEY, tab);
			localStorage.setItem(SORT_KEY, sort);
		} catch {
			// A full or disabled storage costs the memory of the choice, not the choice itself.
		}
	}, [collapsed, tab, sort]);

	const viewport = useRef<HTMLDivElement>(null);
	/*
	 * A different list starts at its own top.
	 *
	 * The scroller is shared by all four combinations, so without this, switching to a list that
	 * happens to be shorter than how far you had scrolled the last one lands you somewhere in its
	 * middle — or, if it is shorter still, at its end with a blank pane. A depth into one list means
	 * nothing in another.
	 */
	useEffect(() => {
		if (viewport.current) viewport.current.scrollTop = 0;
	}, [tab, archiveOpen]);

	/*
	 * Where headings rest: under the strip, which rests against the top edge.
	 *
	 * The strip's own box includes the space around it — see the padding below — so this is its full
	 * height, and a heading stopping here lands flush under it with nothing transparent in between.
	 */
	const rail = 6 + (compact ? 38 : 32) + 6;
	useStickyFade(viewport, 0, rail);

	const { archived, groups, matching, bands, actions, confirm } = useSidebarLists({
		archiveOpen,
		query,
		sort,
		chatShown,
		onOpened: dismissNav,
	});

	/*
	 * Folding everything at once, which is one control rather than two.
	 *
	 * "All shut" is the only state where the reverse is the useful offer, and it is a state you can
	 * see — so the menu asks the question the list is already answering rather than listing both
	 * directions and making you work out which one applies.
	 */
	const foldable = [...groups.pinned, ...groups.projects].map((group) => group.path);
	const allFolded = foldable.length > 0 && foldable.every((path) => collapsed.includes(path));
	const foldAll = (folded: boolean) =>
		setCollapsed((current) =>
			folded
				? [...new Set([...current, ...foldable])]
				: current.filter((path) => !foldable.includes(path)),
		);

	/*
	 * Searching is looking for one conversation, so it happens in the list that has all of them.
	 *
	 * Filtering 「项目」 does work — the projects keep their shape and lose the rows that do not
	 * match — but the matches then sit scattered across however many projects, five rows down each,
	 * which is the exact scrolling the flat list exists to end. The tab you were on comes back when
	 * the search closes, unless you changed it yourself in the meantime.
	 */
	const before = useRef<SidebarTab | null>(null);
	const toggleSearch = () => {
		if (searching) {
			setSearching(false);
			setQuery("");
			if (before.current) setTab(before.current);
			before.current = null;
			return;
		}
		if (tab === "projects") {
			before.current = tab;
			setTab("chats");
		}
		setSearching(true);
	};
	const changeTab = (next: SidebarTab) => {
		before.current = null;
		setTab(next);
		/*
		 * And follow it, on a window with nothing open yet.
		 *
		 * Which half you are in is the only thing you have said about what you want to do next, and
		 * until now the composer ignored it: 「聊天」 over an empty list still said 「选择项目」 and
		 * 新对话 from there opened a directory picker. Guarded inside — a conversation that exists
		 * is never disturbed by this. See `adoptSidebarTab`.
		 */
		void adoptSidebarTab(next);
	};

	const pad = compact ? "px-3" : "px-2.5";
	const empty = query.trim() ? (
		<p className="px-2 py-6 text-center text-detail text-ink-faint">没有匹配的会话</p>
	) : archiveOpen ? (
		<div className="px-2 py-8 text-center">
			<Archive size={22} strokeWidth={1.5} className="mx-auto text-ink-faint" />
			<p className="mt-2.5 text-detail text-ink-muted">还没有归档的聊天</p>
			<p className="mt-1 text-caption leading-relaxed text-ink-faint">把鼠标移到会话上，点归档图标</p>
		</div>
	) : (
		<p className="px-2 py-6 text-center text-detail leading-relaxed text-ink-faint">
			还没有会话。
			<br />
			点击「新对话」开始。
		</p>
	);
	return (
		// No right border: the sidebar's own tint is what sets it apart from the column beside
		// it. A rule on top of that reads as a seam rather than a boundary.
		<div
			className="ly-sidebar-fill flex h-full w-full flex-col"
			/*
			 * Where headings come to rest: below the strip, with a gap either side of it. Declared
			 * here so the rows can be plain `sticky top-[var(--ly-rail)]` — CSS holds them, which is
			 * the only way they keep up with a wheel. See `sidebar/sticky.ts`.
			 */
			style={{ "--ly-rail": `${rail}px` } as React.CSSProperties}
		>
			<div className="h-[44px] shrink-0" />

			<SidebarHead searching={searching} query={query} onQuery={setQuery} onToggleSearch={toggleSearch} />

			{/* Only 新对话 is pinned above the list — see `DestinationNav` for why the other three
			    are not. */}
			<nav className={`flex flex-col pb-1 ${pad}`}>
				<NavItem
					icon={<SquarePen size={15} strokeWidth={1.8} />}
					label="新对话"
					onClick={() => {
						void newSession();
						dismissNav();
					}}
				/>
			</nav>

			{/*
			 * Both ends soften.
			 *
			 * This was a hairline on top and nothing at the bottom, on the reasoning that the nav
			 * above and the settings row below are solid — content passes behind them rather than
			 * dissolving into them, so a fade would leave half-lit rows hanging off an opaque block.
			 * That was true of the fade we had, which painted a strip of `--color-sidebar` over the
			 * list; on a pane whose fill is translucent that strip is a grey film with an edge of its
			 * own, and the half-lit rows were it.
			 *
			 * A mask has no such problem — the rows genuinely thin out to nothing — and once they
			 * really do, the argument turns around: a hard rule at the top of a list that runs on
			 * says the list ended there. See `.ly-fade-y`.
			 */}
			<Scroller className="flex-1" contentClassName={`pb-2 ${pad}`} scrollRef={viewport}>
				<DestinationNav onNavigate={dismissNav} />

				{/*
				 * The strip, in the list and held at the top of it once you scroll.
				 *
				 * `sticky` rather than a copy placed over the pane: the list moves on the compositor,
				 * and anything positioned from JavaScript arrives a frame after it does — which is a
				 * row visibly wobbling by a wheel tick. The cost is `ly-pin`, an opaque fill, because
				 * a row held over a list has to hide what passes under it. `sidebar/sticky.ts` has
				 * the whole account.
				 *
				 * Padding rather than margin for the breathing room, which is the opposite of what it
				 * wants to be and is load-bearing: a margin is outside the fill, so the six pixels
				 * above and below the control stay transparent — and a heading being pushed out
				 * travels up through exactly there. `z-30` puts this over the headings; the padding
				 * is what gives it something to hide them behind.
				 */}
				<div data-ly-rail className="ly-pin sticky top-0 z-30 py-1.5">
					<SidebarTabs
						tab={tab}
						onChange={changeTab}
						trailing={
							<>
								<StripButton label="列表设置" active={menu.open} onClick={menu.toggle}>
									<ListFilter size={14} strokeWidth={1.9} />
								</StripButton>
								<ArchiveToggle
									open={archiveOpen}
									count={archived.length}
									onToggle={() => setArchiveOpen((v) => !v)}
								/>
							</>
						}
					/>
				</div>

				{/*
				 * Keyed on both, so switching either one replays the entrance.
				 *
				 * Four states share this scroller and none of them is a change to the list on screen —
				 * they are different lists. The animation is what says so; without it the rows simply
				 * become other rows, which at a glance reads as the sidebar having reordered itself.
				 */}
				<div key={`${archiveOpen ? "archive" : "live"}-${tab}`} className="ly-enter">
					{tab === "projects" ? (
						<ProjectList
							groups={groups}
							activePath={workspace?.path}
							activeSessionId={activeSessionId}
							collapsed={collapsed}
							onToggleCollapsed={toggleCollapsed}
							groupProps={(path) => ({
								collapsed: collapsed.includes(path),
								onToggleCollapsed: () => toggleCollapsed(path),
								shown: shown[path] ?? SESSION_PAGE,
								onShowMore: () =>
									setShown((prev) => ({ ...prev, [path]: (prev[path] ?? SESSION_PAGE) + SESSION_PAGE })),
								onCollapse: () => setShown((prev) => ({ ...prev, [path]: SESSION_PAGE })),
								activeSessionId,
								actions,
							})}
							looseShown={looseShown}
							onLooseMore={() => setLooseShown((n) => n + SESSION_PAGE)}
							onLooseCollapse={() => setLooseShown(SESSION_PAGE)}
							actions={actions}
							empty={empty}
						/>
					) : (
						<ChatList
							bands={bands}
							activeSessionId={activeSessionId}
							scratchRoots={scratchRoots}
							hidden={Math.max(0, matching.length - chatShown)}
							canCollapse={chatShown > CHAT_PAGE}
							onShowMore={() => setChatShown((n) => n + CHAT_PAGE)}
							onCollapse={() => setChatShown(CHAT_PAGE)}
							actions={actions}
							empty={empty}
						/>
					)}
				</div>
			</Scroller>

			<SidebarFoot onNavigate={dismissNav} />

			{menu.open && (
				<ListMenu
					anchor={menu.anchor}
					tab={tab}
					sort={sort}
					onSort={setSort}
					allFolded={allFolded}
					onFoldAll={foldAll}
					onClose={menu.close}
				/>
			)}
			{confirm}
		</div>
	);
}
