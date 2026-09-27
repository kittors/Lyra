/**
 * The same surface as the main composer, at panel scale.
 *
 * Not the main `Composer` component itself: that one sends to the active session, carries the
 * project and branch chips, and takes image attachments. None of that applies here — this
 * conversation has no project of its own and cannot act on one.
 */

import { useI18n } from "../../i18n/index.ts";
import type { UserContent } from "@lyra/core";
import { Plus } from "lucide-react";
import { useEffect, useRef } from "react";
import { findModel } from "../models/index.ts";
import { useSide, sideChatOf, openScopedPanel } from "../dock/index.ts";
import { useSideSessionId } from "./scope.ts";
import { useDockScope, useScopedMeta } from "../../app/session-scope.tsx";
import { useApp } from "../../store/index.ts";
import { sessionThinking } from "../../lib/thinking.ts";
import { useOpenFile } from "../../store/openFile.ts";
import { companionOf } from "../dock/index.ts";
import {
	ComposerSend,
	ComposerShell,
	attachmentMeta,
	spellDraft,
	type DraftAttachment,
	type OutgoingMeta,
	QueueList,
	queuePreview,
	queueThumbnail,
	useComposerAttachments,
	useDraft,
	useInputHistory,
} from "../composer/index.ts";
import { EffortTrigger, ModelTrigger } from "../models/index.ts";

