import type { McpServerConfig } from "@lyra/core";
import { Cable, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentCapabilities } from "../../../electron/ipc-types.ts";
import { PluginIcon } from "./PluginIcon.tsx";
import { useConfirmer } from "../Confirm.tsx";
import { useApp } from "../../store.ts";
import { Badge, Card, EmptyHint, Field, GhostButton, SectionTitle, Select, TextInput, Toggle } from "./controls.tsx";
import { bridge } from "../../services/index.ts";

/** Servers worth suggesting: widely used, no account needed to try. */
const RECOMMENDED: { id: string; name: string; detail: string; server: McpServerConfig }[] = [
	{
		id: "context7",
		name: "Context7",
		detail: "按库名拉取最新的官方文档与 API 用法，避免模型凭记忆编 API。",
		server: {
			id: "context7",
			name: "Context7",
			transport: "stdio",
			command: "npx",
			args: ["-y", "@upstash/context7-mcp@latest"],
			enabled: true,
		},
	},
	{
		id: "filesystem",
		name: "Filesystem",
		detail: "官方文件系统服务，把可访问目录限制在白名单内。",
		server: {
			id: "filesystem",
			name: "Filesystem",
			transport: "stdio",
			command: "npx",
			args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
			enabled: true,
		},
	},
];

/**
 * A blank server of the given kind, ready to be edited.
 *
 * Exported because adding one is offered from the page's own ⋯ as well as from here, and the two
 * must produce the same thing — a second copy of these defaults would drift the first time one of
 * them was corrected.
 */
export function newMcpServer(transport: "stdio" | "http"): McpServerConfig {
	const id = `mcp-${Date.now().toString(36)}`;
	return transport === "stdio"
		? { id, name: "新建 stdio 服务", transport: "stdio", command: "npx", args: [], enabled: true }
		: { id, name: "新建 HTTP 服务", transport: "http", url: "https://", enabled: true };
}

