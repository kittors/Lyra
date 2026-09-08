import { translate } from "../../i18n/translate.ts";
import { BUILTIN_AGENTS } from "@lyra/core/agents-builtin";
import type { Settings } from "@lyra/core";
import { agentProfile, withAgentProfile, availableModels, resolveModelRef, type SubAgentProfile } from "@lyra/core/model-roles";
import { resolveModelThinkingOptions } from "@lyra/core/thinking-options";
import { AlertCircle, Bot, Brain, Plus, Ellipsis, Copy, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AgentCapabilities } from "../../../electron/ipc-types.ts";
import { useApp } from "../../store/index.ts";
import { Badge, Card, InlineSelect, SectionTitle } from "./controls.tsx";
import { ModelSelect } from "../models/index.ts";
import { AgentDefinitionEditor } from "./AgentDefinitionEditor.tsx";
import { useAgentDefinitions } from "./useAgentDefinitions.ts";
import type { AgentDefinitionRecord } from "@lyra/core";
import { Popover, MenuBody, MenuItem, usePopover } from "../../ui/overlay/Popover.tsx";
import { bridge } from "../../services/index.ts";
import { useI18n, type MessageKey } from "../../i18n/index.ts";

/* 来源三种，存 key——这张表在模块加载时成型，那会儿还不知道窗口是哪种语言。 */
const SOURCE_LABEL: Record<string, MessageKey> = { builtin: "common.builtin", workspace: "common.project", user: "common.user" };

export function AgentsSettings() {
	const { t } = useI18n();
	const catalogue = useAgentDefinitions();
	const [editor, setEditor] = useState<{ record?: AgentDefinitionRecord; copy?: boolean; projectId: string | null } | null>(null);
	const [undo, setUndo] = useState<{ token: string; projectId: string | null } | null>(null);
	const [notice, setNotice] = useState("");
	const [highlight, setHighlight] = useState("");
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

	const agents = catalogue.records?.map(record => record.definition) ?? capabilities?.agents ?? BUILTIN_AGENTS;
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
	if (editor) return <AgentDefinitionEditor record={editor.record} copy={editor.copy} projectId={editor.projectId} projectName={catalogue.projectName} tools={catalogue.tools} onClose={() => setEditor(null)} onSaved={(name, warning) => { setEditor(null); setHighlight(name); setNotice(warning ?? t("agents.savedForNext")); void catalogue.refresh(); }} />;
	return (
		<div className="pt-8">
			<div className="flex items-center justify-between gap-3"><h1 className="text-display leading-tight font-semibold tracking-tight text-ink">{t("agents.title")}</h1>{catalogue.enabled && <button type="button" className="flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-label text-white" onClick={() => setEditor({ projectId: catalogue.projectId })}><Plus size={16} />{t("agents.add")}</button>}</div>
			<p className="mt-2 max-w-[600px] pb-7 text-label leading-relaxed text-ink-muted">
				{translate("agentsSettings.intro")}
			</p>
			<SectionTitle>{translate("agents.availableCount", { n: agents.length })}</SectionTitle>
			{catalogue.error && <p role="alert" className="mb-3 text-label text-danger">{catalogue.error} <button type="button" onClick={() => void catalogue.refresh()}>{t("common.reload")}</button></p>}
			{notice && <p role="status" className="mb-3 text-label text-ink-muted">{notice} {undo && <button type="button" className="text-info" onClick={() => { void bridge.agentDefinitions.restore(undo.projectId, undo.token).then(() => { setUndo(null); setNotice(t("agents.restored")); return catalogue.refresh(); }).catch(cause => setError(String(cause))); }}>{t("common.undo")}</button>}</p>}
			{error && <p role="alert" className="mb-3 text-label text-danger">{error}</p>}
			<Card className="mb-6">
				{agents.map((agent) => (
					<div key={agent.name} data-agent-profile={agent.name} data-agent-saved={highlight === agent.name || undefined} className={`flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl px-4 py-4 ${highlight === agent.name ? "bg-info/5" : ""}`}>
						<div className="min-w-0 flex-[1_1_240px]">
							<div className="flex flex-wrap items-center gap-2">
								<Bot size={16} strokeWidth={1.8} className="shrink-0 text-info" />
								<span className="break-all font-mono text-label text-ink">{agent.name}</span>
								<Badge tone="muted">{catalogue.records?.find(record => record.definition.name === agent.name)?.customized ? t("agents.builtinCustomised") : (SOURCE_LABEL[agent.source] ? t(SOURCE_LABEL[agent.source]) : agent.source)}</Badge>
							</div>
							<p className="mt-1 line-clamp-2 text-label leading-relaxed text-ink-muted">{agent.description}</p>
						</div>
						{settings && <AgentModelControls agent={agent} settings={settings} mainModelId={mainModelId} disabled={saving} onChange={(profile) => { void save(agent.name, profile); }} />}
						{catalogue.records?.filter(record => record.definition.name === agent.name).map(record => <DefinitionActions key={record.id} record={record} disabled={saving} edit={() => void openEditor(record)} copy={() => void openEditor(record, true)} remove={() => void remove(record)} />)}
					</div>
				))}
			</Card>
			{settings && <>
				<SectionTitle>{t("common.session")}</SectionTitle>
				<Card>
					<div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4" data-agent-profile="compact">
						<div><span className="text-label text-ink">compact</span><p className="mt-1 text-detail text-ink-muted">{t("agents.compactContext")}</p></div>
						<ModelSelect ariaLabel={t("agents.compactModel")} value={agentProfile(settings, "compact").modelId ?? ""} inheritLabel={t("agents.followMain")} inheritedModelId={mainModelId ?? settings.defaultModelId ?? undefined} inheritedSource={t("agents.followMainShort")} disabled={saving}
							onChange={(modelId) => save("compact", modelId ? { modelId } : {})} />
					</div>
					<div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
						<span className="text-label text-ink">{t("agents.sidechatModel")}</span>
						<ModelSelect ariaLabel={t("agents.sidechatModel")} value={settings.sideChatModelId ?? ""} inheritLabel={t("agents.followMain")} inheritedModelId={mainModelId ?? settings.defaultModelId ?? undefined} inheritedSource={t("agents.followMainShort")} inheritDetail={t("agents.sidechatModelDetail")} disabled={saving}
							onChange={(modelId) => { const current = useApp.getState().settings; if (current) void persist({ ...current, sideChatModelId: modelId || null }); }} />
					</div>
				</Card>
			</>}
		</div>
	);
}

