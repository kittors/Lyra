import { composingKey } from "../../ui/keyboard.ts";
import { ArrowLeft, Rocket } from "lucide-react";
import { useEffect, useState } from "react";
import { WINDOW_HEADER_HEIGHT } from "../../../shared/window-chrome.ts";
import { NavPane, useLayout } from "../../app/layout.tsx";
import { sectionFor } from "./sections-for.ts";
import { settingsGroups } from "./settings-navigation.ts";
import type { SettingsSection } from "../../store/index.ts";
import { RetainedViews } from "../../ui/layout/RetainedViews.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { useApp } from "../../store/index.ts";
import { ToolbarButton } from "../../app/window/WindowControls.tsx";
import { AgentsSettings } from "./AgentsSettings.tsx";
import { DelegationSettings } from "./DelegationSettings.tsx";
import { ArchivedSettings } from "./ArchivedSettings.tsx";
import { AboutSettings } from "./AboutSettings.tsx";
import { AppearanceSettings } from "./AppearanceSettings.tsx";
import { FormattingSettings } from "./FormattingSettings.tsx";
import { CommandsSettings } from "./CommandsSettings.tsx";
import { GeneralSettings } from "./GeneralSettings.tsx";
import { PersonalizationSettings } from "./PersonalizationSettings.tsx";
import { McpSettings } from "./McpSettings.tsx";
import { ModelSettings } from "./ModelSettings.tsx";
import { ExtensionsSettings } from "./ExtensionsSettings.tsx";
import { HooksSettings } from "./HooksSettings.tsx";
import { IndexSettings } from "./IndexSettings.tsx";
import { BrowserSettings } from "./BrowserSettings.tsx";
import { ScreenshotSettings } from "./ScreenshotSettings.tsx";
import { SkillsSettings } from "./SkillsSettings.tsx";
import { AccessSettings } from "./AccessSettings.tsx";
import { ForgeSettings } from "./ForgeSettings.tsx";
import { SearchSettings } from "./SearchSettings.tsx";
import { SyncSettings } from "./SyncSettings.tsx";
import { UsageSettings } from "./UsageSettings.tsx";
import { WorktreesSettings } from "./WorktreesSettings.tsx";
import { bridge, onPhone } from "../../services/index.ts";
import { useI18n } from "../../i18n/index.ts";

/**
 * Sections that fill the window and scroll their own panes.
 *
 * The model page is two lists side by side; a page-level scroller over the top would mean two
 * scrollbars for one screen and would carry each pane's header away from the rows it labels.
 */
const SELF_SCROLLING = new Set<SettingsSection>(["models", "plugins"]);


