/**
 * One delegated run, read from the outside — and, while it lasts, reachable.
 *
 * The shape is the side chat's, because the thing being done is the same thing: a conversation
 * beside the main one, in its own pane, that you can type into. What it is *not* is a second
 * executor. Typing here does not start anything of its own; it splices a message into the
 * sub-agent's own loop between turns, so it finishes the step it is on, reads what you said with
 * its context intact, and carries on.
 *
 * Which is also the whole of how this reaches the main agent: it does not. The sub-agent reports
 * back to the parent when it finishes, and steering changes what that report says. One executor
 * per workspace — two agents writing to one working tree is a conflict waiting to happen, and the
 * indirection is the design rather than a limitation of it.
 *
 * 派了不止一个时，顶上那一行就是切换器：脸叠成一摞，点开一张单子换人——见 `SubAgentHeader`。
 */

import { Bot, Check, Copy, CornerLeftUp, Play, Plus, RotateCcw, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { SubAgentSummary } from "@lyra/core";
import { useI18n } from "../../i18n/index.ts";
import { useApp } from "../../store/index.ts";
import { rosterOrder, useSubAgents } from "../../store/subAgents.ts";
import { useScopedSessionId, useScopedSubAgents } from "../../app/session-scope.tsx";
import { BackToLatest } from "../conversation/index.ts";
import {
	attachmentMeta,
	ComposerSend,
	ComposerShell,
	type DraftAttachment,
	spellDraft,
	useComposerAttachments,
	useDraft,
	useInputHistory,
} from "../composer/index.ts";
import { Markdown } from "../conversation/index.ts";
import { PanelEmpty } from "../../ui/layout/PanelEmpty.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { useFollowBottom } from "../../ui/scroll/useFollowBottom.ts";
import { tailSignature } from "../../ui/scroll/signature.ts";
import { useAgentAvatars } from "../../store/agent-avatars.ts";
import { stateOf } from "../../lib/dispatches.ts";
import { AgentAvatar } from "../../ui/avatar/AgentAvatar.tsx";
import { wayBack } from "./way-back.ts";
import { SubAgentHeader } from "./SubAgentHeader.tsx";
import { hasContent, StructuredOutput } from "./StructuredOutput.tsx";
import { Button } from "../../ui/primitives/Button.tsx";
import { fromParent, SubAgentTranscript } from "./SubAgentMessageRow.tsx";
import { bridge } from "../../services/index.ts";

/** 在应用里打开一个磁盘上的文件——由挂这个面板的那一层给，见 `dock/panels/builtin.tsx`。 */
type OpenFile = (path: string, name: string) => void;

export function SubAgentPanel({ openFile }: { openFile?: OpenFile } = {}) {
	const { t } = useI18n();
	// The conversation of the screen this panel is in, and its delegated work.
	const sessionId = useScopedSessionId();
	const agents = useScopedSubAgents();
	const focused = useSubAgents((s) => s.focused);
	const ordered = rosterOrder(agents);

	/*
	 * Which one is being read, decided here rather than stored.
	 *
	 * The roster is re-broadcast on every tool call of every sub-agent, so anything derived from it
	 * in the store would churn. Falling back to the first — running ones sort first — means the
	 * pane opens onto something useful without ever moving off what you chose.
	 */
	const current = ordered.find((one) => one.id === focused) ?? ordered[0] ?? null;

	useEffect(() => {
		if (current && sessionId) void useSubAgents.getState().load(sessionId, current.id);
	}, [current, sessionId]);

	if (agents.length === 0) {
		// 排在闸门后面的也在名单上（派出去那一刻就登记了），所以这里只剩「真的一个都没派」。
		return (
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				<PanelEmpty icon={Bot} art={<IdleCrew />} title={t("subAgent.title")}>
					{t("subAgent.empty")}
				</PanelEmpty>
				<IdleComposer placeholder={t("subAgent.empty")} />
			</div>
		);
	}

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			{/*
			 * No `key`, deliberately.
			 *
			 * Keying on the delegate forced a remount on every tab change, which threw away the
			 * scroll position along with everything else — and reading two delegates against each
			 * other is the case this panel exists for. `Transcript` now tells the follow hook which
			 * delegate it is showing and gets the right position back, the same way the conversation
			 * does when you switch sessions.
			 */}
			{current && <Transcript agent={current} agents={ordered} sessionId={sessionId} openFile={openFile} />}
		</div>
	);
}

