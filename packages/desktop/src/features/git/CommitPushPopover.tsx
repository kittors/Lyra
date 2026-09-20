/**
 * 从 Git 工具条上提交和推送的那个浮层。
 *
 * 它替掉了常驻在面板底部的那个输入区。一个浮层能装下的东西有限，所以这里只放三件事：
 * 写什么、带上谁、做哪一个。
 *
 * **留空即自动生成**，这是这一版的中心。从前生成是一颗独立的魔杖按钮：人得先点它、等一下、
 * 看一眼、再点提交——四步做一件事，而且那颗按钮长在输入框右上角，和「写字」抢同一块地方。
 * 现在输入框自己说「留空将自动生成」，提交时如果还是空的就先生成再提交，生成出来的那句话
 * **写回输入框**——人看得见自己提交的是什么，这一点不能省：无声地替人写一句提交说明再提交，
 * 是把记录权拿走了。
 *
 * 生成这件事从前在两处各写了一遍（这里一份、`GitPanel` 的 `onCommitAndPush` 一份），于是
 * 「提交」能看见「正在生成」而「提交并推送」看不见——同一个等待，一个有反馈一个没有。现在
 * 只有 `withMessage` 一处，两个入口都走它。
 */

import { Check, ChevronDown, CloudUpload, GitBranch, GitCommitHorizontal, Languages, Upload } from "lucide-react";
import { useEffect, useState } from "react";
import { useApp } from "../../store/index.ts";
import { bridge } from "../../services/index.ts";
import { useI18n } from "../../i18n/index.ts";
import { MenuBody, MenuItem, Popover, usePopover, type Anchor } from "../../ui/overlay/Popover.tsx";
import { ActionSpinner } from "../../ui/motion/loaders.tsx";
import { COMMIT_LANGUAGES, commitLanguageLabel, resolveCommitLanguage } from "./commit-language.ts";

export interface CommitPushPopoverProps {
	cwd: string;
	branch: string;
	stagedCount: number;
	unstagedCount: number;
	addedCount: number;
	removedCount: number;
	busy: boolean;
	running: boolean;
	/**
	 * 还没推上去的提交数，以及要不要拦住「推送」。
	 *
	 * 从前这一行永远可点、而且永远画成灰的——两句话互相矛盾，人点下去才知道是哪一句当真。
	 * 数目来自 `syncPlan`，和工具条上那颗按钮读的是同一份。
	 */
	unpushed: number;
	/** `syncPlan` 已经写好的那句话：几个提交没推，或者已经同步。 */
	pushTip: string;
	anchor: Anchor;
	onClose: () => void;
	onCommit: (message: string) => Promise<boolean>;
	onCommitAndPush: (message: string, includeUnstaged: boolean) => Promise<boolean>;
	onPush: () => Promise<void>;
}

