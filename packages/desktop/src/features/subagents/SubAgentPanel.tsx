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

import { Bot, CircleStop, FileText, Plus, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { SubAgentSummary } from "@lyra/core";
import { useApp } from "../../store/index.ts";
import { figuresOf, rosterOrder, useSubAgents } from "../../store/subAgents.ts";
import { openViewer } from "../image/index.ts";
import { BackToLatest } from "../conversation/index.ts";
import { ComposerSend, ComposerShell } from "../composer/index.ts";
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
}

export function SubAgentPanel() {
	const sessionId = useApp((s) => s.activeSessionId);
	const agents = useSubAgents((s) => s.agents);
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
			<PanelEmpty icon={Bot} title="子 Agent">
				主 Agent 把一部分工作派发出去时，这里会显示每个子 Agent 在做什么。它们各自有独立的上下文，正在运行的可以直接对话来纠偏。
			</PanelEmpty>
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
	const sessionId = useApp((s) => s.activeSessionId);
	const running = agent.status === "running";
	return (
		<button
			type="button"
			data-ly-tip={running ? "停止并关闭（会中断它正在做的事）" : "关闭"}
			aria-label={running ? `停止并关闭 ${agent.description}` : `关闭 ${agent.description}`}
			onClick={async () => {
				if (!sessionId) return;
				const what = await bridge.subAgents.dismiss(sessionId, agent.id);
				// Stopping is not instant: the run files itself as aborted, and the row goes on the
				// second press. Saying so beats a click that appears to do nothing.
				if (what === "stopping") useApp.getState().notify("正在停止这个子 Agent…", "info");
			}}
			className="rounded p-0.5 opacity-0 transition-opacity duration-[var(--ly-t-quick)] group-hover/subtab:opacity-60 hover:!opacity-100 hover:bg-elevated"
		>
			<X size={11} strokeWidth={2.2} />
		</button>
	);
}

