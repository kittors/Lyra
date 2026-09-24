/**
 * The panels that ship with the app.
 *
 * Registered like any other set, so there is nothing special about them beyond loading first —
 * which is exactly the property that lets a plugin replace one.
 */

import { Bot, FileDiff, FileText, Folder, GitCompare, Globe, History, ListTodo, MessageCirclePlus, SquareTerminal, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { BrowserPanel } from "../../browser/index.ts";
import { FileBrowser } from "../../files/index.ts";
import { FilePanel } from "../../files/index.ts";
import { SubAgentPanel } from "../../subagents/index.ts";
import { FileActions } from "../../files/index.ts";
import { FileTitle } from "../../files/index.ts";
import { DiffView, GitPanel } from "../../git/index.ts";
import { SideChat, SideChatActions } from "../../sidechat/index.ts";
import { TaskPanel } from "../../task/index.ts";
import { TerminalPane } from "../../terminal/index.ts";
import { TerminalTabs } from "../../terminal/index.ts";
import { TrajectoryPanel, useDeliveryReview } from "../../conversation/index.ts";
import type { DeliveryFile, TurnDelivery } from "../../../../electron/turn-delivery.ts";
import { useI18n } from "../../../i18n/index.ts";
import { relativeTo } from "../../../lib/paths.ts";
import { bridge } from "../../../services/index.ts";
import { useApp } from "../../../store/index.ts";
import { useConfirmer } from "../../../ui/overlay/Confirm.tsx";
import { PanelEmpty } from "../../../ui/layout/PanelEmpty.tsx";
import { IconButton } from "../../../ui/primitives/IconButton.tsx";
import { Scroller } from "../../../ui/scroll/Scroller.tsx";
import { usePaneDock } from "../pane-store.ts";
import { useDockScope, useScopedSessionId } from "../../../app/session-scope.tsx";
import { registerPanels, type PanelDefinition } from "./registry.ts";

/**
 * The tree's portion when it opens beside the file.
 *
 * Enough for a filename at a couple of levels of indent, and no more: what anyone is reading is on
 * the other side of the boundary. Matches the proportion full screen gives the pair.
 */
const TREE_SHARE = 0.3;

const needsWorkspace = (state: { workspace: boolean }) => (state.workspace ? undefined : "dock.needProject");
const needsSession = (state: { session: boolean }) => (state.session ? undefined : "dock.needSession");

function deliveryCounts(added: number, removed: number) {
	return <span className="flex shrink-0 items-center gap-1.5 tabular-nums"><span className="text-ok">+{added}</span><span className="text-danger">−{removed}</span></span>;
}

function deliveryName(path: string) {
	const split = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1;
	return <span className="min-w-0 flex-1 truncate"><span className="text-ink-muted">{path.slice(0, split)}</span><span className="text-ink">{path.slice(split)}</span></span>;
}

/**
 * This turn's recorded diffs, in a dock pane.
 *
 * Lives next to the other built-in renders so conversation/index does not
 * have to export a panel that pulls git and dock back into itself.
 */
function DeliveryTitle() {
	const { t } = useI18n();
	const path = useDeliveryReview((state) => state.target?.path ?? null);
	const name = path ? path.split(/[\\/]/).pop() : null;
	return (
		<span className="flex min-w-0 items-center gap-1 py-0.5 pl-1 text-detail">
			<FileDiff size={12.5} strokeWidth={1.8} className="shrink-0 text-ink-faint" />
			<span className="min-w-0 truncate text-ink">{name ?? t("delivery.fileChanges")}</span>
		</span>
	);
}

function DeliveryPanel() {
	const { t } = useI18n();
	const workspace = useApp((state) => state.workspace?.path);
	// The conversation whose screen this panel is in — not whichever one has the focus.
	const owner = useScopedSessionId();
	const scope = useDockScope();
	const target = useDeliveryReview((state) => state.target);
	const cached = useDeliveryReview((state) => state.data);
	const revision = useDeliveryReview((state) => state.revision);
	const [data, setData] = useState<TurnDelivery | null>(cached);
	const [undoing, setUndoing] = useState(false);
	const undoLock = useRef(false);
	const confirm = useConfirmer();

	/*
	 * One review at a time, and it belongs to one conversation. When the review on show is another
	 * conversation's, this screen's panel steps aside — it used to close whenever the focus moved to
	 * another screen, taking the review with it though nothing about the review had changed.
	 */
	useEffect(() => {
		if (target && target.sessionId !== owner && scope) usePaneDock.getState().close(scope, "delivery");
	}, [owner, scope, target]);

	useEffect(() => {
		if (!target) {
			setData(null);
			return;
		}
		const fromStore = useDeliveryReview.getState().data;
		if (fromStore) setData(fromStore);
		let live = true;
		void bridge.delivery.get(target.sessionId, target.timestamp).then((value) => {
			if (live) {
				setData(value);
				useDeliveryReview.getState().setData(value);
			}
		}).catch((error: unknown) => {
			if (live) useApp.getState().notify(String(error), "error");
		});
		return () => { live = false; };
	}, [target, revision]);

	const undo = async (path?: string) => {
		if (!target || undoLock.current) return;
		undoLock.current = true;
		setUndoing(true);
		try {
			await bridge.delivery.undo(target.sessionId, target.timestamp, path);
			const value = await bridge.delivery.get(target.sessionId, target.timestamp);
			setData(value);
			useDeliveryReview.getState().setData(value);
			useApp.getState().notify(t("delivery.reverted"), "info");
			if (!value.files.length) {
				useDeliveryReview.getState().close();
				if (scope) usePaneDock.getState().close(scope, "delivery");
			} else useDeliveryReview.getState().touch();
		} catch (error) {
			useApp.getState().notify(String(error), "error");
		} finally {
			undoLock.current = false;
			setUndoing(false);
		}
	};

	if (!target) return <PanelEmpty icon={FileDiff} title={t("delivery.fileChanges")} />;
	const files = (data?.files ?? []).filter((file) => !target.path || file.path === target.path);
	if (!files.length) return <PanelEmpty icon={FileDiff} title={t("delivery.fileChanges")} />;
	const relative = (path: string) => workspace ? relativeTo(workspace, path) : path;
	const askUndo = (file: DeliveryFile) => {
		confirm.ask({
			title: t("delivery.revertFileConfirm"),
			detail: t("delivery.revertDetail"),
			confirmLabel: t("delivery.revertChanges"),
			onConfirm: () => undo(file.path),
		});
	};

	return <>
		<Scroller>
			{files.map((file) => (
				<section key={file.path} data-delivery-diff={file.path} className="mb-1">
					<div className="ly-pin sticky top-0 z-10">
						<div className="flex min-w-0 items-center gap-3 px-3 py-2 text-label">
							{deliveryName(relative(file.path))}
							{deliveryCounts(file.added, file.removed)}
							<IconButton
								size="sm"
								icon={<Undo2 size={14} />}
								label={file.canUndo ? t("delivery.revertOne") : t("delivery.cannotRevert")}
								explainDisabled
								disabled={!file.canUndo || undoing}
								onClick={() => askUndo(file)}
							/>
						</div>
					</div>
					<DiffView path={file.path} hunks={file.hunks} maxLines={Infinity} />
				</section>
			))}
		</Scroller>
		{confirm.element}
	</>;
}

const BUILTIN_PANELS: PanelDefinition[] = [
	{
		kind: "files",
		label: "common.files",
		icon: Folder,
		shortcut: "⌘P",
		mobile: true,
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
		label: "dock.fileContents",
		icon: FileText,
		shortcut: "⌥⌘P",
		mobile: true,
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
		// The draft and the open tabs move with it — `file-panel-handoff.ts` is that code.
		detach: "handoff",
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
		label: "subAgent.title",
		icon: Bot,
		shortcut: "⌥⌘A",
		mobile: true,
		unavailable: needsSession,
		render: SubAgentPanel,
	},
	{
		kind: "chat",
		label: "dock.sideChat",
		icon: MessageCirclePlus,
		shortcut: "⌥⌘S",
		mobile: true,
		unavailable: needsSession,
		render: SideChat,
		actions: SideChatActions,
	},
	{
		kind: "terminal",
		label: "common.terminal",
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
	{ kind: "tasks", label: "common.tasks", icon: ListTodo, shortcut: "⌘J", mobile: true, render: TaskPanel },
	{
		kind: "trajectory",
		label: "trajectory.title",
		icon: History,
		shortcut: "⌘L",
		mobile: true,
		unavailable: needsSession,
		render: TrajectoryPanel,
	},
	/*
	 * No window of its own: a `<webview>` cannot be moved between documents.
	 *
	 * The tab list is in the main process, so the *rows* would survive — but the page would be
	 * loaded again from its URL in the new window, which throws away scroll position, anything
	 * typed into a form, and whatever the page itself was holding. A button that silently reloads
	 * your page is worse than no button.
	 */
	{ kind: "browser", label: "browser.title", icon: Globe, shortcut: "⌘T", detach: "none", render: BrowserPanel },
	{ kind: "review", label: "common.git", icon: GitCompare, shortcut: "⌘⇧R", unavailable: needsWorkspace, render: GitPanel },
	/*
	 * This turn's recorded diffs — opened from the delivery card, not the +
	 * menu. Git stays `review`; the file pane stays current contents.
	 */
	{
		kind: "delivery",
		label: "delivery.fileChanges",
		icon: FileDiff,
		shortcut: "",
		listed: false,
		ephemeral: true,
		unavailable: needsSession,
		render: DeliveryPanel,
		header: DeliveryTitle,
	},
];

registerPanels(BUILTIN_PANELS);