export function CommitPushPopover({
	cwd,
	branch,
	stagedCount,
	unstagedCount,
	addedCount,
	removedCount,
	busy,
	running,
	unpushed,
	pushTip,
	anchor,
	onClose,
	onCommit,
	onCommitAndPush,
	onPush,
}: CommitPushPopoverProps) {
	const { t } = useI18n();
	const [message, setMessage] = useState("");
	const [generating, setGenerating] = useState(false);
	const [includeUnstaged, setIncludeUnstaged] = useState(stagedCount === 0 && unstagedCount > 0);
	const [workingAction, setWorkingAction] = useState<"commit" | "commitAndPush" | "push" | null>(null);

	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);
	const notify = useApp((s) => s.notify);

	const languageMenu = usePopover();
	const language = resolveCommitLanguage(settings?.commitLanguage);

	useEffect(() => {
		if (stagedCount === 0 && unstagedCount > 0) {
			setIncludeUnstaged(true);
		}
	}, [stagedCount, unstagedCount]);

	function setLanguage(id: string) {
		if (!settings) return;
		void saveSettings({ ...settings, commitLanguage: id });
		languageMenu.close();
	}

	/**
	 * 人写的那句话，没写就现生成一句。
	 *
	 * 生成出来的写回输入框再返回：这一步不是多余的。浮层在提交成功后才关，中间这一两秒里
	 * 输入框是空的——把生成的句子填进去，人在提交发生之前看得到它，失败留在原地时也还在。
	 *
	 * 返回 `null` 表示「这一次不要往下走了」：生成失败已经弹过 toast，再拿一句空的去提交只会
	 * 变成第二个错误。
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

	/** 把未暂存的也带上——`includeUnstaged` 说要带的时候。 */
	async function stageIfAsked(): Promise<void> {
		if (!includeUnstaged || unstagedCount === 0) return;
		const status = await bridge.git.status(cwd);
		const paths = status.unstaged.map((file) => file.path);
		if (paths.length > 0) await bridge.git.stage(cwd, paths);
	}

	async function handleCommit() {
		if (!hasChanges) return;
		setWorkingAction("commit");
		try {
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

	async function handleCommitAndPush() {
		if (!hasChanges) return;
		setWorkingAction("commitAndPush");
		try {
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
	/** 生成中时输入框自己在说话，不该再被当成「人留了空」。 */
	const willGenerate = !message.trim() && !generating;

	return (
		<Popover anchor={anchor} onClose={onClose} placement="bottom" align="end" width={340} label={t("commit.commit")}>
			<div className="flex flex-col p-3.5 text-detail">
				{/*
				 * 分支是这里的上下文，不是一个可以点的东西。
				 *
				 * 它一度带着一枚下拉箭头——而箭头后面什么都没有。在一个「提交到哪里」的浮层里，
				 * 一枚点了不动的箭头比没有箭头更糟：它看起来正好像是那个能改掉目的地的控件。
				 * 换分支在分支页，那里才有它需要的上下文（未提交的改动怎么办、要不要新建）。
				 */}
				<div className="flex items-center gap-1.5 pb-2.5 text-ink">
					<GitBranch size={13} strokeWidth={2} className="shrink-0 text-ink-faint" />
					<span className="min-w-0 truncate font-semibold text-label">{branch}</span>
				</div>

				{/* 写什么。无边框——这一块本来就是浮层里唯一一处要打字的地方，再画个框是重复说明。 */}
				<div className="relative">
					<textarea
						value={message}
						onChange={(e) => setMessage(e.target.value)}
						placeholder={generating ? t("commit.generating") : t("commit.autoPlaceholder")}
						disabled={disabled}
						rows={3}
						data-ly-commit-message
						className="w-full resize-none border-none bg-transparent p-0 text-label leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none disabled:opacity-60"
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
					 * 按钮上的 spinner 说的是「这个动作在跑」，而此刻真正在发生的是「模型在写字」——
					 * 两三秒，放在字会出现的地方才对得上。placeholder 已经换成了「正在生成…」，
					 * 这枚转圈只是让它不像一句静止的提示。
					 */}
					{generating && (
						<span className="pointer-events-none absolute top-0.5 right-0">
							<ActionSpinner size={12} />
						</span>
					)}
				</div>

				{/*
				 * 用什么语言生成——只在真的会生成时才出现。
				 *
				 * 它从前和输入框抢右上角，不管人是不是打算让它生成。现在它只跟着「留空」这个状态走：
				 * 输入框一有字，自动生成就不会发生，这一行也就没有意义了。
				 */}
				{willGenerate && (
					<div className="flex justify-end pt-1">
						<button
							type="button"
							data-ly-tip={t("commit.languageIs", { language: commitLanguageLabel(language) })}
							aria-label={t("commit.languageIs", { language: commitLanguageLabel(language) })}
							disabled={disabled}
							onClick={languageMenu.toggle}
							className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-caption text-ink-faint transition-colors hover:bg-card-hover hover:text-ink disabled:opacity-40"
						>
							<Languages size={11} strokeWidth={1.8} />
							<span>{commitLanguageLabel(language)}</span>
							<ChevronDown size={9} strokeWidth={2} />
						</button>
					</div>
				)}

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
							 * 自己画的方框，不是原生 checkbox——后者在两个平台上长得不一样，而这一枚
							 * 挨着的是我们自己的字号和圆角。真正的 input 留在 `sr-only` 里，键盘和
							 * 读屏走的仍然是它。
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

				{/* 做哪一个。 */}
				<div className="mt-2 space-y-0.5 border-t border-line-soft pt-2">
					<ActionRow
						icon={<GitCommitHorizontal size={15} strokeWidth={1.9} />}
						label={t("commit.commit")}
						trailing={<kbd className="rounded border border-line-soft px-1 py-px font-mono text-[10px] text-ink-faint">⌘↩</kbd>}
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
						label={t("common.push")}
						tip={pushTip}
						/* 几个提交在等着推——这个数目本身就是按下去的理由。 */
						trailing={unpushed > 0 ? <span className="font-mono text-caption tabular-nums text-ink-faint">{unpushed}</span> : undefined}
						working={workingAction === "push"}
						disabled={disabled || unpushed === 0}
						onClick={() => void handlePush()}
					/>
				</div>
			</div>
		</Popover>
	);
}

/**
 * 浮层底部那三行，一个样子。
 *
 * 抽出来是因为三行之间只差图标、文案和末尾那一点东西，而它们之前各写一遍的结果是高度、圆角和
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