function AgentModelControls({ agent, settings, mainModelId, disabled, onChange }: {
	agent: Pick<AgentCapabilities["agents"][number], "name" | "model">; settings: Settings; mainModelId?: string | null;
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
		<fieldset disabled={disabled} aria-label={t("agents.runConfig", { name: agent.name })} className="m-0 flex min-w-0 max-w-full flex-wrap items-center gap-2 border-0 p-0 disabled:opacity-60 [&>button]:max-w-full">
			<ModelSelect ariaLabel={t("agents.modelFor", { name: agent.name })} value={profile.modelId ?? ""} disabled={disabled} inheritedModelId={inherited?.model.id} inheritedSource={inherited?.via === t("agents.sessionModel") ? t("agents.followMainShort") : t("common.default")}
				inheritLabel={inherited && inherited.via !== t("agents.sessionModel") ? t("agents.followDefinition") : t("agents.followMain")} inheritDetail={inherited ? `${inherited.provider.name} · ${inherited.model.name}` : t("agents.followMain")} onChange={(modelId) => onChange(modelId ? { modelId } : {})} />
			{levels.length > 0 ? <InlineSelect ariaLabel={t("agents.thinkingFor", { name: agent.name })} value={profile.thinking ?? ""}
				options={[
					{ value: "", label: t("agents.defaultThinking", { level: defaultThinking?.label ?? t("thinking.off") }), icon: <Brain size={14} /> },
					...(invalidThinking && profile.thinking ? [{ value: profile.thinking, label: t("agents.levelUnavailable") }] : []),
					...levels.map((level) => ({ value: level.id, label: level.label, detail: level.detail, icon: <Brain size={14} /> })),
				]} onChange={(thinking) => onChange({ ...profile, thinking: thinking || undefined })} /> :
				<span className="flex h-[30px] items-center gap-1.5 text-label text-ink-faint"><Brain size={14} />{current ? t("agents.noThinking") : t("agents.thinkingLevel")}</span>}
			{(invalid || invalidThinking) && <AlertCircle size={15} className="text-danger" aria-label={t("agents.configUnavailable")} data-ly-tip={t("agents.configUnavailableDetail")} />}
		</fieldset>
	);
}

function DefinitionActions({ record, disabled, edit, copy, remove }: { record: AgentDefinitionRecord; disabled: boolean; edit: () => void; copy: () => void; remove: () => void }) {
	const { t } = useI18n();
	const menu = usePopover();
	return <div className="flex shrink-0 items-center gap-1">
		{record.editable && <button type="button" aria-label={t("agents.editNamed", { name: record.definition.name })} disabled={disabled} className="rounded-lg px-2 py-1.5 text-label text-info hover:bg-hover" onClick={edit}>{t("common.edit")}</button>}
		<button type="button" aria-label={t("agents.moreFor", { name: record.definition.name })} aria-haspopup="menu" aria-expanded={menu.open} disabled={disabled} className="rounded-lg p-1.5 text-ink-muted hover:bg-hover" onClick={menu.toggle}><Ellipsis size={16} /></button>
		{menu.open && <Popover anchor={menu.anchor} onClose={menu.close} label={t("agents.actions")}><MenuBody>
			<MenuItem icon={<Copy size={14} />} onClick={() => { menu.close(); copy(); }}>{t("agents.duplicate")}</MenuItem>
			{record.editable && record.scope !== "builtin" && <MenuItem icon={record.customized ? <RotateCcw size={14} /> : <Trash2 size={14} />} onClick={() => { menu.close(); remove(); }}>{record.customized ? record.scope === "project" ? t("agents.removeProjectOverride") : t("agents.restoreBuiltin") : t("agents.delete")}</MenuItem>}
		</MenuBody></Popover>}
	</div>;
}
