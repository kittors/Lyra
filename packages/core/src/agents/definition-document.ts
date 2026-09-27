import { Document, isMap, parseDocument } from "yaml";
import type { AgentDefinition } from "../agents-builtin.ts";

export interface AgentDraft {
	name: string;
	description: string;
	systemPrompt: string;
	tools: string[] | "*";
	/** `形状-颜色`。不给就不动文件里原有的那一行——见 `AgentDefinition.avatar`。 */
	avatar?: string;
}

/** 只认形状，不认名单：名单归界面，这里只挡掉写不进 YAML 一行、或者明显不是这个意思的东西。 */
const AVATAR = /^[a-z]{2,16}-[a-z]{2,16}$/;

export interface AgentDefinitionRecord {
	id: string;
	definition: AgentDefinition;
	scope: "builtin" | "user" | "project";
	editable: boolean;
	customized: boolean;
	revision: string;
	raw: string;
	shadowedSources: string[];
}

export interface AgentDefinitionSave {
	id?: string;
	copyFrom?: string;
	revision?: string;
	scope: "user" | "project";
	draft: AgentDraft;
}

/** Patch only form-owned fields; unknown metadata and advanced constraints survive editing. */
export function renderAgentDocument(draft: AgentDraft, raw?: string, builtin?: AgentDefinition): string {
	const front = raw?.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (raw && !front) throw new Error("定义缺少完整的 YAML 元数据，请先修正原文件");
	/*
	 * 新文件从一张空的块状表开始。从前是 `parseDocument("{}")`，那张表带着「流式」的记号，于是每个
	 * 新建的定义头部都被写成一行 `{ name: …, tools: [ read ] }`——合法，但没人愿意手改它。
	 */
	const document = front ? parseDocument(front[1]) : new Document({});
	if (document.errors.length || !isMap(document.contents)) throw new Error("智能体元数据必须是有效的 YAML 对象");
	if (builtin) {
		// 脸也跟着走：改一下内置的指令，不该顺手把它变成另一个人。
		for (const key of ["model", "output", "schemaMode", "spawns", "avatar"] as const) {
			if (builtin[key] !== undefined) document.set(key, builtin[key]);
		}
	}
	document.set("name", draft.name);
	document.set("description", draft.description);
	document.set("tools", draft.tools);
	if (draft.avatar) document.set("avatar", draft.avatar);
	return `---\n${document.toString()}---\n${draft.systemPrompt}\n`;
}

export function validateAgentDraft(value: AgentDraft, tools: readonly string[], existing?: AgentDefinition): void {
	if (!value || typeof value.name !== "string" || typeof value.description !== "string" || typeof value.systemPrompt !== "string") throw new Error("智能体字段不完整");
	if (existing ? value.name !== existing.name : !/^[a-z][a-z0-9_-]{0,63}$/.test(value.name) || value.name === "compact") throw new Error("调用名不可用：使用小写字母、数字、连字符或下划线");
	if (!value.description.trim() || !value.systemPrompt.trim()) throw new Error("请填写用途和指令");
	if (value.systemPrompt.length > 200_000 || value.description.length > 2000) throw new Error("智能体指令或用途过长");
	if (value.tools !== "*" && (!Array.isArray(value.tools) || value.tools.some(name => typeof name !== "string"))) throw new Error("工具权限格式无效");
	if (value.avatar !== undefined && (typeof value.avatar !== "string" || !AVATAR.test(value.avatar))) throw new Error("形象格式无效");
	const previous = existing?.tools === "*" ? [] : existing?.tools ?? [];
	if (value.tools !== "*" && value.tools.some(name => !tools.includes(name) && !previous.includes(name))) throw new Error("存在不可用的工具，请重新选择");
}
