import { Blocks, Cable, ChevronDown, FolderOpen, MoreHorizontal, Plus, Puzzle, Scale, Sparkles, Store } from "lucide-react";
import { useEffect, useState } from "react";

import { MenuBody, MenuItem, Popover, usePopover } from "../../ui/overlay/Popover.tsx";
import { SearchField } from "../../ui/inputs/SearchField.tsx";
import { useApp } from "../../store/index.ts";
import { ExtensionHostSettings } from "./ExtensionHostSettings.tsx";
import { McpSettings, newMcpServer } from "./McpSettings.tsx";
import { PluginsSettings } from "./PluginsSettings.tsx";
import { RulesSettings } from "./RulesSettings.tsx";
import { SkillsSettings } from "./SkillsSettings.tsx";
import { bridge } from "../../services/index.ts";

type Tab = "plugins" | "skills" | "rules" | "mcp" | "extensions";

/**
 * Plugins, skills and MCP servers, in one place.
 *
 * They were three separate pages in the sidebar, which put three names on something users have
 * one word for. A plugin *is* a bundle of skills and MCP servers — listing the container and
 * its two contents as siblings made them look like three competing mechanisms to choose
 * between, when the relationship is that one contains the others.
 *
 * The counts sit in the tabs because that is the question the page answers at a glance: how
 * much is installed, and of what.
 */
