/**
 * 设置 › 插件 › MCP：每一台服务一张卡片——它在不在跑、缺不缺钥匙、怎么启动、带来了哪些工具。
 *
 * 卡片从上到下是人需要的顺序：
 *
 *   1. 头：名字、状态（已连接 · N 个工具 / 缺密钥 / 连接失败 / 已关闭）、开关、⋯；
 *   2. 缺钥匙时，钥匙就在头下面——不填它，下面的一切都起不来；
 *   3. 「启动方式」（命令和参数，或 URL）和「环境变量」，收着：头上那颗滑杆按钮悬停才出现，点开才展开；
 *   4. 「工具」，收着：状态里的「N 个工具」本身就是它的开关。
 *
 * 从前页面最上面是一段写死的「推荐」（Context7、Filesystem 两条），下面每台服务是一张摊开的表单：
 * 名字、命令、参数全是输入框，状态是三个并排的徽章，env 根本不显示——一个要钥匙的服务在这里没有
 * 任何办法填钥匙。推荐那一段现在是市场的事：市场上有几十台，而且会更新；这里只留一条去市场的路。
 */

import { Input } from "../../ui/inputs/NativeField.tsx";
import type { McpServerConfig } from "@lyra/core";
import { looksSecret } from "@lyra/core/mcp-placeholders";
import { FolderOpen, MoreHorizontal, Plus, SlidersHorizontal, Store, Trash2 } from "lucide-react";
import { Collapse } from "../../ui/layout/Collapse.tsx";
import { useEffect, useState } from "react";
import type { AgentCapabilities } from "../../../electron/ipc-types.ts";
import { PluginIcon } from "./PluginIcon.tsx";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import { MenuBody, MenuItem, MenuSeparator, Popover, usePopover } from "../../ui/overlay/Popover.tsx";
import { useApp } from "../../store/index.ts";
import { Card, EmptyHint, Field, Select, TextInput, Toggle } from "./controls.tsx";
import { SecretInput } from "./inputs.tsx";
import { ProjectOverrideNotice } from "./ProjectOverrideNotice.tsx";
import { McpKeys, missingOf, useEnvironment, useLocalScan, type MarketMark } from "../plugins/index.ts";
import { bridge } from "../../services/index.ts";
import { translate, useI18n } from "../../i18n/index.ts";

type Status = AgentCapabilities["mcp"][number];