function Transcript({ agent, sessionId }: { agent: SubAgentSummary; sessionId: string | null }) {
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
				contentClassName="px-3 py-2"
				onScroll={follow.onScroll}
				onResize={follow.onResize}
			>
				{!messages || messages.length === 0 ? (
					<p className="px-2 py-8 text-center text-detail text-ink-faint">
						{loading || agent.status === "running" ? "刚开始，还没有输出。" : "这个子 Agent 没有留下内容。"}
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
				{agent.status === "done" && agent.answer && (
					<div className="mt-2 min-w-0 max-w-full overflow-hidden rounded-lg border border-line-soft bg-card/50 px-3 py-2">
						<p className="mb-1 text-caption text-ink-faint">回报给主 Agent</p>
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
				{agent.status === "failed" && agent.error && (
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
			{agent.status === "running" && sessionId && <Steer agent={agent} sessionId={sessionId} />}
		</>
	);
}

function Redispatch({ agent }: { agent: SubAgentSummary }) {
	const [asked, setAsked] = useState(false);
	return (
		<button
			type="button"
			disabled={asked}
			data-ly-tip="让主 Agent 重新派发一个同样的子任务"
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
						`刚才那个子任务「${agent.description}」${agent.status === "failed" ? "失败了" : "被停掉了"}，重新派发一个同样的子 agent 去做。`,
						true,
					);
				setAsked(true);
			}}
			className="mt-2 flex items-center gap-1.5 rounded-lg border border-line-soft px-2.5 py-1.5 text-detail text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink disabled:opacity-50"
		>
			<RotateCcw size={11.5} strokeWidth={1.9} />
			{asked ? "已填入输入框" : "让主 Agent 重新派发"}
		</button>
	);
}

function Header({ agent, sessionId }: { agent: SubAgentSummary; sessionId: string | null }) {
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
			<span className="shrink-0">{agent.agent}</span>
			<span className="text-line">·</span>
			<span className="shrink-0 tabular-nums">{ranFor(agent)}</span>
			{agent.toolCalls > 0 && (
				<>
					<span className="text-line">·</span>
					<span className="shrink-0 tabular-nums">{agent.toolCalls} 次调用</span>
				</>
			)}
			{/* What it has cost so far — the number that decides whether delegating this was worth it. */}
			{figuresWord(figuresOf(agent)) && (
				<>
					<span className="text-line">·</span>
					<span data-sub-figures data-ly-tip="这个子 Agent 用掉的 token 与估算费用" className="shrink-0 tabular-nums">
						{figuresWord(figuresOf(agent))}
					</span>
				</>
			)}
			{/* The newest thing it did, which is what answers "is this stuck?". */}
			{agent.status === "running" && agent.lastActivity && (
				<span className="ly-fade-tail min-w-0 flex-1 truncate text-ink-faint">{agent.lastActivity}</span>
			)}
			<span className="min-w-2 flex-1" />
			{agent.status === "running" && sessionId && (
				<button
					type="button"
					data-ly-tip="停止这个子 Agent（主 Agent 和其他子 Agent 不受影响）"
					aria-label="停止这个子 Agent"
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
 * Say something to a sub-agent that is still running.
 *
 * Designed with the exact same visual styling and interaction polish as SideComposer / ComposerShell:
 * Supports text, multi-format attachments (images, code files, logs, docs), and unified buttons.
 */
function Steer({ agent, sessionId }: { agent: SubAgentSummary; sessionId: string }) {
	const [text, setText] = useState("");
	const [attachments, setAttachments] = useState<SubAgentAttachment[]>([]);
	const [sending, setSending] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);

	const addFiles = async (fileList: FileList | null) => {
		if (!fileList || fileList.length === 0) return;
		const next: SubAgentAttachment[] = [];
		for (const file of Array.from(fileList)) {
			if (file.type.startsWith("image/")) {
				const buffer = await file.arrayBuffer();
				const base64 = bytesToBase64(new Uint8Array(buffer));
				next.push({
					id: `${Date.now()}-${Math.random()}`,
					name: file.name,
					mimeType: file.type,
					data: base64,
					isText: false,
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
					});
				} catch {
					useApp.getState().notify(`无法读取文件 ${file.name} 的内容`, "warn");
				}
			}
		}
		if (next.length > 0) {
			setAttachments((prev) => [...prev, ...next]);
		}
	};

	const send = async () => {
		const trimmed = text.trim();
		if ((!trimmed && attachments.length === 0) || sending) return;

		let finalMessage = trimmed;
		if (attachments.length > 0) {
			const textFiles = attachments.filter((a) => a.isText && a.text);
			const attachedTexts = textFiles.map((f) => `### 附件文件: ${f.name}\n\`\`\`\n${f.text}\n\`\`\``);
			if (attachedTexts.length > 0) {
				finalMessage = finalMessage
					? `${finalMessage}\n\n${attachedTexts.join("\n\n")}`
					: attachedTexts.join("\n\n");
			}
		}

		if (!finalMessage) return;

		setSending(true);
		const delivered = await bridge.subAgents.steer(sessionId, agent.id, finalMessage);
		setSending(false);
		if (delivered) {
			setText("");
			setAttachments([]);
		} else {
			useApp.getState().notify("这个子 Agent 已经结束了，消息没有送达。", "error");
		}
	};

	return (
		<div className="mx-auto w-full max-w-[var(--ly-content)] shrink-0 px-3 pt-2 pb-[15px]">
			<ComposerShell
				value={text}
				onChange={setText}
				onSubmit={() => void send()}
				disabled={sending}
				placeholder="纠偏、补充信息，或让它收尾…"
				onFiles={(files) => void addFiles(files)}
				attachments={
					attachments.length > 0 ? (
						<div className="flex flex-wrap gap-2 px-3.5 pt-3">
							{attachments.map((attachment) => (
								<div key={attachment.id} className="relative group/att">
									{attachment.isText ? (
										<div className="flex h-14 w-28 flex-col justify-between rounded-lg border border-line bg-card p-2 text-left shadow-xs">
											<div className="flex items-center gap-1 text-ink-muted">
												<FileText size={13} className="shrink-0" />
												<span className="truncate text-[11px] font-medium text-ink">{attachment.name}</span>
											</div>
											<span className="text-[9.5px] text-ink-faint">文件附件</span>
										</div>
									) : (
										<button
											type="button"
											aria-label={`预览 ${attachment.name}`}
											onClick={(event) => {
												const images = attachments
													.filter((a) => !a.isText && a.data)
													.map((a) => ({
														src: `data:${a.mimeType};base64,${a.data}`,
														alt: a.name,
													}));
												const index = attachments.filter((a) => !a.isText).findIndex((a) => a.id === attachment.id);
												const origin = event.currentTarget.getBoundingClientRect();
												openViewer(images, index, origin, event.currentTarget);
											}}
											className="block h-14 w-20 overflow-hidden rounded-lg border border-line bg-card shadow-xs transition-opacity duration-[var(--ly-t-quick)] hover:opacity-85"
										>
											<img
												src={`data:${attachment.mimeType};base64,${attachment.data}`}
												alt={attachment.name}
												className="h-full w-full object-cover"
											/>
										</button>
									)}
									<button
										type="button"
										onClick={() => setAttachments((prev) => prev.filter((a) => a.id !== attachment.id))}
										className="absolute -top-1.5 -right-1.5 flex h-4.5 w-4.5 items-center justify-center rounded-full border border-line bg-float text-ink-muted transition-colors hover:text-ink"
									>
										<X size={10} strokeWidth={2.2} />
									</button>
								</div>
							))}
						</div>
					) : undefined
				}
				left={
					<>
						<button
							type="button"
							data-ly-tip="添加附件文件或图片"
							aria-label="添加附件文件或图片"
							onClick={() => fileInputRef.current?.click()}
							className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-card-hover hover:text-ink"
						>
							<Plus size={16} strokeWidth={1.9} />
						</button>
						<input
							ref={fileInputRef}
							type="file"
							multiple
							hidden
							onChange={(e) => {
								void addFiles(e.target.files);
								e.target.value = "";
							}}
						/>
						<span className="flex h-7 min-w-0 items-center gap-1.5 px-2 text-caption text-ink-faint">
							<span className={`size-[5px] shrink-0 rounded-full ${statusTone(agent.status)}`} />
							<span className="truncate">定向纠偏</span>
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