export function SettingsShell() {
	const { t } = useI18n();
	const workspaceKey = useApp((state) => state.workspace?.path ?? "");
	const wanted = useApp((s) => s.settingsSection);
	const setSection = useApp((s) => s.setSettingsSection);
	const setView = useApp((s) => s.setView);
	const { compact, navOpen, toggleNav, dismissNav, sidebarWidth, titlebar } = useLayout();
	const [platform, setPlatform] = useState("darwin");

	useEffect(() => {
		void bridge.system.platform().then(setPlatform);
	}, []);

	const phone = onPhone();

	const groups = settingsGroups(platform, phone);
	const section = sectionFor(groups, wanted, phone);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.repeat || composingKey(event)) return;
			if ((event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.code === "KeyB") {
				event.preventDefault();
				toggleNav();
			} else if (event.key === "Escape" && compact && navOpen) {
				dismissNav();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [compact, navOpen, toggleNav, dismissNav]);

	return (
		/*
		 * The page is the palest surface here, as it is in the workspace.
		 *
		 * `bg-panel` put it within one step of the navigation beside it — 245 against 244 — so the
		 * two columns read as one undifferentiated field. The workspace already answers this: the
		 * nav is tinted and the thing you are working in is the plain page.
		 */
		<div className="ly-shell relative flex h-full">
			<NavPane width={sidebarWidth} label={t("app.settingsNavigation")}>
				{/* Same as the workspace sidebar: separated by its tint, not by a rule. */}
				<nav className="ly-sidebar-fill flex h-full w-full flex-col">
					<div className="shrink-0" style={{ height: WINDOW_HEADER_HEIGHT }} />

					{/*
					 * Filled on hover, like the section rows below it. The outlined variant used
					 * here before highlighted its border instead, which made the one button you
					 * press most often behave unlike everything around it.
					 */}
					<div className={`pb-2 ${compact ? "px-3" : "px-2.5"}`}>
						<button
							type="button"
							onClick={() => {
								setView("chat");
								dismissNav();
							}}
							className={`flex w-full items-center gap-2.5 rounded-lg px-2 text-left text-label text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink active:bg-elevated ${
								compact ? "h-[40px]" : "h-[32px]"
							}`}
						>
							<ArrowLeft size={15} strokeWidth={1.8} className="shrink-0" />
							{t("app.backWorkspace")}
						</button>
					</div>

					{/* Same as the workspace sidebar: both ends soften. */}
					<Scroller className="flex-1" contentClassName={`pb-3 ${compact ? "px-3" : "px-2.5"}`}>
						{groups.map((group) => (
							// Spaced for the same reason as the session list: adjacent filled rows
							// would otherwise merge into one block on hover.
							<div key={group.label} className="flex flex-col gap-[2px]">
								<div className="px-2 pt-4 pb-1 text-detail text-ink-faint">{t(group.labelKey)}</div>
								{group.items.map((item) => (
									<button
										key={item.id}
										aria-current={section === item.id ? "page" : undefined}
										type="button"
										onClick={() => {
											setSection(item.id);
											dismissNav();
										}}
										className={`flex w-full items-center gap-2.5 rounded-lg px-2 text-left text-label transition-colors ${
											compact ? "h-[40px]" : "h-[32px]"
										} ${
											section === item.id
												? "bg-card-hover text-ink"
												: "text-ink-muted hover:bg-card-hover/60 hover:text-ink"
										}`}
									>
										<item.icon size={15} strokeWidth={1.8} className="shrink-0" />
										{t(item.labelKey)}
									</button>
								))}
							</div>
						))}
					</Scroller>

					<div className={`pb-3 ${compact ? "px-3" : "px-2.5"}`}>
						{/* The dashed edge marks it as the odd one out; the fill on hover keeps it
						    behaving like the rest of the pane. */}
						<button
							type="button"
							onClick={() => {
								setSection("models");
								dismissNav();
							}}
							className="flex h-[36px] w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line text-label text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink active:bg-elevated"
						>
							<Rocket size={14} strokeWidth={1.8} />
							{t("app.guide")}
						</button>
					</div>
				</nav>
			</NavPane>

			<main className="ly-opaque flex min-w-0 flex-1 flex-col">
				<div className="shrink-0" style={{ height: WINDOW_HEADER_HEIGHT }} />
				{/*
				 * Most sections are a column of settings and scroll as one page. A few are
				 * two-pane layouts whose halves scroll independently — putting those inside a page
				 * scroller as well would give the window two nested scrollbars for one screen, and
				 * the outer one would move the pane headers out from over their own content.
				 */}
				<RetainedViews key={workspaceKey} active={section} limit={4} render={(section) => SELF_SCROLLING.has(section) ? (
					<div className={`mx-auto flex min-h-0 w-full max-w-[900px] flex-1 flex-col pb-6 ${compact ? "px-4" : "px-9"}`}>
						<SectionBody section={section} />
					</div>
				) : (
				<Scroller className="flex-1">
					<div className={`mx-auto w-full max-w-[900px] pb-16 ${compact ? "px-4" : "px-9"}`}>
						<SectionBody section={section} />
					</div>
				</Scroller>
				)} />
			</main>

			{/* Last child, for the same DOM-order reason as the chat shell's toolbar. */}
			<div className="drag-region absolute inset-x-0 top-0 z-40" style={{ height: WINDOW_HEADER_HEIGHT }}>
				<div className="no-drag absolute top-0 flex items-center gap-0.5" style={{ left: titlebar.start, height: WINDOW_HEADER_HEIGHT }}>
					{/*
					 * Settings shares the shell's nav state, so a sidebar collapsed in the workspace
					 * arrives collapsed here too. Without this button there would be no way back to
					 * the section list — or, in a compact window, out of the drawer.
					 */}
					<ToolbarButton
						label={navOpen ? t("app.hideSettingsNavigation", { shortcut: "⌘B" }) : t("app.showSettingsNavigation", { shortcut: "⌘B" })}
						onClick={toggleNav}
						active={compact && navOpen}
					>
						<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
							<rect x="3" y="4" width="18" height="16" rx="2.5" />
							<line x1="9.5" y1="4" x2="9.5" y2="20" />
							<rect
								x="3"
								y="4"
								width="6.5"
								height="16"
								rx="2.5"
								fill="currentColor"
								stroke="none"
								className="transition-opacity duration-[var(--ly-t-base)]"
								opacity={navOpen ? 0.5 : 0}
							/>
						</svg>
					</ToolbarButton>
				</div>

			</div>
		</div>
	);
}

function SectionBody({ section }: { section: SettingsSection }) {
	switch (section) {
		case "general":
			return <GeneralSettings />;
		case "appearance":
			return <AppearanceSettings />;
		case "formatting":
			return <FormattingSettings />;
		case "personalization":
			return <PersonalizationSettings />;
		case "models":
			return <ModelSettings />;
		case "skills":
			return <SkillsSettings />;
		case "agents":
			return <AgentsSettings />;
		case "delegation":
			return <DelegationSettings />;
		case "mcp":
			return <McpSettings />;
		case "plugins":
			return <ExtensionsSettings />;
		case "hooks":
			return <HooksSettings />;
		case "index":
			return <IndexSettings />;
		case "browser":
			return <BrowserSettings />;
		case "screenshot":
			return <ScreenshotSettings />;
		case "commands":
			return <CommandsSettings />;
		case "search":
			return <SearchSettings />;
		case "access":
			return <AccessSettings />;
		case "forges":
			return <ForgeSettings />;
		case "sync":
			return <SyncSettings />;
		case "usage":
			return <UsageSettings />;
		case "worktrees":
			return <WorktreesSettings />;
		case "about":
			return <AboutSettings />;
		case "archived":
			return <ArchivedSettings />;
		default:
			return <GeneralSettings />;
	}
}