export function McpSettings({ filter = "", markOf }: { filter?: string; markOf?: (id?: string, name?: string) => MarketMark | undefined }) {
	const { t } = useI18n();
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);
	const activeSessionId = useApp((s) => s.activeSessionId);
	const setView = useApp((s) => s.setView);
	const setPluginFocus = useApp((s) => s.setPluginFocus);
	const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);
	const confirm = useConfirmer();
	// Each installed server's bundle: where it lives (for 打开目录) and what it looks like.
	const { scan } = useLocalScan();
	const bundles = new Map((scan?.mcpBundles ?? []).map((bundle) => [bundle.id, bundle]));

	useEffect(() => {
		if (!activeSessionId) return;
		let alive = true;
		void bridge.sessions
			.capabilities(activeSessionId)
			.then((answer) => alive && setCapabilities(answer))
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, [activeSessionId, settings?.mcpServers]);

	const all = settings?.mcpServers ?? [];
	const present = useEnvironment(all.flatMap((server) => Object.keys(server.env ?? {})));
	if (!settings) return null;
	const needle = filter.trim().toLowerCase();
	const servers = all.filter((s) => !needle || `${s.name} ${s.origin?.bundle ?? ""}`.toLowerCase().includes(needle));

	const update = (id: string, patch: Partial<McpServerConfig>) =>
		void saveSettings({
			...settings,
			mcpServers: settings.mcpServers.map((s) => (s.id === id ? ({ ...s, ...patch } as McpServerConfig) : s)),
		});

	const remove = (server: McpServerConfig) =>
		confirm.ask(
			server.origin
				? {
						/*
						 * Uninstalling reaches past this page, because an installed server is two things: this
						 * row, and the directory under `~/.lyra/mcp` it was copied from. Deleting only the row
						 * leaves the directory, and the next scan writes the row straight back.
						 */
						title: t("mcp.uninstallConfirm", { name: server.name }),
						detail: t("mcp.uninstallDetail", { bundle: server.origin.bundle }),
						confirmLabel: t("mcp.uninstall"),
						onConfirm: () => void bridge.plugins.uninstall(server.origin?.bundle ?? "").then(() => useApp.getState().bumpExtensions()),
					}
				: {
						title: t("mcp.deleteConfirm", { name: server.name }),
						detail: t("mcp.deleteDetail"),
						confirmLabel: t("common.delete"),
						onConfirm: () => void saveSettings({ ...settings, mcpServers: settings.mcpServers.filter((s) => s.id !== server.id) }),
					},
		);

	const browse = () => {
		setPluginFocus(null);
		setView("plugins");
	};

	return (
		<div>
			<ProjectOverrideNotice keys={["mcpServers"]} />

			{servers.length === 0 ? (
				<div className="py-12 text-center">
					<EmptyHint>{needle ? t("mcp.noMatch") : t("mcpSettings.emptyHint")}</EmptyHint>
					{!needle && (
						<button
							type="button"
							onClick={browse}
							className="mx-auto mt-3 flex h-[32px] items-center gap-1.5 rounded-lg bg-card-hover px-3 text-label text-ink transition-colors duration-[var(--ly-t-quick)] hover:bg-line-soft"
						>
							<Store size={14} strokeWidth={1.8} aria-hidden />
							{t("mcpSettings.findInMarket")}
						</button>
					)}
				</div>
			) : (
				<div className="space-y-3">
					{servers.map((server) => (
						<ServerCard
							key={server.id}
							server={server}
							status={capabilities?.mcp.find((m) => m.id === server.id)}
							missing={missingOf(server, present)}
							onUpdate={(patch) => update(server.id, patch)}
							onRemove={() => remove(server)}
							folder={server.origin ? bundles.get(server.origin.bundle)?.dir : undefined}
							mark={markOf?.(server.origin?.bundle, server.name) ?? (server.origin ? bundles.get(server.origin.bundle)?.manifest.interface : undefined)}
							onOpenInMarket={
								server.origin
									? () => {
											setPluginFocus(server.origin?.bundle ?? null);
											setView("plugins");
										}
									: undefined
							}
						/>
					))}
				</div>
			)}

			{servers.length > 0 && (
				<button
					type="button"
					onClick={browse}
					className="mt-5 flex items-center gap-1.5 text-detail text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:text-ink"
				>
					<Store size={12} strokeWidth={1.9} aria-hidden />
					{t("mcpSettings.moreInMarket")}
				</button>
			)}

			{confirm.element}
		</div>
	);
}

