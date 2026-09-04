/**
 * Turning finished sessions into things worth remembering, without being asked each time.
 *
 * `learn` covers the explicit path: something happens, the model writes it down. What it cannot
 * cover is the lesson nobody noticed at the time — a convention that showed up in three sessions,
 * a command that always has to be run first, a mistake made twice. Those only become visible when
 * you read several sessions together, which is not something anybody does.
 *
 * Three things make this safe to run on its own, and they are the design:
 *
 *   It asks first. Extraction sends conversation content to a model, and a tool that runs locally
 *   by default must not start doing that quietly. Off until someone says yes, once.
 *
 *   It never touches `learned.md`. That file holds what a person or the `learn` tool wrote on
 *   purpose. A pass that rewrites its own output wholesale is only safe because the deliberate
 *   half lives somewhere else.
 *
 *   It takes a lock. Several windows are usually open, and two extractions writing the same file
 *   is how you get half of each.
 */

import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Message, ModelConfig, ProviderConfig } from "../types.ts";
import type { streamAssistant } from "../ai/index.ts";
import { proposeSkill } from "./managed-skills.ts";
import { projectMemoryDir } from "./project-memory.ts";

/**
 * Sessions younger than this are left alone.
 *
 * A conversation that ended twenty minutes ago is one the person is likely still in the middle of
 * — they closed the window to look something up. Summarising it now reads its unfinished half as
 * if it were a conclusion.
 */
export const MIN_AGE_MS = 12 * 60 * 60 * 1000;
/** Beyond this, what a session concluded is probably no longer true of the code. */
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** How many sessions one pass will read. */
export const MAX_SESSIONS = 40;
/** A lock older than this belonged to a window that is gone. */
export const LOCK_STALE_MS = 10 * 60 * 1000;

export interface ExtractionCandidate {
	id: string;
	updatedAt: number;
	messages: Message[];
}

export interface ExtractionResult {
	/** What was written into `MEMORY.md`, or empty when the pass concluded there was nothing. */
	memory: string;
	/** How many sessions it read. */
	sessions: number;
	/** Set when the pass did not run, with the reason. */
	skipped?: string;
	/**
	 * 这几次会话里看出来的一段流程，已经写进待确认区。
	 *
	 * **待确认，不是已启用。** 一个自动生成的技能会改变这个 agent 以后的行为，而看到它生效的
	 * 人多半不记得自己批准过什么——所以它先躺在 `.pending` 里等人点头。见 `managed-skills.ts`。
	 */
	proposedSkill?: string;
}

/**
 * Whether a session is worth reading.
 *
 * Also excludes the very short ones: a two-message session is a question and an answer, and the
 * lessons this is looking for come from work, not from lookups.
 */
export function isCandidate(session: { updatedAt: number; messageCount: number }, now = Date.now()): boolean {
	const age = now - session.updatedAt;
	return age >= MIN_AGE_MS && age <= MAX_AGE_MS && session.messageCount >= 6;
}

/** Take the lock, or report who has it. `null` means somebody else is running. */
export async function acquireLock(dir: string, now = Date.now()): Promise<(() => Promise<void>) | null> {
	await mkdir(dir, { recursive: true });
	const path = join(dir, ".lock");

	const existing = await stat(path).catch(() => null);
	if (existing && now - existing.mtimeMs < LOCK_STALE_MS) return null;
	/*
	 * A stale lock is taken over rather than reported. It means a window closed mid-pass, and the
	 * alternative is memory that stops updating until somebody finds a dotfile and deletes it.
	 */
	await writeFile(path, String(process.pid), "utf8");
	return async () => {
		await rm(path, { force: true }).catch(() => {});
	};
}

/**
 * The prompt that reads sessions and returns lessons.
 *
 * Most of it is about what *not* to return, for the same reason `learn`'s description is: the
 * expensive failure is not an empty file, it is a file of facts that expire. Anything a reader
 * could get by opening the code will be wrong after the next refactor and believed anyway.
 */
export function extractionPrompt(): string {
	return [
		"你在读一个项目最近的几次会话记录，任务是提炼出**下次还用得上**的东西。",
		"",
		"值得记的：",
		"- 这个仓库的约定，尤其是从代码里看不出来的（构建命令、部署流程、为什么某处要那么写）",
		"- 用户纠正过的做法，而且这个纠正会反复适用",
		"- 踩过并解决了的坑，下次还会踩的那种",
		"- 反复出现的工作流（「改完 X 之后总要跑 Y」）",
		"",
		"**不要记：**",
		"- 代码结构、文件位置、函数签名——读代码就知道，而且会过期",
		"- 某一次任务的具体内容",
		"- git 历史里已经有的信息",
		"- 你不确定是不是普遍成立的东西",
		"",
		"记忆库里一条过时的事实比没有这条更糟，因为模型会照着它做决定。宁可少写。",
		"",
		"输出 markdown 列表，每条一行，一两句话，具体可执行。确实没有值得记的就输出「（没有）」。",
	].join("\n");
}

