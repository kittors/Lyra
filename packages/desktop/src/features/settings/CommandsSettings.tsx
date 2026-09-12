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

import type { BuiltinCommand } from "@lyra/core/commands-builtin";
import type { SlashCommand } from "@lyra/core/commands-view";
import { FolderOpen, Plus, SquareTerminal, TriangleAlert, Wrench } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AgentCapabilities } from "../../../electron/ipc-types.ts";
import { useApp } from "../../store/index.ts";
import { EmptyHint, PrimaryButton } from "./controls.tsx";
import { TextInput } from "./inputs.tsx";
import { Card, ListRow, SectionTitle } from "./layout.tsx";
import { bridge } from "../../services/index.ts";
import { IconButton } from "../../ui/primitives/IconButton.tsx";
import { RowDeleteButton } from "../../ui/primitives/RowDeleteButton.tsx";
import { useDefinitionRemoval } from "./useDefinitionRemoval.tsx";
import { translate, useI18n } from "../../i18n/index.ts";

type Tab = "commands" | "tools";

export function CommandsSettings() {
	const { t } = useI18n();
	const [tab, setTab] = useState<Tab>("commands");

	return (
		<div className="pt-8">
			<h1 className="text-display leading-tight font-semibold tracking-tight text-ink">{t("commands.title")}</h1>
			<p className="mt-2 text-label text-ink-muted">{t("commands.intro")}</p>

			<div className="mt-6 mb-6 flex items-center gap-1 border-b border-line-soft">
				{(
					[
						{ id: "commands", label: t("commands.slash"), icon: SquareTerminal },
						{ id: "tools", label: t("common.tools"), icon: Wrench },
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
	if (command.origin === "claude") return command.scope === "workspace" ? translate("commands.claudeProject") : translate("commands.claudePersonal");
	if (command.origin === "agents") return command.scope === "workspace" ? translate("commands.agentsProject") : translate("commands.agentsPersonal");
	return command.scope === "workspace" ? translate("common.project") : translate("common.personal");
}

function SlashCommands() {
	const { t } = useI18n();
	const workspace = useApp((s) => s.workspace);
	const cwd = workspace?.path ?? "";
	const [list, setList] = useState<{ commands: SlashCommand[]; builtins: BuiltinCommand[]; diagnostics: { path: string; message: string }[] } | null>(
		null,
	);
	const [name, setName] = useState("");
	const [scope, setScope] = useState<"workspace" | "user">("user");
	const [error, setError] = useState<string | null>(null);

	const refresh = useCallback(() => {
		void bridge.commands.list(cwd).then(setList);
	}, [cwd]);
	const removal = useDefinitionRemoval("command", cwd, refresh);

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
	const builtins = list?.builtins ?? [];
	const diagnostics = list?.diagnostics ?? [];

	return (
		<div>
			<SectionTitle>{t("commands.new")}</SectionTitle>
			<Card className="mb-6">
				<div className="flex flex-col gap-3 p-4">
					<div className="flex items-center gap-2">
						<div className="min-w-0 flex-1">
							<TextInput
								value={name}
								onChange={setName}
								placeholder={t("commands.namePlaceholder")}
								onKeyDown={(event) => {
									if (event.key === "Enter" && name.trim()) void create();
								}}
							/>
						</div>
						<div className="flex h-[38px] shrink-0 items-center gap-1 rounded-[10px] bg-card p-1">
							{(
								[
									{ id: "user", label: t("common.personal") },
									{ id: "workspace", label: t("common.project") },
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
							<span>{t("commands.createAndEdit")}</span>
						</PrimaryButton>
					</div>
					<p className="text-detail text-ink-faint">
						{scope === "workspace"
							? t("commands.projectScope")
							: t("commands.personalScope")}
						{` ${t("commands.whatIsIt")}`}
					</p>
					{error && <p className="text-detail text-accent">{error}</p>}
				</div>
			</Card>

			{diagnostics.length > 0 && (
				<Card className="mb-6 border-accent/35 bg-accent/6">
					<div className="px-4 py-3">
						<div className="mb-2 flex items-center gap-1.5 text-label text-accent">
							<TriangleAlert size={13} strokeWidth={1.9} />
							{t("commandsSettings.failedToLoad", { n: diagnostics.length })}
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
				<SectionTitle>{t("commandsSettings.available", { n: commands.length })}</SectionTitle>
				<div className="flex items-center gap-1">
					<IconButton label={t("commands.openPersonalDir")} icon={<FolderOpen size={14} />} onClick={() => void bridge.commands.reveal("user", cwd)} />
					{cwd && (
						<IconButton label={t("commands.openProjectDir")} icon={<FolderOpen size={14} />} onClick={() => void bridge.commands.reveal("workspace", cwd)} />
					)}
				</div>
			</div>
			{/*
			 * 内建的在最前面，而且不可编辑。
			 *
			 * 这一页回答的是「有哪些命令可以用」，而它此前漏掉了用得最多的三条——那三条写在
			 * `/` 菜单那个组件里，只有那一个界面知道。一个漏掉三分之一答案的列表，比没有列表
			 * 更误导人。
			 *
			 * 单列一段而不是混进下面：它们没有文件可以打开，而下面每一行点开都是编辑器。
			 */}
			{builtins.length > 0 && (
				<Card className="mb-6">
					<div className="px-4 pt-3 pb-1 text-label text-ink-muted">{t("commands.builtin")}</div>
					<div className="p-2 pt-0">
						{builtins.map((command) => (
							<ListRow
								key={command.name}
								title={
									<span className="font-mono">
										<span className="text-ink-faint">/</span>
										{command.name}
									</span>
								}
								detail={command.description}
								actions={<span className="text-detail text-ink-faint">{t("common.builtin")}</span>}
							/>
						))}
					</div>
				</Card>
			)}

			<Card>
				{commands.length === 0 ? (
					<EmptyHint>{t("commands.empty")}</EmptyHint>
				) : (
					<div className="p-2">
						{commands.map((command) => (
							<ListRow
								key={command.path}
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
								actions={<>
									<span className="text-detail whitespace-nowrap text-ink-faint">{originOf(command)}</span>
									<RowDeleteButton label={t("commands.deleteNamed", { name: command.name })} pending={removal.pending.has(command.path)} onClick={() => removal.ask(command.name, command.path)} />
								</>}
								onOpen={() => void bridge.commands.open(command.path)}
								openLabel={t("commands.editNamed", { name: command.name })}
							/>
						))}
					</div>
				)}
			</Card>
			{removal.element}
		</div>
	);
}

/** Tool inventory. Useful when debugging why the model did or did not have something available. */
function ToolInventory() {
	const { t } = useI18n();
	const activeSessionId = useApp((s) => s.activeSessionId);
	// 同 `useFileTree.ts`：`useApp.getState()` 是 zustand store 的静态读法，不是在调 hook。
	// oxlint-disable-next-line react/hooks
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
			<SectionTitle>{t("commandsSettings.builtinTools", { n: builtin.length })}</SectionTitle>
			<Card className="mb-6">
				{builtin.length === 0 ? (
					<EmptyHint>{t("commands.openSessionFirst")}</EmptyHint>
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

			<SectionTitle>{t("commandsSettings.mcpTools", { n: external.length })}</SectionTitle>
			<Card>
				{external.length === 0 ? (
					<EmptyHint>{t("commands.noMcp")}</EmptyHint>
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