function ServerCard({
	server,
	status,
	missing,
	onUpdate,
	onRemove,
	onOpenInMarket,
	folder,
	mark,
}: {
	server: McpServerConfig;
	status: Status | undefined;
	missing: string[];
	onUpdate: (patch: Partial<McpServerConfig>) => void;
	onRemove: () => void;
	onOpenInMarket?: () => void;
	/** The bundle's directory, for a server that came from the market. */
	folder?: string;
	/** Its bundle's mark, so the card looks like the one it was installed from. */
	mark?: { logo?: string; brandColor?: string };
}) {
	const { t } = useI18n();
	const menu = usePopover();
	/*
	 * The launch settings and the tool list, opened on demand from the header rather than sitting as
	 * two disclosure rows at the foot of every card. A page of three servers used to be three names and
	 * six 「启动方式与环境变量 / 工具」 rows — the part nobody opens outnumbering the part everybody reads.
	 */
	const [open, setOpen] = useState<"launch" | "tools" | null>(null);
	const toggle = (which: "launch" | "tools") => setOpen((was) => (was === which ? null : which));
	const tools = status?.tools ?? [];
	const state = !server.enabled
		? { tone: "text-ink-faint", dot: "bg-line", label: t("market.serverOff") }
		: missing.length > 0
			? { tone: "text-accent", dot: "bg-accent", label: t("mcpSettings.needsKeys") }
			: status?.state === "connected"
				? { tone: "text-ok", dot: "bg-ok", label: translate("mcpSettings.toolCount", { n: status.toolCount }) }
				: status?.state === "failed"
					? { tone: "text-danger", dot: "bg-danger", label: t("mcp.failed") }
					: { tone: "text-ink-faint", dot: "bg-ink-faint/60", label: t("market.serverOn") };

	return (
		<Card data-mcp-server={server.id} className="group/card">
			<div className="flex items-center gap-2 px-4 py-3">
				<PluginIcon name={server.name} kind="mcp" logo={mark?.logo} brandColor={mark?.brandColor} size={28} />
				<div className="min-w-0 flex-1">
					<Input
						value={server.name}
						onChange={(e) => onUpdate({ name: e.target.value })}
						aria-label={t("mcpSettings.name")}
						className="w-full min-w-0 truncate bg-transparent text-body text-ink focus:outline-none"
					/>
					<div className="flex items-center gap-1.5 text-caption">
						<span className={`h-1.5 w-1.5 shrink-0 rounded-full ${state.dot}`} aria-hidden />
						{status?.state === "connected" && server.enabled && missing.length === 0 && tools.length > 0 ? (
							<button
								type="button"
								aria-expanded={open === "tools"}
								onClick={() => toggle("tools")}
								className={`${state.tone} rounded underline-offset-2 transition-opacity duration-[var(--ly-t-quick)] hover:underline aria-expanded:underline`}
							>
								{state.label}
							</button>
						) : (
							<span className={state.tone}>{state.label}</span>
						)}
						<span className="text-ink-faint">· {server.transport === "stdio" ? "stdio" : server.transport === "sse" ? "SSE" : "HTTP"}</span>
						{server.origin && <span className="text-ink-faint">· {t("mcp.fromMarket")}</span>}
					</div>
				</div>
				{/* Shown on hover or focus — and kept while its section is open, so the way back is where it was. */}
				<button
					type="button"
					aria-label={t("mcpSettings.launch")}
					data-ly-tip={t("mcpSettings.launch")}
					aria-expanded={open === "launch"}
					onClick={() => toggle("launch")}
					className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-ink-faint opacity-0 transition-[color,background-color,opacity] duration-[var(--ly-t-quick)] group-hover/card:opacity-100 hover:bg-card-hover hover:text-ink focus-visible:opacity-100 aria-expanded:bg-card-hover aria-expanded:text-ink aria-expanded:opacity-100"
				>
					<SlidersHorizontal size={14} strokeWidth={1.9} aria-hidden />
				</button>
				<Toggle checked={server.enabled} onChange={(enabled) => onUpdate({ enabled })} ariaLabel={t("market.enableNamed", { name: server.name })} />
				<button
					type="button"
					aria-label={t("plugins.moreFor", { name: server.name })}
					data-ly-tip={t("common.more")}
					aria-haspopup="menu"
					aria-expanded={menu.open}
					onClick={menu.toggle}
					className="flex h-[26px] w-[26px] items-center justify-center rounded-md text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink aria-expanded:bg-card-hover aria-expanded:text-ink"
				>
					<MoreHorizontal size={15} strokeWidth={1.9} />
				</button>
			</div>

			{(missing.length > 0 || (server.needs?.length ?? 0) > 0) && (
				<div className="border-t border-line-soft px-4 py-3.5">
					<McpKeys servers={[server]} compact />
				</div>
			)}

			{status?.state === "failed" && status.error && !status.missing && server.enabled && (
				<p className="border-t border-line-soft px-4 py-2.5 text-detail leading-relaxed text-danger">{status.error}</p>
			)}

			<Collapse open={open === "launch"}>
				<div className="border-t border-line-soft px-4 pt-3 pb-1">
					<div className="space-y-3 pt-1 pb-2">
							{server.transport === "stdio" ? (
								<>
									<Field label={t("mcpSettings.command")}>
										<TextInput value={server.command} onChange={(command) => onUpdate({ command })} mono placeholder="npx" />
									</Field>
									<Field label={t("mcp.args")} hint={t("mcp.argsDetail")}>
										<TextInput
											value={(server.args ?? []).join(" ")}
											onChange={(value) => onUpdate({ args: value.split(" ").filter(Boolean) })}
											mono
											placeholder="-y @modelcontextprotocol/server-filesystem /Users/me/code"
										/>
									</Field>
								</>
							) : (
								<>
									<Field label="URL">
										<TextInput value={server.url} onChange={(url) => onUpdate({ url })} mono placeholder="https://mcp.example.com/mcp" />
									</Field>
									<Field label={t("mcp.transport")}>
										<Select
											value={server.transport}
											onChange={(transport) => onUpdate({ transport })}
											options={[
												{ value: "http", label: "Streamable HTTP" },
												{ value: "sse", label: "SSE" },
											]}
										/>
									</Field>
								</>
							)}
							<EnvEditor server={server} onChange={(env) => onUpdate({ env })} />
						</div>
				</div>
			</Collapse>
			<Collapse open={open === "tools"}>
				<div className="space-y-1 border-t border-line-soft px-4 py-3">
					{tools.map((tool) => (
						<div key={tool.name} className="text-detail">
							<span className="font-mono text-ink">{tool.name}</span>
							<span className="ml-2 text-ink-faint">{tool.description.slice(0, 120)}</span>
						</div>
					))}
				</div>
			</Collapse>

			{menu.open && (
				<Popover anchor={menu.anchor} onClose={menu.close} placement="bottom" align="end" width="compact" role="menu" label={server.name}>
					<MenuBody>
						{onOpenInMarket && (
							<MenuItem
								icon={<Store size={13} strokeWidth={1.8} />}
								onClick={() => {
									menu.close();
									onOpenInMarket();
								}}
							>
								{t("mcpSettings.viewInMarket")}
							</MenuItem>
						)}
						{folder && (
							<MenuItem
								icon={<FolderOpen size={13} strokeWidth={1.8} />}
								onClick={() => {
									menu.close();
									void bridge.system.openPath(folder);
								}}
							>
								{t("common.openFolder")}
							</MenuItem>
						)}
						{(onOpenInMarket || folder) && <MenuSeparator />}
						<MenuItem
							danger
							icon={<Trash2 size={13} strokeWidth={1.8} />}
							onClick={() => {
								menu.close();
								onRemove();
							}}
						>
							{server.origin ? t("mcp.uninstall") : t("common.delete")}
						</MenuItem>
					</MenuBody>
				</Popover>
			)}
		</Card>
	);
}

