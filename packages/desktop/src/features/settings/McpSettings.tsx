import { Input } from "../../ui/inputs/NativeField.tsx";
import type { McpServerConfig } from "@lyra/core";
import { Cable } from "lucide-react";
import { RowDeleteButton } from "../../ui/primitives/RowDeleteButton.tsx";
import { Disclosure } from "../../ui/layout/Disclosure.tsx";
import { useEffect, useState } from "react";
import type { AgentCapabilities } from "../../../electron/ipc-types.ts";
import { PluginIcon } from "./PluginIcon.tsx";
import { useConfirmer } from "../../ui/overlay/Confirm.tsx";
import { useApp } from "../../store/index.ts";
import { Badge, Card, EmptyHint, Field, GhostButton, SectionTitle, Select, TextInput, Toggle } from "./controls.tsx";
import { ProjectOverrideNotice } from "./ProjectOverrideNotice.tsx";
import { bridge } from "../../services/index.ts";
import { translate, useI18n, type MessageKey } from "../../i18n/index.ts";

/** Servers worth suggesting: widely used, no account needed to try. */
/* 推荐目录在模块加载时成型，那会儿还不知道窗口是哪种语言——存 key，渲染时才译。 */
const RECOMMENDED: { id: string; name: string; detailKey: MessageKey; server: McpServerConfig }[] = [
	{
		id: "context7",
		name: "Context7",
		detailKey: "mcp.context7",
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
		detailKey: "mcp.filesystem",
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
		? { id, name: translate("mcp.newStdio"), transport: "stdio", command: "npx", args: [], enabled: true }
		: { id, name: translate("mcp.newHttp"), transport: "http", url: "https://", enabled: true };
}

export function McpSettings({ filter = "" }: { filter?: string }) {
	const { t } = useI18n();
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
			<ProjectOverrideNotice keys={["mcpServers"]} />
			{/* Adding a server is in the page's ⋯ now, beside the other two tabs' directory actions. */}
			<SectionTitle>{t("mcp.recommended")}</SectionTitle>
			<Card className="mb-7">
				{RECOMMENDED.map((entry) => {
					const installed = servers.some((s) => s.id === entry.id);
					return (
						<div key={entry.id} className="flex items-center gap-3 border-b border-line-soft px-4 py-3 last:border-b-0">
							<Cable size={15} strokeWidth={1.8} className="shrink-0 text-info" />
							<div className="min-w-0 flex-1">
								<div className="text-body text-ink">{entry.name}</div>
								<div className="mt-0.5 text-label text-ink-muted">{t(entry.detailKey)}</div>
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
								{installed ? t("mcp.added") : t("mcp.add")}
							</GhostButton>
						</div>
					);
				})}
			</Card>

			<SectionTitle>{translate("mcpSettings.configured", { n: servers.length })}</SectionTitle>

			{servers.length === 0 ? (
				<Card>
					<EmptyHint>{needle ? t("mcp.noMatch") : t("mcp.empty")}</EmptyHint>
				</Card>
			) : (
				<div className="space-y-3">
					{servers.map((server) => {
						const status = capabilities?.mcp.find((m) => m.id === server.id);
						return (
							<Card key={server.id}>
								<div data-row-actions className="flex items-center gap-2.5 border-b border-line-soft px-4 py-3">
									<PluginIcon name={server.name} kind="mcp" size={22} />
									<Input
										value={server.name}
										onChange={(e) => update(server.id, { name: e.target.value })}
										className="min-w-0 flex-1 bg-transparent text-body text-ink focus:outline-none"
									/>
									<Badge tone="muted">{server.transport}</Badge>
									{status?.state === "connected" && <Badge tone="ok">{translate("mcpSettings.toolCount", { n: status.toolCount })}</Badge>}
									{status?.state === "failed" && <Badge tone="danger">{t("mcp.failed")}</Badge>}
									{/*
									 * Where it came from, said on the row.
									 *
									 * Everything on this page used to be typed in by hand, so there was
									 * nothing to say. Now half of them arrived from the catalogue, and which
									 * half decides what the delete button means: a hand-made row is one
									 * server to drop, an installed one has a directory that has to go with
									 * it — otherwise the next scan writes the row straight back.
									 */}
									{server.origin && <Badge tone="muted">{t("mcp.fromMarket")}</Badge>}
									<Toggle checked={server.enabled} onChange={(enabled) => update(server.id, { enabled })} />
									<RowDeleteButton
										label={t("mcp.removeNamed", { action: server.origin ? t("mcp.uninstall") : t("common.delete"), name: server.name })}
										onClick={() =>
											confirm.ask(server.origin
													? {
															title: t("mcp.uninstallConfirm", { name: server.name }),
															detail: t("mcp.uninstallDetail", { bundle: server.origin.bundle }),
															confirmLabel: t("mcp.uninstall"),
															onConfirm: () => void uninstallBundle(server.origin?.bundle ?? ""),
														}
													: {
															title: t("mcp.deleteConfirm", { name: server.name }),
															detail: t("mcp.deleteDetail"),
															confirmLabel: t("common.delete"),
															onConfirm: () => remove(server.id),
														},
											)
										}
									/>
								</div>

								<div className="space-y-3 px-4 py-3.5">
									{server.transport === "stdio" ? (
										<>
											<Field label={t("commands.title")}>
												<TextInput
													value={server.command}
													onChange={(command) => update(server.id, { command })}
													mono
													placeholder="npx"
												/>
											</Field>
											<Field label={t("mcp.args")} hint={t("mcp.argsDetail")}>
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
											<Field label={t("mcp.transport")}>
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
										<Disclosure variant="compact" title={t("common.tools")} count={status.tools.length}>
											<div className="space-y-1 py-1">
												{status.tools.map((tool) => (
													<div key={tool.name} className="text-detail">
														<span className="font-mono text-ink">{tool.name}</span>
														<span className="ml-2 text-ink-faint">{tool.description.slice(0, 120)}</span>
													</div>
												))}
											</div>
										</Disclosure>
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