/**
 * 除了记忆条目，还问一句：这里面有没有一段值得做成技能的流程。
 *
 * 一条记忆是「记住这件事」，一个技能是「下次照着做」。「改完 core 之后要跑 `pnpm arch` 和
 * `pnpm typecheck`」写成记忆，模型每轮读到它、然后自己决定要不要照做；写成技能，它在需要
 * 的时候被整段调出来。
 *
 * 分成两次请求而不是一次问两件事：一次请求要两种格式的输出，模型会把两者混在一起，而解析
 * 失败的那一半是静默丢掉的。两次都是便宜模型上的小请求。
 */
export function skillProposalPrompt(): string {
	return [
		"你在读一个项目最近的几次会话记录，找**一段反复出现、下次可以照着做的流程**。",
		"",
		"算的：",
		"- 「改完 X 之后总要跑 Y 和 Z」这种检查清单",
		"- 一件事的固定做法，步骤明确、换个人也能照做",
		"",
		"**不算的：**",
		"- 只出现过一次的事",
		"- 一句约定（那是记忆，不是技能）——「用 pnpm 不用 npm」不该做成技能",
		"- 需要判断力才能执行的事（「审查代码质量」）",
		"",
		"**宁可什么都不给。** 一个自动生成的技能会改变这个 agent 以后的行为，而看到它的人多半",
		"不记得自己批准过什么。只有在你能写出具体步骤时才给。",
		"",
		"有的话按这个格式输出，只输出这三行加正文：",
		"NAME: <小写连字符的名字，三四个词>",
		"DESCRIPTION: <一句话，说清什么时候该用它>",
		"BODY:",
		"<正文，步骤列表>",
		"",
		"没有就只输出「（没有）」。",
	].join("\n");
}

/**
 * 读模型的技能提案。
 *
 * 任何一处不完整都返回 null：一个缺了步骤的技能会以一个人不知道的方式改变 agent 的行为，
 * 而「少一个候选」这件事没有任何代价。
 */
export function parseSkillProposal(text: string): { name: string; description: string; body: string } | null {
	if (text.includes("（没有）") || text.includes("(没有)")) return null;
	const name = /^NAME:\s*(.+)$/m.exec(text)?.[1]?.trim().toLowerCase();
	const description = /^DESCRIPTION:\s*(.+)$/m.exec(text)?.[1]?.trim();
	const body = text.split(/^BODY:\s*$/m)[1]?.trim();
	if (!name || !description || !body) return null;
	if (!/^[a-z][a-z0-9-]{1,40}$/.test(name)) return null;
	return { name, description, body };
}

/** Render sessions compactly enough that several fit in one request. */
export function renderSessions(candidates: ExtractionCandidate[]): string {
	const blocks: string[] = [];
	for (const session of candidates) {
		const lines: string[] = [`## 会话 ${session.id}`];
		for (const message of session.messages) {
			if (message.role === "user" && !message.synthetic) {
				lines.push(`用户：${textOf(message).slice(0, 600)}`);
			} else if (message.role === "assistant") {
				const said = textOf(message).trim();
				if (said) lines.push(`助手：${said.slice(0, 600)}`);
			}
			/*
			 * Tool results are left out entirely. They are the bulk of a transcript and the least
			 * of what it means — file contents and command output describe the state of the code at
			 * one moment, which is exactly the kind of thing that must not become a memory.
			 */
		}
		blocks.push(lines.join("\n"));
	}
	return blocks.join("\n\n");
}

