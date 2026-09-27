import { translate } from "../../i18n/translate.ts";
import { BUILTIN_AGENTS } from "@lyra/core/agents-builtin";
import type { Settings } from "@lyra/core";
import { agentProfile, withAgentProfile, availableModels, resolveModelRef, type SubAgentProfile } from "@lyra/core/model-roles";
import { resolveModelThinkingOptions } from "@lyra/core/thinking-options";
import { AlertCircle, Brain, Copy, Ellipsis, MessageSquare, Minimize2, Pencil, Plus, RotateCcw, RotateCw, Trash2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentCapabilities } from "../../../electron/ipc-types.ts";
import { useApp } from "../../store/index.ts";
import { useAgentAvatars, type AvatarOf } from "../../store/agent-avatars.ts";
import type { Avatar } from "../../lib/agent-avatar.ts";
import { AgentAvatar } from "../../ui/avatar/AgentAvatar.tsx";
import { Button } from "../../ui/primitives/Button.tsx";
import { InlineSelect } from "./controls.tsx";
import { ModelSelect } from "../models/index.ts";
import { AgentDefinitionEditor } from "./AgentDefinitionEditor.tsx";
import { useAgentDefinitions } from "./useAgentDefinitions.ts";
import type { AgentDefinitionRecord } from "@lyra/core";
import { Popover, MenuBody, MenuItem, MenuSeparator, usePopover } from "../../ui/overlay/Popover.tsx";
import { bridge } from "../../services/index.ts";
import { useI18n, type MessageKey } from "../../i18n/index.ts";

/* 来源三种，存 key——这张表在模块加载时成型，那会儿还不知道窗口是哪种语言。 */
const SOURCE_LABEL: Record<string, MessageKey> = { builtin: "common.builtin", workspace: "common.project", user: "common.user" };

type Agent = AgentCapabilities["agents"][number];

/**
 * 智能体，一人一行。
 *
 * 分成「自定义」和「内置」两段：自己写的那几个是常来改的，放上面；内置的七个多数时候只是看一眼
 * 用的什么模型。改过的内置仍然在内置那段——它还是那个人，只是换了几句指令。
 *
 * 每行的模型、思考等级是「安静」的下拉：没改过的（跟随主会话、默认等级）字淡一档、不画底，改过的
 * 是正常字色。从前每行两颗灰底胶囊、一支蓝色的笔、一个 ⋯，七行就是二十八样东西，页面上最显眼的
 * 是七遍一模一样的「随主会话」。现在整行就是编辑的入口，笔收进 ⋯ 里。
 */