/** 没活的时候，几张醒着的脸在这儿等着——比一枚机器人图标更像「派活就会有人来」。 */
function IdleCrew() {
	const avatarOf = useAgentAvatars();
	const names = ["explore", "general", "plan"];
	return (
		<span className="flex items-end gap-2" aria-hidden data-ly-avatar-host="">
			{names.map((name, index) => (
				<AgentAvatar key={name} avatar={avatarOf(name)} size={index === 1 ? 34 : 26} seed={name} host="[data-ly-avatar-host]" />
			))}
		</span>
	);
}

function Transcript({ agent, agents, sessionId, openFile }: {
	agent: SubAgentSummary;
	agents: SubAgentSummary[];
	sessionId: string | null;
	openFile?: OpenFile;
}) {
	const { t } = useI18n();
	const messages = useSubAgents((s) => s.transcripts[agent.id]);
	const loading = useSubAgents((s) => s.loading.includes(agent.id));

	/*
	 * One position per delegate, not one per panel.
	 *
	 * The surface is the pair: the same delegate id can appear under two conversations, and the two
	 * are different transcripts. `status` and the report are in the signature because both change
	 * what is on screen without touching a message — a delegate finishing appends its report below
	 * everything else, and that is content arriving like any other.
	 */
	const follow = useFollowBottom({
		surfaceId: sessionId ? `${sessionId}:${agent.id}` : null,
		namespace: "subagent",
		count: messages?.length ?? 0,
		tail: tailSignature(messages ?? [], `${agent.status}:${agent.answer?.length ?? 0}:${agent.error ? 1 : 0}`),
	});

	return (
		<>
			<SubAgentHeader agent={agent} agents={agents} sessionId={sessionId} />
			<div className="relative flex min-h-0 flex-1 flex-col">
			<Scroller
				className="flex-1"
				scrollRef={follow.scrollRef}
				/* Bottom padding leaves 「回到最新」 somewhere to float that is not the newest output. */
				contentClassName="ly-content-gutter pt-2 pb-[var(--ly-bottom-inset)]"
				onScroll={follow.onScroll}
				onResize={follow.onResize}
				onUserScroll={follow.onUserScroll}
			>
				{!messages || messages.length === 0 ? (
					<p className="px-2 py-8 text-center text-detail text-ink-faint">
						{loading || agent.status === "running" || agent.status === "queued" ? t("subAgent.waiting") : t("subAgent.noOutput")}
					</p>
				) : (
					<SubAgentTranscript
						messages={messages}
						isLive={agent.status === "running"}
						// 回报是一段话的时候，那段话只在回报卡片里画一次——见 `echo`。
						echo={agent.answer && !(agent.output && hasContent(agent.output)) ? agent.answer : undefined}
					/>
				)}
				{/*
				 * The answer, marked as the one thing the parent actually saw.
				 *
				 * Everything above it is the sub-agent's own working — the point of delegation is
				 * that none of it reached the parent's context. Saying which part did is what makes
				 * the transcript legible as "what was delegated and what came back".
				 */}
				{/*
				 * Shown whenever there is one, not only on a clean finish.
				 *
				 * A run that lost its provider halfway still did half an hour of work, and what it
				 * had concluded by then travels back with the failure — see `incompleteNote`. Gating
				 * this on `done` hid exactly the reports worth reading, and left the pane for a
				 * half-hour run showing one red line.
				 */}
				{agent.answer && <Report agent={agent} />}
				{/* Only when it is the whole story: the report above already opens with the cause. */}
				{agent.status === "failed" && agent.error && !agent.answer && (
					<p className="mt-3 rounded-xl border border-danger/25 px-3.5 py-2.5 text-detail leading-relaxed text-danger">{agent.error}</p>
				)}
				{/*
				 * A way back from the two endings that were not the point.
				 *
				 * A sub-agent that failed or was stopped leaves the parent holding an error where it
				 * expected a report — and the parent is the only thing that can dispatch another,
				 * because it owns the `task` call and the context that produced the prompt. So this
				 * does not re-run anything itself: it asks the main agent to, in as many words, and
				 * the main agent decides whether that is still the right move. Same indirection as
				 * steering, for the same reason — one executor per workspace.
				 *
				 * 上下文还在的，要的是「接着跑」，不是「重派」：重派的那个从零开始，把它读过的再读一遍。
				 * 跑到检查点停下的那种（`done` + `incomplete`）从前在这里什么都没有——而那正是反馈里
				 * 「60 步跑满、啥都没干好」的那一个，最需要一个出路。重派只留给上下文已经不在的。
				 */}
				{wayBack(agent) === "resume" && <Resume agent={agent} />}
				{wayBack(agent) === "redispatch" && <Redispatch agent={agent} />}
				{/* Where "you have seen the newest output" is decided — see `useFollowBottom`. */}
				<div ref={follow.tailRef} aria-hidden className="h-px w-full shrink-0" />
			</Scroller>
			{/* A delegate streams like anything else, and scrolling up in one used to be a one-way trip. */}
			<BackToLatest show={follow.away} unread={follow.unread} onClick={follow.returnToBottom} />
			</div>
			{agent.status === "running" && sessionId ? (
				<Steer agent={agent} sessionId={sessionId} openFile={openFile} />
			) : (
				<IdleComposer placeholder={t("subAgent.finishedSteer")} agent={agent} />
			)}
		</>
	);
}

