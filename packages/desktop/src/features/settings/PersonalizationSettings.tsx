/**
 * Personalization settings: custom global instructions, local persistent memory management, and tone.
 */

import { useEffect, useState } from "react";
import { Brain, Check, Info, Plus, Trash2 } from "lucide-react";
import { useApp } from "../../store/index.ts";
import { Card, GhostButton, InlineSelect, PrimaryButton, Row, SectionTitle, Toggle } from "./controls.tsx";
import { bridge } from "../../services/index.ts";
import { MemoryMeta, type MemorySource } from "./MemoryMeta.tsx";

export function PersonalizationSettings() {
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

	useEffect(() => {
		if (!workspace?.path) return;
		void bridge.projectMemory.list(workspace.path).then(setProjectMemory).catch(() => setProjectMemory(null));
	}, [workspace?.path]);

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
		if (!confirm("确定要删除此电脑上保存的所有本地记忆吗？此操作不可撤销。")) return;
		try {
			await bridge.memory.clear();
			setMemoryEntries([]);
		} catch {
			// ignore
		}
	};

	return (
		<div className="space-y-6">
			{/* Custom Instructions */}
			<div>
				<div className="mb-2 flex items-center justify-between">
					<div>
						<SectionTitle>自定义指令</SectionTitle>
						<p className="text-caption text-ink-muted mt-0.5">
							向 Agent 提供适用于此主机上所有聊天的额外说明和全局规则，会自动与项目中的 AGENTS.md / CLAUDE.md 组合生效。
						</p>
					</div>
					<GhostButton
						onClick={handleSaveInstructions}
						disabled={customInstructions === (personalization.customInstructions ?? "")}
					>
						{savedNotice ? (
							<>
								<Check size={13} className="text-emerald-500" strokeWidth={2.2} />
								<span className="text-emerald-500">已保存</span>
							</>
						) : (
							<span>保存</span>
						)}
					</GhostButton>
				</div>

				<Card className="p-3.5 space-y-2">
					<textarea
						value={customInstructions}
						onChange={(e) => setCustomInstructions(e.target.value)}
						placeholder="# 全局 Agent 规则与偏好&#10;&#10;- 默认使用中文回答；代码、命令与错误日志保留原文。&#10;- 遵循最小改动原则，标准库与原生依赖优先，不做过度抽象。&#10;- 遇到问题主动检索本地代码与文档，给出经过验证的方案。"
						rows={7}
						className="w-full rounded-xl border border-line-soft bg-card-hover/20 p-3 font-mono text-detail text-ink leading-relaxed placeholder:text-ink-faint focus:border-ink-faint focus:outline-none resize-none"
					/>
					<div className="flex items-center gap-1.5 text-micro text-ink-faint px-1">
						<Info size={12} strokeWidth={1.8} />
						<span>支持 Markdown 格式。系统会自动读取项目根目录的 AGENTS.md / LYRA.md / CLAUDE.md 作为项目级指令。</span>
					</div>
				</Card>
			</div>

			{/* Memory Management */}
			<div>
				<div className="mb-2 flex items-center justify-between">
					<div>
						<SectionTitle>记忆</SectionTitle>
						<p className="text-caption text-ink-muted mt-0.5">
							设置在此电脑上如何收集、保留和整合本地记忆，跨会话保留开发习惯与核心决策。
						</p>
					</div>
					{memoryEntries.length > 0 && (
						<button
							type="button"
							onClick={handleClearAllMemory}
							className="rounded-lg px-2.5 py-1 text-caption text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
						>
							清除所有记忆
						</button>
					)}
				</div>

				<Card>
					<Row
						title="启用本地记忆"
						detail="根据此电脑上的聊天与工程任务沉淀关键记忆，并用于个性化此电脑上的后续会话"
						control={
							<Toggle
								checked={personalization.enableMemory !== false}
								onChange={handleToggleEnableMemory}
							/>
						}
					/>
					<Row
						title="允许基于工具辅助聊天生成本地记忆"
						detail="从使用过 MCP 工具、搜索或文件分析的工程交互中提炼重要决策和上下文"
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
						title="从历史会话里总结项目经验"
						detail="空闲时读最近几次对话（12 小时前到 30 天内），提炼这个仓库的约定和踩过的坑，写进项目记忆。会把那些对话内容发给你配置的模型；默认关闭，每天最多一次。"
						control={<Toggle checked={settings?.memoryExtraction === true} onChange={handleToggleExtraction} />}
					/>
				</Card>

				{/* Memory Items List */}
				{personalization.enableMemory !== false && (
					<div className="mt-3 space-y-2">
						<div className="flex items-center gap-2">
							<input
								type="text"
								value={newMemory}
								onChange={(e) => setNewMemory(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter" && newMemory.trim()) void handleAddMemory();
								}}
								placeholder="手动添加一条用户记忆（例如：习惯使用 bun 进行包管理，项目打包目标为 ES2024）..."
								className="h-[32px] flex-1 rounded-lg border border-line bg-input px-3 text-label text-ink placeholder:text-ink-faint focus:border-ink-faint"
							/>
							<PrimaryButton disabled={!newMemory.trim()} onClick={handleAddMemory}>
								<Plus size={14} strokeWidth={2} />
								<span>添加记忆</span>
							</PrimaryButton>
						</div>

						{memoryEntries.length > 0 ? (
							<div className="space-y-1.5">
								{memoryEntries.map((m) => (
									<div
										key={m.id}
										className="flex items-center justify-between gap-3 rounded-xl border border-line bg-card p-3 transition-colors hover:border-line-soft"
									>
										<div className="flex items-start gap-2.5 min-w-0">
											<Brain size={15} strokeWidth={1.8} className="text-accent shrink-0 mt-0.5" />
											<div className="min-w-0">
												<span className="text-detail text-ink leading-relaxed break-words">{m.content}</span>
												<MemoryMeta source={m.source ?? "user"} createdAt={m.createdAt} lastInjectedAt={m.lastInjectedAt} />
											</div>
										</div>
										<button
											type="button"
											onClick={() => handleDeleteMemory(m.id)}
											data-ly-tip="删除此条记忆"
											className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-faint hover:bg-rose-500/10 hover:text-rose-500 transition-colors cursor-pointer"
										>
											<Trash2 size={13.5} strokeWidth={1.8} />
										</button>
									</div>
								))}
							</div>
						) : (
							<div className="rounded-xl border border-line/60 bg-card/40 py-8 text-center text-caption text-ink-faint">
								{loadingMemory ? "正在读取记忆..." : "暂无持久化记忆条目，可在此手动添加或在对话中自动沉淀。"}
							</div>
						)}

						{workspace?.path && projectMemory && (projectMemory.lessons.length > 0 || projectMemory.extracted) && (
							<div className="pt-2" data-project-memory>
								<p className="mb-1.5 text-caption text-ink-muted">
									这个项目记住的（<span className="font-mono">{workspace.name ?? workspace.path}</span>）
								</p>
								<div className="space-y-1.5">
									{projectMemory.lessons.map((lesson) => (
										<div key={`${lesson.at}-${lesson.text}`} className="rounded-xl border border-line bg-card p-3" data-project-lesson>
											<span className="text-detail text-ink leading-relaxed break-words">{lesson.text}</span>
											{lesson.context && <span className="block text-caption text-ink-muted">适用于：{lesson.context}</span>}
											<MemoryMeta source="learn" createdAt={lesson.at} lastInjectedAt={lesson.lastInjectedAt} />
										</div>
									))}
									{projectMemory.extracted && (
										<div className="rounded-xl border border-line bg-card p-3" data-project-extracted>
											<pre className="whitespace-pre-wrap font-sans text-detail text-ink leading-relaxed break-words">{projectMemory.extracted.text}</pre>
											<MemoryMeta
												source="extracted"
												createdAt={projectMemory.extracted.updatedAt ?? Date.now()}
												lastInjectedAt={projectMemory.extracted.lastInjectedAt}
											/>
										</div>
									)}
								</div>
							</div>
						)}
					</div>
				)}
			</div>

			{/* Personality / Tone */}
			<div>
				<div className="mb-2">
					<SectionTitle>个性与语气偏好</SectionTitle>
					<p className="text-caption text-ink-muted mt-0.5">
						调整 Agent 回复的默认语调与工程风格。
					</p>
				</div>
				<Card>
					<Row
						title="语气风格"
						detail="选择适合您开发习惯的助手交流风格"
						control={
							<InlineSelect
								value={personalization.tone ?? "friendly"}
								onChange={(val) => void handleToneChange(val as any)}
								options={[
									{ value: "friendly", label: "亲和温和 (默认)" },
									{ value: "professional", label: "专业严谨" },
									{ value: "concise", label: "极度精炼 (少废话)" },
									{ value: "candid", label: "直接坦率 (直指缺陷)" },
									{ value: "humorous", label: "幽默风趣" },
								]}
							/>
						}
					/>
				</Card>
			</div>
		</div>
	);
}
