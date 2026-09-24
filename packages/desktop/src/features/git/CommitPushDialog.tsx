/**
 * 提交与推送，一个居中的弹窗。
 *
 * 从前它是挂在 Git 工具条那颗按钮上的 popover——贴着窗口右上角展开，宽 340，底下压着半个面板。
 * 提交是这个应用里少数几件「按下去就改变了磁盘」的事，它值得占住屏幕中间、把背后的东西压暗，
 * 而不是像一个顺手的菜单那样挂在角上。
 *
 * **留空即自动生成**：输入框自己说这句话，提交时空着就先生成再提交，生成出来的**写回输入框**
 * ——人看得见自己提交的是什么。无声地替人写一句提交说明再提交，是把记录权拿走了。
 *
 * **提交到哪个分支**也在这里选。分支那一行是可以点的：展开是本地分支的清单，末尾一项是「新分支」。
 * 选了新分支不会当场创建——名字先记着，等真的提交那一刻才 `git switch -c`。中途改了主意就什么
 * 都没发生，而不是在仓库里留下一个空分支。
 *
 * **写了什么、哪一步在跑，都不存在这里**：见 `commit-work.ts`。这个组件是那件事此刻的样子，
 * 关掉它只是把样子收起来——事情还在跑，工具条上那颗按钮替它转着圈，按一下就又回到这儿。
 */

import { Check, ChevronDown, CloudUpload, GitBranch, GitCommitHorizontal, Languages, Plus, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useApp } from "../../store/index.ts";
import { bridge } from "../../services/index.ts";
import { useI18n } from "../../i18n/index.ts";
import { MenuBody, MenuItem, MenuLabel, Popover, usePopover } from "../../ui/overlay/Popover.tsx";
import { Overlay } from "../../ui/overlay/Overlay.tsx";
import { OverlayScrollbar } from "../../ui/scroll/OverlayScrollbar.tsx";
import { useFieldFade } from "../../ui/inputs/useFieldFade.ts";
import { ActionSpinner } from "../../ui/motion/loaders.tsx";
import { shortcutLabel } from "../../ui/keyboard.ts";
import { COMMIT_LANGUAGES, commitLanguageLabel, resolveCommitLanguage } from "./commit-language.ts";
import type { CommitWork } from "./commit-work.ts";

export interface CommitPushDialogProps {
	cwd: string;
	branch: string;
	stagedCount: number;
	unstagedCount: number;
	addedCount: number;
	removedCount: number;
	busy: boolean;
	running: boolean;
	/**
	 * 这一次提交的现场：写了什么、提交到哪儿、哪一步正在跑。
	 *
	 * 它归面板持有，不归这个弹窗——关掉弹窗不该让一件正在跑的事从界面上消失。见 `commit-work.ts`。
	 */
	work: CommitWork;
	/** 还没推上去的提交数——没有可推的就真的禁用那一行，而不是画成灰的却照样可点。 */
	unpushed: number;
	/**
	 * 远端从没见过这个分支：推送那一行就是发布。
	 *
	 * 这时没有数可报——`syncPlan` 把「发布过没有」当成是非题，数目是 null，传到 `unpushed` 就成了
	 * 0——可整条分支都还没离开这台机器。只按 `unpushed` 判，工作区干净的新分支点进来三行全灰：
	 * 工具条上那颗按钮写着「发布」，弹窗里却没有一行按得下去。
	 */
	publish: boolean;
	/** `syncPlan` 已经写好的那句话：几个提交没推，或者已经同步。 */
	pushTip: string;
	onClose: () => void;
	onCommit: (message: string) => Promise<boolean>;
	onCommitAndPush: (message: string, includeUnstaged: boolean) => Promise<boolean>;
	onPush: () => Promise<void>;
	/** 分支换了，外面那份 status 要重读。 */
	onBranchChanged?: () => void;
}