/**
 * 它交回来的东西，一张卡片。
 *
 * A report that was cut short is drawn as one. Its first line already says so in words, and that
 * is what the parent model reads — but a person skims, and the window strips symbols out of text it
 * did not write (`strip-emoji`), so the `⚠` that leads the sentence never reaches the screen. The
 * label is the part a reader cannot miss; `status` could not carry it, because a run that used up
 * its rounds is `done` — the work happened, it just did not finish. `danger` only on the label and a
 * barely tinted border: a whole card in red would read as "this failed", and it did not.
 *
 * 声明了输出格式的，画的是那个对象，不再在下面把 `answer` 也画一遍。`answer` 是同一个对象给
 * 模型读的写法（`renderYield`：结论、每条记录压成一行、报告全文），两份叠在一起，读的人是把每条
 * 发现从表格里读一遍、再从一串「- `a.ts` — severity: high，problem: …」里读一遍。只有对象里
 * 什么都没写（`{ summary: "", files: [] }` 也能过校验）的时候，才退回那段文字——那时它是
 * 子智能体最后说的话。
 */
function Report({ agent }: { agent: SubAgentSummary }) {
	const { t } = useI18n();
	const answer = agent.answer ?? "";
	const structured = agent.output && hasContent(agent.output) ? agent.output : null;
	/*
	 * 没跑完的那种，开头一段是 core 写的「为什么没跑完、下面是什么」。只画对象的时候那段话会跟着
	 * `answer` 一起消失，而标题只说了「没跑完」，没说是跑满了检查点、原地打转，还是服务出错。
	 */
	const note = agent.incomplete && structured ? answer.split(/\n{2,}/)[0].replace(/^⚠\s*/, "") : null;
	const prose = (text: string) => <Markdown text={text} className="min-w-0 max-w-full break-words" />;
	return (
		<section
			data-sub-report=""
			className={`group/report mt-3 min-w-0 max-w-full overflow-hidden rounded-xl border px-3.5 pt-2 pb-3.5 ${agent.incomplete ? "border-danger/25 bg-card/40" : "border-line-soft bg-card/50"}`}
		>
			<header className={`mb-2 flex h-7 items-center gap-1.5 text-caption ${agent.incomplete ? "text-danger" : "text-ink-faint"}`}>
				{agent.incomplete ? (
					<TriangleAlert size={12.5} strokeWidth={2} aria-hidden className="shrink-0" />
				) : (
					<CornerLeftUp size={12.5} strokeWidth={2} aria-hidden className="shrink-0" />
				)}
				<span className="min-w-0 truncate">{t(agent.incomplete ? "subAgent.reportedBackPartial" : "subAgent.reportedBack")}</span>
				<span className="flex-1" />
				<CopyReport text={answer} />
			</header>
			{note && <p className="mb-3 text-detail leading-relaxed text-ink-muted" data-sub-report-note="">{note}</p>}
			{structured ? <StructuredOutput output={structured} warnings={agent.warnings} prose={prose} /> : prose(answer)}
		</section>
	);
}

