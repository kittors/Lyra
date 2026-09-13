/**
 * The same surface as the main composer, at panel scale.
 *
 * Not the main `Composer` component itself: that one sends to the active session, carries the
 * project and branch chips, and takes image attachments. None of that applies here — this
 * conversation has no project of its own and cannot act on one.
 */

import { useI18n } from "../../i18n/index.ts";
import type { UserContent } from "@lyra/core";
import { Plus, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { findModel } from "../models/index.ts";
import { useSide } from "../dock/index.ts";
import { useApp } from "../../store/index.ts";
import { openFromEvent } from "../image/index.ts";
import {
	AttachmentStrip,
	ComposerSend,
	ComposerShell,
	fileKind,
	KIND_LABEL,
	pickedFrom,
	type PickedFile,
	type StripFile,
} from "../composer/index.ts";
import { ModelSelect } from "../models/index.ts";

interface SideAttachment {
	id: string;
	name: string;
	mimeType: string;
	data?: string;
	text?: string;
	isText: boolean;
	/** 磁盘上的位置，来自一个文件的话——「打开」和「在访达中显示」靠它。 */
	path?: string;
}

export function SideComposer({
	running,
	disabled,
	onSend,
	onStop,
	onReset,
}: {
	running: boolean;
	/** No session to be beside; the field stays visible but inert rather than vanishing. */
	disabled?: boolean;
	onSend: (content: UserContent[]) => void;
	onStop: () => void;
	onReset?: () => void;
}) {
	const { t } = useI18n();
	const settings = useApp((s) => s.settings);
	const meta = useApp((s) => s.meta);
	const modelId = useSide((s) => s.modelId);
	const loading = useSide((s) => s.loading);
	const [text, setText] = useState("");
	const [attachments, setAttachments] = useState<SideAttachment[]>([]);
	const fileInputRef = useRef<HTMLInputElement>(null);

	/** 这一排要画的东西，和主输入框那一排是同一种形状——见 `AttachmentStrip`。 */
	const strip: StripFile[] = useMemo(
		() =>
			attachments.map((attachment) => {
				const kind = fileKind(attachment.name, attachment.mimeType);
				return {
					key: attachment.id,
					name: attachment.name,
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
	const draftSeed = useSide((s) => s.draftSeed);
	useEffect(() => {
		if (!draftSeed) return;
		setText((was) => (was.trim() ? `${was.replace(/\s+$/, "")}\n${draftSeed.text}` : draftSeed.text));
		useSide.getState().clearDraftSeed();
	}, [draftSeed]);

	const addFiles = async (picked: PickedFile[]) => {
		if (picked.length === 0) return;
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
		if (next.length > 0) {
			setAttachments((prev) => [...prev, ...next]);
		}
	};

	function submit() {
		const trimmed = text.trim();
		if ((!trimmed && attachments.length === 0) || running || disabled) return;

		let finalMessage = trimmed;
		const textFiles = attachments.filter((a) => a.isText && a.text);
		if (textFiles.length > 0) {
			// Written for the model that reads it, so it stays in English whatever the window is set to.
			const attachedTexts = textFiles.map((f) => `### Attached file: ${f.name}\n\`\`\`\n${f.text}\n\`\`\``);
			finalMessage = finalMessage
				? `${finalMessage}\n\n${attachedTexts.join("\n\n")}`
				: attachedTexts.join("\n\n");
		}

		const images = attachments
			.filter((a) => !a.isText && a.data)
			.map((a): UserContent => ({ type: "image", data: a.data!, mimeType: a.mimeType }));

		const content: UserContent[] = [
			...images,
			...(finalMessage ? [{ type: "text" as const, text: finalMessage }] : []),
		];

		setText("");
		setAttachments([]);
		onSend(content);
	}

	// Inheritance stays a policy; the trigger names the model used by the next request.
	const model = findModel(settings, meta?.modelId ?? settings?.defaultModelId ?? null);
	const modelName = model?.name ?? null;

	/*
	 * 15, because of what sits below it: the panel's 4px inset plus its 1px card border. The
	 * main composer rests 20px off the window's bottom edge, and 15 + 1 + 4 lands on the same
	 * line — which is what stops the two fields looking a pixel out of step side by side.
	 */
	return (
		// Same cap as the transcript above it, so the field stays under the messages it answers.
		<div className="mx-auto w-full max-w-[var(--ly-content)] shrink-0 px-3 pt-2 pb-[15px]">
			<ComposerShell
				value={text}
				onChange={setText}
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
						<div className="px-3.5 pt-3">
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
								onRemove={(file) => setAttachments((prev) => prev.filter((a) => a.id !== file.key))}
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
								void addFiles(pickedFrom(e.target.files));
								e.target.value = "";
							}}
						/>
						<ModelSelect ariaLabel={t("sideChat.model")} value={modelId ?? ""} inheritedModelId={model?.id} inheritedSource={t("sideChat.followMain")} inheritLabel={t("sideChat.followMainLong")} inheritDetail={modelName ?? t("sideChat.noModel")}
							disabled={disabled || loading} onChange={(value) => { void useSide.getState().setModel(value || null); }} />
					</>
				}
				right={
					<>
						{onReset && !running && (
							<button
								type="button"
								data-ly-tip={t("sideChat.new")}
								aria-label={t("sideChat.new")}
								onClick={onReset}
								className="mr-1.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink"
							>
								<RotateCcw size={13.5} strokeWidth={1.9} />
							</button>
						)}
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