export function AgentsSettings() {
	const { t } = useI18n();
	const catalogue = useAgentDefinitions();
	const [editor, setEditor] = useState<{ record?: AgentDefinitionRecord; copy?: boolean; projectId: string | null } | null>(null);
	const [undo, setUndo] = useState<{ token: string; projectId: string | null } | null>(null);
	const [notice, setNotice] = useState("");
	const [highlight, setHighlight] = useState<{ name: string; at: number } | null>(null);
	const activeSessionId = useApp((s) => s.activeSessionId);
	const settings = useApp((s) => s.settings);
	const mainModelId = useApp((s) => s.meta?.modelId);
	const sharedCapabilities = useApp((s) => s.capabilities);
	const [capabilities, setCapabilities] = useState<AgentCapabilities | null>(null);
	const [saving, setSaving] = useState(false);
	const savingRef = useRef(false);
	const [error, setError] = useState("");

	useEffect(() => {
		let cancelled = false;
		setCapabilities(activeSessionId ? sharedCapabilities : null);
		setError("");
		if (!activeSessionId || sharedCapabilities) return;
		void bridge.sessions.capabilities(activeSessionId).then((value) => {
			if (!cancelled) setCapabilities(value);
		}).catch((cause: unknown) => {
			if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
		});
		return () => { cancelled = true; };
	}, [activeSessionId, sharedCapabilities]);

	async function persist(next: Settings) {
		if (savingRef.current) return;
		savingRef.current = true; setSaving(true); setError("");
		try { await useApp.getState().saveSettings(next); }
		catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
		finally { savingRef.current = false; setSaving(false); }
	}

	function save(name: string, profile: SubAgentProfile) {
		const current = useApp.getState().settings;
		if (current) void persist(withAgentProfile(current, name, profile));
	}

	const agents: Agent[] = useMemo(
		() => catalogue.records?.map(record => record.definition) ?? capabilities?.agents ?? BUILTIN_AGENTS,
		[catalogue.records, capabilities?.agents],
	);
	const avatarOf = useAgentAvatars(agents);
	const openEditor = async (record: AgentDefinitionRecord, copy = false) => {
		try { const fresh = await bridge.agentDefinitions.read(catalogue.projectId, record.id); setEditor({ record: fresh, copy, projectId: catalogue.projectId }); }
		catch (cause) { setError(String(cause)); }
	};
	const remove = async (record: AgentDefinitionRecord) => {
		setSaving(true);
		try {
			const result = await bridge.agentDefinitions.remove(catalogue.projectId, record.id, record.revision);
			setUndo({ token: result.undoToken, projectId: catalogue.projectId }); setNotice(result.warning ?? t("agents.removed")); await catalogue.refresh();
		} catch (cause) { setError(String(cause)); }
		finally { setSaving(false); }
	};
	if (editor) {
		return <AgentDefinitionEditor record={editor.record} copy={editor.copy} projectId={editor.projectId} projectName={catalogue.projectName} tools={catalogue.tools}
			avatarOf={avatarOf} taken={agents.filter(agent => !editor.record || editor.copy || agent.name !== editor.record.definition.name).map(agent => ({ name: agent.name, avatar: avatarOf(agent.name) }))}
			onClose={() => setEditor(null)} onSaved={(name, warning) => { setEditor(null); setHighlight({ name, at: Date.now() }); setNotice(warning ?? t("agents.savedForNext")); void catalogue.refresh(); }} />;
	}

	const recordOf = (name: string) => catalogue.records?.find(record => record.definition.name === name);
	// 自己写的在上面。改过的内置留在内置那段：它还是那个人。
	const builtin = (agent: Agent) => { const record = recordOf(agent.name); return record ? record.scope === "builtin" || record.customized : agent.source === "builtin"; };
	const own = agents.filter(agent => !builtin(agent));
	const shipped = agents.filter(builtin);
	const row = (agent: Agent) => {
		const record = recordOf(agent.name);
		const tag = record?.customized ? t("agents.customised") : SOURCE_LABEL[agent.source] ? t(SOURCE_LABEL[agent.source]) : agent.source;
		return (
			<AgentRow key={agent.name} agent={agent} avatarOf={avatarOf} tag={tag} saved={highlight?.name === agent.name ? highlight.at : null}
				edit={record?.editable ? () => void openEditor(record) : undefined}
				actions={record ? <DefinitionActions record={record} disabled={saving} edit={() => void openEditor(record)} copy={() => void openEditor(record, true)} remove={() => void remove(record)} /> : null}>
				{settings && <AgentModelControls agent={agent} settings={settings} mainModelId={mainModelId} disabled={saving} onChange={(profile) => { void save(agent.name, profile); }} />}
			</AgentRow>
		);
	};
	return (
		<div className="pt-8" data-agents-settings="">
			<header className="flex items-start justify-between gap-4 pb-7">
				<div className="min-w-0">
					<h1 className="text-display leading-tight font-semibold tracking-tight text-ink">{t("agents.title")}</h1>
					<p className="mt-2 max-w-[600px] text-label leading-relaxed text-ink-muted">{translate("agentsSettings.intro")}</p>
				</div>
				{catalogue.enabled && <div className="mt-1 shrink-0"><Button variant="primary" icon={<Plus size={16} strokeWidth={2} aria-hidden />} label={t("agents.add")} onClick={() => setEditor({ projectId: catalogue.projectId })} /></div>}
			</header>
			{catalogue.error && <p role="alert" className="mb-3 text-label text-danger">{catalogue.error} <button type="button" data-ly-tip={t("common.reload")} aria-label={t("common.reload")} className="inline-grid h-5 w-5 translate-y-[3px] place-items-center rounded hover:bg-hover" onClick={() => void catalogue.refresh()}><RotateCw size={12} strokeWidth={2} aria-hidden /></button></p>}
			{notice && <p role="status" className="ly-enter mb-3 flex items-center gap-1.5 text-label text-ink-muted">{notice} {undo && <button type="button" data-ly-tip={t("common.undo")} aria-label={t("common.undo")} className="inline-grid h-6 w-6 place-items-center rounded-md text-info hover:bg-card-hover" onClick={() => { void bridge.agentDefinitions.restore(undo.projectId, undo.token).then(() => { setUndo(null); setNotice(t("agents.restored")); return catalogue.refresh(); }).catch(cause => setError(String(cause))); }}><Undo2 size={13} strokeWidth={2} aria-hidden /></button>}</p>}
			{error && <p role="alert" className="mb-3 text-label text-danger">{error}</p>}

			<Section title={t("agents.customSection")} count={own.length}>
				{own.length > 0 ? own.map(row) : <EmptyOwn onCreate={catalogue.enabled ? () => setEditor({ projectId: catalogue.projectId }) : undefined} />}
			</Section>
			<Section title={t("agents.builtinSection")} count={shipped.length}>{shipped.map(row)}</Section>

			{settings && (
				<Section title={t("common.session")}>
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[10px] px-2.5 py-2.5" data-agent-profile="compact">
						<SessionMark icon={<Minimize2 size={15} strokeWidth={1.8} />} />
						<div className="min-w-0 flex-1 @xl:min-w-[160px]"><div className="text-body text-ink">{t("agents.compactContext")}</div><div className="mt-0.5 font-mono text-detail text-ink-faint">compact</div></div>
						<SessionControl>
							<ModelSelect quiet ariaLabel={t("agents.compactModel")} value={agentProfile(settings, "compact").modelId ?? ""} inheritLabel={t("agents.followMain")} inheritedModelId={mainModelId ?? settings.defaultModelId ?? undefined} inheritedSource={t("agents.followMainShort")} disabled={saving}
								onChange={(modelId) => save("compact", modelId ? { modelId } : {})} />
						</SessionControl>
					</div>
					<div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[10px] px-2.5 py-2.5">
						<SessionMark icon={<MessageSquare size={15} strokeWidth={1.8} />} />
						<div className="min-w-0 flex-1 @xl:min-w-[160px]"><div className="text-body text-ink">{t("agents.sidechatModel")}</div><div className="mt-0.5 text-detail text-ink-faint">{t("agents.sidechatModelDetail")}</div></div>
						<SessionControl>
							<ModelSelect quiet ariaLabel={t("agents.sidechatModel")} value={settings.sideChatModelId ?? ""} inheritLabel={t("agents.followMain")} inheritedModelId={mainModelId ?? settings.defaultModelId ?? undefined} inheritedSource={t("agents.followMainShort")} inheritDetail={t("agents.sidechatModelDetail")} disabled={saving}
								onChange={(modelId) => { const current = useApp.getState().settings; if (current) void persist({ ...current, sideChatModelId: modelId || null }); }} />
						</SessionControl>
					</div>
				</Section>
			)}
		</div>
	);
}

