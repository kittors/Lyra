/**
 * The Git panel types into the same field the conversation does.
 *
 * No second shell, no second send button. `ComposerShell` and `ComposerSend` are the surface;
 * this file only fills the slots that are actually about committing: the wand, the language,
 * and where send goes.
 */

import { Check, Languages, Wand2 } from "lucide-react";
import { useState } from "react";
import { useApp } from "../../store.ts";
import { ComposerSend, ComposerShell } from "../ComposerShell.tsx";
import { Spinner } from "../../ui/motion/loaders.tsx";
import { MenuBody, MenuItem, Popover, usePopover } from "../../ui/overlay/Popover.tsx";
import { bridge } from "../../services/index.ts";
import {
	COMMIT_LANGUAGES,
	commitLanguageLabel,
	resolveCommitLanguage,
} from "./commit-language.ts";

export function CommitComposer({
	cwd,
	stagedCount,
	busy,
	disabled,
	onCommit,
}: {
	cwd: string;
	stagedCount: number;
	busy: boolean;
	disabled: boolean;
	onCommit: (message: string) => Promise<boolean>;
}) {
	const [message, setMessage] = useState("");
	const [generating, setGenerating] = useState(false);
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);
	const notify = useApp((s) => s.notify);
	const languageMenu = usePopover();
	const language = resolveCommitLanguage(settings?.commitLanguage);

	async function generate() {
		if (generating || disabled) return;
		setGenerating(true);
		try {
			const result = await bridge.git.generateCommitMessage(cwd);
			if (!result.ok || !result.message) {
				notify(result.error ?? "生成提交说明失败", "error");
				return;
			}
			setMessage(result.message);
		} finally {
			setGenerating(false);
		}
	}

	async function commit() {
		const trimmed = message.trim();
		if (busy || generating || stagedCount === 0 || !trimmed) return;
		const ok = await onCommit(trimmed);
		if (ok) setMessage("");
	}

	function setLanguage(id: string) {
		if (!settings) return;
		void saveSettings({ ...settings, commitLanguage: id });
		languageMenu.close();
	}

	return (
		<div className="mx-auto w-full max-w-[var(--ly-content)] shrink-0 px-3 pt-2 pb-[15px]">
			<ComposerShell
				value={message}
				onChange={setMessage}
				onSubmit={() => void commit()}
				placeholder="输入提交信息…"
				left={
					<>
						<button
							type="button"
							data-ly-tip={generating ? "正在生成提交说明…" : "用当前模型写提交说明"}
							data-ly-tip-side="top"
							aria-label={generating ? "正在生成提交说明…" : "用当前模型写提交说明"}
							disabled={generating || disabled}
							onClick={() => void generate()}
							className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-card-hover hover:text-ink disabled:opacity-40"
						>
							{generating ? <Spinner size={15} /> : <Wand2 size={16} strokeWidth={1.9} />}
						</button>
						<button
							type="button"
							data-ly-tip={`提交说明语言：${commitLanguageLabel(language)}`}
							data-ly-tip-side="top"
							aria-label={`提交说明语言：${commitLanguageLabel(language)}`}
							aria-haspopup="menu"
							aria-expanded={languageMenu.open}
							onClick={languageMenu.toggle}
							className={`flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 text-label transition-colors ${
								languageMenu.open ? "bg-card-hover text-ink" : "text-ink-muted hover:bg-card-hover hover:text-ink"
							}`}
						>
							<Languages size={13} strokeWidth={1.8} />
							<span className="min-w-0 truncate">{commitLanguageLabel(language)}</span>
						</button>
						{languageMenu.open && (
							<Popover
								anchor={languageMenu.anchor}
								onClose={languageMenu.close}
								placement="top"
								align="start"
								width="compact"
								label="提交说明语言"
							>
								<MenuBody>
									{COMMIT_LANGUAGES.map((entry) => (
										<MenuItem
											key={entry.id}
											selected={entry.id === language}
											trailing={
												entry.id === language ? (
													<Check size={13} strokeWidth={2.2} className="shrink-0 text-ink" />
												) : undefined
											}
											onClick={() => setLanguage(entry.id)}
										>
											{entry.native}
										</MenuItem>
									))}
								</MenuBody>
							</Popover>
						)}
					</>
				}
				right={
					<ComposerSend
						running={false}
						disabled={busy || generating || stagedCount === 0 || !message.trim()}
						tip="提交"
						onSend={() => void commit()}
						onStop={() => {}}
					/>
				}
			/>
		</div>
	);
}
