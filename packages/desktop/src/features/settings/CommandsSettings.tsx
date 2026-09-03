/**
 * Slash commands, and the tool inventory that used to have this page to itself.
 *
 * The page is called 命令 and it now opens on the thing that word means to somebody using the app:
 * what happens when you type `/`. What was here before — every tool the model can call — is real
 * and worth keeping, but it is a debugging view of the agent's capabilities, and it had the most
 * intuitive name in the settings sidebar pointing at it.
 *
 * Two tabs rather than two sidebar entries: they are the same subject asked at two levels, and the
 * sidebar already carries fifteen destinations.
 */

import type { SlashCommand } from "@lyra/core/commands-view";
import { FolderOpen, Plus, SquareTerminal, TriangleAlert, Wrench } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AgentCapabilities } from "../../../electron/ipc-types.ts";
import { useApp } from "../../store/index.ts";
import { EmptyHint, GhostButton, PrimaryButton } from "./controls.tsx";
import { TextInput } from "./inputs.tsx";
import { Card, ListRow, SectionTitle } from "./layout.tsx";
import { bridge } from "../../services/index.ts";

type Tab = "commands" | "tools";

export function CommandsSettings() {
	const [tab, setTab] = useState<Tab>("commands");

	return (
		<div className="pt-8">
			<h1 className="text-display leading-tight font-semibold tracking-tight text-ink">命令</h1>
			<p className="mt-2 text-label text-ink-muted">在输入框里敲 “/” 就能用的指令，以及 Agent 手上的全部工具。</p>

			<div className="mt-6 mb-6 flex items-center gap-1 border-b border-line-soft">
				{(
					[
						{ id: "commands", label: "斜杠命令", icon: SquareTerminal },
						{ id: "tools", label: "工具", icon: Wrench },
					] as const
				).map((entry) => (
					<button
						key={entry.id}
						type="button"
						onClick={() => setTab(entry.id)}
						className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-label transition-colors duration-[var(--ly-t-quick)] ${
							tab === entry.id
								? "border-ink text-ink"
								: "border-transparent text-ink-muted hover:text-ink"
						}`}
					>
						<entry.icon size={13} strokeWidth={1.9} />
						{entry.label}
					</button>
				))}
			</div>

			{tab === "commands" ? <SlashCommands /> : <ToolInventory />}
		</div>
	);
}

/** Where a command came from, said the same way the composer says it. */
function originOf(command: SlashCommand): string {
	if (command.origin === "claude") return command.scope === "workspace" ? "Claude · 项目" : "Claude · 个人";
	return command.scope === "workspace" ? "项目" : "个人";
}

function SlashCommands() {
	const workspace = useApp((s) => s.workspace);
	const cwd = workspace?.path ?? "";
	const [list, setList] = useState<{ commands: SlashCommand[]; diagnostics: { path: string; message: string }[] } | null>(
		null,
	);
	const [name, setName] = useState("");
	const [scope, setScope] = useState<"workspace" | "user">("user");
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(() => {
		void bridge.commands.list(cwd).then(setList);
	}, [cwd]);

	useEffect(refresh, [refresh]);

	/*
	 * Re-read when the window is focused again.
	 *
	 * Creating a command opens it in an external editor, so the interesting moment is coming back
	 * from that editor — without this the list still shows the description the template shipped
	 * with, and the page looks like it did not notice the file being written.
	 */
	useEffect(() => {
		window.addEventListener("focus", refresh);
		return () => window.removeEventListener("focus", refresh);
	}, [refresh]);

	async function create() {
		setError(null);
		const result = await bridge.commands.create(scope, name.trim(), cwd);
		if (!result.ok) {
			setError(result.error);
			return;
		}
		setName("");
		refresh();
		// Straight into the editor: a new command is an empty file until somebody writes the prompt.
		await bridge.commands.open(result.path);
	}

	const commands = list?.commands ?? [];
	const diagnostics = list?.diagnostics ?? [];

	return (
		<div>
			<SectionTitle>新建命令</SectionTitle>
			<Card className="mb-6">
				<div className="flex flex-col gap-3 p-4">
					<div className="flex items-center gap-2">
						<div className="min-w-0 flex-1">
							<TextInput
								value={name}
								onChange={setName}
								placeholder="命令名，例如 review-diff"
								onKeyDown={(event) => {
									if (event.key === "Enter" && name.trim()) void create();
								}}
							/>
						</div>
						<div className="flex h-[38px] shrink-0 items-center gap-1 rounded-[10px] bg-card p-1">
							{(
								[
									{ id: "user", label: "个人" },
									{ id: "workspace", label: "项目" },
								] as const
							).map((entry) => (
								<button
									key={entry.id}
									type="button"
									disabled={entry.id === "workspace" && !cwd}
									onClick={() => setScope(entry.id)}
									className={`h-full rounded-[8px] px-3 text-label font-medium transition-colors duration-[var(--ly-t-quick)] disabled:opacity-40 cursor-pointer ${
										scope === entry.id ? "bg-elevated text-ink shadow-xs" : "text-ink-muted hover:text-ink"
									}`}
								>
									{entry.label}
								</button>
							))}
						</div>
						<PrimaryButton disabled={!name.trim()} onClick={() => void create()}>
							<Plus size={14} strokeWidth={2} />
							<span>创建并编辑</span>
						</PrimaryButton>
					</div>
					<p className="text-detail text-ink-faint">
						{scope === "workspace"
							? "存在项目的 .lyra/commands 里，跟着仓库走，团队每个人都能用。"
							: "存在 ~/.lyra/commands 里，你在所有项目里都能用。"}
						{" 命令就是一个 Markdown 文件，正文是你要 Agent 执行的指令。"}
					</p>
					{error && <p className="text-detail text-accent">{error}</p>}
				</div>
			</Card>

			{diagnostics.length > 0 && (
				<Card className="mb-6 border-accent/35 bg-accent/6">
					<div className="px-4 py-3">
						<div className="mb-2 flex items-center gap-1.5 text-label text-accent">
							<TriangleAlert size={13} strokeWidth={1.9} />
							{diagnostics.length} 个命令没能加载
						</div>
						{diagnostics.map((diagnostic) => (
							<div key={diagnostic.path} className="py-0.5 text-detail text-accent/85">
								<span className="font-mono">{diagnostic.path}</span> — {diagnostic.message}
							</div>
						))}
					</div>
				</Card>
			)}

			<div className="mb-2 flex items-center justify-between">
				<SectionTitle>可用命令（{commands.length}）</SectionTitle>
				<div className="flex items-center gap-1">
					<GhostButton onClick={() => void bridge.commands.reveal("user", cwd)}>
						<FolderOpen size={13} strokeWidth={1.9} />
						个人目录
					</GhostButton>
					{cwd && (
						<GhostButton onClick={() => void bridge.commands.reveal("workspace", cwd)}>
							<FolderOpen size={13} strokeWidth={1.9} />
							项目目录
						</GhostButton>
					)}
				</div>
			</div>
			<Card>
				{commands.length === 0 ? (
					<EmptyHint>
						还没有命令。上面建一个，或者把写好的 .md 文件放进命令目录——
						{/* Said plainly, because the commonest question about this feature is where the files go. */}
						项目的 .lyra/commands、你的 ~/.lyra/commands，以及 Claude Code 的 .claude/commands 都会被读取。
					</EmptyHint>
				) : (
					<div className="p-2">
						{commands.map((command) => (
							<ListRow
								key={`${command.scope}:${command.origin}:${command.name}`}
								title={
									<span className="font-mono">
										<span className="text-ink-faint">/</span>
										{command.name}
										{command.argumentHint && (
											<span className="ml-1.5 text-detail text-ink-faint">{command.argumentHint}</span>
										)}
									</span>
								}
								detail={command.description || command.path}
								actions={<span className="text-detail text-ink-faint">{originOf(command)}</span>}
								onOpen={() => void bridge.commands.open(command.path)}
								openLabel={`编辑 ${command.name}`}
							/>
						))}
					</div>
				)}
			</Card>
		</div>
	);
}

/** Tool inventory. Useful when debugging why the model did or did not have something available. */
function ToolInventory() {
	const activeSessionId = useApp((s) => s.activeSessionId);
	const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(useApp.getState().capabilities);

	useEffect(() => {
		if (!activeSessionId) return;
		void bridge.sessions.capabilities(activeSessionId).then(setCapabilities);
	}, [activeSessionId]);

	const tools = capabilities?.toolNames ?? [];
	const builtin = tools.filter((t) => !t.startsWith("mcp__"));
	const external = tools.filter((t) => t.startsWith("mcp__"));

	return (
		<div>
			<SectionTitle>内置工具（{builtin.length}）</SectionTitle>
			<Card className="mb-6">
				{builtin.length === 0 ? (
					<EmptyHint>打开一个会话后即可查看。</EmptyHint>
				) : (
					<div className="flex flex-wrap gap-2 p-4">
						{builtin.map((tool) => (
							<span key={tool} className="rounded-lg bg-card px-2.5 py-1 font-mono text-detail text-ink">
								{tool}
							</span>
						))}
					</div>
				)}
			</Card>

			<SectionTitle>MCP 工具（{external.length}）</SectionTitle>
			<Card>
				{external.length === 0 ? (
					<EmptyHint>没有已连接的 MCP 工具。</EmptyHint>
				) : (
					<div className="flex flex-wrap gap-2 p-4">
						{external.map((tool) => (
							<span key={tool} className="rounded-lg bg-card px-2.5 py-1 font-mono text-detail text-ink-muted">
								{tool}
							</span>
						))}
					</div>
				)}
			</Card>
		</div>
	);
}