/** 复制它交回来的全文——给模型读的那一份，带着每一条，贴到哪儿都能读。 */
function CopyReport({ text }: { text: string }) {
	const { t } = useI18n();
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return;
		const timer = setTimeout(() => setCopied(false), 1600);
		return () => clearTimeout(timer);
	}, [copied]);
	return (
		<button
			type="button"
			data-ly-hover-reveal
			data-ly-tip={copied ? t("common.copied") : t("common.copy")}
			aria-label={t("subAgent.copyReport")}
			onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true))}
			className="grid size-6 shrink-0 place-items-center rounded-md text-ink-faint opacity-0 transition duration-[var(--ly-t-quick)] group-hover/report:opacity-100 hover:bg-card-hover hover:text-ink focus-visible:opacity-100"
		>
			{copied ? <Check size={12.5} strokeWidth={2.2} className="ly-pop text-ok" /> : <Copy size={12.5} strokeWidth={1.8} />}
		</button>
	);
}

/**
 * 让主 Agent 带着这个子代理的上下文把它续上。
 *
 * 和「重新派发」同一个间接法、同一个理由：落成输入框里的一份草稿，人读过、改过、或者扔掉之后才
 * 花钱。草稿里带着 id——主 Agent 要用它调 `task` 的 `resume`，写一句「接着跑刚才那个」它不知道
 * 是哪一个。
 *
 * 从前这两个是一枚带描边的小方块，只有一个播放 / 回转图标：看的人得先悬停才知道它是干什么的，
 * 而这恰恰是一次派发没做完之后唯一的出路。现在写着字。
 */
function Resume({ agent }: { agent: SubAgentSummary }) {
	const { t } = useI18n();
	const [asked, setAsked] = useState(false);
	return (
		<div className="mt-2 w-fit" data-sub-resume>
			<Button
				variant="subtle"
				size="sm"
				disabled={asked}
				label={t("subAgent.resumeTip")}
				icon={asked ? <Check size={13} strokeWidth={2.2} aria-hidden /> : <Play size={13} strokeWidth={1.9} aria-hidden />}
				onClick={() => {
					useApp.getState().setComposerDraft(t("subAgent.resumeDraft", { name: agent.description, id: agent.id }), true);
					setAsked(true);
				}}
			>
				{asked ? t("subAgent.drafted") : t("subAgent.resume")}
			</Button>
		</div>
	);
}

function Redispatch({ agent }: { agent: SubAgentSummary }) {
	const { t } = useI18n();
	const [asked, setAsked] = useState(false);
	return (
		<div className="mt-2 w-fit" data-sub-redispatch>
			<Button
				variant="subtle"
				size="sm"
				disabled={asked}
				label={t("subAgent.redispatchTip")}
				icon={asked ? <Check size={13} strokeWidth={2.2} aria-hidden /> : <RotateCcw size={13} strokeWidth={1.9} aria-hidden />}
				onClick={() => {
					/*
					 * Through the composer, not straight to the model.
					 *
					 * It lands as a draft you can read, edit, or throw away before anything runs — the
					 * request is a sentence about work that already cost something once, and pressing a
					 * button should not be the last word on spending it again.
					 */
					useApp
						.getState()
						.setComposerDraft(
							t(agent.status === "failed" ? "subAgent.redispatchDraftFailed" : "subAgent.redispatchDraftAborted", {
								name: agent.description,
							}),
							true,
						);
					setAsked(true);
				}}
			>
				{/* 派过之后变成一个勾：草稿已经在输入框里了，再按一次不会有第二份。 */}
				{asked ? t("subAgent.drafted") : t("subAgent.redispatch")}
			</Button>
		</div>
	);
}