/** 一段：标题、人数、一张卡。卡里行与行之间不画线，靠节奏分开——和插件、技能那几页一样。 */
function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
	return (
		<section className="mb-7">
			<h2 className="mb-2.5 flex items-baseline gap-2 text-title font-medium text-ink">
				{title}
				{count !== undefined && <span className="text-label font-normal tabular-nums text-ink-faint">{count}</span>}
			</h2>
			{/* 容器查询的锚：卡片够宽时控件和名字同一行，窄了控件掉到名字下面——按卡片量，不按窗口量。 */}
			<div className="@container rounded-[14px] border border-line bg-card/40 p-1.5">{children}</div>
		</section>
	);
}

/**
 * 会话那两行的下拉，和上面智能体那一列模型对齐：宽的时候后面空出思考等级和 ⋯ 那么宽（124 + 32
 * 加两道间距），窄的时候和智能体那几行一样掉到名字下面。
 */
function SessionControl({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex w-full min-w-0 items-center pl-[46px] @xl:w-auto @xl:shrink-0 @xl:pl-0 @xl:pr-[164px]">
			<div className="min-w-0 flex-1 @xl:w-[196px] @xl:flex-none [&>button]:w-full [&>button]:max-w-none">{children}</div>
		</div>
	);
}

/** 会话那两行没有脸，用一枚圆底的记号占住头像那一列，文字才和上面的名字对齐。 */
function SessionMark({ icon }: { icon: React.ReactNode }) {
	return <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full bg-card text-ink-muted">{icon}</span>;
}

const EMPTY_FACES: Avatar[] = [
	{ shape: "ghost", color: "sky" },
	{ shape: "flower", color: "rose" },
	{ shape: "star", color: "lime" },
];

