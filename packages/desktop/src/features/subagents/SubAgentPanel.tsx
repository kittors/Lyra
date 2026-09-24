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
 * A tab strip above, because a parent dispatching three searches at once is the case this exists
 * for, and choosing between them *is* the title.
 */

import { Bot, Check, CircleStop, Plus, RotateCcw, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { SubAgentSummary } from "@lyra/core";
import { useI18n } from "../../i18n/index.ts";
import { useApp } from "../../store/index.ts";
import { figuresOf, rosterOrder, useSubAgents } from "../../store/subAgents.ts";
import { useScopedSessionId, useScopedSubAgents } from "../../app/session-scope.tsx";
import { openFromEvent } from "../image/index.ts";
import { scanPlaceholders } from "../../lib/attachment-placeholders.ts";
import { openViewer } from "../image/index.ts";
import { useOpenFile } from "../../store/openFile.ts";
import { BackToLatest } from "../conversation/index.ts";
import {
	AttachmentStrip,
	ComposerSend,
	ComposerShell,
	fileKind,
	type FileKind,
	spellDraft,
	useAttachmentMarks,
	KIND_LABEL,
	pickedFrom,
	type PickedFile,
	type StripFile,
	useAttachmentActions,
} from "../composer/index.ts";
import { Markdown } from "../conversation/index.ts";
import { PanelEmpty } from "../../ui/layout/PanelEmpty.tsx";
import { Scroller } from "../../ui/scroll/Scroller.tsx";
import { useFollowBottom } from "../../ui/scroll/useFollowBottom.ts";
import { tailSignature } from "../../ui/scroll/signature.ts";
import { figuresWord, ranFor, statusTone } from "./format.ts";
import { SubAgentRoster } from "./SubAgentRoster.tsx";
import { StructuredOutput } from "./StructuredOutput.tsx";
import { SubAgentTranscript } from "./SubAgentMessageRow.tsx";
import { bridge } from "../../services/index.ts";

interface SubAgentAttachment {
	id: string;
	name: string;
	mimeType: string;
	data?: string;
	text?: string;
	isText: boolean;
	/** 磁盘上的位置，来自一个文件的话——「打开」和「在访达中显示」靠它。 */
	path?: string;
	/** 界面上叫什么：「图片 1」或者文件名。正文里那枚标记写的就是它——见 `useAttachmentMarks`。 */
	label?: string;
	kind?: FileKind;
}

export function SubAgentPanel() {
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
		return (
			<div className="flex min-h-0 min-w-0 flex-1 flex-col">
				<PanelEmpty icon={Bot} title={t("subAgent.title")}>
					{t("subAgent.empty")}
				</PanelEmpty>
				<IdleComposer placeholder={t("subAgent.empty")} />
			</div>
		);
	}

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			<SubAgentRoster
				agents={ordered}
				current={current?.id ?? null}
				onFocus={(id) => useSubAgents.getState().focus(id)}
				trailing={(one) => <Dismiss agent={one} />}
			/>
			{/*
			 * No `key`, deliberately.
			 *
			 * Keying on the delegate forced a remount on every tab change, which threw away the
			 * scroll position along with everything else — and reading two delegates against each
			 * other is the case this panel exists for. `Transcript` now tells the follow hook which
			 * delegate it is showing and gets the right position back, the same way the conversation
			 * does when you switch sessions.
			 */}
			{current && <Transcript agent={current} sessionId={sessionId} />}
		</div>
	);
}

function Dismiss({ agent }: { agent: SubAgentSummary }) {
	const { t } = useI18n();
	const sessionId = useApp((s) => s.activeSessionId);
	const running = agent.status === "running";
	return (
		<button
			type="button"
			data-ly-hover-reveal
			data-ly-tip={running ? t("subAgent.stopAndClose") : t("common.close")}
			aria-label={running ? t("subAgent.stopAndCloseOne", { name: agent.description }) : t("subAgent.closeOne", { name: agent.description })}
			onClick={async () => {
				if (!sessionId) return;
				const what = await bridge.subAgents.dismiss(sessionId, agent.id);
				// Stopping is not instant: the run files itself as aborted, and the row goes on the
				// second press. Saying so beats a click that appears to do nothing.
				if (what === "stopping") useApp.getState().notify(t("subAgent.stopping"), "info");
			}}
			className="rounded p-0.5 opacity-0 transition-opacity duration-[var(--ly-t-quick)] group-hover/subtab:opacity-60 hover:!opacity-100 hover:bg-elevated"
		>
			<X size={11} strokeWidth={2.2} />
		</button>
	);
}

