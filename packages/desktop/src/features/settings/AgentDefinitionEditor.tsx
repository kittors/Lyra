import { ArrowLeft, Save } from "lucide-react";
import { useEffect, useState } from "react";
import type { AgentDefinitionRecord, AgentDefinitionSave, AgentDraft } from "@lyra/core";
import { Input, Textarea } from "../../ui/inputs/NativeField.tsx";
import { Disclosure } from "../../ui/layout/Disclosure.tsx";
import { InlineSelect } from "./controls.tsx";
import { bridge } from "../../services/index.ts";
import { useI18n } from "../../i18n/index.ts";

// Keep unsaved text through settings navigation without writing instructions to browser storage.
const drafts = new Map<string, { draft: AgentDraft; scope: "user" | "project" }>();

export function AgentDefinitionEditor({ record, copy, projectId, projectName, tools, onClose, onSaved }: {
	record?: AgentDefinitionRecord; copy?: boolean; projectId: string | null; projectName?: string;
	tools: string[]; onClose: () => void; onSaved: (name: string, warning?: string) => void;
}) {
	const { t } = useI18n();
	const definition = record?.definition;
	const original: AgentDraft = { name: copy ? `${definition?.name ?? "agent"}-copy` : definition?.name ?? "", description: definition?.description ?? "", systemPrompt: definition?.systemPrompt ?? "", tools: definition?.tools ?? ["read", "glob", "grep", "ls"] };
	const draftKey = JSON.stringify([projectId, record?.id ?? "new", Boolean(copy)]);
	const remembered = drafts.get(draftKey);
	const [draft, setDraft] = useState(remembered?.draft ?? original);
	const [scope, setScope] = useState<"user" | "project">(remembered?.scope ?? (record?.scope === "project" && !copy ? "project" : "user"));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [leaving, setLeaving] = useState(false);
	const dirty = JSON.stringify(draft) !== JSON.stringify(original) || scope !== (record?.scope === "project" && !copy ? "project" : "user");
	useEffect(() => { if (dirty) drafts.set(draftKey, { draft, scope }); else drafts.delete(draftKey); }, [draftKey, draft, scope, dirty]);
	const discard = () => { drafts.delete(draftKey); onClose(); };
	const patch = (next: Partial<AgentDraft>) => setDraft(current => ({ ...current, ...next }));
	const save = async () => {
		if (busy) return;
		setBusy(true); setError("");
		try {
			const input: AgentDefinitionSave = { scope, draft, ...record ? copy ? { copyFrom: record.id } : { id: record.id, revision: record.revision } : {} };
			const result = await bridge.agentDefinitions.save(projectId, input);
			drafts.delete(draftKey); onSaved(draft.name, result.warning);
		} catch (cause) { setError(String(cause)); }
		finally { setBusy(false); }
	};
	return <form className="max-w-[800px] pt-8" data-agent-editor onSubmit={event => { event.preventDefault(); void save(); }}>
		{/*
		 * 两个一样高的盒子，才谈得上居中。
		 *
		 * 原先是 `p-2` 包一个 18px 图标（盒高 34）挨着一个 `text-title` 的标题，两个高度不一样的盒子
		 * 靠 `items-center` 对齐——盒子的中线是齐的，可标题的行盒比字形高出一截，字看着就比箭头低。
		 * 让按钮和标题都是 36px（`h-9` 配 `leading-9`），中线和字形就落在同一条线上。
		 */}
		<div className="sticky top-0 z-10 flex items-center gap-3 bg-shell py-3">
			<button type="button" aria-label={t("agentEditor.back")} className="flex h-9 w-9 shrink-0 items-center justify-center rounded hover:bg-hover" disabled={busy} onClick={() => dirty ? setLeaving(true) : onClose()}><ArrowLeft size={18} /></button>
			<h1 className="min-w-0 flex-1 truncate text-title leading-9 font-semibold">{record && !copy ? t("agentEditor.editNamed", { name: record.definition.name }) : t("agents.add")}</h1>
			<button type="submit" disabled={busy} className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-label text-white disabled:opacity-50"><Save size={15} />{busy ? t("common.saving") : t("common.save")}</button>
		</div>
		{leaving && <div role="alert" className="my-3 flex flex-wrap items-center gap-3 rounded-lg border border-line p-3 text-label">{t("agentEditor.unsaved")}<button type="button" className="text-info" onClick={() => setLeaving(false)}>{t("agentEditor.keepEditing")}</button><button type="button" className="text-danger" onClick={discard}>{t("agentEditor.discard")}</button></div>}
		{error && <p role="alert" className="my-3 text-label text-danger">{error}</p>}
		<p className="mb-5 text-label text-ink-muted">{record?.scope === "builtin" && !copy ? t("agentEditor.saveAsCustom") : t("agentEditor.intro")}</p>
		<fieldset disabled={busy} className="space-y-5 border-0 p-0 disabled:opacity-60">
			<label className="block text-label">{t("agentEditor.nameLabel")}<div className="mt-2 flex items-center gap-2"><span className="text-ink-muted">@</span><Input aria-label={t("agentEditor.callName")} value={draft.name} readOnly={Boolean(record && !copy)} required pattern={record && !copy ? undefined : "[a-z][a-z0-9_-]{0,63}"} className="w-full rounded-lg border border-line bg-input px-3 py-2 font-mono" onChange={event => patch({ name: event.target.value })} /></div></label>
			<label className="block text-label">{t("agentEditor.purposeLabel")}<Input aria-label={t("agentEditor.purpose")} required maxLength={2000} value={draft.description} className="mt-2 w-full rounded-lg border border-line bg-input px-3 py-2" onChange={event => patch({ description: event.target.value })} /></label>
			<div className="flex items-center justify-between gap-3 text-label"><span>{t("agentEditor.scopeLabel")}</span><fieldset disabled={Boolean(record && !copy)} className="border-0 p-0"><InlineSelect ariaLabel={t("agentEditor.scope")} value={scope} options={[{ value: "user", label: t("common.allProjects") }, ...(projectId ? [{ value: "project", label: projectName ?? t("common.currentProject") }] : [])]} onChange={value => { if (value === "project" || value === "user") setScope(value); }} /></fieldset></div>
			<label className="block text-label">{t("agentEditor.instructionsLabel")}<Textarea aria-label={t("agentEditor.instructions")} required maxLength={200000} value={draft.systemPrompt} rows={12} className="mt-2 block min-h-[220px] w-full resize-y rounded-lg border border-line bg-input p-3 text-label leading-relaxed" onChange={event => patch({ systemPrompt: event.target.value })} /></label>
			<div><p className="mb-2 text-label">{t("agentEditor.allowedTools")}</p><label className="flex items-center gap-2 text-label"><Input type="checkbox" checked={draft.tools === "*"} onChange={event => patch({ tools: event.target.checked ? "*" : ["read", "glob", "grep", "ls"] })} />{t("agentEditor.allTools")}</label>
				{draft.tools !== "*" && <div className="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-line p-3">{[...new Set([...tools, ...draft.tools])].map(name => <label key={name} className="flex min-w-0 items-center gap-2 text-detail"><Input type="checkbox" checked={draft.tools !== "*" && draft.tools.includes(name)} onChange={event => { if (draft.tools !== "*") patch({ tools: event.target.checked ? [...draft.tools, name] : draft.tools.filter(tool => tool !== name) }); }} /><span className="break-all font-mono">{name}</span></label>)}</div>}
				<p className="mt-2 text-caption text-ink-muted">{t("agentEditor.draftNote")}</p>
			</div>
			{definition && <div className="text-label"><Disclosure variant="framed" title={t("agentEditor.advanced")}><p className="mb-2 text-detail text-ink-muted">{t("agentEditor.advancedNote")}</p><pre className="overflow-auto whitespace-pre-wrap break-words text-caption">{JSON.stringify({ model: definition.model, output: definition.output, schemaMode: definition.schemaMode, spawns: definition.spawns }, null, 2)}</pre></Disclosure></div>}
		</fieldset>
	</form>;
}