/**
 * The environment a server starts with, as rows.
 *
 * There was no editor for it at all — a server that needed `DEBUG=1`, or a key its package never
 * declared, had to be given one by editing the settings file. The keys a package *does* declare are
 * above, in `McpKeys`, with their descriptions; these rows are everything else, and every row that
 * looks like a secret is masked and, like those, kept in the vault rather than in the file.
 */
function EnvEditor({ server, onChange }: { server: McpServerConfig; onChange: (env: Record<string, string>) => void }) {
	const { t } = useI18n();
	const declared = new Set((server.needs ?? []).map((need) => need.name));
	const rows = Object.entries(server.env ?? {}).filter(([name]) => !declared.has(name));
	const [name, setName] = useState("");
	const valid = /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);

	const set = (key: string, value: string) => onChange({ ...server.env, [key]: value });
	const drop = (key: string) => {
		const next = { ...server.env };
		delete next[key];
		onChange(next);
	};

	return (
		<Field label={t("mcpSettings.env")} hint={t("mcpSettings.envHint")}>
			<div className="space-y-1.5">
				{rows.map(([key, value]) => (
					<div key={key} className="flex items-center gap-2">
						<span className="w-[40%] shrink-0 truncate font-mono text-detail text-ink" data-ly-tip={key}>
							{key}
						</span>
						<div className="min-w-0 flex-1">
							{looksSecret(key) ? (
								<SecretInput value={value} onChange={(next) => set(key, next)} />
							) : (
								<TextInput value={value} onChange={(next) => set(key, next)} mono />
							)}
						</div>
						<button
							type="button"
							aria-label={t("mcpSettings.removeEnv", { name: key })}
							data-ly-tip={t("common.remove")}
							onClick={() => drop(key)}
							className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-danger/10 hover:text-danger"
						>
							<Trash2 size={13} strokeWidth={1.8} />
						</button>
					</div>
				))}
				<div className="flex items-center gap-2">
					<div className="w-[40%] shrink-0">
						<TextInput
							value={name}
							onChange={setName}
							onKeyDown={(event) => {
								if (event.key === "Enter" && valid) {
									set(name, "");
									setName("");
								}
							}}
							mono
							invalid={name !== "" && !valid}
							placeholder="NAME"
						/>
					</div>
					<button
						type="button"
						disabled={!valid}
						onClick={() => {
							set(name, "");
							setName("");
						}}
						className="flex h-[30px] items-center gap-1 rounded-lg px-2.5 text-detail text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink disabled:opacity-40"
					>
						<Plus size={12} strokeWidth={2} aria-hidden />
						{t("mcpSettings.addEnv")}
					</button>
				</div>
			</div>
		</Field>
	);
}