function Transcript({ agent, sessionId }: { agent: SubAgentSummary; sessionId: string | null }) {
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
			<Header agent={agent} sessionId={sessionId} />
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
						{loading || agent.status === "running" ? t("subAgent.waiting") : t("subAgent.noOutput")}
					</p>
				) : (
					<SubAgentTranscript messages={messages} isLive={agent.status === "running"} />
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
				{agent.answer && (
					/*
					 * A report that was cut short is drawn as one.
					 *
					 * Its first line already says so in words, and that is what the parent model reads
					 * — but a person skims, and the window strips symbols out of text it did not write
					 * (`strip-emoji`), so the `⚠` that leads the sentence never reaches the screen. The
					 * label is the part a reader cannot miss; `status` could not carry it, because a
					 * run that used up its rounds is `done` — the work happened, it just did not
					 * finish.
					 *
					 * `danger` rather than a warning hue of its own: this app has three semantic
					 * colours and has already turned down a sixth for exactly this kind of case (see
					 * `SessionStatus`). Only the label takes it and the border is barely tinted — a
					 * whole card in red would read as "this failed", and it did not.
					 */
					<div
						className={`mt-2 min-w-0 max-w-full overflow-hidden rounded-lg border bg-card/50 px-3 py-2 ${
							agent.incomplete ? "border-danger/25" : "border-line-soft"
						}`}
					>
						<p className={`mb-1 flex items-center gap-1.5 text-caption ${agent.incomplete ? "text-danger" : "text-ink-faint"}`}>
							{agent.incomplete && <TriangleAlert size={12} strokeWidth={2} className="shrink-0" />}
							{t(agent.incomplete ? "subAgent.reportedBackPartial" : "subAgent.reportedBack")}
						</p>
						{/*
						 * The object first, drawn by its shape, when the agent declared one.
						 *
						 * It is what the parent indexes into (`agent://<id>/passed`), and printing it as
						 * JSON would make the one structured thing on this pane the hardest to read.
						 * The prose below it is still shown: the report and the object answer
						 * different questions.
						 */}
						{agent.output && (
							<div className="mb-2 border-b border-line-soft pb-2">
								<StructuredOutput output={agent.output} />
							</div>
						)}
						{/*
						 * Rendered, not printed.
						 *
						 * A sub-agent's report is written for the model to read and is Markdown like any
						 * other reply — file paths in backticks, findings in a list, emphasis on what
						 * matters. Shown raw it was a wall of asterisks and hyphens, which is both
						 * harder to read than the plain prose it replaced and inconsistent with the
						 * same text everywhere else in the window.
						 */}
						<Markdown text={agent.answer} className="min-w-0 max-w-full break-words" />
					</div>
				)}
				{/* Only when it is the whole story: the report above already opens with the cause. */}
				{agent.status === "failed" && agent.error && !agent.answer && (
					<p className="mt-2 rounded-lg border border-danger/30 px-3 py-2 text-detail text-danger">{agent.error}</p>
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
				 */}
				{(agent.status === "failed" || agent.status === "aborted") && <Redispatch agent={agent} />}
				{/* Where "you have seen the newest output" is decided — see `useFollowBottom`. */}
				<div ref={follow.tailRef} aria-hidden className="h-px w-full shrink-0" />
			</Scroller>
			{/* A delegate streams like anything else, and scrolling up in one used to be a one-way trip. */}
			<BackToLatest show={follow.away} unread={follow.unread} onClick={follow.returnToBottom} />
			</div>
			{agent.status === "running" && sessionId ? (
				<Steer agent={agent} sessionId={sessionId} />
			) : (
				<IdleComposer placeholder={t("subAgent.steering")} />
			)}
		</>
	);
}

