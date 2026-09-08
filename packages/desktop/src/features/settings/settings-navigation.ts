import {
	Anchor,
	Archive,
	BarChart3,
	Blocks,
	Bot,
	Camera,
	Database,
	FolderGit2,
	GitPullRequest,
	Globe,
	Info,
	Layers,
	Palette,
	Search,
	Settings2,
	ShieldCheck,
	Smartphone,
	Sparkles,
	SquareTerminal,
	Wand2,
	Workflow,
} from "lucide-react";
import type { SettingsSection } from "../../store/index.ts";
import { groupsFor } from "./sections-for.ts";
import type { MessageKey } from "../../i18n/index.ts";

/*
 * 每一项只有一个名字，就是那个 key。
 *
 * 从前每项还带一个写死的中文 `label`，而它一处都没显示过：分组名画的是 `t(labelKey)`，
 * 项名也是，`label` 只在 `key={group.label}` 里当过 React 的键。也就是说切成英文之后它
 * 仍旧是中文，但那句中文谁也看不见——一个不会被发现是错的错误。键改用 `labelKey`，它本来
 * 就是唯一的。
 */
const GROUPS: { labelKey: MessageKey; items: { id: SettingsSection; labelKey: MessageKey; icon: typeof Settings2 }[] }[] = [
	{
		labelKey: "settings.group.basic",
		items: [
			{ id: "general", labelKey: "settings.general", icon: Settings2 },
			{ id: "appearance", labelKey: "settings.appearance", icon: Palette },
			// Next to 外观 because they are asked about together, and separate because one changes
			// how code is drawn and the other changes what is written to disk.
			{ id: "formatting", labelKey: "settings.formatting", icon: Wand2 },
			{ id: "personalization", labelKey: "settings.personalization", icon: Sparkles },
			{ id: "models", labelKey: "settings.models", icon: Layers },
			{ id: "forges", labelKey: "settings.forges", icon: GitPullRequest },
			{ id: "screenshot", labelKey: "settings.screenshot", icon: Camera },
			{ id: "browser", labelKey: "settings.browser", icon: Globe },
		],
	},
	{
		labelKey: "settings.group.agent",
		items: [
			{ id: "plugins", labelKey: "settings.extensions", icon: Blocks },
			{ id: "agents", labelKey: "settings.agents", icon: Bot },
			// 紧挨着智能体，因为它们是同一件事的两半：那一页说有谁，这一页说什么时候派他们出去。
			{ id: "delegation", labelKey: "settings.delegation", icon: Workflow },
			{ id: "commands", labelKey: "settings.commands", icon: SquareTerminal },
			{ id: "hooks", labelKey: "settings.hooks", icon: Anchor },
			{ id: "search", labelKey: "settings.search", icon: Search },
			{ id: "access", labelKey: "settings.access", icon: ShieldCheck },
		],
	},
	{
		labelKey: "settings.group.data",
		items: [
			{ id: "index", labelKey: "settings.index", icon: Database },
			{ id: "sync", labelKey: "settings.sync", icon: Smartphone },
			{ id: "usage", labelKey: "settings.usage", icon: BarChart3 },
		],
	},
	{
		labelKey: "settings.group.vcs",
		items: [
			{ id: "worktrees", labelKey: "settings.worktrees", icon: FolderGit2 },
		],
	},
	{
		labelKey: "settings.group.about",
		items: [
			{ id: "about", labelKey: "settings.about", icon: Info },
			{ id: "archived", labelKey: "settings.archived", icon: Archive },
		],
	},
];


/** Desktop capture works on every desktop platform; phones still use their native capture. */
export function settingsGroups(_platform: string, phone: boolean) {
	return groupsFor(GROUPS, phone);
}