export function CommitPushDialog({
	cwd,
	branch,
	stagedCount,
	unstagedCount,
	addedCount,
	removedCount,
	busy,
	running,
	work,
	unpushed,
	publish,
	pushTip,
	onClose,
	onCommit,
	onCommitAndPush,
	onPush,
	onBranchChanged,
}: CommitPushDialogProps) {
	const { t } = useI18n();
	/*
	 * 这四样都在 `work` 里，不在这儿。
	 *
	 * 它们是这次提交本身，而这个组件只是它此刻的样子：关掉弹窗只是把样子收起来，事情还在跑。
	 * 顺手解构出来，下面的写法和从前一模一样。
	 */
	const { message, setMessage, generating, setGenerating, target, setTarget } = work;
	const workingAction = work.action;
	const setWorkingAction = work.setAction;
	const [includeUnstaged, setIncludeUnstaged] = useState(stagedCount === 0 && unstagedCount > 0);
	const [locals, setLocals] = useState<string[]>([]);
	const newBranchField = useRef<HTMLInputElement>(null);
	const messageField = useRef<HTMLTextAreaElement>(null);
	const messageScroller = useRef<HTMLDivElement>(null);
	useFieldFade(messageField, messageScroller);

	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);
	const notify = useApp((s) => s.notify);

	const languageMenu = usePopover();
	const branchMenu = usePopover();
	const language = resolveCommitLanguage(settings?.commitLanguage);

	useEffect(() => {
		if (stagedCount === 0 && unstagedCount > 0) setIncludeUnstaged(true);
	}, [stagedCount, unstagedCount]);

	/* 本地分支，开弹窗时读一次。读不到就只剩「当前分支」和「新分支」两项，仍然可用。 */
	useEffect(() => {
		let live = true;
		void bridge.git.branches(cwd).then((list) => { if (live) setLocals(list.local); }).catch(() => {});
		return () => { live = false; };
	}, [cwd]);

	/* 选了「新分支」就把光标送过去——多按一次 Tab 才能打字，是这一步最容易丢人的地方。 */
	useEffect(() => {
		if (target.kind === "new") newBranchField.current?.focus();
	}, [target.kind]);

	function setLanguage(id: string) {
		if (!settings) return;
		void saveSettings({ ...settings, commitLanguage: id });
		languageMenu.close();
	}

	/**
	 * 人写的那句话，没写就现生成一句。
	 *
	 * 生成出来的写回输入框再返回：弹窗在提交成功后才关，中间这一两秒里输入框是空的——把生成的
	 * 句子填进去，人在提交发生之前看得到它，失败留在原地时也还在。
	 *
	 * 返回 `null` 是「这一次别往下走了」：生成失败已经弹过 toast，再拿一句空的去提交只会是第二个错误。
	 */
	async function withMessage(): Promise<string | null> {
		const trimmed = message.trim();
		if (trimmed) return trimmed;
		setGenerating(true);
		try {
			const result = await bridge.git.generateCommitMessage(cwd);
			if (!result.ok || !result.message) {
				notify(result.error ?? t("commit.generateFailed"), "error");
				return null;
			}
			setMessage(result.message);
			return result.message;
		} finally {
			setGenerating(false);
		}
	}

	/**
	 * 要提交到别处的话，先把分支换过去。
	 *
	 * 新分支到这一刻才创建（`git switch -c` 带着工作区的改动过去），所以中途改主意不会在仓库里
	 * 留下空分支。返回 false 表示换失败了，这一次提交不该继续——否则就提交到了人没选的那个分支上。
	 */
	async function moveToTarget(): Promise<boolean> {
		if (target.kind === "current") return true;
		const name = target.name.trim();
		if (!name) {
			notify(t("commit.branchNameEmpty"), "error");
			return false;
		}
		const result = await bridge.git.createBranch(cwd, name);
		if (!result.ok) {
			notify(result.error ?? t("commit.branchCreateFailed"), "error");
			return false;
		}
		setTarget({ kind: "current" });
		onBranchChanged?.();
		return true;
	}

	async function switchTo(name: string) {
		branchMenu.close();
		if (name === branch) {
			setTarget({ kind: "current" });
			return;
		}
		const result = await bridge.git.switchBranch(cwd, name);
		if (!result.ok) {
			notify(result.error ?? t("commit.branchSwitchFailed"), "error");
			return;
		}
		setTarget({ kind: "current" });
		onBranchChanged?.();
	}

	async function handleCommit() {
		if (!hasChanges) return;
		setWorkingAction("commit");
		try {
			if (!(await moveToTarget())) return;
			await stageIfAsked();
			const finalMessage = await withMessage();
			if (!finalMessage) return;
			if (await onCommit(finalMessage)) {
				setMessage("");
				onClose();
			}
		} finally {
			setWorkingAction(null);
		}
	}

	async function stageIfAsked(): Promise<void> {
		if (!includeUnstaged || unstagedCount === 0) return;
		const status = await bridge.git.status(cwd);
		const paths = status.unstaged.map((file) => file.path);
		if (paths.length > 0) await bridge.git.stage(cwd, paths);
	}

	async function handleCommitAndPush() {
		if (!hasChanges) return;
		setWorkingAction("commitAndPush");
		try {
			if (!(await moveToTarget())) return;
			// 暂存交给 `onCommitAndPush`：推送那一步要它先看一眼暂存区，两件事在同一处才对得上。
			const finalMessage = await withMessage();
			if (!finalMessage) return;
			if (await onCommitAndPush(finalMessage, includeUnstaged)) {
				setMessage("");
				onClose();
			}
		} finally {
			setWorkingAction(null);
		}
	}

	async function handlePush() {
		setWorkingAction("push");
		try {
			await onPush();
			onClose();
		} finally {
			setWorkingAction(null);
		}
	}

	const hasChanges = stagedCount > 0 || (includeUnstaged && unstagedCount > 0);
	const disabled = busy || running || workingAction !== null || generating;

	return (
		<Overlay onClose={onClose} width={460} label={t("commit.commit")}>
			<div data-ly-commit-dialog className="flex flex-col p-4 text-detail">
				{/* 提交到哪儿。这一行是可以点的——展开是本地分支，末尾一项是新建。 */}
				<div className="flex items-center gap-1.5 pb-2.5">
					{target.kind === "new" ? (
						<div className="flex min-w-0 flex-1 items-center gap-1.5">
							<GitBranch size={13} strokeWidth={2} className="shrink-0 text-ink-faint" />
							<input
								ref={newBranchField}
								value={target.name}
								onChange={(e) => setTarget({ kind: "new", name: e.target.value })}
								placeholder={t("commit.newBranchPlaceholder")}
								disabled={disabled}
								data-ly-new-branch
								className="min-w-0 flex-1 border-none bg-transparent p-0 text-label font-semibold text-ink placeholder:font-normal placeholder:text-ink-faint focus:outline-none"
								onKeyDown={(e) => {
									// Esc 收回这一步，回到当前分支——它不该连整个弹窗一起关掉。
									if (e.key === "Escape") {
										e.preventDefault();
										e.stopPropagation();
										setTarget({ kind: "current" });
									}
								}}
							/>
							<button
								type="button"
								aria-label={t("common.cancel")}
								onClick={() => setTarget({ kind: "current" })}
								className="flex size-5 shrink-0 items-center justify-center rounded text-ink-faint transition-colors hover:bg-card-hover hover:text-ink"
							>
								<X size={12} strokeWidth={2} />
							</button>
						</div>
					) : (
						<button
							type="button"
							data-ly-branch-picker
							disabled={disabled}
							onClick={branchMenu.toggle}
							className="-ml-1 flex min-w-0 items-center gap-1.5 rounded-md px-1 py-0.5 text-ink transition-colors hover:bg-card-hover disabled:opacity-40"
						>
							<GitBranch size={13} strokeWidth={2} className="shrink-0 text-ink-faint" />
							<span className="min-w-0 truncate font-semibold text-label">{branch}</span>
							<ChevronDown size={12} strokeWidth={2} className="shrink-0 text-ink-muted" />
						</button>
					)}
				</div>

				{branchMenu.open && (
					<Popover anchor={branchMenu.anchor} onClose={branchMenu.close} placement="bottom" align="start" width="compact" label={t("commit.commitTo")}>
						<MenuBody>
							<MenuLabel>{t("commit.commitTo")}</MenuLabel>
							{(locals.length > 0 ? locals : [branch]).map((name) => (
								<MenuItem
									key={name}
									selected={name === branch}
									trailing={name === branch ? <Check size={13} strokeWidth={2.2} className="shrink-0 text-ink" /> : undefined}
									onClick={() => void switchTo(name)}
								>
									<span className="flex min-w-0 items-center gap-1.5">
										<GitBranch size={12} strokeWidth={1.8} className="shrink-0 text-ink-faint" />
										<span className="truncate">{name}</span>
									</span>
								</MenuItem>
							))}
							<MenuItem
								onClick={() => {
									branchMenu.close();
									setTarget({ kind: "new", name: "" });
								}}
							>
								<span className="flex items-center gap-1.5">
									<Plus size={12} strokeWidth={2} className="shrink-0 text-ink-faint" />
									<span>{t("commit.newBranch")}</span>
								</span>
							</MenuItem>
						</MenuBody>
					</Popover>
				)}

				{/*
				 * 写什么。一个圆角框，和聊天那个输入框同一副样子——但**不带它的阴影**。
				 *
				 * 从前这里是裸的一片字，靠底下一条分隔线把它和三个动作隔开——于是「能打字的地方」
				 * 没有边界，而那条线又凭空在弹窗中间画了一道。现在边界由框自己给：一样的圆角、一样
				 * 的描边、聚焦时一样会加深。那条线也就不必存在了——框的下沿已经说清楚了到哪儿为止。
				 *
				 * 阴影是唯一没抄过来的东西，而且是故意的：主输入框那两层阴影是它和页面之间的距离，
				 * 而这个框长在一个已经浮起来的弹窗里，再加一层就是浮起来的东西上面又浮了一块，整个
				 * 框会从卡片里「鼓」出来。同一套视觉语言在不同的底子上，该换的是深度，不是圆角。
				 *
				 * 内衬用 `--ly-composer-in` / `--ly-composer-x` 这两个变量，不是抄两个数字过来：
				 * 主输入框的呼吸感跟着它们走，哪天调了，这里跟着一起动。
				 */}
				<div
					data-ly-commit-field
					className="rounded-[18px] border border-line-soft transition-colors duration-[var(--ly-t-base)] focus-within:border-ink-faint/60"
				>
					{/*
					 * 三行装不下的时候，它自己会滚——那就得有滑块，也得有两头的渐隐。
					 *
					 * 这两样在这里曾经都没有：原生滚动条是全局关掉的（见 `OverlayScrollbar`），于是
					 * 一篇长提交信息滚起来没有任何东西说它有多长；上下又是硬切的，最后一行半截字就压
					 * 在底下那行语言按钮上方几像素处，读起来像画坏了。跟主输入框走同一套。
					 */}
					<div ref={messageScroller} className="ly-scroll-host relative">
						<textarea
							ref={messageField}
							value={message}
							onChange={(e) => setMessage(e.target.value)}
							placeholder={generating ? t("commit.generating") : t("commit.autoPlaceholder")}
							disabled={disabled}
							rows={3}
							data-ly-commit-message
							className="ly-field-fade block w-full resize-none overflow-y-auto border-none bg-transparent px-[var(--ly-composer-x)] py-[var(--ly-composer-in)] text-label leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-60"
							onKeyDown={(e) => {
								if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
									e.preventDefault();
									void handleCommit();
								}
							}}
						/>
						{/*
						 * 生成中的那一下，由输入框自己交代。
						 *
						 * 按钮上的 spinner 说的是「这个动作在跑」，而此刻真正发生的是「模型在写字」——
						 * 两三秒，放在字会出现的地方才对得上。跟着第一行字走，所以它也站在内衬里面。
						 */}
						{generating && (
							<span className="pointer-events-none absolute top-[calc(var(--ly-composer-in)+3px)] right-[var(--ly-composer-x)]">
								<ActionSpinner size={12} />
							</span>
						)}
						<OverlayScrollbar viewport={messageField} orientation="vertical" />
					</div>

					{/*
					 * 用什么语言生成。它**一直在**，不跟着输入框里有没有字来去。
					 *
					 * 从前它只在「这一次会自动生成」时才画出来：打第一个字的那一刻整行消失，框跟着矮
					 * 一截，人正打着字，脚下的东西动了——而且一个刚刚还在那儿的控件突然不见，看上去
					 * 像是被删掉了。清空输入它又会回来，这个来回本身就是毛病。
					 *
					 * 少画一个按钮省不下什么，跳一下却要人重新找一遍。常驻还让这个框有了固定的高度，
					 * 和主输入框底下那排控件是同一个道理：那排东西也从不因为你开始打字就收起来。
					 *
					 * 它落在框**里面**的底边，位置跟主输入框那排控件一样（`.ly-composer-bar` 出的内衬）：
					 * 这句话讲的是这个框里的字怎么来，挂在框外面就成了一句无主的小字。
					 */}
					<div className="ly-composer-bar flex justify-end">
						<button
							type="button"
							data-ly-commit-language
							data-ly-tip={t("commit.languageIs", { language: commitLanguageLabel(language) })}
							aria-label={t("commit.languageIs", { language: commitLanguageLabel(language) })}
							disabled={disabled}
							onClick={languageMenu.toggle}
							className="-mr-1 flex items-center gap-1 rounded-md px-1.5 py-0.5 text-caption text-ink-faint transition-colors hover:bg-card-hover hover:text-ink disabled:opacity-40"
						>
							<Languages size={11} strokeWidth={1.8} />
							<span>{commitLanguageLabel(language)}</span>
							<ChevronDown size={9} strokeWidth={2} />
						</button>
					</div>
				</div>

				{languageMenu.open && (
					<Popover anchor={languageMenu.anchor} onClose={languageMenu.close} placement="bottom" align="end" width="compact" label={t("commit.language")}>
						<MenuBody>
							{COMMIT_LANGUAGES.map((entry) => (
								<MenuItem
									key={entry.id}
									selected={entry.id === language}
									trailing={entry.id === language ? <Check size={13} strokeWidth={2.2} className="shrink-0 text-ink" /> : undefined}
									onClick={() => setLanguage(entry.id)}
								>
									{entry.native}
								</MenuItem>
							))}
						</MenuBody>
					</Popover>
				)}

				{/* 带上谁。只有真有未暂存的改动时才问这一句。 */}
				{unstagedCount > 0 && (
					<label className="mt-1.5 flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-1 py-1.5 transition-colors select-none hover:bg-card-hover">
						<span className="flex min-w-0 items-center gap-2">
							{/*
							 * 自己画的方框，不是原生 checkbox——后者在两个平台上长得不一样，而这一枚挨着的
							 * 是我们自己的字号和圆角。真正的 input 留在 `sr-only` 里，键盘和读屏走的仍是它。
							 */}
							<span
								aria-hidden
								className={`flex size-[15px] shrink-0 items-center justify-center rounded-[4px] border transition-colors ${
									includeUnstaged ? "border-accent bg-accent text-white" : "border-line bg-card text-transparent"
								}`}
							>
								<Check size={11} strokeWidth={3} />
							</span>
							<input
								type="checkbox"
								checked={includeUnstaged}
								onChange={(e) => setIncludeUnstaged(e.target.checked)}
								disabled={disabled}
								className="sr-only"
							/>
							<span className="truncate text-label text-ink">{t("commit.includeUnstaged")}</span>
						</span>
						<span className="shrink-0 font-mono text-caption tabular-nums">
							{addedCount > 0 && <span className="text-ok">+{addedCount}</span>}
							{addedCount > 0 && removedCount > 0 && " "}
							{removedCount > 0 && <span className="text-danger">−{removedCount}</span>}
						</span>
					</label>
				)}

				{/* 做哪一个。上面那个框已经画出了自己的下沿，再补一条分隔线就是同一件事说了两遍。 */}
				<div className="mt-2.5 space-y-0.5">
					<ActionRow
						icon={<GitCommitHorizontal size={15} strokeWidth={1.9} />}
						label={t("commit.commit")}
						trailing={<kbd className="rounded border border-line-soft px-1 py-px font-mono text-[10px] text-ink-faint">{shortcutLabel("⌘↩")}</kbd>}
						working={workingAction === "commit"}
						disabled={disabled || !hasChanges}
						onClick={() => void handleCommit()}
					/>
					<ActionRow
						icon={<CloudUpload size={15} strokeWidth={1.9} />}
						label={t("commit.commitAndPush")}
						working={workingAction === "commitAndPush"}
						disabled={disabled || !hasChanges}
						onClick={() => void handleCommitAndPush()}
					/>
					<ActionRow
						icon={<Upload size={15} strokeWidth={1.9} />}
						label={publish ? t("sync.publishBranch") : t("common.push")}
						tip={pushTip}
						/* 几个提交在等着推——这个数目本身就是按下去的理由。 */
						trailing={unpushed > 0 ? <span className="font-mono text-caption tabular-nums text-ink-faint">{unpushed}</span> : undefined}
						working={workingAction === "push"}
						disabled={disabled || (unpushed === 0 && !publish)}
						onClick={() => void handlePush()}
					/>
				</div>
			</div>
		</Overlay>
	);
}

