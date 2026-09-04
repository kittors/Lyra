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
		return { memory: text, sessions: options.candidates.length };
	} finally {
		await release();
	}
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
