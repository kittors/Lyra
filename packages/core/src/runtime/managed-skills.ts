/**
 * 从过去的会话里长出来的技能，以及为什么它们默认不生效。
 *
 * 后台抽取读几次会话，能看出「改完 core 之后要跑 `pnpm arch`」这种反复出现的流程。把它写成
 * 一个技能，下次就不用有人再想起来。
 *
 * **而自动生成的东西默认生效是危险的。** 它会以一个人不知道的方式改变 agent 的行为——下次
 * 它多跑了两条命令，而没有任何地方说得出为什么。所以候选先进「待确认」，人点了才算数。
 *
 * 这一条不是谨慎，是这个功能能不能存在的前提：一个会自己给自己加规矩的 agent，只有在那些
 * 规矩每一条都经过人点头时，才是能用的。
 */

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { projectMemoryDir } from "./project-memory.ts";

/** 待确认的候选放这儿；批准之后才搬进 `skills/`。 */
export function pendingSkillsDir(cwd: string): string {
	return join(projectMemoryDir(cwd), "skills", ".pending");
}

/** 已批准的托管技能。能力层从这里读。 */
export function managedSkillsDir(cwd: string): string {
	return join(projectMemoryDir(cwd), "skills");
}

export interface SkillCandidate {
	/** 目录名，也是技能名。 */
	name: string;
	/** 一行说明，模型靠它决定要不要用。 */
	description: string;
	/** SKILL.md 的正文。 */
	body: string;
}

/** 名字要能当目录名，也要能被模型按名字叫出来。 */
const NAME = /^[a-z][a-z0-9-]{1,40}$/;

/**
 * 候选写进待确认区。
 *
 * 同名的直接覆盖：一个还没被批准的候选没有任何人依赖它，而两份关于同一件事的候选会让确认
 * 这个动作变成一次比较。已经批准的那些不在这个目录里，所以覆盖不到。
 */
export async function proposeSkill(cwd: string, candidate: SkillCandidate): Promise<string | null> {
	if (!NAME.test(candidate.name) || !candidate.description.trim() || !candidate.body.trim()) return null;

	const dir = pendingSkillsDir(cwd);
	await mkdir(dir, { recursive: true });
	const path = join(dir, `${candidate.name}.md`);
	await writeFile(path, renderSkill(candidate), "utf8");
	return path;
}

/** 待确认的全部候选。 */
export async function pendingSkills(cwd: string): Promise<SkillCandidate[]> {
	const dir = pendingSkillsDir(cwd);
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	const out: SkillCandidate[] = [];
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
		const raw = await readFile(join(dir, entry.name), "utf8").catch(() => null);
		if (raw === null) continue;
		const parsed = parseSkill(raw);
		if (parsed) out.push({ ...parsed, name: entry.name.replace(/\.md$/, "") });
	}
	return out;
}

/**
 * 批准一个候选：从待确认区搬进 `skills/<name>/SKILL.md`。
 *
 * `content` 可以是人编辑过的版本——「编辑后启用」跟「启用」是同一个动作的两种入口，而不是
 * 两条代码路径。
 */
export async function approveSkill(cwd: string, name: string, content?: string): Promise<string | null> {
	if (!NAME.test(name)) return null;
	const source = join(pendingSkillsDir(cwd), `${name}.md`);
	const raw = content ?? (await readFile(source, "utf8").catch(() => null));
	if (raw === null) return null;

	const dir = join(managedSkillsDir(cwd), name);
	await mkdir(dir, { recursive: true });
	const path = join(dir, "SKILL.md");
	await writeFile(path, raw, "utf8");
	await rm(source, { force: true });
	return path;
}

/** 否决一个候选。文件删掉——留着它只会在下次列表里再问一次。 */
export async function rejectSkill(cwd: string, name: string): Promise<boolean> {
	if (!NAME.test(name)) return false;
	await rm(join(pendingSkillsDir(cwd), `${name}.md`), { force: true });
	return true;
}

/*
 * 这里曾经有一个 `approvedSkills`，注释写着「给设置页用」。
 *
 * 设置页不需要它：已经批准的技能由 `managedProvider` 供应，跟人写的那些走同一个列表、显示在
 * 同一个地方。为想象中的调用方准备的函数，在真的调用方出现时通常是不合身的——这次是扫描器
 * 在同一个提交里当场抓到的，而不是三个月后。
 */

function renderSkill(candidate: SkillCandidate): string {
	return `---\nname: ${candidate.name}\ndescription: ${JSON.stringify(candidate.description.trim())}\n---\n\n${candidate.body.trim()}\n`;
}

function parseSkill(raw: string): { description: string; body: string } | null {
	const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(raw);
	if (!match) return null;
	const described = /^description:\s*(.+)$/m.exec(match[1]);
	if (!described) return null;
	let description = described[1].trim();
	try {
		if (description.startsWith('"')) description = String(JSON.parse(description));
	} catch {
		// 引号没闭合就照原样用——一个引号问题不该让候选整个消失。
	}
	return { description, body: match[2].trim() };
}