/**
 * The same card the running steer uses, inert.
 *
 * Side chat keeps its field when there is nothing to say; this pane used to
 * lose the whole card the moment a run ended, so three composers along the
 * window's bottom became two, then one, and the remaining cards sat on a
 * different line. A disabled twin holds the slot.
 */
function IdleComposer({ placeholder, agent }: { placeholder: string; agent?: SubAgentSummary }) {
	const { t } = useI18n();
	const avatarOf = useAgentAvatars();
	return (
		<div className="ly-composer-pad mx-auto w-full max-w-[var(--ly-content)] shrink-0">
			<ComposerShell
				value=""
				onChange={() => undefined}
				onSubmit={() => undefined}
				disabled
				placeholder={placeholder}
				left={
					<>
						<button
							type="button"
							disabled
							data-ly-tip={t("composer.addAttachment")}
							aria-label={t("composer.addAttachment")}
							className="ly-composer-control ly-composer-icon flex shrink-0 items-center justify-center rounded-full text-ink-muted"
						>
							<Plus size={16} strokeWidth={1.9} />
						</button>
						{/*
						 * 和在跑时那一格同一个位置、同一张脸，只是淡下去：跑完的那一刻这一行不跳。从前这里在右边
						 * 另画一个「• 定向纠偏」，和占位里那句一字不差，一个框里说了两遍同一个词。
						 */}
						{agent && (
							<span className="flex h-7 min-w-0 items-center gap-1.5 px-2 text-label text-ink-faint opacity-60">
								<AgentAvatar avatar={avatarOf(agent.agent)} size={14} mood={stateOf(agent)} seed={agent.agent} interactive={false} />
								<span className="truncate">{t("subAgent.steering")}</span>
							</span>
						)}
					</>
				}
				right={<ComposerSend running={false} disabled onSend={() => undefined} onStop={() => undefined} />}
			/>
		</div>
	);
}

/**
 * Say something to a sub-agent that is still running.
 *
 * 和主输入框、侧边聊天是同一套：收附件的那一整套（`useComposerAttachments`）、按对象存着的草稿
 * （`useDraft`）、方向键翻自己说过的话（`useInputHistory`）。从前这里各样自己抄一份最早的：所有
 * 文件都摆成卡片、PDF 读成乱码、草稿放在组件里——而面板不按子智能体重挂，于是给 A 写到一半切到
 * B，那半句话跟着过去，回车一按说给了另一个。现在草稿按子智能体存。
 *
 * 发送键就是发送键。它从前在「发送中」那一瞬变成停止键，而那颗停止停的是整个子智能体：连点两下
 * 回车，第二下就把它杀了。停止在面板顶上，写着字。
 */