function EmptyOwn({ onCreate }: { onCreate?: () => void }) {
	const { t } = useI18n();
	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-3 px-3 py-4" data-agents-empty="">
			{/* 三张没人认领的脸，闭着眼：位置空着，等你来填。 */}
			<span className="flex shrink-0 -space-x-1.5 opacity-60" aria-hidden>
				{EMPTY_FACES.map((face) => (
					<AgentAvatar key={`${face.shape}-${face.color}`} avatar={face} size={26} mood="stopped" interactive={false} />
				))}
			</span>
			<p className="min-w-[200px] flex-1 text-label leading-relaxed text-ink-muted">{t("agents.emptyCustom")}</p>
			{onCreate && <Button variant="subtle" icon={<Plus size={14} strokeWidth={2} aria-hidden />} onClick={onCreate}>{t("agents.add")}</Button>}
		</div>
	);
}

function AgentRow({ agent, avatarOf, tag, saved, edit, actions, children }: {
	agent: Agent; avatarOf: AvatarOf; tag: string; saved: number | null;
	edit?: () => void; actions: React.ReactNode; children: React.ReactNode;
}) {
	const { t } = useI18n();
	return (
		/*
		 * 整行都是「编辑」：点脸、点描述、点空白都进编辑器；点在下拉、⋯ 和它们的菜单上的不算——菜单
		 * 画在 portal 里，可 React 的点击照样冒泡回这一行，所以按目标往上找，而不是按位置。
		 *
		 * 键盘和读屏走名字：名字本身是一颗按钮，名字还是从前那支笔的名字（「编辑 general」）。从前
		 * 是一颗铺满整行的透明按钮垫在最底下，它的正中央恰好落在模型下拉上——按中心点下去的测试和
		 * 读屏的「点击」都会点到别的东西。
		 */
		<div data-agent-profile={agent.name} data-agent-saved={saved ? true : undefined} data-ly-avatar-host=""
			onClick={(event) => {
				if (edit && !(event.target as HTMLElement).closest("button, input, fieldset, [role=menu], [role=menuitem], [role=dialog]")) edit();
			}}
			className={`group/agent relative flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[10px] px-2.5 py-2.5 transition-colors duration-[var(--ly-t-quick)] ${
				saved ? "bg-info/[0.06]" : ""
			} ${edit ? "cursor-pointer hover:bg-card-hover/60" : ""}`}>
			<AgentAvatar avatar={avatarOf(agent.name)} size={34} seed={agent.name} host="[data-ly-avatar-host]" cheer={saved} />
			<div className="min-w-0 flex-1 @xl:min-w-[160px]">
				<div className="flex min-w-0 items-baseline gap-2">
					{edit ? (
						<button type="button" aria-label={t("agents.editNamed", { name: agent.name })} onClick={edit} data-agent-name=""
							className="min-w-0 truncate rounded-sm text-left text-body font-medium text-ink outline-none focus-visible:underline">{agent.name}</button>
					) : (
						<span className="truncate text-body font-medium text-ink" data-agent-name="">{agent.name}</span>
					)}
					<span className="shrink-0 text-caption text-ink-faint">{tag}</span>
				</div>
				<p className="mt-0.5 truncate text-label text-ink-muted" data-ly-tip={agent.description}>{agent.description}</p>
			</div>
			{/* 窄的时候独占一行、缩进到名字那一列下面；宽了就回到名字右边。 */}
			<div className="relative flex w-full min-w-0 items-center gap-1 pl-[46px] @xl:w-auto @xl:shrink-0 @xl:pl-0">
				{children}
				{actions}
			</div>
		</div>
	);
}

