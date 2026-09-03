/**
 * The same surface as the main composer, at panel scale.
 *
 * Not the main `Composer` component itself: that one sends to the active session, carries the
 * project and branch chips, and takes image attachments. None of that applies here — this
 * conversation has no project of its own and cannot act on one.
 */

import type { UserContent } from "@lyra/core";
import { FileText, Plus, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { findModel } from "../models/index.ts";
import { useSide } from "../dock/index.ts";
import { useApp } from "../../store/index.ts";
import { openViewer } from "../image/index.ts";
import { ComposerSend, ComposerShell } from "../composer/index.ts";
import { ModelIcon } from "../models/index.ts";

interface SideAttachment {
	id: string;
	name: string;
	mimeType: string;
	data?: string;
	text?: string;
	isText: boolean;
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
	const settings = useApp((s) => s.settings);
	const meta = useApp((s) => s.meta);
	const [text, setText] = useState("");
	const [attachments, setAttachments] = useState<SideAttachment[]>([]);
	const fileInputRef = useRef<HTMLInputElement>(null);

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

	const addFiles = async (fileList: FileList | null) => {
		if (!fileList || fileList.length === 0) return;
		const next: SideAttachment[] = [];
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

	function submit() {
		const trimmed = text.trim();
		if ((!trimmed && attachments.length === 0) || running || disabled) return;

		let finalMessage = trimmed;
		const textFiles = attachments.filter((a) => a.isText && a.text);
		if (textFiles.length > 0) {
			const attachedTexts = textFiles.map((f) => `### 附件文件: ${f.name}\n\`\`\`\n${f.text}\n\`\`\``);
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

	// Stated, not offered. The side chat runs on whatever the main session runs on.
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
				placeholder={disabled ? "还没有可以聊的会话" : "问点关于这个会话的事"}
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
						<span
							data-ly-tip={modelName ? `跟随主会话：${modelName}` : undefined}
							className="flex h-7 min-w-0 items-center gap-1.5 px-2 text-label text-ink-faint"
						>
							<ModelIcon model={model?.modelId} name={modelName} />
							<span className="min-w-0 truncate">{modelName ?? "未配置模型"}</span>
						</span>
					</>
				}
				right={
					<>
						{onReset && !running && (
							<button
								type="button"
								data-ly-tip="新的侧边聊天"
								aria-label="新的侧边聊天"
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
