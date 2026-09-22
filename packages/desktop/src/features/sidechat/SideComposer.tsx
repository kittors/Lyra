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
import { useEffect, useMemo, useRef, useState } from "react";
import { findModel } from "../models/index.ts";
import { useSide, sideChatOf, openScopedPanel } from "../dock/index.ts";
import { useSideSessionId } from "./scope.ts";
import { useApp } from "../../store/index.ts";
import { sessionThinking } from "../../lib/thinking.ts";
import { openFromEvent } from "../image/index.ts";
import { scanPlaceholders } from "../../lib/attachment-placeholders.ts";
import { openViewer } from "../image/index.ts";
import { useOpenFile } from "../../store/openFile.ts";
import { companionOf } from "../dock/index.ts";
import {
	AttachmentStrip,
	ComposerSend,
	ComposerShell,
	fileKind,
	type FileKind,
	KIND_LABEL,
	attachmentMeta,
	spellDraft,
	type OutgoingMeta,
	useAttachmentMarks,
	pickedFrom,
	type PickedFile,
	type StripFile,
	useAttachmentActions,
} from "../composer/index.ts";
import { EffortTrigger, ModelTrigger } from "../models/index.ts";

interface SideAttachment {
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
	const meta = useApp((s) => s.meta);
	const sessionId = useSideSessionId();
	const modelId = useSide((s) => sideChatOf(s, sessionId).modelId);
	const loading = useSide((s) => sideChatOf(s, sessionId).loading);
	const thinking = useSide((s) => sideChatOf(s, sessionId).thinking);
	const [text, setText] = useState("");
	const [attachments, setAttachments] = useState<SideAttachment[]>([]);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const field = useRef<HTMLTextAreaElement>(null);
	const attachmentActions = useAttachmentActions();
	/*
	 * 正文里那枚标记，和主输入框是同一套。
	 *
	 * 这个输入框从前收得下文件，句子里却什么也没有：附件一律「图片在前、文本缀在后」地送出去，于是
	 * 「照着第二张图改」这种再普通不过的话，模型只能猜是哪一张。
	 */
	const marks = useAttachmentMarks<SideAttachment>({ attachments, setAttachments, setText, field });

	const previewable = useMemo(
		() => attachments.filter((a) => !a.isText && a.data),
		[attachments],
	);

	const previewImage = (target: SideAttachment, originRect?: DOMRect) => {
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
	}, [draftSeed, sessionId]);

	const addFiles = async (picked: PickedFile[]) => {
		if (picked.length === 0) return;
		// 读文件之前记下来：读一份大文件要几百毫秒，那期间光标早就不在原地了。
		const caret = field.current?.selectionStart ?? text.length;
		const next: SideAttachment[] = [];
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

	function submit() {
		const trimmed = text.trim();
		if ((!trimmed && attachments.length === 0) || running || disabled) return;
		/*
		 * 和主输入框同一段：附件按标记在句子里的先后排，每份自带「第几张、共几张」。
		 *
		 * 这里从前是自己拼的——图片一律排最前，文本附件一律缀在最后，而且什么标签都不带。那正是这套
		 * 记号当初要治的毛病：三张截图送过去，模型看到的是三团分不出先后的像素。
		 */
		const content = spellDraft(trimmed, attachments);
		/*
		 * 再交一份给人看的：人打的那些字（`【图片 1】` 这样的标记留着），和附件的名字门类。
		 *
		 * 没有这一份的时候，面板只能把所有文本块拼起来画——于是 `### Attached file: image.png`
		 * 这种写给模型的记号原样出现在气泡里，而同一条消息在主会话里画的是一枚胶囊。
		 */
		const meta = { displayText: trimmed, attachments: attachmentMeta(attachments) };
		setText("");
		setAttachments([]);
		onSend(content, meta);
	}

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
							mimeType: hit.file.mimeType,
							isImage: !hit.file.isText && Boolean(hit.file.data),
							onPreviewImage: (originRect?: DOMRect) => previewImage(hit.file, originRect),
							onOpenFile: (path: string, name: string) => {
								void useOpenFile.getState().open({ path, name, isDirectory: false, size: 0 });
								openScopedPanel("file", companionOf("file"));
							},
						},
						rect,
					);
				}}
				decoration={{ attachments: marks.decorationFor(text) }}
				onSubmit={submit}
				disabled={disabled}
				placeholder={t(disabled ? "sideChat.noSession" : "sideChat.placeholder")}
				onFiles={(picked) => void addFiles(picked)}
				attachments={
					/*
					 * 和主输入框、和气泡外面，是同一排东西。
					 *
					 * 这里从前自己画了一份：14px 高的卡片、20px 宽的缩略图、常驻的叉、一行「文件附件」。
					 * 于是同一份 PDF 在应用里有四种长相（主输入框、气泡、这儿、子智能体那儿），而它们
					 * 说的是同一件事。四份实现也意味着新增的能力只会长在其中一份上——打开、指出位置、
					 * 复制路径，这一份一样都没有。
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
					</>
				}
				right={
					<>
						{/*
						 * 和主输入框同一枚，不是一个长得像它的。
						 *
						 * 这里从前用的是设置页那个 `ModelSelect`：描了边、按输入框高度做的表单控件，外加一句
						 * 「随主会话」。摆进这一行，就成了在输入框的边框里面再画一个框；而那句话说的是配置，
						 * 不是正在写的这条消息。两样东西，全应用只有这一个输入框上有。
						 *
						 * 继承没被藏起来，只是挪进了提示里——见 `inheriting`。
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
						 * 想多久，也是这一条消息的属性。
						 *
						 * 侧边聊天此前只能挑模型，等级一律跟着主会话——而它本来就是另一个对话，模型
						 * 都能单独挑，想多久却挑不了。`sidechat.ts` 的 `ask` 一直收这个参数，缺的只是
						 * 界面和中间那几层。不选就还是跟着主会话走，也就是从前的行为。
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
						<ComposerSend
							running={running}
							disabled={(!text.trim() && attachments.length === 0) || disabled}
							onSend={submit}
							onStop={onStop}
						/>
					</>
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