function AgentModelControls({ agent, settings, mainModelId, disabled, onChange }: {
	agent: Pick<Agent, "name" | "model">; settings: Settings; mainModelId?: string | null;
	disabled: boolean; onChange: (profile: SubAgentProfile) => void;
}) {
	const { t } = useI18n();
	const models = availableModels(settings);
	const profile = agentProfile(settings, agent.name);
	const fallback = models.find(({ model }) => model.id === (mainModelId || settings.defaultModelId));
	const selected = profile.modelId ? models.find(({ model }) => model.id === profile.modelId) : undefined;
	const inherited = fallback ? resolveModelRef(withAgentProfile(settings, agent.name, {}), agent.model, fallback) : undefined;
	const current = profile.modelId ? selected : inherited;
	const levels = resolveModelThinkingOptions(current?.model);
	const invalid = profile.modelId && !selected;
	const invalidThinking = profile.thinking && levels.length > 0 && !levels.some((level) => level.id === profile.thinking);
	const inheritedThinking = profile.modelId ? settings.thinking : inherited?.thinking ?? settings.thinking;
	const defaultThinking = levels.find((level) => level.id === inheritedThinking) ?? levels.find((level) => level.isDefault) ?? levels[0];

	return (
		<fieldset disabled={disabled} aria-label={t("agents.runConfig", { name: agent.name })} className="m-0 flex min-w-0 flex-1 items-center gap-1 border-0 p-0 disabled:opacity-60 @xl:flex-none">
			{(invalid || invalidThinking) && <AlertCircle size={15} className="mr-0.5 shrink-0 text-danger" aria-label={t("agents.configUnavailable")} data-ly-tip={t("agents.configUnavailableDetail")} />}
			<div className="min-w-0 flex-[3_1_0] @xl:w-[196px] @xl:flex-none [&>button]:w-full [&>button]:max-w-none">
				<ModelSelect quiet ariaLabel={t("agents.modelFor", { name: agent.name })} value={profile.modelId ?? ""} disabled={disabled} inheritedModelId={inherited?.model.id} inheritedSource={inherited?.via === t("agents.sessionModel") ? t("agents.followMainShort") : t("common.default")}
					inheritLabel={inherited && inherited.via !== t("agents.sessionModel") ? t("agents.followDefinition") : t("agents.followMain")} inheritDetail={inherited ? `${inherited.provider.name} · ${inherited.model.name}` : t("agents.followMain")} onChange={(modelId) => onChange(modelId ? { modelId } : {})} />
			</div>
			<div className="min-w-0 flex-[2_1_0] @xl:w-[124px] @xl:flex-none [&>button]:w-full">
				{levels.length > 0 ? <InlineSelect quiet set={Boolean(profile.thinking)} ariaLabel={t("agents.thinkingFor", { name: agent.name })} value={profile.thinking ?? ""}
					options={[
						{ value: "", label: t("agents.defaultThinking", { level: defaultThinking?.label ?? t("thinking.off") }), icon: <Brain size={14} /> },
						...(invalidThinking && profile.thinking ? [{ value: profile.thinking, label: t("agents.levelUnavailable") }] : []),
						...levels.map((level) => ({ value: level.id, label: level.label, detail: level.detail, icon: <Brain size={14} /> })),
					]} onChange={(thinking) => onChange({ ...profile, thinking: thinking || undefined })} /> :
					<span className="flex h-[var(--ly-control)] items-center gap-2 px-2.5 text-label text-ink-faint"><Brain size={14} className="shrink-0" /><span className="truncate">{current ? t("agents.noThinking") : t("agents.thinkingLevel")}</span></span>}
			</div>
		</fieldset>
	);
}

function DefinitionActions({ record, disabled, edit, copy, remove }: { record: AgentDefinitionRecord; disabled: boolean; edit: () => void; copy: () => void; remove: () => void }) {
	const { t } = useI18n();
	const menu = usePopover();
	return <>
		<button type="button" aria-label={t("agents.moreFor", { name: record.definition.name })} data-ly-tip={t("common.more")} aria-haspopup="menu" aria-expanded={menu.open} disabled={disabled}
			className="grid h-[var(--ly-control)] w-8 shrink-0 place-items-center rounded-lg text-ink-faint transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink aria-expanded:bg-card-hover aria-expanded:text-ink disabled:opacity-50" onClick={menu.toggle}><Ellipsis size={16} aria-hidden /></button>
		{menu.open && <Popover anchor={menu.anchor} onClose={menu.close} placement="bottom" align="end" width="compact" label={t("agents.actions")}><MenuBody>
			{record.editable && <MenuItem icon={<Pencil size={14} />} onClick={() => { menu.close(); edit(); }}>{t("common.edit")}</MenuItem>}
			<MenuItem icon={<Copy size={14} />} onClick={() => { menu.close(); copy(); }}>{t("agents.duplicate")}</MenuItem>
			{record.editable && record.scope !== "builtin" && <>
				<MenuSeparator />
				<MenuItem danger={!record.customized} icon={record.customized ? <RotateCcw size={14} /> : <Trash2 size={14} />} onClick={() => { menu.close(); remove(); }}>{record.customized ? record.scope === "project" ? t("agents.removeProjectOverride") : t("agents.restoreBuiltin") : t("agents.delete")}</MenuItem>
			</>}
		</MenuBody></Popover>}
	</>;
}