export function McpSettings({ filter = "" }: { filter?: string }) {
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);
	const activeSessionId = useApp((s) => s.activeSessionId);
	const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);
	const confirm = useConfirmer();

	useEffect(() => {
		if (!activeSessionId) return;
		void bridge.sessions.capabilities(activeSessionId).then(setCapabilities);
	}, [activeSessionId]);

	if (!settings) return null;
	const needle = filter.trim().toLowerCase();
	const servers = settings.mcpServers.filter((s) => !needle || s.name.toLowerCase().includes(needle));

	const update = (id: string, patch: Partial<McpServerConfig>) =>
		void saveSettings({
			...settings,
			mcpServers: settings.mcpServers.map((s) => (s.id === id ? ({ ...s, ...patch } as McpServerConfig) : s)),
		});

	const remove = (id: string) =>
		void saveSettings({ ...settings, mcpServers: settings.mcpServers.filter((s) => s.id !== id) });

	/**
	 * Uninstalling reaches past this page, because an installed server is two things.
	 *
	 * The row here is a copy of what a directory under `~/.lyra/mcp` declared. Deleting only the
	 * row leaves the directory, and the next scan does not care that you deleted anything — the
	 * main process removes both, keyed on the bundle name every row it wrote carries.
	 */
	const uninstallBundle = async (bundle: string) => {
		if (!bundle) return;
		await bridge.plugins.uninstall(bundle);
	};

	return (
		<div>
			{/* Adding a server is in the page's ⋯ now, beside the other two tabs' directory actions. */}
			<SectionTitle>推荐</SectionTitle>
			<Card className="mb-7">
				{RECOMMENDED.map((entry) => {
					const installed = servers.some((s) => s.id === entry.id);
					return (
						<div key={entry.id} className="flex items-center gap-3 border-b border-line-soft px-4 py-3 last:border-b-0">
							<Cable size={15} strokeWidth={1.8} className="shrink-0 text-info" />
							<div className="min-w-0 flex-1">
								<div className="text-body text-ink">{entry.name}</div>
								<div className="mt-0.5 text-label text-ink-muted">{entry.detail}</div>
								<div className="mt-1 font-mono text-detail text-ink-faint">
									{entry.server.transport === "stdio"
										? `${entry.server.command} ${(entry.server.args ?? []).join(" ")}`
										: entry.server.url}
								</div>
							</div>
							<GhostButton
								disabled={installed}
								onClick={() => void saveSettings({ ...settings, mcpServers: [...settings.mcpServers, entry.server] })}
							>
								{installed ? "已添加" : "添加"}
							</GhostButton>
						</div>
					);
				})}
			</Card>

			<SectionTitle>已配置（{servers.length}）</SectionTitle>

			{servers.length === 0 ? (
				<Card>
					<EmptyHint>
						还没有配置 MCP 服务器。
						<br />
						例如 stdio 方式的文件系统服务：命令 <span className="font-mono">npx</span>，参数{" "}
						<span className="font-mono">-y @modelcontextprotocol/server-filesystem /path</span>
					</EmptyHint>
				</Card>
			) : (
				<div className="space-y-3">
					{servers.map((server) => {
						const status = capabilities?.mcp.find((m) => m.id === server.id);
						return (
							<Card key={server.id}>
								<div className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3">
									<PluginIcon name={server.name} kind="mcp" size={22} />
									<input
										value={server.name}
										onChange={(e) => update(server.id, { name: e.target.value })}
										className="min-w-0 flex-1 bg-transparent text-body text-ink focus:outline-none"
									/>
									<Badge tone="muted">{server.transport}</Badge>
									{status?.state === "connected" && <Badge tone="ok">{status.toolCount} 个工具</Badge>}
									{status?.state === "failed" && <Badge tone="danger">连接失败</Badge>}
									{/*
									 * Where it came from, said on the row.
									 *
									 * Everything on this page used to be typed in by hand, so there was
									 * nothing to say. Now half of them arrived from the catalogue, and which
									 * half decides what the delete button means: a hand-made row is one
									 * server to drop, an installed one has a directory that has to go with
									 * it — otherwise the next scan writes the row straight back.
									 */}
									{server.origin && <Badge tone="muted">来自市场</Badge>}
									<Toggle checked={server.enabled} onChange={(enabled) => update(server.id, { enabled })} />
									<button
										type="button"
										data-ly-tip={server.origin ? "卸载" : "删除"}
										aria-label={`${server.origin ? "卸载" : "删除"} ${server.name}`}
										onClick={() =>
											confirm.ask(server.origin
													? {
															title: `卸载 ${server.name}？`,
															detail: `它是从市场装的。卸载会删掉 ${server.origin.bundle} 的目录，你在这里改过的参数也一起清掉。`,
															confirmLabel: "卸载",
															onConfirm: () => void uninstallBundle(server.origin?.bundle ?? ""),
														}
													: {
															title: `删除 ${server.name}？`,
															detail: "这条服务的配置会从设置里消失，包括它的命令和参数。",
															confirmLabel: "删除",
															onConfirm: () => remove(server.id),
														},
											)
										}
										className="text-ink-faint transition-colors hover:text-danger"
									>
										<Trash2 size={14} strokeWidth={1.8} />
									</button>
								</div>

								<div className="space-y-3 px-4 py-3.5">
									{server.transport === "stdio" ? (
										<>
											<Field label="命令">
												<TextInput
													value={server.command}
													onChange={(command) => update(server.id, { command })}
													mono
													placeholder="npx"
												/>
											</Field>
											<Field label="参数" hint="空格分隔">
												<TextInput
													value={(server.args ?? []).join(" ")}
													onChange={(value) =>
														update(server.id, { args: value.split(" ").filter(Boolean) })
													}
													mono
													placeholder="-y @modelcontextprotocol/server-filesystem /Users/me/code"
												/>
											</Field>
										</>
									) : (
										<>
											<Field label="URL">
												<TextInput
													value={server.url}
													onChange={(url) => update(server.id, { url })}
													mono
													placeholder="https://mcp.example.com/mcp"
												/>
											</Field>
											<Field label="传输方式">
												<Select
													value={server.transport}
													onChange={(transport) => update(server.id, { transport })}
													options={[
														{ value: "http", label: "Streamable HTTP" },
														{ value: "sse", label: "SSE" },
													]}
												/>
											</Field>
										</>
									)}

									{status?.error && (
										<div className="rounded-lg border border-danger/35 bg-danger/8 px-3 py-2 text-detail text-danger">
											{status.error}
										</div>
									)}

									{status?.tools && status.tools.length > 0 && (
										<details>
											<summary className="cursor-pointer text-detail text-ink-muted">
												查看 {status.tools.length} 个工具
											</summary>
											<div className="mt-2 space-y-1">
												{status.tools.map((tool) => (
													<div key={tool.name} className="text-detail">
														<span className="font-mono text-ink">{tool.name}</span>
														<span className="ml-2 text-ink-faint">{tool.description.slice(0, 120)}</span>
													</div>
												))}
											</div>
										</details>
									)}
								</div>
							</Card>
						);
					})}
				</div>
			)}

			{confirm.element}
		</div>
	);
}
