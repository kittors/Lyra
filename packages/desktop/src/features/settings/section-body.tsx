/**
 * Which page draws which section — shared by the desktop's settings shell and the phone's.
 */

import type { SettingsSection } from "../../store/index.ts";
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
import { StorageSettings } from "./StorageSettings.tsx";
import { UsageSettings } from "./UsageSettings.tsx";
import { WorktreesSettings } from "./WorktreesSettings.tsx";

/**
 * Sections that fill the window and scroll their own panes.
 *
 * The model page is two lists side by side; a page-level scroller over the top would mean two
 * scrollbars for one screen and would carry each pane's header away from the rows it labels.
 *
 * Plugins fills the pane and keeps the 900px column *inside* its own scroller. Constraining the
 * host to that column put the overlay thumb on the right of every full-width field.
 */
export const SELF_SCROLLING = new Set<SettingsSection>(["models", "plugins"]);

export function SectionBody({ section }: { section: SettingsSection }) {
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
		case "storage":
			return <StorageSettings />;
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