function Redispatch({ agent }: { agent: SubAgentSummary }) {
	const { t } = useI18n();
	const [asked, setAsked] = useState(false);
	return (
		<button
			type="button"
			disabled={asked}
			data-ly-tip={t("subAgent.redispatchTip")}
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
			aria-label={asked ? t("subAgent.drafted") : t("subAgent.redispatch")}
			className="mt-2 grid h-7 w-7 place-items-center rounded-lg border border-line-soft text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink disabled:opacity-50"
		>
			{/* 派过之后变成一个勾：草稿已经在输入框里了，再按一次不会有第二份。 */}
			{asked ? <Check size={11.5} strokeWidth={2.2} aria-hidden /> : <RotateCcw size={11.5} strokeWidth={1.9} aria-hidden />}
		</button>
	);
}

function Header({ agent, sessionId }: { agent: SubAgentSummary; sessionId: string | null }) {
	const { t } = useI18n();
	/* A clock while it runs, frozen at the end once it has. */
	const [, tick] = useState(0);
	useEffect(() => {
		if (agent.status !== "running") return;
		const timer = window.setInterval(() => tick((n) => n + 1), 1000);
		return () => window.clearInterval(timer);
	}, [agent.status]);

	return (
		<div className="flex h-7 shrink-0 items-center gap-2 border-b border-line px-2.5 text-caption text-ink-faint">
			<span className={`size-[5px] shrink-0 rounded-full ${statusTone(agent.status)}`} />
			<span className="shrink-0 whitespace-nowrap">{agent.agent}</span>
			<span className="shrink-0 text-line">·</span>
			<span className="shrink-0 whitespace-nowrap tabular-nums">{ranFor(agent)}</span>
			{agent.toolCalls > 0 && (
				<>
					<span className="shrink-0 text-line">·</span>
					<span className="shrink-0 whitespace-nowrap tabular-nums">{t("subAgent.calls", { n: agent.toolCalls })}</span>
				</>
			)}
			{/* What it has cost so far — the number that decides whether delegating this was worth it. */}
			{figuresWord(figuresOf(agent)) && (
				<>
					<span className="shrink-0 text-line">·</span>
					<span data-sub-figures data-ly-tip={t("subAgent.figuresTip")} className="shrink-0 whitespace-nowrap tabular-nums">
						{figuresWord(figuresOf(agent))}
					</span>
				</>
			)}
			{/*
			 * The newest thing it did, which is what answers "is this stuck?".
			 *
			 * 正在重连时说重连——那才是此刻的实话。卡在重试上的子代理，最后一次工具调用可能是半小时
			 * 前的事，把它顶在这里等于告诉人「它在读文件」，而它其实什么都没在做。
			 *
			 * 重连那行稍重一档，但不用警告色：重试不是错误，是在等。
			 */}
			{agent.status === "running" && (agent.retrying || agent.lastActivity) && (
				<span className={`ly-fade-tail min-w-0 flex-1 truncate ${agent.retrying ? "text-ink-muted" : "text-ink-faint"}`}>
					{agent.retrying
						? t("subAgent.retrying", { attempt: agent.retrying.attempt, reason: agent.retrying.reason })
						: agent.lastActivity}
				</span>
			)}
			<span className="min-w-2 flex-1" />
			{agent.status === "running" && sessionId && (
				<button
					type="button"
					data-ly-tip={t("subAgent.stopTip")}
					aria-label={t("subAgent.stop")}
					onClick={() => void bridge.subAgents.abort(sessionId, agent.id)}
					className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-danger"
				>
					<CircleStop size={12} strokeWidth={1.9} />
				</button>
			)}
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
function IdleComposer({ placeholder }: { placeholder: string }) {
	const { t } = useI18n();
	return (
		<div className="ly-composer-pad mx-auto w-full max-w-[var(--ly-content)] shrink-0">
			<ComposerShell
				value=""
				onChange={() => undefined}
				onSubmit={() => undefined}
				disabled
				placeholder={placeholder}
				left={
					<button
						type="button"
						disabled
						data-ly-tip={t("subAgent.attach")}
						aria-label={t("subAgent.attach")}
						className="ly-composer-control ly-composer-icon flex shrink-0 items-center justify-center rounded-full text-ink-muted"
					>
						<Plus size={16} strokeWidth={1.9} />
					</button>
				}
				right={
					<>
						<span className="flex h-7 min-w-0 items-center gap-1.5 px-2 text-label text-ink-faint">
							<span className="size-[5px] shrink-0 rounded-full bg-ink-faint" />
							<span className="truncate">{t("subAgent.steering")}</span>
						</span>
						<ComposerSend running={false} disabled onSend={() => undefined} onStop={() => undefined} />
					</>
				}
			/>
		</div>
	);
}

/**
 * Say something to a sub-agent that is still running.
 *
 * Designed with the exact same visual styling and interaction polish as SideComposer / ComposerShell:
 * Supports text, multi-format attachments (images, code files, logs, docs), and unified buttons.
 */
function Steer({ agent, sessionId }: { agent: SubAgentSummary; sessionId: string }) {
	const { t } = useI18n();
	const [text, setText] = useState("");
	const [attachments, setAttachments] = useState<SubAgentAttachment[]>([]);
	const [sending, setSending] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const field = useRef<HTMLTextAreaElement>(null);
	const attachmentActions = useAttachmentActions();
	/*
	 * 正文里那枚标记，和主输入框是同一套。
	 *
	 * 这个框从前收得下图片、也画得出缩略图，但发出去的时候图片是被静默丢掉的——`steer` 只收一段字，
	 * 于是只有文本附件被拼进正文。现在 `steer` 收内容块了，见 `core/runtime/sub-agents.ts`。
	 */
	const marks = useAttachmentMarks<SubAgentAttachment>({ attachments, setAttachments, setText, field });

	const previewable = useMemo(
		() => attachments.filter((a) => !a.isText && a.data),
		[attachments],
	);

	const previewImage = (target: SubAgentAttachment, originRect?: DOMRect) => {
		const index = previewable.findIndex((file) => file.id === target.id);
		if (index < 0) return;
		const origin = originRect ?? new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 1, 1);
		openViewer(
			previewable.map((file) => ({ src: `data:${file.mimeType};base64,${file.data}`, alt: file.name })),
			index,
			origin,
		);
	};
	/** 这一排要画的东西，和主输入框那一排是同一种形状——见 `AttachmentStrip`。 */
	const strip: StripFile[] = useMemo(
		() =>
			attachments.map((attachment) => {
				const kind = attachment.kind ?? fileKind(attachment.name, attachment.mimeType);
				return {
					key: attachment.id,
					name: attachment.label ?? attachment.name,
					kind,
					...(attachment.data && !attachment.isText
						? { src: `data:${attachment.mimeType};base64,${attachment.data}` }
						: {}),
					...(attachment.path ? { path: attachment.path } : {}),
					tip: `${attachment.name}\n${t(KIND_LABEL[kind])}`,
				};
			}),
		[attachments, t],
	);

	const addFiles = async (picked: PickedFile[]) => {
		if (picked.length === 0) return;
		// 读文件之前记下来：读一份大文件要几百毫秒，那期间光标早就不在原地了。
		const caret = field.current?.selectionStart ?? text.length;
		const next: SubAgentAttachment[] = [];
		for (const { file, path } of picked) {
			const from = path ? { path } : {};
			if (file.type.startsWith("image/")) {
				const buffer = await file.arrayBuffer();
				const base64 = bytesToBase64(new Uint8Array(buffer));
				next.push({
					id: `${Date.now()}-${Math.random()}`,
					name: file.name,
					mimeType: file.type,
					data: base64,
					isText: false,
					...from,
				});
			} else {
				// Non-image attachments (text, markdown, code, config, logs, etc.)
				try {
					const content = await file.text();
					next.push({
						id: `${Date.now()}-${Math.random()}`,
						name: file.name,
						mimeType: file.type || "text/plain",
						text: content,
						isText: true,
						...from,
					});
				} catch {
					useApp.getState().notify(t("subAgent.fileUnreadable", { name: file.name }), "warn");
				}
			}
		}
		// 标记、编号、光标落点都在这一步里——和主输入框是同一段代码。
		marks.attach(next, caret);
	};

	const send = async () => {
		const trimmed = text.trim();
		if ((!trimmed && attachments.length === 0) || sending) return;

		/*
		 * 和主输入框同一段：附件按标记在句子里的先后排，每份自带「第几张、共几张」。
		 *
		 * 这里从前是自己拼的，而且只拼得动文本附件——图片一路收到这儿就没了，因为 `steer` 当时只收
		 * 一段字。界面上那一格缩略图是真的，发出去的东西里没有它，这中间没有任何提示。
		 */
		const content = spellDraft(trimmed, attachments);
		if (content.length === 0) return;

		setSending(true);
		const delivered = await bridge.subAgents.steer(sessionId, agent.id, content);
		setSending(false);
		if (delivered) {
			setText("");
			setAttachments([]);
		} else {
			useApp.getState().notify(t("subAgent.gone"), "error");
		}
	};

	return (
		<div className="ly-composer-pad mx-auto w-full max-w-[var(--ly-content)] shrink-0">
			<ComposerShell
				value={text}
				fieldRef={field}
				onChange={(next) => {
					setText(next);
					// 句子里那枚标记被删掉，附件跟着卸下来——删除是双向的。
					marks.reconcile(next);
				}}
				onKeyDown={(event) => {
					// 退格吃掉整枚标记，而不是把它啃成一串没人认得的方括号。
					marks.keyDown(event);
				}}
				onAttachmentClick={(index, rect) => {
					const hit = scanPlaceholders(text, attachments)[index];
					if (!hit) return;
					attachmentActions.openOrPreview(
						{
							name: hit.file.label ?? hit.file.name,
							path: hit.file.path,
							src: hit.file.data && !hit.file.isText ? `data:${hit.file.mimeType};base64,${hit.file.data}` : undefined,
							isImage: !hit.file.isText && Boolean(hit.file.data),
							onPreviewImage: (originRect?: DOMRect) => previewImage(hit.file, originRect),
							onOpenFile: (path: string, name: string) => {
								void useOpenFile.getState().open({ path, name, isDirectory: false, size: 0 });
								// Note: SubAgentPanel cannot import the dock directly due to dependency cycle.
								// It opens via useOpenFile and users view files in file panel or system.
							},
						},
						rect,
					);
				}}
				decoration={{ attachments: marks.decorationFor(text) }}
				onSubmit={() => void send()}
				disabled={sending}
				placeholder={t("subAgent.steerPlaceholder")}
				onFiles={(picked) => void addFiles(picked)}
				attachments={
					/*
					 * 和主输入框、侧边聊天、气泡外面，是同一排东西。
					 *
					 * 这里从前自己画了一份：56px 高的卡片、一行「文件附件」、常驻的叉。于是同一份 PDF 在应用里
					 * 有四种长相，而它们说的是同一件事。四份实现也意味着新增的能力只会长在其中一份上——打开、
					 * 指出位置、复制路径，这一份一样都没有。
					 */
					attachments.length > 0 ? (
						<div className="ly-composer-attachments">
							<AttachmentStrip
								files={strip}
								layout="row"
								/* 面板本来就窄，格子跟着小一号——一排还是一排，只是每个矮一点。 */
								thumbnail={56}
								onOpen={(index, event) =>
									openFromEvent(
										event,
										attachments
											.filter((a) => !a.isText && a.data)
											.map((a) => ({ src: `data:${a.mimeType};base64,${a.data}`, alt: a.name })),
										index,
									)
								}
								onRemove={(file) => {
									const target = attachments.find((a) => a.id === file.key);
									if (target) marks.detach(target);
								}}
							/>
						</div>
					) : undefined
				}
				left={
					<>
						<button
							type="button"
							data-ly-tip={t("subAgent.attach")}
							aria-label={t("subAgent.attach")}
							onClick={() => fileInputRef.current?.click()}
							className="ly-composer-control ly-composer-icon flex shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-card-hover hover:text-ink"
						>
							<Plus size={16} strokeWidth={1.9} />
						</button>
						<input
							ref={fileInputRef}
							type="file"
							multiple
							hidden
							onChange={(e) => {
								void addFiles(pickedFrom(e.target.files));
								e.target.value = "";
							}}
						/>
						<span className="flex h-7 min-w-0 items-center gap-1.5 px-2 text-label text-ink-faint">
							<span className={`size-[5px] shrink-0 rounded-full ${statusTone(agent.status)}`} />
							<span className="truncate">{t("subAgent.steering")}</span>
						</span>
					</>
				}
				right={
					<ComposerSend
						running={sending}
						disabled={!text.trim() && attachments.length === 0}
						onSend={() => void send()}
						onStop={() => void bridge.subAgents.abort(sessionId, agent.id)}
					/>
				}
			/>
		</div>
	);
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}