function Steer({ agent, sessionId, openFile }: { agent: SubAgentSummary; sessionId: string; openFile?: OpenFile }) {
	const { t } = useI18n();
	const avatarOf = useAgentAvatars();
	const { text, setText, attachments, setAttachments, clear } = useDraft<DraftAttachment>(`subagent:${sessionId}:${agent.id}`);
	const [sending, setSending] = useState(false);
	const field = useRef<HTMLTextAreaElement>(null);
	const kit = useComposerAttachments<DraftAttachment>({ text, attachments, setAttachments, setText, field, openFile, thumbnail: 56 });
	const { marks } = kit;
	/*
	 * 只翻人自己在这里说过的。开头那份任务、续跑时补的那句，是派它出去的那一方说的——翻出来再发一遍，
	 * 等于把主 Agent 的话当成自己的又说一遍。
	 */
	const transcript = useSubAgents((s) => s.transcripts[agent.id]);
	const spoken = useMemo(() => (transcript ?? []).filter((message, index) => !fromParent(message, index)), [transcript]);
	const history = useInputHistory({
		messages: spoken,
		value: text,
		attachments,
		onPick: (next, files) => {
			setText(next);
			setAttachments(files as DraftAttachment[]);
		},
		field,
		resetKey: agent.id,
	});
	const empty = !text.trim() && attachments.length === 0;

	const send = async () => {
		const trimmed = text.trim();
		if (empty || sending) return;
		/*
		 * 和主输入框同一段：附件按标记在句子里的先后排，每份自带「第几张、共几张」。再交一份给人看的
		 * ——人打的字和附件的名字门类——气泡里画的就是它，而不是一整篇文件正文。
		 */
		const content = spellDraft(trimmed, attachments);
		if (content.length === 0) return;
		const display = { displayText: trimmed, attachments: attachmentMeta(attachments) };
		/* 先清空再送：送不到再原样放回去，接在这期间新打的字前面。 */
		const kept = { text, attachments };
		clear();
		setSending(true);
		const delivered = await bridge.subAgents.steer(sessionId, agent.id, content, display).catch(() => false);
		setSending(false);
		if (!delivered) {
			setText((current) => (current.trim() ? `${kept.text}\n${current}` : kept.text));
			setAttachments((current) => [...kept.attachments, ...current]);
			useApp.getState().notify(t("subAgent.gone"), "error");
		}
	};

	return (
		<div className="ly-composer-pad mx-auto w-full max-w-[var(--ly-content)] shrink-0">
			<ComposerShell
				value={text}
				fieldRef={field}
				hint={
					history.position ? (
						<div data-ly-history="" className="ly-composer-hint text-caption text-ink-faint">
							{t("composer.history", { current: history.position.current, total: history.position.total })}
						</div>
					) : undefined
				}
				onChange={(next) => {
					setText(next);
					// 句子里那枚标记被删掉，附件跟着卸下来——删除是双向的。
					marks.reconcile(next);
				}}
				onKeyDown={(event) => {
					// 退格吃掉整枚标记，而不是把它啃成一串没人认得的方括号。
					if (marks.keyDown(event)) return;
					history.keyDown(event);
				}}
				onContextMenu={kit.onContextMenu}
				onAttachmentClick={kit.onAttachmentClick}
				decoration={{ attachments: marks.decorationFor(text) }}
				onSubmit={() => void send()}
				placeholder={t("subAgent.steerPlaceholder")}
				onFiles={(picked) => void kit.addFiles(picked)}
				attachments={
					/* 和主输入框同一排：只有图片，文件在句子里那枚标记上；没有图就不撑开。 */
					<div className="ly-reveal" data-open={kit.strip.length > 0 ? "true" : "false"}>
						<div className="ly-composer-attachments">{kit.stripNode}</div>
					</div>
				}
				left={
					<>
						<button
							type="button"
							data-ly-tip={t("composer.addAttachment")}
							aria-label={t("composer.addAttachment")}
							onClick={kit.picker.open}
							className="ly-composer-control ly-composer-icon flex shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-card-hover hover:text-ink"
						>
							<Plus size={16} strokeWidth={1.9} />
						</button>
						{kit.picker.input}
						{/* 说给谁听：它的脸在这儿，字就不用再写一遍名字。 */}
						<span className="flex h-7 min-w-0 items-center gap-1.5 px-2 text-label text-ink-faint">
							<AgentAvatar avatar={avatarOf(agent.agent)} size={14} mood={stateOf(agent)} seed={agent.agent} interactive={false} />
							<span className="truncate">{t("subAgent.steering")}</span>
						</span>
					</>
				}
				right={<ComposerSend running={false} disabled={empty || sending} onSend={() => void send()} onStop={() => undefined} />}
			/>
			{kit.menu}
		</div>
	);
}
