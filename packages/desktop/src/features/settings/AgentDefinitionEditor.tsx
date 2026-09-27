import { ArrowLeft, PenLine, Save, Shuffle, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { AgentDefinitionRecord, AgentDefinitionSave, AgentDraft } from "@lyra/core";
import { TextArea } from "../../ui/inputs/TextArea.tsx";
import { Disclosure } from "../../ui/layout/Disclosure.tsx";
import { AgentAvatar } from "../../ui/avatar/AgentAvatar.tsx";
import { Button } from "../../ui/primitives/Button.tsx";
import { Popover, usePopover } from "../../ui/overlay/Popover.tsx";
import { formatAvatar, freshAvatar, parseAvatar, type Avatar } from "../../lib/agent-avatar.ts";
import type { AvatarOf } from "../../store/agent-avatars.ts";
import { Segmented, TextInput } from "./controls.tsx";
import { AvatarPicker, avatarName } from "./AvatarPicker.tsx";
import { ToolPicker } from "./ToolPicker.tsx";
import { bridge } from "../../services/index.ts";
import { useI18n } from "../../i18n/index.ts";

// Keep unsaved text through settings navigation without writing instructions to browser storage.
const drafts = new Map<string, { draft: AgentDraft; scope: "user" | "project" }>();
const READ_ONLY = ["read", "glob", "grep", "ls"];

/**
 * 写一个智能体：先是它是谁（脸、名字、干什么的），再是它怎么干（指令、能用哪些工具）。
 *
 * 脸放在最前面，而且新建时就已经挑好了一张没人用的——它是这个智能体在设置页、`@` 菜单、面板
 * 里被认出来的方式，不该是一个等人想起来才去填的空。不满意就点它换，或者掷一次骰子。
 */
export function AgentDefinitionEditor({ record, copy, projectId, projectName, tools, avatarOf, taken, onClose, onSaved }: {
	record?: AgentDefinitionRecord; copy?: boolean; projectId: string | null; projectName?: string;
	tools: string[];
	/** 名单里每个人现在的脸，用来给新来的挑一张没人用的。 */
	avatarOf: AvatarOf;
	/** 除了正在编辑的这一个之外，每个人和他在用的脸。 */
	taken: { name: string; avatar: Avatar }[];
	onClose: () => void; onSaved: (name: string, warning?: string) => void;
}) {
	const { t } = useI18n();
	const definition = record?.definition;
	const draftKey = JSON.stringify([projectId, record?.id ?? "new", Boolean(copy)]);
	const remembered = drafts.get(draftKey);
	// 新建和复制一张新脸（复制出来的是另一个人）；编辑沿用它现在那张。只在第一次渲染时定下来。
	const [initialAvatar] = useState(() => formatAvatar(record && !copy ? avatarOf(record.definition.name) : freshAvatar(taken.map(other => other.avatar))));
	const original: AgentDraft = { name: copy ? `${definition?.name ?? "agent"}-copy` : definition?.name ?? "", description: definition?.description ?? "", systemPrompt: definition?.systemPrompt ?? "", tools: definition?.tools ?? READ_ONLY, avatar: initialAvatar };
	const [draft, setDraft] = useState(remembered?.draft ?? original);
	const [scope, setScope] = useState<"user" | "project">(remembered?.scope ?? (record?.scope === "project" && !copy ? "project" : "user"));
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [leaving, setLeaving] = useState(false);
	const [rolls, setRolls] = useState(0);
	const picker = usePopover();
	const dirty = JSON.stringify(draft) !== JSON.stringify(original) || scope !== (record?.scope === "project" && !copy ? "project" : "user");
	useEffect(() => { if (dirty) drafts.set(draftKey, { draft, scope }); else drafts.delete(draftKey); }, [draftKey, draft, scope, dirty]);
	const discard = () => { drafts.delete(draftKey); onClose(); };
	const patch = (next: Partial<AgentDraft>) => setDraft(current => ({ ...current, ...next }));
	const face = parseAvatar(draft.avatar) ?? parseAvatar(initialAvatar) ?? freshAvatar(taken.map(other => other.avatar));
	// 谁在用哪张：选脸的格子据此把别人的那张标出来、不让选，提示里说是谁。
	const owners = useMemo(() => new Map(taken.map(other => [formatAvatar(other.avatar), other.name])), [taken]);
	const editing = Boolean(record && !copy);
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
		 * 两个一样高的盒子，才谈得上居中：返回键、标题、保存键都是 32px 一行。标题的行盒比字形高出
		 * 一截，只靠 `items-center` 对齐盒子的中线，字会看着比箭头低——所以标题也是 `leading-8`。
		 */}
		<div className="sticky top-0 z-10 -mx-1 flex items-center gap-2 bg-shell px-1 py-3">
			<button type="button" aria-label={t("agentEditor.back")} data-ly-tip={t("agentEditor.back")} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover hover:text-ink" disabled={busy} onClick={() => dirty ? setLeaving(true) : onClose()}><ArrowLeft size={17} /></button>
			<h1 className="min-w-0 flex-1 truncate text-title leading-8 font-semibold">{editing && record ? t("agentEditor.editNamed", { name: record.definition.name }) : t("agents.add")}</h1>
			<Button type="submit" variant="primary" disabled={busy} loading={busy} icon={<Save size={15} aria-hidden />} label={busy ? t("common.saving") : t("common.save")} />
		</div>
		{/*
		 * 「有改动没保存」，后面跟一支笔和一个垃圾桶。
		 *
		 * 这两颗是全app里最需要看清楚的一对：一个回到编辑，一个把刚写的东西扔掉。所以它们不靠
		 * 形状之外的东西区分——笔和桶本来就长得完全不一样，颜色再补一层（info 对 danger），
		 * 具体那句「丢弃改动」留在 tooltip 和读屏上。
		 */}
		{leaving && <div role="alert" className="ly-enter my-3 flex flex-wrap items-center gap-3 rounded-[12px] bg-card px-4 py-2.5 text-label">{t("agentEditor.unsaved")}<span className="flex-1" /><button type="button" data-ly-tip={t("agentEditor.keepEditing")} aria-label={t("agentEditor.keepEditing")} className="grid h-7 w-7 place-items-center rounded-lg text-info hover:bg-card-hover" onClick={() => setLeaving(false)}><PenLine size={14} strokeWidth={1.9} aria-hidden /></button><button type="button" data-ly-tip={t("agentEditor.discard")} aria-label={t("agentEditor.discard")} className="grid h-7 w-7 place-items-center rounded-lg text-danger hover:bg-card-hover" onClick={discard}><Trash2 size={14} strokeWidth={1.9} aria-hidden /></button></div>}
		{error && <p role="alert" className="my-3 text-label text-danger">{error}</p>}
		<p className="mb-5 text-label text-ink-muted">{record?.scope === "builtin" && !copy ? t("agentEditor.saveAsCustom") : t("agentEditor.intro")}</p>
		<fieldset disabled={busy} className="space-y-4 border-0 p-0 disabled:opacity-60">
			{/* 它是谁 */}
			<section className="@container rounded-[14px] border border-line bg-card/40 p-4" data-agent-identity="">
				<div className="flex flex-col gap-4 @md:flex-row @md:items-center">
					{/*
					 * 脸是一块能点的底：点它挑，角上那颗骰子直接换一张没人用的。两颗按钮叠在一块底上而不是
					 * 套在一起——按钮里不能再有按钮。
					 */}
					<div className="relative grid h-[92px] w-[92px] shrink-0 place-items-center rounded-[24px] bg-card transition-colors duration-[var(--ly-t-quick)] hover:bg-card-hover" data-ly-avatar-host="">
						<button type="button" aria-label={t("agentEditor.pickAvatar")} data-ly-tip={`${t("agentEditor.pickAvatar")} · ${avatarName(face, t)}`} aria-haspopup="dialog" aria-expanded={picker.open}
							data-agent-avatar={formatAvatar(face)} onClick={picker.toggle} className="absolute inset-0 rounded-[24px]" />
						<AgentAvatar avatar={face} size={60} seed={draft.name || "new"} host="[data-ly-avatar-host]" cheer={rolls || null} className="pointer-events-none" />
						<button type="button" aria-label={t("agentEditor.shuffleAvatar")} data-ly-tip={t("agentEditor.shuffleAvatar")} data-agent-shuffle=""
							onClick={() => { patch({ avatar: formatAvatar(freshAvatar([...taken.map(other => other.avatar), face])) }); setRolls(n => n + 1); }}
							className="absolute right-1 bottom-1 grid h-[26px] w-[26px] place-items-center rounded-full bg-shell text-ink-muted transition-[color,transform] duration-[var(--ly-t-quick)] hover:rotate-[20deg] hover:text-ink active:scale-90">
							<Shuffle size={13} strokeWidth={2} aria-hidden />
						</button>
					</div>
					<div className="min-w-0 flex-1 space-y-3.5">
						{/* 和设置页其余每一个文字框同一颗胶囊（`.ly-field`）。`@` 画在框里：它是名字的一部分，调用时就是这么写的。 */}
						<label className="block"><span className="mb-1.5 block text-label text-ink-muted">{t("agentEditor.nameLabel")}</span>
							<span className="relative block"><span aria-hidden className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 font-mono text-label text-ink-faint">@</span>
								<TextInput aria-label={t("agentEditor.callName")} value={draft.name} readOnly={editing} required mono pattern={editing ? undefined : "[a-z][a-z0-9_-]{0,63}"} placeholder="docs-writer" style={{ paddingLeft: 32 }} className="w-full" onChange={next => patch({ name: next })} /></span></label>
						<label className="block"><span className="mb-1.5 block text-label text-ink-muted">{t("agentEditor.purposeLabel")}</span>
							<TextInput aria-label={t("agentEditor.purpose")} required maxLength={2000} value={draft.description} placeholder={t("agentEditor.purposePlaceholder")} className="w-full" onChange={next => patch({ description: next })} /></label>
					</div>
				</div>
				<div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line-soft pt-3.5 text-label">
					<span className="text-ink-muted">{t("agentEditor.scopeLabel")}</span>
					{/* 已有的定义不能原地换范围——那是另一个文件。要换就复制一份。 */}
					<fieldset disabled={editing} aria-label={t("agentEditor.scope")} className="border-0 p-0 disabled:opacity-60">
						<Segmented value={scope} onChange={value => setScope(value)} options={[{ value: "user" as const, label: t("common.allProjects") }, ...(projectId ? [{ value: "project" as const, label: projectName ?? t("common.currentProject") }] : [])]} />
					</fieldset>
				</div>
			</section>

			{/* 它怎么干 */}
			<label className="block"><span className="mb-1.5 block text-label text-ink-muted">{t("agentEditor.instructionsLabel")}</span>
				<TextArea aria-label={t("agentEditor.instructions")} required maxLength={200000} value={draft.systemPrompt} rows={12} resizable placeholder={t("agentEditor.instructionsPlaceholder")} className="min-h-[220px]" onChange={next => patch({ systemPrompt: next })} /></label>
			<ToolPicker tools={tools} value={draft.tools} readOnly={READ_ONLY} onChange={next => patch({ tools: next })} />
			<p className="text-caption leading-relaxed text-ink-faint">{t("agentEditor.draftNote")}</p>
			{definition && <div className="text-label"><Disclosure variant="framed" title={t("agentEditor.advanced")}><p className="mb-2 text-detail text-ink-muted">{t("agentEditor.advancedNote")}</p><pre className="overflow-auto whitespace-pre-wrap break-words text-caption">{JSON.stringify({ model: definition.model, output: definition.output, schemaMode: definition.schemaMode, spawns: definition.spawns }, null, 2)}</pre></Disclosure></div>}
		</fieldset>
		{picker.open && <Popover anchor={picker.anchor} onClose={picker.close} placement="bottom" align="start" width={316} label={t("agentEditor.pickAvatar")}>
			<AvatarPicker value={face} owners={owners} onChange={next => { patch({ avatar: formatAvatar(next) }); setRolls(n => n + 1); }} />
		</Popover>}
	</form>;
}
