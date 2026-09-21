/**
 * Personalization settings: custom global instructions, local persistent memory management, and tone.
 */

import { useI18n } from "../../i18n/index.ts";
import { TextArea } from "../../ui/inputs/TextArea.tsx";
import { useCallback, useEffect, useState } from "react";
import { Brain, Check, Info, Plus, Save, Trash2 } from "lucide-react";
import { useApp } from "../../store/index.ts";
import { Card, InlineSelect, PrimaryButton, Row, SectionTitle, TextInput, Toggle } from "./controls.tsx";
import { DialogAction } from "../../ui/overlay/Dialog.tsx";
import { bridge } from "../../services/index.ts";
import { MemoryMeta, type MemorySource } from "./MemoryMeta.tsx";
import { SidebarMotto } from "./SidebarMotto.tsx";

export function PersonalizationSettings() {
	const { t } = useI18n();
	const settings = useApp((s) => s.settings);
	const saveSettings = useApp((s) => s.saveSettings);

	const personalization = settings?.personalization ?? {
		customInstructions: "",
		enableMemory: true,
		enableToolAssistedMemory: true,
		tone: "friendly",
	};

	const [customInstructions, setCustomInstructions] = useState(personalization.customInstructions ?? "");
	const [savedNotice, setSavedNotice] = useState(false);
	const [memoryEntries, setMemoryEntries] = useState<{ id: string; content: string; createdAt: number; source?: MemorySource; lastInjectedAt?: number }[]>([]);
	/*
	 * This project's memory, beside the user's own.
	 *
	 * Two stores, two scopes: the user's preferences follow the person, the lessons and the
	 * extracted file follow the repository. Shown together because the question is the same for
	 * both — what does the model know about me, and is it actually reaching it.
	 */
	const workspace = useApp((s) => s.workspace);
	const [projectMemory, setProjectMemory] = useState<Awaited<ReturnType<typeof bridge.projectMemory.list>> | null>(null);
	const [newMemory, setNewMemory] = useState("");
	const [loadingMemory, setLoadingMemory] = useState(false);

	const loadMemories = async () => {
		try {
			setLoadingMemory(true);
			const res = await bridge.memory.load();
			setMemoryEntries(res.entries ?? []);
		} catch {
			// silent fallback
		} finally {
			setLoadingMemory(false);
		}
	};

	useEffect(() => {
		void loadMemories();
	}, []);

	const loadProjectMemory = useCallback(() => {
		if (!workspace?.path) return;
		void bridge.projectMemory.list(workspace.path).then(setProjectMemory).catch(() => setProjectMemory(null));
	}, [workspace?.path]);

	useEffect(() => {
		loadProjectMemory();
	}, [loadProjectMemory]);

	/*
	 * 删完重读，而不是就地把那一条从数组里抠掉。
	 *
	 * 磁盘上的文件才是这份清单的本体，而它不止这一个窗口在写——后台抽取也在写。就地改状态会让
	 * 界面和文件各说各话，直到下次切换项目。重读一次是一次本地文件读取，便宜得多。
	 */
	const forgetLesson = async (at: number) => {
		if (!workspace?.path) return;
		await bridge.projectMemory.forget(workspace.path, at);
		loadProjectMemory();
	};

	const forgetExtracted = async () => {
		if (!workspace?.path) return;
		await bridge.projectMemory.forgetExtracted(workspace.path);
		loadProjectMemory();
	};

	const forgetAllProjectMemory = async () => {
		if (!workspace?.path) return;
		// 不可撤销，而且删的是模型往后再也读不到的东西——先问一句。用的是这个文件既有的那种问法（见上面清空用户记忆处）。
		if (!confirm(t("memory.confirmForgetAllProject"))) return;
		await bridge.projectMemory.forgetAll(workspace.path);
		loadProjectMemory();
	};

	const handleSaveInstructions = async () => {
		if (!settings) return;
		await saveSettings({
			...settings,
			personalization: {
				...personalization,
				customInstructions,
			},
		});
		setSavedNotice(true);
		setTimeout(() => setSavedNotice(false), 2000);
	};

	const handleToggleEnableMemory = async (checked: boolean) => {
		if (!settings) return;
		await saveSettings({
			...settings,
			personalization: {
				...personalization,
				enableMemory: checked,
				// Preserve the effective legacy value before changing the personal switch.
				enableProjectMemory: (personalization.enableProjectMemory ?? personalization.enableMemory) !== false,
			},
		});
	};

	const handleToggleToolMemory = async (checked: boolean) => {
		if (!settings) return;
		await saveSettings({
			...settings,
			personalization: {
				...personalization,
				enableToolAssistedMemory: checked,
			},
		});
	};

	/*
	 * 后台抽取的开关，跟上面两个不是一回事。
	 *
	 * 上面两个管的是「这台电脑上的个人偏好」，存在本地、也只在本地用；这个管的是「读这个项目的
	 * 历史会话、把内容发给模型」，所以它默认是关的，而且第一次触发时会先问。
	 *
	 * 在这里动一下，也算回答过那次征询——写下的是 `true`/`false`，不再是「没问过」。
	 */
	const handleToggleExtraction = async (checked: boolean) => {
		if (!settings) return;
		await saveSettings({ ...settings, memoryExtraction: checked });
	};

	const handleToneChange = async (tone: "friendly" | "professional" | "concise" | "candid" | "humorous") => {
		if (!settings) return;
		await saveSettings({
			...settings,
			personalization: {
				...personalization,
				tone,
			},
		});
	};

	const handleAddMemory = async () => {
		if (!newMemory.trim()) return;
		try {
			const entry = await bridge.memory.add(newMemory.trim());
			setMemoryEntries((prev) => [entry, ...prev]);
			setNewMemory("");
		} catch {
			// ignore
		}
	};

	const handleDeleteMemory = async (id: string) => {
		try {
			await bridge.memory.remove(id);
			setMemoryEntries((prev) => prev.filter((m) => m.id !== id));
		} catch {
			// ignore
		}
	};

	const handleClearAllMemory = async () => {
		if (!confirm(t("memory.confirmClear"))) return;
		try {
			await bridge.memory.clear();
			setMemoryEntries([]);
		} catch {
			// ignore
		}
	};

	return (
		<div className="space-y-6">
			<SidebarMotto />
			{/* Custom Instructions */}
			<div>
				<div className="mb-2 flex items-center justify-between">
					<div>
						<SectionTitle>{t("tone.customInstructions")}</SectionTitle>
						<p className="text-caption text-ink-muted mt-0.5">
							{t("personalization.globalRules")}
						</p>
					</div>
					{/*
					 * 存完那一下变绿，不再多写一个「已保存」。
					 *
					 * 原来是同一颗按钮上换一句话，而那句话本身是短暂的——过一会儿又变回「保存」。
					 * 勾加绿色说的是同一件事，且按钮不必跟着两句话的长短宽一次窄一次。
					 */}
					<DialogAction
						onClick={handleSaveInstructions}
						disabled={customInstructions === (personalization.customInstructions ?? "")}
						label={savedNotice ? t("common.saved") : t("common.save")}
					>
						{savedNotice ? <Check size={13} className="text-emerald-500" strokeWidth={2.2} aria-hidden /> : <Save size={13} strokeWidth={1.9} aria-hidden />}
						{savedNotice ? t("common.saved") : t("common.save")}
					</DialogAction>
				</div>

				<Card className="p-3.5 space-y-2">
					<TextArea
						value={customInstructions}
						onChange={setCustomInstructions}
						placeholder={t("tone.sampleRules")}
						rows={7}
						className="ly-textarea-mono"
					/>
					<div className="flex items-center gap-1.5 text-micro text-ink-faint px-1">
						<Info size={12} strokeWidth={1.8} />
						<span>{t("tone.customDetail")}</span>
					</div>
				</Card>
			</div>

			{/* Memory Management */}
			<div>
				<div className="mb-2 flex items-center justify-between">
					<div>
						<SectionTitle>{t("memory.title")}</SectionTitle>
						<p className="text-caption text-ink-muted mt-0.5">
							{t("personalization.memoryIntro")}
						</p>
					</div>
					{memoryEntries.length > 0 && (
						<button
							type="button"
							onClick={handleClearAllMemory}
							className="rounded-lg px-2.5 py-1 text-caption text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"

							data-ly-tip={t("personalization.clearMemory")}
							aria-label={t("personalization.clearMemory")}>
							<Trash2 size={13} strokeWidth={1.8} />
						</button>
					)}
				</div>

				<Card>
					<Row
						title={t("memory.user")}
						detail={t("memory.userDetail")}
						control={
							<Toggle
								checked={personalization.enableMemory !== false}
								onChange={handleToggleEnableMemory}
							/>
						}
					/>
					<Row
						title={t("memory.fromTools")}
						detail={t("memory.fromToolsDetail")}
						control={
							<Toggle
								checked={personalization.enableToolAssistedMemory !== false}
								onChange={handleToggleToolMemory}
							/>
						}
					/>
					{/*
					 * 说清楚代价，因为这一条跟上面两条不同：它要把对话内容发出去。
					 *
					 * 上面两条都只在本机沉淀偏好；这一条是空闲时读最近几次会话、交给模型提炼这个仓库的
					 * 约定。一个默认只在本地跑的工具，在这件事上必须把话说在开关旁边，而不是只在
					 * 第一次弹窗里说一次。
					 */}
					<Row
						title={t("memory.project")}
						detail={t("memory.projectDetail")}
						control={<Toggle checked={(personalization.enableProjectMemory ?? personalization.enableMemory) !== false} onChange={(checked) => { if (settings) void saveSettings({ ...settings, personalization: { ...personalization, enableProjectMemory: checked } }); }} />}
					/>
					<Row
						title={t("memory.autoProject")}
						detail={t("memory.autoProjectDetail")}
						control={<Toggle checked={settings?.memoryExtraction === true} onChange={handleToggleExtraction} />}
					/>
				</Card>

				{/* Memory Items List */}
				{personalization.enableMemory !== false && (
					<div className="mt-3 space-y-2">
						<div className="flex items-center gap-2">
							<TextInput
								type="text"
								value={newMemory}
								onChange={setNewMemory}
								onKeyDown={(e) => {
									if (e.key === "Enter" && newMemory.trim()) void handleAddMemory();
								}}
								placeholder={t("memory.addPlaceholder")}
								className="flex-1"
							/>
							<PrimaryButton disabled={!newMemory.trim()} onClick={handleAddMemory} icon={<Plus size={14} strokeWidth={2} />} title={t("memory.add")} />
						</div>

						{memoryEntries.length > 0 ? (
							<div className="space-y-1.5">
								{memoryEntries.map((m) => (
									<div
										key={m.id}
										className="flex items-center justify-between gap-3 rounded-xl border border-line bg-card p-3 transition-colors hover:border-line-soft"
									>
										{/*
										 * 脑图标对着这条记忆的中线，跟右边的删除按钮同高。
										 *
										 * 它原本贴着第一行文字，而删除按钮是居中的——一条记忆两行高，左右两个图标就差
										 * 出半行，看着像哪一边没放正。
										 */}
										<div className="flex items-center gap-2.5 min-w-0">
											<Brain size={15} strokeWidth={1.8} className="text-accent shrink-0" />
											<div className="min-w-0">
												<span className="text-detail text-ink leading-relaxed break-words">{m.content}</span>
												<MemoryMeta source={m.source ?? "user"} createdAt={m.createdAt} lastInjectedAt={m.lastInjectedAt} />
											</div>
										</div>
										<button
											type="button"
											onClick={() => handleDeleteMemory(m.id)}
											data-ly-tip={t("memory.deleteOne")}
											className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-faint hover:bg-rose-500/10 hover:text-rose-500 transition-colors cursor-pointer"
										>
											<Trash2 size={13.5} strokeWidth={1.8} />
										</button>
									</div>
								))}
							</div>
						) : (
							<div className="rounded-xl border border-line/60 bg-card/40 py-8 text-center text-caption text-ink-faint">
								{loadingMemory ? t("memory.reading") : t("memory.empty")}
							</div>
						)}
					</div>
				)}
				{workspace?.path && projectMemory && (projectMemory.lessons.length > 0 || projectMemory.extracted) && (
					<div className="pt-2" data-project-memory>
						<div className="mb-1.5 flex items-center justify-between gap-2">
							<p className="text-caption text-ink-muted">
								{t("personalization.rememberedFor", { name: workspace.name ?? workspace.path })}
							</p>
							{/*
							 * 「全部忘掉」和逐条删是两种意图，不是一个的快捷方式。
							 *
							 * 逐条删是在修一条错的；全部忘掉是「这个项目我重新开始」——多半发生在
							 * 抽取跑歪了、或者仓库整个换了方向之后。一条条点二十下不是同一件事。
							 */}
							<button
								type="button"
								onClick={() => void forgetAllProjectMemory()}
								data-project-memory-clear
								className="shrink-0 rounded-lg px-2 py-1 text-caption text-ink-faint transition-colors hover:bg-rose-500/10 hover:text-rose-500 cursor-pointer"
							>
								{t("memory.forgetAllProject")}
							</button>
						</div>
						<div className="space-y-1.5">
							{/*
							 * 每一条都得能删掉。
							 *
							 * 这些会被注入这个项目的每一次请求——一条过时的记忆不是碍眼，是一句对模型
							 * 永远重复的指示。在这之前，撤回它的唯一办法是自己去改
							 * `~/.lyra/projects` 底下那个项目的记忆目录；用户记忆早就有这颗按钮了，
							 * 项目记忆没有，纯粹是漏了。
							 */}
							{projectMemory.lessons.map((lesson) => (
								<div key={`${lesson.at}-${lesson.text}`} className="flex items-start justify-between gap-2 rounded-xl border border-line bg-card p-3" data-project-lesson>
									<div className="min-w-0">
										<span className="text-detail text-ink leading-relaxed break-words">{lesson.text}</span>
										{lesson.context && <span className="block text-caption text-ink-muted">{t("personalization.appliesTo", { context: lesson.context })}</span>}
										<MemoryMeta source="learn" createdAt={lesson.at} lastInjectedAt={lesson.lastInjectedAt} />
									</div>
									<button
										type="button"
										onClick={() => void forgetLesson(lesson.at)}
										data-ly-tip={t("memory.deleteOne")}
										aria-label={t("memory.deleteOne")}
										data-project-lesson-delete
										className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-faint hover:bg-rose-500/10 hover:text-rose-500 transition-colors cursor-pointer"
									>
										<Trash2 size={13.5} strokeWidth={1.8} />
									</button>
								</div>
							))}
							{projectMemory.extracted && (
								<div className="flex items-start justify-between gap-2 rounded-xl border border-line bg-card p-3" data-project-extracted>
									<div className="min-w-0">
										<pre className="whitespace-pre-wrap font-sans text-detail text-ink leading-relaxed break-words">{projectMemory.extracted.text}</pre>
										<MemoryMeta
											source="extracted"
											createdAt={projectMemory.extracted.updatedAt ?? Date.now()}
											lastInjectedAt={projectMemory.extracted.lastInjectedAt}
										/>
									</div>
									{/* 抽取出来的那一份是整体重写的，所以它只有「整份丢掉」这一个动作。下次抽取会重新写。 */}
									<button
										type="button"
										onClick={() => void forgetExtracted()}
										data-ly-tip={t("memory.deleteExtracted")}
										aria-label={t("memory.deleteExtracted")}
										data-project-extracted-delete
										className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-faint hover:bg-rose-500/10 hover:text-rose-500 transition-colors cursor-pointer"
									>
										<Trash2 size={13.5} strokeWidth={1.8} />
									</button>
								</div>
							)}
						</div>
					</div>
				)}
			</div>

			{/* Personality / Tone */}
			<div>
				<div className="mb-2">
					<SectionTitle>{t("tone.section")}</SectionTitle>
					<p className="text-caption text-ink-muted mt-0.5">
						{t("personalization.toneIntro")}
					</p>
				</div>
				<Card>
					<Row
						title={t("tone.title")}
						detail={t("tone.detail")}
						control={
							<InlineSelect
								value={personalization.tone ?? "friendly"}
								onChange={(val) => void handleToneChange(val as any)}
								options={[
									{ value: "friendly", label: t("tone.warm") },
									{ value: "professional", label: t("tone.professional") },
									{ value: "concise", label: t("tone.terse") },
									{ value: "candid", label: t("tone.blunt") },
									{ value: "humorous", label: t("tone.playful") },
								]}
							/>
						}
					/>
				</Card>
			</div>
		</div>
	);
}
