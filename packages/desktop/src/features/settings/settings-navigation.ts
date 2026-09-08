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

const GROUPS: { label: string; labelKey: MessageKey; items: { id: SettingsSection; label: string; labelKey: MessageKey; icon: typeof Settings2 }[] }[] = [
	{
		label: "基础设置",
		labelKey: "settings.group.basic",
		items: [
			{ id: "general", label: "常规", labelKey: "settings.general", icon: Settings2 },
			{ id: "appearance", label: "外观", labelKey: "settings.appearance", icon: Palette },
			// Next to 外观 because they are asked about together, and separate because one changes
			// how code is drawn and the other changes what is written to disk.
			{ id: "formatting", label: "代码格式化", labelKey: "settings.formatting", icon: Wand2 },
			{ id: "personalization", label: "个性化", labelKey: "settings.personalization", icon: Sparkles },
			{ id: "models", label: "模型设置", labelKey: "settings.models", icon: Layers },
			{ id: "forges", label: "代码托管", labelKey: "settings.forges", icon: GitPullRequest },
			{ id: "screenshot", label: "屏幕截图", labelKey: "settings.screenshot", icon: Camera },
			{ id: "browser", label: "浏览器", labelKey: "settings.browser", icon: Globe },
		],
	},
	{
		label: "Agent 能力",
		labelKey: "settings.group.agent",
		items: [
			{ id: "plugins", label: "插件", labelKey: "settings.extensions", icon: Blocks },
			{ id: "agents", label: "智能体", labelKey: "settings.agents", icon: Bot },
			// 紧挨着智能体，因为它们是同一件事的两半：那一页说有谁，这一页说什么时候派他们出去。
			{ id: "delegation", label: "子智能体调度", labelKey: "settings.delegation", icon: Workflow },
			{ id: "commands", label: "命令", labelKey: "settings.commands", icon: SquareTerminal },
			{ id: "hooks", label: "钩子", labelKey: "settings.hooks", icon: Anchor },
			{ id: "search", label: "网页搜索", labelKey: "settings.search", icon: Search },
			{ id: "access", label: "访问授权", labelKey: "settings.access", icon: ShieldCheck },
		],
	},
	{
		label: "数据与统计",
		labelKey: "settings.group.data",
		items: [
			{ id: "index", label: "索引库", labelKey: "settings.index", icon: Database },
			{ id: "sync", label: "移动端同步", labelKey: "settings.sync", icon: Smartphone },
			{ id: "usage", label: "使用统计", labelKey: "settings.usage", icon: BarChart3 },
		],
	},
	{
		label: "代码与版本控制",
		labelKey: "settings.group.vcs",
		items: [
			{ id: "worktrees", label: "Worktrees", labelKey: "settings.worktrees", icon: FolderGit2 },
		],
	},
	{
		label: "关于与归档",
		labelKey: "settings.group.about",
		items: [
			{ id: "about", label: "关于", labelKey: "settings.about", icon: Info },
			{ id: "archived", label: "已归档的聊天", labelKey: "settings.archived", icon: Archive },
		],
	},
];


/** Desktop capture works on every desktop platform; phones still use their native capture. */
export function settingsGroups(_platform: string, phone: boolean) {
	return groupsFor(GROUPS, phone);
}