/**
 * 弹窗底部那三行，一个样子。
 *
 * 抽出来是因为三行之间只差图标、文案和末尾那一点东西，而它们各写一遍的结果是高度、圆角和
 * spinner 尺寸三处都对不齐——同一组按钮，看得出是三次写出来的。
 */
function ActionRow({
	icon,
	label,
	tip,
	trailing,
	working,
	disabled,
	onClick,
}: {
	icon: React.ReactNode;
	label: string;
	tip?: string;
	trailing?: React.ReactNode;
	working: boolean;
	disabled: boolean;
	onClick: () => void;
}) {
	return (
		<button
			type="button"
			disabled={disabled}
			onClick={onClick}
			{...(tip ? { "data-ly-tip": tip } : {})}
			className="flex h-9 w-full items-center justify-between gap-2 rounded-lg px-2 text-left text-label text-ink transition-colors hover:bg-card-hover disabled:pointer-events-none disabled:opacity-40"
		>
			<span className="flex min-w-0 items-center gap-2.5">
				{/*
				 * 转圈的那一枚占的是图标的位置，尺寸也一样。
				 *
				 * 换成别的尺寸，按下去的一瞬间整行的字会横着挪一下——一次成功的提交不该以抖动开场。
				 */}
				<span className="flex size-[15px] shrink-0 items-center justify-center text-ink-faint">
					{working ? <ActionSpinner size={14} /> : icon}
				</span>
				<span className="truncate">{label}</span>
			</span>
			{trailing}
		</button>
	);
}