export function SideComposer({
	running,
	disabled,
	onSend,
	onStop,
}: {
	running: boolean;
	/** No session to be beside; the field stays visible but inert rather than vanishing. */
	disabled?: boolean;
	onSend: (content: UserContent[], meta: OutgoingMeta) => void;
	onStop: () => void;
}) {
	const { t } = useI18n();
	const settings = useApp((s) => s.settings);
	/*
	 * The conversation this side chat is beside, which is what 「跟随主会话」 follows.
	 *
	 * Not the live slot's `meta`: that is the focused screen's, and under another screen it named the
	 * focused conversation's model and effort as the ones the next question would use. The request
	 * itself was always right — the main process reads the side chat's own conversation.
	 */
	const meta = useScopedMeta();
	const sessionId = useSideSessionId();
	// The screen this side chat is docked in, where a file marked here opens — not the one with focus.
	const screen = useDockScope();
	/** 标记点开的文件进右边的文件面板——和主输入框同一个去处，开在这一屏。 */
	const openFile = (path: string, name: string) => {
		void useOpenFile.getState().open({ path, name, isDirectory: false, size: 0 });
		openScopedPanel("file", companionOf("file"), screen ?? undefined);
	};
	const modelId = useSide((s) => sideChatOf(s, sessionId).modelId);
	const loading = useSide((s) => sideChatOf(s, sessionId).loading);
	const thinking = useSide((s) => sideChatOf(s, sessionId).thinking);
	const messages = useSide((s) => sideChatOf(s, sessionId).messages);
	const queued = useSide((s) => sideChatOf(s, sessionId).queued);
	/*
	 * 草稿按会话存，和主输入框同一个仓库——面板关了、换个会话再回来，打了一半的话还在。
	 * 从前它是这个组件自己的 state，面板一关就没了。
	 */
	const { text, setText, attachments, setAttachments, clear } = useDraft<DraftAttachment>(sessionId ? `side:${sessionId}` : null);
	const field = useRef<HTMLTextAreaElement>(null);
	/*
	 * 收附件的那一整套，和主输入框是同一份：八个的上限、PDF 抽字、上方只摆图片（文件在句子里那枚
	 * 标记上）、右键标记弹出同一份菜单。见 `useComposerAttachments`。
	 */
	const kit = useComposerAttachments<DraftAttachment>({ text, attachments, setAttachments, setText, field, openFile, thumbnail: 56 });
	const { marks } = kit;
	/* 方向键往回翻自己在这个侧边聊天里问过的话——和主输入框同一套手感。 */
	const history = useInputHistory({
		messages,
		value: text,
		attachments,
		onPick: (next, files) => {
			setText(next);
			setAttachments(files as DraftAttachment[]);
		},
		field,
		resetKey: sessionId ?? "",
	});

	/*
	 * Text handed back by withdrawing a task.
	 *
	 * Withdrawing is nearly always "not like that" rather than "never mind", so the wording comes
	 * back here to be edited and sent again instead of being thrown away. Appended rather than
	 * substituted when something is already half-typed: losing what you were writing to recover
	 * something you asked for is a bad trade.
	 */
	const draftSeed = useSide((s) => sideChatOf(s, sessionId).draftSeed);
	useEffect(() => {
		if (!draftSeed) return;
		setText((was) => (was.trim() ? `${was.replace(/\s+$/, "")}\n${draftSeed.text}` : draftSeed.text));
		useSide.getState().clearDraftSeed(sessionId);
	}, [draftSeed, sessionId, setText]);

	const empty = !text.trim() && attachments.length === 0;

	function submit() {
		const trimmed = text.trim();
		if (empty || disabled) return;
		/*
		 * 和主输入框同一段：附件按标记在句子里的先后排，每份自带「第几张、共几张」。再交一份给人看的：
		 * 人打的那些字（`【图片 1】` 这样的标记留着），和附件的名字门类——没有这一份，气泡里摆的是
		 * 写给模型的 `### Attached file: …`。
		 */
		const content = spellDraft(trimmed, attachments);
		const sent = { displayText: trimmed, attachments: attachmentMeta(attachments) };
		/*
		 * 正在答的时候，排到后面，而不是什么都不发生。
		 *
		 * 从前这里直接 return：字留在框里，没有一句话说为什么，看着像回车键坏了。现在和主输入框一样
		 * 排在输入框上方那条上，这一轮答完自己发出去；条上改得了、删得掉、排得出先后。队里还压着
		 * 别的时候也排——不然新说的这句会越过前面那几句先到。
		 */
		if (running || queued.length > 0) {
			const composed = { text: trimmed, attachments, sessionRefs: [] };
			const thumbnail = queueThumbnail(composed);
			useSide.getState().enqueue(sessionId, {
				content,
				displayText: sent.displayText,
				...(sent.attachments.length ? { attachments: sent.attachments } : {}),
				draft: { text: trimmed, attachments, sessionRefs: [] },
				preview: queuePreview(composed),
				...(thumbnail ? { thumbnail } : {}),
			});
			clear();
			return;
		}
		clear();
		onSend(content, sent);
	}

	/** 排着的那一条退回来：整份草稿——字和附件——接在框里已有的后面。 */
	const restoreQueued = (entry: { draft: { text: string; attachments: unknown[] } }) => {
		setText((current) => (current.trim() ? `${current.trimEnd()}\n\n${entry.draft.text}` : entry.draft.text));
		setAttachments((current) => [...current, ...(entry.draft.attachments as DraftAttachment[])]);
		const el = field.current;
		if (!el) return;
		el.focus();
		requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
	};

	// Inheritance stays a policy; the trigger names the model used by the next request.
	const model = findModel(settings, meta?.modelId ?? settings?.defaultModelId ?? null);
	const modelName = model?.name ?? null;

	/*
	 * `.ly-composer-pad` uses the same `--ly-composer-out` gutter as the main dock,
	 * minus `--ly-pane-chrome` on the bottom so the two cards share one window line.
	 */
	return (
		// Same cap as the transcript above it, so the field stays under the messages it answers.
		<div className="ly-composer-pad mx-auto w-full max-w-[var(--ly-content)] shrink-0">
			{sessionId && (
				<QueueList
					source={{
						items: queued,
						drop: (id) => useSide.getState().dropQueued(sessionId, id),
						move: (id, targetId, placement) => void useSide.getState().moveQueued(sessionId, id, targetId, placement),
					}}
					running={running}
					onEdit={restoreQueued}
				/>
			)}
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
				onSubmit={submit}
				disabled={disabled}
				placeholder={t(disabled ? "sideChat.noSession" : "sideChat.placeholder")}
				onFiles={(picked) => void kit.addFiles(picked)}
				attachments={
					/*
					 * 和主输入框同一排：只有图片，文件在句子里那枚标记上。只在真有图时展开，不然贴进来一个
					 * 文件，输入框上沿平白高出一道空的内衬。
					 */
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
					</>
				}
				right={
					<>
						{/*
						 * 和主输入框同一枚，不是一个长得像它的。继承没被藏起来，只是挪进了提示里——见 `inheriting`。
						 */}
						<ModelTrigger
							modelId={modelId || model?.id}
							ariaLabel={t("sideChat.model")}
							inheriting={modelId ? undefined : t("sideChat.followMainLong")}
							disabled={disabled || loading}
							selection={{
								value: modelId ?? "",
								inheritLabel: t("sideChat.followMainLong"),
								inheritDetail: modelName ?? t("sideChat.noModel"),
								onChange: (value) => {
									void useSide.getState().setModel(sessionId, value || null);
								},
							}}
						/>
						{/*
						 * 想多久，也是这一条消息的属性。不选就还是跟着主会话走，也就是从前的行为。
						 */}
						<EffortTrigger
							modelId={modelId || model?.id}
							disabled={disabled || loading}
							selection={{
								modelId: modelId || model?.id,
								value: thinking ?? sessionThinking(meta, settings),
								onChange: (level) => useSide.getState().setThinking(sessionId, level),
							}}
						/>
						{/* 正在答的时候按下去是排队，所以它说的也不再是「发送」——和主输入框同一个说法。 */}
						<div className="ly-queue-send" data-visible={running && !empty} inert={!running || empty}>
							<div>
								<ComposerSend running={false} active={running && !empty} disabled={!running || empty} tip={t("composer.queueWaiting")} onSend={submit} onStop={onStop} />
							</div>
						</div>
						<ComposerSend running={running} disabled={empty || disabled} onSend={submit} onStop={onStop} />
					</>
				}
			/>
			{kit.menu}
		</div>
	);
}