function textOf(message: Message): string {
	return message.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

export interface ExtractOptions {
	cwd: string;
	candidates: ExtractionCandidate[];
	provider: ProviderConfig;
	model: ModelConfig;
	stream: typeof streamAssistant;
	signal?: AbortSignal;
}

/**
 * Read the sessions, write `MEMORY.md`, leave `learned.md` alone.
 *
 * Returns what it wrote so the caller can show it. Nothing here enables anything: the consent
 * check and the scheduling belong to whoever calls this, because they are the parts that differ
 * between a desktop window and a headless run.
 */
export async function extractMemory(options: ExtractOptions): Promise<ExtractionResult> {
	if (options.candidates.length === 0) return { memory: "", sessions: 0, skipped: "没有符合条件的会话" };

	const dir = projectMemoryDir(options.cwd);
	const release = await acquireLock(dir);
	if (!release) return { memory: "", sessions: 0, skipped: "另一个窗口正在抽取" };

	try {
		const stream = options.stream(
			options.provider,
			options.model,
			{
				systemPrompt: extractionPrompt(),
				messages: [
					{ role: "user", content: [{ type: "text", text: renderSessions(options.candidates) }], timestamp: Date.now() },
				],
				tools: [],
			},
			{ signal: options.signal, thinking: "off" },
		);

		/*
		 * A failed request is a pass that did not happen, not an error to surface.
		 *
		 * This runs on its own, without anybody waiting for it. A provider being unreachable means
		 * the memory is not updated this time, which is invisible and correct; raising it would put
		 * an error in front of someone who did not ask for anything.
		 */
		let final: Awaited<ReturnType<typeof stream.next>>;
		try {
			do {
				final = await stream.next();
			} while (!final.done);
		} catch {
			return { memory: "", sessions: options.candidates.length, skipped: "抽取时模型没能返回" };
		}
		const reply = final.value;
		if (reply.stopReason === "error" || reply.stopReason === "aborted") {
			return { memory: "", sessions: options.candidates.length, skipped: "抽取被中断" };
		}

		const text = reply.content
			.filter((block): block is { type: "text"; text: string } => block.type === "text")
			.map((block) => block.text)
			.join("\n")
			.trim();

		/*
		 * "（没有）" is a real answer and must not be written as if it were a lesson. A model told to
		 * find something will find something; leaving it a way to say no is what keeps the file from
		 * filling with restatements of the obvious.
		 */
		if (!text || /^（?没有）?$/.test(text)) return { memory: "", sessions: options.candidates.length, skipped: "这些会话里没有值得记的" };

		const body = [
			"# 从会话里总结的",
			"",
			`由后台抽取生成，读了 ${options.candidates.length} 次会话。可以手改，但下一次抽取会整份重写这个文件——`,
			"要保留的内容请移到 `learned.md`，那个文件抽取永远不碰。",
			"",
			text,
			"",
		].join("\n");

		await mkdir(dir, { recursive: true });
		await writeFile(join(dir, "MEMORY.md"), body, "utf8");

		/*
		 * 再问一次：这里面有没有一段值得做成技能的流程。
		 *
		 * 第二次请求而不是一次问两件事——一次要两种格式的输出，模型会把它们混在一起，而解析
		 * 失败的那一半是静默丢掉的。两次都是便宜模型上的小请求。
		 *
		 * 失败当没有：这一步是锦上添花，而记忆已经写下来了。让它把整次抽取拖失败，是拿一个
		 * 可有可无的东西去赌一个有用的东西。
		 */
		const proposed = await proposeFromSessions(options).catch(() => null);
		return { memory: text, sessions: options.candidates.length, ...(proposed ? { proposedSkill: proposed } : {}) };
	} finally {
		await release();
	}
}

/**
 * 问一次「有没有值得做成技能的流程」，有就写进待确认区。
 *
 * 返回技能名，或者 null——而 null 是常态：绝大多数会话里没有那样的东西，而提示词里特意写了
 * 「宁可什么都不给」。一个被逼着找出来的流程，就是那种会被批准一次然后困扰一年的东西。
 */
async function proposeFromSessions(options: ExtractOptions): Promise<string | null> {
	const stream = options.stream(
		options.provider,
		options.model,
		{
			systemPrompt: skillProposalPrompt(),
			messages: [{ role: "user", content: [{ type: "text", text: renderSessions(options.candidates) }], timestamp: Date.now() }],
			tools: [],
		},
		{ signal: options.signal, thinking: "off" },
	);

	let final: Awaited<ReturnType<typeof stream.next>>;
	do {
		final = await stream.next();
	} while (!final.done);

	const reply = final.value;
	if (reply.stopReason === "error" || reply.stopReason === "aborted") return null;

	const text = reply.content
		.filter((block): block is { type: "text"; text: string } => block.type === "text")
		.map((block) => block.text)
		.join("\n");

	const proposal = parseSkillProposal(text);
	if (!proposal) return null;
	const written = await proposeSkill(options.cwd, proposal);
	return written ? proposal.name : null;
}

/** What was extracted last time, for injection alongside `learned.md`. */
export async function readExtractedMemory(cwd: string): Promise<string> {
	const raw = await readFile(join(projectMemoryDir(cwd), "MEMORY.md"), "utf8").catch(() => null);
	if (raw === null) return "";
	/*
	 * The header explains the file to a person opening it and means nothing to the model, so it is
	 * dropped rather than spent on every prompt in this project.
	 */
	const body = raw.split("\n").filter((line) => !line.startsWith("#") && !line.startsWith("由后台抽取") && !line.startsWith("要保留的内容"));
	return body.join("\n").trim();
}

/** Sessions on disk that are worth a pass, newest first. */
export async function findCandidates(
	sessionsRoot: string,
	projectId: string,
	load: (id: string) => Promise<Message[]>,
	now = Date.now(),
): Promise<ExtractionCandidate[]> {
	const dir = join(sessionsRoot, projectId);
	const files = await readdir(dir).catch(() => []);
	const found: ExtractionCandidate[] = [];

	for (const file of files.filter((f) => f.endsWith(".jsonl"))) {
		const info = await stat(join(dir, file)).catch(() => null);
		if (!info) continue;
		const messages = await load(file.replace(/\.jsonl$/, "")).catch(() => []);
		if (!isCandidate({ updatedAt: info.mtimeMs, messageCount: messages.length }, now)) continue;
		found.push({ id: file.replace(/\.jsonl$/, ""), updatedAt: info.mtimeMs, messages });
	}

	return found.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, MAX_SESSIONS);
}