export function ExtensionsSettings() {
	const workspace = useApp((s) => s.workspace);
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);
	const setView = useApp((s) => s.setView);
	const [tab, setTab] = useState<Tab>("plugins");
	const [query, setQuery] = useState("");
	const [counts, setCounts] = useState({ plugins: 0, skills: 0, rules: 0, extensions: 0 });
	const add = usePopover();
	const more = usePopover();
	const extensionsNonce = useApp((s) => s.extensionsNonce);

	/** Whichever directory this tab is about — the two tabs that have one ask the same question. */
	const revealDir = (scope: "user" | "workspace") => {
		const cwd = workspace?.path ?? "";
		if (tab === "skills") return bridge.system.revealSkillsDir(scope, cwd);
		return bridge.plugins.revealDir(scope, cwd);
	};

	const addServer = (transport: "stdio" | "http") => {
		if (!settings) return;
		void saveSettings({ ...settings, mcpServers: [...settings.mcpServers, newMcpServer(transport)] });
		setTab("mcp");
	};

	/*
	 * Browsing is a different place now, not a dialog over this one.
	 *
	 * This page is for what is already installed — which bundle is on, what it brought with it,
	 * where its directory is. Finding something new is the catalogue's job, and it had been a
	 * 620px modal launched from here, which is a strange place to keep a shop. Leaving means
	 * leaving; the catalogue's own header has a gear pointing back.
	 */
	const browse = () => setView("plugins");

	useEffect(() => {
		const cwd = workspace?.path ?? "";
		/*
		 * 两次扫描，各自到达。
		 *
		 * 规则和插件读的是不同的目录，用 `Promise.all` 会让先回来的那个等着后回来的——而这里
		 * 是两个 tab 上的两个数字，谁也不依赖谁。
		 */
		void bridge.plugins.list(cwd).then((scan) => {
			setCounts((was) => ({ ...was, plugins: scan.plugins.length, skills: scan.skills.length }));
		});
		void bridge.extensions
			.stats(null, cwd)
			.then((scan) => setCounts((was) => ({ ...was, extensions: scan.extensions.length })))
			.catch(() => {});
		void bridge.rules.list(cwd).then((scan) => {
			// 生效的那些——被同名文件盖掉的不算，它们在那一页里单列一段说明。
			setCounts((was) => ({ ...was, rules: scan.rules.filter((rule) => !rule.shadowedBy).length }));
		});
	}, [workspace?.path, settings?.disabledPlugins.length, extensionsNonce]);

	// Same order as the catalogue's tabs. They are the two halves of one subject, and a page where
	// 技能 is second and another where it is third is two orders for one list.
	const tabs: { id: Tab; label: string; count: number; icon: typeof Blocks }[] = [
		{ id: "plugins", label: "插件", count: counts.plugins, icon: Blocks },
		{ id: "mcp", label: "MCP", count: settings?.mcpServers.length ?? 0, icon: Cable },
		{ id: "skills", label: "技能", count: counts.skills, icon: Sparkles },
		/*
		 * 规则跟技能并列，因为它们是同一类东西：磁盘上的 markdown，按同名覆盖，影响模型怎么做事。
		 *
		 * 数字不在这里显示。技能和插件的数量是「装了多少」，看一眼就有用；规则的数量里混着六个
		 * 来源和三种代价，一个总数说不清任何事——要看的是那张表本身。
		 */
		{ id: "rules", label: "规则", count: counts.rules, icon: Scale },
		/*
		 * 扩展在最后：它不是「给模型的东西」，是「看着模型的东西」——跑在 worker 里的代码，
		 * 收事件、可以拦截。这一页答的是它有没有在跑、跑得多慢（10 §7.3）。
		 */
		{ id: "extensions", label: "扩展", count: counts.extensions, icon: Puzzle },
	];

	return (
		<div className="flex min-h-0 flex-1 flex-col pt-8">
			<header className="flex shrink-0 items-start justify-between pb-5">
				<div className="min-w-0">
					<h1 className="text-display leading-tight font-semibold tracking-tight text-ink">插件</h1>
					{/* One line under the title, because the word 插件 is doing three jobs on this page —
					    and the tabs below only make sense once you know it contains the other two. */}
					<p className="pt-1 text-label text-ink-muted">管理插件、技能和 MCP</p>
				</div>

				<div className="flex shrink-0 items-center gap-2 pt-1">
					<button
						type="button"
						onClick={browse}
						className="flex h-[30px] items-center gap-1.5 rounded-lg border border-line px-3 text-label text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:border-ink-faint hover:text-ink"
					>
						<Store size={13} strokeWidth={1.8} />
						浏览市场
					</button>
					<button
						type="button"
						onClick={add.toggle}
						aria-haspopup="menu"
						aria-expanded={add.open}
						className="flex h-[30px] items-center gap-1.5 rounded-lg bg-ink px-3 text-label font-medium text-shell transition-opacity duration-[var(--ly-t-quick)] hover:opacity-90"
					>
						添加
						<ChevronDown size={13} strokeWidth={2} />
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
								browse();
							}}
						>
							添加插件市场
						</MenuItem>
						{/* Adds one and lands on it, rather than only switching tab — the label says 添加,
						    and a menu item that navigates instead of doing the thing it names is a lie. */}
						<MenuItem
							icon={<Cable size={14} strokeWidth={1.8} />}
							onClick={() => {
								add.close();
								addServer("stdio");
							}}
						>
							添加 MCP 服务器
						</MenuItem>
					</MenuBody>
				</Popover>
			)}

			{/* One row: what to look at, and what to look for. */}
			<div className="flex shrink-0 items-center gap-3 pb-5">
				<div className="flex items-center gap-1">
					{tabs.map((entry) => (
						<button
							key={entry.id}
							type="button"
							onClick={() => setTab(entry.id)}
							className={`flex h-[30px] items-center gap-1.5 rounded-lg px-3 text-label transition-colors duration-[var(--ly-t-quick)] ${
								tab === entry.id ? "bg-card-hover text-ink" : "text-ink-muted hover:bg-card-hover/60"
							}`}
						>
							<entry.icon size={13} strokeWidth={1.8} className="shrink-0" />
							{entry.label}
							<span className="text-ink-faint tabular-nums">{entry.count}</span>
						</button>
					))}
				</div>

				<div className="min-w-2 flex-1" />
				<SearchField
					size="comfortable"
					value={query}
					onChange={setQuery}
					placeholder="搜索"
					className="w-[220px]"
				/>

				{/*
				 * What this tab can do besides list things.
				 *
				 * Each of the three used to open with a header of its own — two directory buttons on
				 * plugins, the same two on skills, two 添加 buttons on MCP — so switching tab moved a
				 * row of buttons around above a list that had not moved. They are the same kind of
				 * thing (act on the tab, not on a row), and one ⋯ that changes contents is where that
				 * kind of thing goes.
				 */}
				<button
					type="button"
					aria-label="更多操作"
					aria-haspopup="menu"
					aria-expanded={more.open}
					onClick={more.toggle}
					className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-lg text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink aria-expanded:bg-card-hover aria-expanded:text-ink"
				>
					<MoreHorizontal size={15} strokeWidth={1.9} />
				</button>
			</div>

			{more.open && (
				<Popover anchor={more.anchor} onClose={more.close} placement="bottom" align="end" width="default">
					<MenuBody>
						{tab === "mcp" ? (
							<>
								<MenuItem
									icon={<Plus size={13} strokeWidth={1.9} />}
									onClick={() => {
										more.close();
										addServer("stdio");
									}}
								>
									添加 stdio 服务
								</MenuItem>
								<MenuItem
									icon={<Plus size={13} strokeWidth={1.9} />}
									onClick={() => {
										more.close();
										addServer("http");
									}}
								>
									添加 HTTP 服务
								</MenuItem>
							</>
						) : (
							<>
								<MenuItem
									icon={<FolderOpen size={13} strokeWidth={1.8} />}
									onClick={() => {
										more.close();
										void revealDir("user");
									}}
								>
									用户目录
								</MenuItem>
								<MenuItem
									icon={<FolderOpen size={13} strokeWidth={1.8} />}
									disabled={!workspace}
									title={workspace ? undefined : "当前没有打开项目"}
									onClick={() => {
										more.close();
										void revealDir("workspace");
									}}
								>
									项目目录
								</MenuItem>
							</>
						)}
					</MenuBody>
				</Popover>
			)}

			<div className="min-h-0 flex-1 overflow-y-auto pb-10">
				{tab === "plugins" && <PluginsSettings filter={query} />}
				{tab === "skills" && <SkillsSettings filter={query} />}
				{tab === "rules" && <RulesSettings filter={query} />}
				{tab === "mcp" && <McpSettings filter={query} />}
				{tab === "extensions" && <ExtensionHostSettings filter={query} />}
			</div>

		</div>
	);
}
