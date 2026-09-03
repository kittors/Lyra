/**
 * The panels that ship with the app.
 *
 * Registered like any other set, so there is nothing special about them beyond loading first —
 * which is exactly the property that lets a plugin replace one.
 */

import { Bot, FileText, Folder, GitCompare, Globe, History, ListTodo, MessageCirclePlus, SquareTerminal } from "lucide-react";

import { BrowserPanel } from "../../browser/BrowserPanel.tsx";
import { FileBrowser } from "../../files/FileBrowser.tsx";
import { FilePanel } from "../../files/FilePanel.tsx";
import { SubAgentPanel } from "../../subagents/SubAgentPanel.tsx";
import { FileActions } from "../../files/FileActions.tsx";
import { FileTitle } from "../../files/FileTitle.tsx";
import { GitPanel } from "../../git/GitPanel.tsx";
import { SideChat } from "../../sidechat/SideChat.tsx";
import { TaskPanel } from "../../task/TaskPanel.tsx";
import { TerminalPane } from "../../terminal/TerminalPane.tsx";
import { TerminalTabs } from "../../terminal/TerminalTabs.tsx";
import { TrajectoryPanel } from "../../conversation/trajectory/TrajectoryPanel.tsx";
import { registerPanels, type PanelDefinition } from "./registry.ts";

/**
 * The tree's portion when it opens beside the file.
 *
 * Enough for a filename at a couple of levels of indent, and no more: what anyone is reading is on
 * the other side of the boundary. Matches the proportion full screen gives the pair.
 */
const TREE_SHARE = 0.3;

const needsWorkspace = (state: { workspace: boolean }) => (state.workspace ? undefined : "先打开一个项目");
const needsSession = (state: { session: boolean }) => (state.session ? undefined : "先开始一个对话");

const BUILTIN_PANELS: PanelDefinition[] = [
	{
		kind: "files",
		label: "文件",
		icon: Folder,
		shortcut: "⌘P",
		unavailable: needsWorkspace,
		/*
		 * To the left of the file, and narrower than it.
		 *
		 * This is the direction that only happens when the file pane is already there and the tree
		 * is being asked for — from the dropdown's 「在面板中打开」, usually with the file filling the
		 * window. There is width to give in that situation, and names belong on the left of what
		 * they name. `share` is the tree's own portion: enough for a filename, no more.
		 *
		 * The other direction — opening the file when the tree is already here — stacks instead, so
		 * the tree keeps the column width it has. See the `file` panel below.
		 */
		companion: { kind: "file", side: "left", share: TREE_SHARE },
		render: FileBrowser,
	},
	/*
	 * The open file, beside the tree rather than inside it.
	 *
	 * Opened by clicking a file rather than from the menu, most of the time — but it is listed
	 * there like any other pane, because once you have closed it the menu is how you say you want
	 * it back without having to find a file to click.
	 *
	 * Paired with the tree in both directions: between them they are a file browser, and either
	 * one alone is half a tool.
	 */
	{
		kind: "file",
		label: "文件内容",
		icon: FileText,
		shortcut: "⌥⌘P",
		unavailable: needsWorkspace,
		/*
		 * Under the tree, not beside it.
		 *
		 * Clicking a file is the common way this pane opens, and the tree is already occupying a
		 * column — putting the file next to it splits that column again, and a dock column halved
		 * gives a tree too narrow for a filename and a file too narrow for a line of code. Height is
		 * what a column has to spare, so height is what the file takes.
		 *
		 * Note this is deliberately not the mirror of the tree's own companion. The two describe
		 * different situations rather than one arrangement: this one is "the tree is here and needs
		 * to keep its width", and the tree's is "the file is already filling the space, make room at
		 * the side for names".
		 */
		companion: { kind: "files", side: "bottom" },
		render: FilePanel,
		/*
		 * The file's name in place of the pane's, with the tree behind it.
		 *
		 * 「文件内容」 names a category nobody was in doubt about, on the one row that could have said
		 * which file — and this pane is very often the one left open after its companion tree has been
		 * closed, at which point it had neither a name nor a way to reach another file. See `FileTitle`.
		 */
		header: FileTitle,
		actions: FileActions,
	},
	/*
	 * Delegated work, in a pane of its own.
	 *
	 * Beside 「侧边聊天」 because it is the same shape — a conversation that is not the main one —
	 * and deliberately not inside it: the side chat is yours to ask questions in, a sub-agent is
	 * the main agent's own worker. Merging them would put two different relationships in one pane.
	 */
	{
		kind: "subagents",
		label: "子 Agent",
		icon: Bot,
		shortcut: "⌥⌘A",
		unavailable: needsSession,
		render: SubAgentPanel,
	},
	{
		kind: "chat",
		label: "侧边聊天",
		icon: MessageCirclePlus,
		shortcut: "⌥⌘S",
		unavailable: needsSession,
		render: SideChat,
	},
	{
		kind: "terminal",
		label: "终端",
		icon: SquareTerminal,
		shortcut: "⌃`",
		/*
		 * No availability rule: a shell needs a directory and there is always one.
		 *
		 * With a project open it starts there; without, the registry falls back to the home
		 * directory — the same thing every other terminal on the machine does.
		 */
		render: TerminalPane,
		header: TerminalTabs,
	},
	{ kind: "tasks", label: "任务", icon: ListTodo, shortcut: "⌘J", render: TaskPanel },
	{
		kind: "trajectory",
		label: "轨迹",
		icon: History,
		shortcut: "⌘L",
		unavailable: needsSession,
		render: TrajectoryPanel,
	},
	{ kind: "browser", label: "浏览器", icon: Globe, shortcut: "⌘T", render: BrowserPanel },
	{ kind: "review", label: "Git", icon: GitCompare, shortcut: "⌘⇧R", unavailable: needsWorkspace, render: GitPanel },
];

registerPanels(BUILTIN_PANELS);
